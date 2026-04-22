-- ============================================================================
-- Afterpay — Unique Queues with Contact Volume (Last 30 Days)
-- ============================================================================
-- Returns one row per (queue_id, queue_name) with metadata and volume.
--
-- Source: ap_cur_xoop_g.operation.m_zendesk_tickets_base (Afterpay-only)
-- Metadata: fivetran.app_support.cust_ops_queue_mapping (BRAND = 'AFTERPAY')
-- Join:  tickets_base.group_id  ->  cust_ops_queue_mapping.queue_id
--        fallback on queue_name when queue_id has no match
--
-- Channel mapping (from raw ticket channel):
--   native_messaging -> Messaging
--   voice            -> Voice
--   web, email       -> Email/Other
--
-- Business-line assignment:
--   1. Primary — exact queue_name match against `business_lines_best`
--      (columns A:B of the business_lines_best tab), filtered by channel.
--   2. Fallback — derived from WFM regex mapping (group_id lists + tag
--      heuristics). Less accurate; business_lines from business_lines_wfm.
-- ============================================================================

with volumes as (

    select group_id :: varchar(255)   as queue_id
        , group_name                  as queue_name
        , case channel
            when 'native_messaging' then 'Messaging'
            when 'voice'            then 'Voice'
            when 'web'              then 'Email/Other'
            when 'email'            then 'Email/Other'
          end as channel_simplified
        , count(distinct zticket_id) as contacts_last_30d

    from ap_cur_xoop_g.operation.m_zendesk_tickets_base

    where created_date_local :: date >= current_date - 30
        and created_date_local :: date <  current_date
        and direction   = 'inbound'
        and department  = 'customer_service'
        and role_type   = 'front_office'
        and channel in ('native_messaging', 'web', 'voice', 'email')
        -- Exclude test queues
        and group_name not ilike '%automation test%'

    group by 1, 2, 3

)

, meta_by_id as (

    select queue_id :: varchar(255)                                                    as queue_id
        , listagg(distinct brand,          ', ') within group (order by brand)          as brand
        , listagg(distinct business_area,  ', ') within group (order by business_area)  as business_area
        , listagg(distinct geography,      ', ') within group (order by geography)      as geography
        , listagg(distinct language,       ', ') within group (order by language)       as language

    from fivetran.app_support.cust_ops_queue_mapping

    where upper(brand) = 'AFTERPAY'
        and queue_id is not null

    group by 1

)

, meta_by_name as (

    select queue_name
        , listagg(distinct brand,          ', ') within group (order by brand)          as brand
        , listagg(distinct business_area,  ', ') within group (order by business_area)  as business_area
        , listagg(distinct geography,      ', ') within group (order by geography)      as geography
        , listagg(distinct language,       ', ') within group (order by language)       as language

    from fivetran.app_support.cust_ops_queue_mapping

    where upper(brand) = 'AFTERPAY'
        and queue_name is not null

    group by 1

)

-- ------------------------------------------------------------------------
-- business_lines_best — hand-curated queue_name -> business_line mapping,
-- loaded from columns A:B of the `business_lines_best` tab in the
-- companion Google Sheet. Channel column is 'Digital' or 'Voice'; Digital
-- covers our 'Messaging' + 'Email/Other' simplified channels.
-- ------------------------------------------------------------------------
, business_lines_best as (

    select column1 as business_line
        , column2 as bl_channel
    from (values
          ('Global Digital',              'Digital')
        , ('Global Digital',              'Voice')
        , ('Global ID Verification',      'Digital')
        , ('Global Help With Repayments', 'Digital')
        , ('Global Refund/ Return Support','Digital')
        , ('ANZ Escalations',             'Digital')
        , ('ANZ Escalations',             'Voice')
        , ('ANZ Voice',                   'Digital')
        , ('ANZ Voice',                   'Voice')
        , ('Licenced Support Team (US)',  'Digital')
        , ('Licenced Support Team (US)',  'Voice')
        , ('Licenced Team (US)',          'Digital')
        , ('Licenced Team (US)',          'Voice')
        , ('NA Escalations',              'Digital')
        , ('NA Escalations',              'Voice')
        , ('UK Escalations',              'Digital')
        , ('UK Escalations',              'Voice')
        , ('UK Voice',                    'Digital')
        , ('UK Voice',                    'Voice')
        , ('USA Voice (DO NOT ASSIGN)',   'Digital')
        , ('USA Voice (DO NOT ASSIGN)',   'Voice')
    )

)

