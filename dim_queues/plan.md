# dim_queues — Plan

## Overview

Build a queue-level dimension table for Afterpay that enriches every customer-contact queue with the cleanest available metadata: channel, contact volume, business area, business line ("queue group"), queue function, queue owner, geography, and language. Source data is `ap_cur_xoop_g.operation.m_zendesk_tickets_base`; metadata is joined from `fivetran.app_support.cust_ops_queue_mapping` plus two hand-curated Google Sheet tabs.

Output is written to the `queues` tab of a companion Google Sheet, with the SQL mirrored to a `sql` tab so the query is traceable alongside the results.

**Companion Google Sheet:** https://docs.google.com/spreadsheets/d/1T6Cg3OLzHyWjzIRCzbXADyRK0Q9DBCBwPNOoIBqrwSM/edit

---

## Objective

Produce a single row per distinct `(queue_id, queue_name, channel)` for Afterpay's inbound customer-service front-office traffic in the last 30 completed days, with these columns:

- `BRAND`, `CHANNEL`, `QUEUE_ID`, `QUEUE_NAME`
- `BUSINESS_AREA` — as stored in `cust_ops_queue_mapping`
- `QUEUE_GROUP` — the cleanest business-line label available
- `QUEUE_FUNCTION` — for now, mirrors `QUEUE_GROUP`
- `QUEUE_OWNER` — one of: `Customer Operations`, `Compliance Operations`, `Risk Operations`
- `GEOGRAPHY`, `LANGUAGE`
- `CONTACTS_LAST_30D`

---

## Data Flow

### 1. Volume (tickets base)

From `ap_cur_xoop_g.operation.m_zendesk_tickets_base`, filter:

- `created_date_local` in `[current_date - 30, current_date)` (30 completed days)
- `direction = 'inbound'`
- `department = 'customer_service'`
- `role_type = 'front_office'`
- `channel in ('native_messaging', 'web', 'voice', 'email')`
- `group_name not ilike '%automation test%'` (exclude test queues)

Aggregate to `queue_id` (= `group_id`), `queue_name` (= `group_name`), `channel_simplified`:

- `native_messaging` → `Messaging`
- `voice` → `Voice`
- `web`, `email` → `Email/Other`

Count `distinct zticket_id` as `contacts_last_30d`.

### 2. Queue metadata (cust_ops_queue_mapping)

From `fivetran.app_support.cust_ops_queue_mapping`, filter `upper(brand) = 'AFTERPAY'`. Two lookup CTEs:

- `meta_by_id` — `listagg(distinct ...)` of `brand`, `business_area`, `geography`, `language` grouped by `queue_id`.
- `meta_by_name` — same, grouped by `queue_name`, used as a fallback when `queue_id` doesn't match.

**Key gotcha:** the table has two columns — `BUISNESS_AREA` (typo, all null for Afterpay) and `BUSINESS_AREA` (correctly spelled, populated). Always use the non-typo column. `DESCRIBE TABLE` lists the typo version first which is easy to grab by mistake.

**Join caveat:** `m_zendesk_tickets_base.group_id` is `NUMBER`, but `cust_ops_queue_mapping.queue_id` is `VARCHAR` with some Salesforce-style alphanumeric values. Cast both to `varchar(255)` in the join or Snowflake will implicit-cast and fail with `Numeric value '00G...' is not recognized`.

### 3. Business line assignment (queue_group)

Two hand-curated tabs in the companion sheet drive this:

#### `business_lines_best` tab (primary)

Columns A:B — `(Business Line, Channel)`. Values are effectively queue_name strings with a channel qualifier (`Digital` or `Voice`). Loaded into the SQL as a `VALUES`-based CTE (`business_lines_best`). The mapping covers ~12 distinct queue_names across the Digital/Voice split (21 rows total).

Match rule:

- `upper(trim(queue_name)) = upper(trim(business_line))`
- AND (`bl_channel = 'Digital'` AND our `channel in ('Messaging', 'Email/Other')`) OR (`bl_channel = 'Voice'` AND our `channel = 'Voice'`)

#### `business_lines_wfm` tab (fallback)

25 business-line names sourced from the WFM `Block Business Line Mapping` sheet (tab `AFTERPAY: Queue to Business Line`, column F). That sheet maps queues via **regex on channel + phone + group_id + country + tags** — tag/country data we've aggregated away. Approximated in SQL using `queue_id` lists, `queue_name` patterns, and `geography`:

- **Voice** (WFM uses phone numbers; we approximate via `queue_name` + `queue_id`) — `NA Voice`, `ANZ Voice`, `UK Voice`, `Pay Monthly`, `UK/ANZ/NA Merchant Admin`.
- **Queue-name globals** — `Global Social Media` (socials/reviews), `Global Trust Pilot`, `Manual ID`.
- **Exclusive queue_ids** — `Chargebacks`, `Global Fin rec`, `Global Investigations`, `Global Merchant Shop directory`, `Global | Cards`, `Pay Monthly`, `ANZ Merchant Disputes`, `UK Collections`, `NA Merchant Admin`.
- **Shared queue_ids** disambiguated by geography — `UK/ANZ Merchant Admin`, `ANZ Collection` vs `NA Collections`.
- **Digital groups by country** — country-specific group_id lists → `UK Digital` / `ANZ Digital` / `NA Digital`.
- **Regional fallbacks** — `<region> escalation` queue_name patterns → `<region> Digital`.

#### Final fallback

If neither `business_lines_best` nor WFM rules match, `raw_business_line = queue_name`.

### 4. Digital consolidation

After resolving `raw_business_line`, collapse any country-specific Digital variant into a single bucket:

```sql
case when raw_business_line ilike any (
    '%Global Digital%', '%NA Digital%', '%UK Digital%',
    '%ANZ Digital%',    '%CAN Digital%', '%USA Digital%'
) then 'Global Digital' else raw_business_line end as queue_group
```

`queue_function` mirrors `queue_group`.

### 5. queue_owner classification

Keyword match on `queue_name`, in priority order:

- **Risk Operations** — `chargeback`, `investigation`, `fin rec`, `token removal`, `id verification`, `manual id`, `fraud`, `risk`, `cards`.
- **Compliance Operations** — `licenced` / `licensed`, `pay monthly`, `collection`, `hardship`, `acknowledgement`, `complaint`, `help with repayments`.
- **Customer Operations** — default (voice, digital, escalations, merchant admin, merchant disputes, refund, social, trust pilot, etc.).

---

## Output

- **`queues` tab** — one row per `(queue_id, queue_name, channel)`. Sorted by channel (`Voice` → `Messaging` → `Email/Other`) then `contacts_last_30d` desc. Headers bold, row 1 frozen, auto-sized columns.
- **`sql` tab** — full SQL, one line per row in column A. Column A widened.

Current run: **67 rows** after excluding 3 Automation Test variants. Owner distribution: **40 Customer Ops / 15 Compliance Ops / 12 Risk Ops**. 15 rows roll up to the consolidated `Global Digital` queue_group.

---

## Known Limitations

1. **Global-geography queues are ambiguous at queue level.** WFM splits Global-routed traffic into per-country Digital buckets via ticket `custom_country`. Since the output is aggregated by `(queue_id, queue_name, channel)`, Global queues (e.g. Global Digital 40123093988633, Global Help With Repayments, Global Acknowledgement Team) can't be cleanly assigned to a single per-country business line. The current query collapses them to `Global Digital` or falls through to queue_name.
2. **Voice rows on digital-only queues fall through to queue_name.** `business_lines_best` lists Global ID Verification, Global Help With Repayments, and Global Refund/Return Support as Digital-only. Any voice contacts to those queues (usually misrouted, low volume) are unmapped.
3. **Shared group_ids across countries.** Queue_id `28217723` is both `ANZ Collection` and `NA Collections` in WFM depending on ticket country. The SQL uses `geography` from `cust_ops_queue_mapping` as a best-effort disambiguator, but this breaks down if a queue serves multiple regions.
4. **Hardship Level 2 inconsistency.** `queue_id = 360002545312` is in the WFM Digital group lists for all three regions. Messaging/Email contacts resolve to `queue_group = Global Digital`; voice contacts fall through to `queue_group = Hardship Level 2`. queue_owner stays `Compliance Operations` in both cases because it's based on `queue_name`.
5. **Refresh cadence.** The SQL is a point-in-time query over `current_date - 30`. Rerunning produces a new 30-day window. No persistence — every run regenerates the full dataset.

---

## How to Run

1. `snow sql --account SQUARE --warehouse ADHOC__LARGE --format CSV -f afterpay_queue_volume_30d.sql > results.csv`
2. Overwrite the `queues` tab of the companion sheet with `results.csv`.
3. Overwrite the `sql` tab with the contents of `afterpay_queue_volume_30d.sql` (one line per row).

Or use the `gdrive` skill's `sheets write` + `batch-update` commands to automate steps 2–3.

---

## Follow-Up Ideas

- **Split aggregation by ticket `custom_country`** — would let Global queues route into per-country WFM Digital buckets instead of collapsing. Produces more rows but removes Ambiguity #1 above.
- **Add `speed_to_answer_target`** — already sitting in `cust_ops_queue_mapping`; useful dimension for SLA reporting.
- **Promote `queue_function`** beyond a mirror of `queue_group` — would probably key off `business_area` + `channel` to give a finer-grained label (e.g. "Consumer Support / Refunds" vs "Consumer Support / Digital").
- **Persist as a dbt model** in `app_support` or `support_de` so downstream reporting can query `dim_queues` directly instead of regenerating the mapping in every dashboard.
- **Add "Licenced Team (US)" variants** to `business_lines_best` to cover the remaining small voice-on-digital-queue fall-throughs.