-- ------------------------------------------------------------------------
-- Base enriched rowset (queue + metadata).
-- ------------------------------------------------------------------------
, enriched as (

    select coalesce(mid.brand, mnm.brand, 'Afterpay')                   as brand
        , v.channel_simplified                                          as channel
        , v.queue_id
        , trim(v.queue_name)                                            as queue_name
        , coalesce(mid.business_area, mnm.business_area)                as business_area
        , coalesce(mid.geography,     mnm.geography)                    as geography
        , coalesce(mid.language,      mnm.language)                     as language
        , v.contacts_last_30d

    from volumes v

    left join meta_by_id   mid on v.queue_id   = mid.queue_id
    left join meta_by_name mnm on trim(v.queue_name) = trim(mnm.queue_name)
                               and mid.queue_id is null

    where v.channel_simplified is not null

)

-- ------------------------------------------------------------------------
-- Step 4: primary match against business_lines_best by exact queue_name
-- (case-insensitive) + channel group.
-- ------------------------------------------------------------------------
, best_match as (

    select e.queue_id
        , e.queue_name
        , e.channel
        , max(b.business_line) as business_line_best

    from enriched e

    left join business_lines_best b
        on upper(trim(e.queue_name)) = upper(trim(b.business_line))
       and (
            (b.bl_channel = 'Digital' and e.channel in ('Messaging', 'Email/Other'))
         or (b.bl_channel = 'Voice'   and e.channel = 'Voice')
       )

    group by 1, 2, 3

)

-- ------------------------------------------------------------------------
-- Resolve business line per queue. Pick order:
--   1. Primary — `business_lines_best` match
--   2. WFM regex approximation (group_id lists + queue_name heuristics)
--   3. Fallback — queue_name itself
-- Then:
--   4. Collapse country-specific Digital variants into 'Global Digital'
--   5. Derive queue_owner from queue_name patterns
-- ------------------------------------------------------------------------
, assigned as (

    select e.brand
        , e.channel
        , e.queue_id
        , e.queue_name
        , e.business_area
        , e.geography
        , e.language
        , e.contacts_last_30d

        , coalesce(
              bm.business_line_best

            -- --- WFM fallback ---
            , case
                  -- Voice (WFM matches by phone; approximated via queue_name/id)
                  when e.channel = 'Voice' and (e.queue_id = '360002304871' or e.queue_name ilike '%USA Voice%' or e.queue_name ilike '%US/CA%') then 'NA Voice'
                  when e.channel = 'Voice' and e.queue_name ilike '%NA Escalations%'                                                            then 'NA Voice'
                  when e.channel = 'Voice' and e.queue_id in ('360000165603', '1900000606268')                                                  then 'NA Voice'
                  when e.channel = 'Voice' and e.queue_name ilike '%ANZ Voice%'                                                                 then 'ANZ Voice'
                  when e.channel = 'Voice' and e.queue_id in ('360000347463', '900002982606', '900006461246')                                   then 'ANZ Voice'
                  when e.channel = 'Voice' and e.queue_name ilike '%UK Voice%'                                                                  then 'UK Voice'
                  when e.channel = 'Voice' and e.queue_id = '900005198946'                                                                      then 'UK Voice'
                  when e.channel = 'Voice' and e.queue_id in ('11112590006553', '11112517565849')                                               then 'Pay Monthly'
                  when e.channel = 'Voice' and e.queue_name ilike '%merchant admin%' and coalesce(e.geography, '') ilike '%UK%'                 then 'UK Merchant Admin'
                  when e.channel = 'Voice' and e.queue_name ilike '%merchant admin%' and coalesce(e.geography, '') ilike '%ANZ%'                then 'ANZ Merchant Admin'
                  when e.channel = 'Voice' and e.queue_name ilike '%merchant admin%'                                                            then 'NA Merchant Admin'

                  -- Queue-name-based globals (tag regex approximations)
                  when e.queue_name ilike '%social%' or e.queue_name ilike '%reviews%' then 'Global Social Media'
                  when e.queue_name ilike '%trust%pilot%'                              then 'Global Trust Pilot'
                  when e.queue_name ilike '%manual id%'                                then 'Manual ID'

                  -- Exclusive queue_ids
                  when e.queue_id = '360005399612'                                     then 'Chargebacks'
                  when e.queue_id = '360003685331'                                     then 'Global Fin rec'
                  when e.queue_id = '360006023412'                                     then 'Global Investigations'
                  when e.queue_id = '900006950386'                                     then 'Global Merchant Shop directory'
                  when e.queue_id = '900006794786'                                     then 'Global | Cards'
                  when e.queue_id in ('11112590006553', '11112517565849')              then 'Pay Monthly'
                  when e.queue_id = '28313926'                                         then 'ANZ Merchant Disputes'
                  when e.queue_id = '360003676691'                                     then 'UK Collections'
                  when e.queue_id in ('360000165603', '1900000606268')                 then 'NA Merchant Admin'

                  -- Shared queue_ids — disambiguate by geography
                  when e.queue_id = '900005198946'                                                                       then 'UK Merchant Admin'
                  when e.queue_id in ('360000347463', '900002982606', '900006461246')
                       and coalesce(e.geography, '') ilike '%ANZ%'                                                       then 'ANZ Merchant Admin'
                  when e.queue_id in ('28217723', '900004957263')
                       and coalesce(e.geography, '') ilike '%ANZ%'                                                       then 'ANZ Collection'
                  when e.queue_id = '28217723'                                                                           then 'NA Collections'

                  -- Digital groups by country
                  when e.channel in ('Messaging', 'Email/Other')
                       and coalesce(e.geography, '') ilike '%UK%'
                       and e.queue_id in (
                           '360003944332','360003939312','900001251243','360004783172','360003944352',
                           '900004545486','900004196466','4410942651801','360002545312',
                           '39151440833177','40123058050969'
                       )                                                                                                 then 'UK Digital'
                  when e.channel in ('Messaging', 'Email/Other')
                       and coalesce(e.geography, '') ilike '%ANZ%'
                       and e.queue_id in (
                           '22390105','28181986','360007575272','360002634032','360002545312',
                           '360000291363','25821203','360000435026','360000285926','900004545486',
                           '4410942651801','39151440833177','40123058050969'
                       )                                                                                                 then 'ANZ Digital'
                  when e.channel in ('Messaging', 'Email/Other')
                       and coalesce(e.geography, '') ilike any ('%USA%', '%NA%', '%CA%', '%Global%')
                       and e.queue_id in (
                           '360000192803','360002304871','360004985831','360007575272','360002545312',
                           '900001255326','22390105','900003098286','900003098266','28181986',
                           '900004545486','4410942651801','4415973458457',
                           '39151440833177','40123058050969'
                       )                                                                                                 then 'NA Digital'

                  -- Best-effort regional fallbacks for queue_name patterns
                  when coalesce(e.geography, '') ilike '%ANZ%' and e.queue_name ilike '%escalation%'                     then 'ANZ Digital'
                  when coalesce(e.geography, '') ilike '%UK%'  and e.queue_name ilike '%escalation%'                     then 'UK Digital'
                  when coalesce(e.geography, '') ilike any ('%USA%', '%NA%', '%CA%') and e.queue_name ilike '%escalation%' then 'NA Digital'
                  when e.queue_name ilike '%USA Digital%' or e.queue_name ilike '%CAN Digital%'                          then 'NA Digital'
                  when e.queue_name ilike '%UK Digital%'                                                                 then 'UK Digital'
                  when e.queue_name ilike '%ANZ Digital%'                                                                then 'ANZ Digital'

                  else null
              end

            -- --- Final fallback: queue_name itself ---
            , e.queue_name
          ) as raw_business_line

    from enriched e

    left join best_match bm
        on bm.queue_id   = e.queue_id
       and bm.queue_name = e.queue_name
       and bm.channel    = e.channel

)

select a.brand
    , a.channel
    , a.queue_id
    , a.queue_name
    , a.business_area

    -- Collapse country-specific digital variants into a single Global Digital bucket.
    , case
          when a.raw_business_line ilike any (
              '%Global Digital%', '%NA Digital%', '%UK Digital%', '%ANZ Digital%',
              '%CAN Digital%', '%USA Digital%'
          ) then 'Global Digital'
          else a.raw_business_line
      end                                            as queue_group

    -- For now, queue_function mirrors queue_group.
    , case
          when a.raw_business_line ilike any (
              '%Global Digital%', '%NA Digital%', '%UK Digital%', '%ANZ Digital%',
              '%CAN Digital%', '%USA Digital%'
          ) then 'Global Digital'
          else a.raw_business_line
      end                                            as queue_function

    -- Queue owner: best-effort bucketing based on queue_name / queue_group.
    , case
          -- Risk Operations: fraud, chargebacks, investigations, card/token issues, ID verification.
          when a.queue_name ilike any (
              '%chargeback%', '%investigation%', '%fin rec%', '%token removal%',
              '%id verification%', '%manual id%', '%fraud%', '%risk%', '%cards%'
          ) then 'Risk Operations'

          -- Compliance Operations: regulated functions — hardship, licensed lending,
          -- pay monthly, collections, complaints, acknowledgement, help with repayments.
          when a.queue_name ilike any (
              '%licenced%', '%licensed%', '%pay monthly%', '%collection%',
              '%hardship%', '%acknowledgement%', '%complaint%', '%help with repayments%'
          ) then 'Compliance Operations'

          -- Default: Customer Operations (voice, digital, escalations, merchant, social, etc.)
          else 'Customer Operations'
      end                                            as queue_owner

    , a.geography
    , a.language
    , a.contacts_last_30d

from assigned a

order by
    case a.channel
        when 'Voice'       then 1
        when 'Messaging'   then 2
        when 'Email/Other' then 3
    end
    , a.contacts_last_30d desc
;
