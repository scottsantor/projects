# dim_queues — Plan (Afterpay)

## Overview

Build a queue-level dimension table for Afterpay that enriches every customer-contact queue with classification metadata (owner, function, group), contact volume, geography, language, and staff group / supplier assignments. The output drives reporting and joins against ticket/contact data.

**Companion Google Sheet — "Afterpay dim_queues mapping":** https://docs.google.com/spreadsheets/d/1T6Cg3OLzHyWjzIRCzbXADyRK0Q9DBCBwPNOoIBqrwSM/edit

**Sheet tabs:**
- `dim_queues` — one row per `(queue_id, queue_name, channel)` with volume + classification. SQL-driven.
- `dim_queue_staff_groups` — one row per `(queue_id, queue_name, staff_group)` with staff group / supplier / location. Python-driven (see §Staff Groups below).
- `build` — just a link back to this GitHub folder; the SQL is versioned here, not inline in the sheet.

---

## `dim_queues` — Output

One row per distinct `(queue_id, queue_name, channel)` for Afterpay inbound CS front-office traffic in the last 30 completed days.

**Columns:** `BRAND, CHANNEL, QUEUE_OWNER, QUEUE_FUNCTION, QUEUE_GROUP, QUEUE_ID, QUEUE_NAME, GEOGRAPHY, LANGUAGE, CONTACTS_LAST_30D`

### SQL source

`afterpay_queue_mapping.sql` (this folder) is the full query. Run with:
```bash
snow sql --account SQUARE --warehouse ADHOC__LARGE --format CSV -f afterpay_queue_mapping.sql > dim_queues.csv
```
Then paste `dim_queues.csv` into the `dim_queues` tab.

### Data flow

**1. Volumes** from `ap_cur_xoop_g.operation.m_zendesk_tickets_base`:
- `created_date_local` in `[current_date - 30, current_date)` (30 completed days)
- `direction = 'inbound'`, `department = 'customer_service'`, `role_type = 'front_office'`
- `channel in ('native_messaging', 'web', 'voice', 'email')`
- Excludes `group_name ilike '%automation test%'` (test queues)
- Channel simplification: `native_messaging → Messaging`, `voice → Voice`, `web|email → Email/Other`
- Aggregates to `count(distinct zticket_id)` per `(group_id, group_name, channel_simplified)`

**2. Queue metadata** from `fivetran.app_support.cust_ops_queue_mapping` (filter `upper(brand) = 'AFTERPAY'`):
- `meta_by_id` keyed on `queue_id`; `meta_by_name` fallback keyed on `queue_name`.
- Pulled: `brand`, `business_area`, `geography`, `language`.

**3. Queue group resolution** (three-tier fallback into `raw_business_line`):
1. **`business_lines_best`** — primary. VALUES-based CTE inline in SQL. Sourced from https://docs.google.com/spreadsheets/d/14VYFicBoF1xTUwPALAL9bOB-vv_lnMXfS2djIIoZjwM/edit?gid=103004255#gid=103004255 — tab "Legacy Afterpay FCR v2", cells B5:E26. Match rule: exact `queue_name = business_line` + channel group (`Digital` covers our Messaging + Email/Other; `Voice` matches Voice).
2. **WFM regex approximation** — fallback. Encoded as CASE statements over `queue_id` / `queue_name` / `geography`. Allowed output values listed in the `business_lines_wfm` CTE (25 business lines). Sourced from https://docs.google.com/spreadsheets/d/10Z4mHOQVXtDEpERpn0Zn9az0bmNfLSHn_54SuhvWYJw/edit?gid=1900547438#gid=1900547438 — tab "AFTERPAY: Queue to Business Line", column F (business lines) + column H (queue_ids embedded in regex). The SQL embeds both lists inline as VALUES CTEs; the upstream sheets are the source of truth.
3. **Final fallback** — `queue_name` itself.

Then `queue_group` collapses any country-specific Digital variant (`ANZ/NA/UK/CAN/USA/Global Digital`) into a single **Global Digital** bucket.

**4. `queue_function`** — 7-category natural bucketing on `queue_name`, in priority order:
- `Escalations`
- `Risk & Chargebacks` (chargeback, investigation, token removal, card)
- `Identity Verification` (id verification, manual id)
- `Hardship & Repayments` (hardship, help with repayments)
- `Refunds/Returns` (refund, return)
- `Licensed Support` (licenced/licensed)
- `General Support` (voice, digital)
- `Other` (fallback: socials/reviews, acknowledgement team, etc.)

**5. `queue_owner`** — three-bucket classification on `queue_name`:
- **Risk Operations** — chargeback, investigation, fin rec, token removal, id verification, manual id, fraud, risk, cards.
- **Compliance Operations** — licenced/licensed, pay monthly, collection, hardship, acknowledgement, complaint, help with repayments.
- **Customer Operations** — default (voice, digital, escalations, merchant admin, disputes, refund, social, etc.).

### Cascading sort

Uses `sum(contacts_last_30d) over (partition by ...)` in the final `ORDER BY`. At each level, groups are ranked by their total volume in the current run; within each group, drop to the next level:

1. `channel` total desc
2. `queue_owner` total desc (within channel)
3. `queue_function` total desc (within channel + owner)
4. `queue_group` total desc (within channel + owner + function)
5. `contacts_last_30d` desc (per-queue tiebreaker)

Implementation note: final SELECT is wrapped as a `final` CTE so the outer `ORDER BY` can reference the classification aliases directly (otherwise Snowflake rejects `PARTITION BY alias` inside window functions).

---

## `dim_queue_staff_groups` — Output

One row per `(queue_id, queue_name, staff_group)`. A queue can be staffed by multiple staff groups (e.g., `Chargebacks` has Lance and Louie, both at Probe; `ANZ Voice` is staffed by Probe + Teleperformance), so expect **more rows than distinct queues** (currently 38 rows for 23 distinct queues).

**Columns:** `QUEUE_ID, QUEUE_NAME, QUEUE_GROUP, GEOGRAPHY, LANGUAGE, CONTACTS_LAST_30D_QUEUE, STAFF_GROUP, STAFF_GROUP_WFM_TOOL, STAFF_GROUP_SUPPLIER, STAFF_GROUP_LOCATION`

- `CONTACTS_LAST_30D_QUEUE` — total contacts across *all* channels for that queue in the 30d window.
- `STAFF_GROUP` — matched Business Line name (join key back to the WFM source rows).
- `STAFF_GROUP_WFM_TOOL` — the WFM tool's label (e.g., `ANZ | Voice`, `Chargebacks | Lance (P)`).
- `STAFF_GROUP_SUPPLIER` — one of `Probe`, `Teleperformance`, `Internal`.
- `STAFF_GROUP_LOCATION` — e.g., `Probe (Manila)`, `Teleperformance (Manila)`, blank for Internal.

### Build (currently Python-driven)

No SQL file yet — the build runs in Python on top of the `dim_queues.csv` output. Steps:

1. Load `dim_queues.csv`; group rows to one record per `(queue_name, queue_id)`, sum `contacts_last_30d` → `CONTACTS_LAST_30D_QUEUE`. For queues whose `queue_group` varies by channel (e.g., `Hardship Level 2`), pick the queue_group from the highest-volume channel.
2. Hardcode the 24-row source table from https://docs.google.com/spreadsheets/d/10Z4mHOQVXtDEpERpn0Zn9az0bmNfLSHn_54SuhvWYJw/edit?gid=1925126368#gid=1925126368 — tab "AFTERPAY: Business line to Staff Group", columns A (Business Line), B (Staff Group Name), D (Supplier), E (Supplier Location).
3. **Expand each source row** into one tuple per staff group / supplier combo:
   - Single staff_group + multi-supplier → one row per supplier (with matching location).
   - Multiple staff_groups with suffix markers (`(P)` = Probe, `(AP)` = Internal/Afterpay, `(T)` = Teleperformance) → one row per staff_group, supplier decoded from the suffix.
   - Empty staff_group but suppliers present (e.g., Global Merchant Shop directory) → one row per supplier with blank staff_group.
4. **Match `queue_group` → Business Line** (best-effort):
   - Direct match if `queue_group` is one of the 24 Business Lines.
   - `Global Digital` (consolidated queue_group) splits by `queue_name` pattern: `%ANZ%` → ANZ Digital, `%UK%` → UK Digital, `%USA%` / `%CAN%` / `NA ` → NA Digital.
   - Bridges: `USA Voice (DO NOT ASSIGN)` → NA Voice, `Licenced Support Team (US)` / `Licenced Team (US)` → Pay Monthly, `Global ID Verification` → Manual ID, `NA Escalations` → the source's typo row "NA Escaltions".
5. Sort rows the same cascading way as `dim_queues`, adapted for queue grain (no channel dimension):
   - `queue_owner` total desc → `queue_function` total desc → `queue_group` total desc → `contacts_last_30d_queue` desc → `queue_name` asc.
6. Write to the `dim_queue_staff_groups` tab.

### Unmapped queues (6 of 23)

Left with blank staff group fields — no clean match in source:

| Queue | Notes |
|---|---|
| Global Digital (the actual global queue_name) | Ambiguous — served by all regional staff groups based on ticket country |
| Global Refund/Return Support | No match; possibly needs a new source row |
| Global Help With Repayments | Could plausibly map to Pay Monthly / Collections, but weak |
| Hardship Level 2 | Could plausibly map to Pay Monthly, but weak |
| Global Acknowledgement Team | Could plausibly map to Pay Monthly (complaint acknowledgement), but weak |
| Token Removal | No match in source |

---

## Known Limitations & Gotchas

1. **Two `business_area` columns in the mapping.** `cust_ops_queue_mapping` has both `BUISNESS_AREA` (typo, null for Afterpay) and `BUSINESS_AREA` (correct, populated). `DESCRIBE TABLE` shows the typo version first — always confirm via `INFORMATION_SCHEMA.COLUMNS` and use the non-typo one.
2. **Join type mismatch.** `m_zendesk_tickets_base.group_id` is `NUMBER`; `cust_ops_queue_mapping.queue_id` is `VARCHAR` with Salesforce-style alphanumeric values. Cast both to `varchar(255)` or Snowflake errors with `Numeric value '00G...' is not recognized`.
3. **Global-geography queues split by ticket country in WFM.** At queue-level aggregation we can't cleanly assign a single business line to queues like Global Digital, Global Refund/Return Support, Global Help With Repayments. The fix (if needed) is to add ticket `custom_country` to the aggregation and split rows per country.
4. **Hardship Level 2 channel inconsistency.** Its `queue_id` (360002545312) is in the WFM Digital group lists, so messaging/email rows resolve to `queue_group = Global Digital`; voice rows fall through to `queue_group = Hardship Level 2`. `queue_owner` stays Compliance Operations in both because it's keyed on `queue_name`.
5. **Staff group expansion is heuristic.** The source cell format mixes comma-separated lists with suffix markers `(P)/(AP)/(T)`. Rows with no suffix and multiple suppliers assume 1:N — every supplier staffs the same group. Rows with suffixes assume each staff_group variant maps to exactly one supplier by suffix.
6. **Refresh cadence.** Every run queries a fresh 30-day window (`current_date - 30` to `current_date`). No persistence / snapshotting; rerun regenerates the full dataset.

---

## How to Rerun End-to-End

1. Execute `afterpay_queue_mapping.sql` against Snowflake (account=SQUARE, warehouse=ADHOC__LARGE). Export to CSV.
2. Overwrite the `dim_queues` tab with the CSV.
3. Run the Python rebuild script (see §dim_queue_staff_groups) against that CSV + the hardcoded source table. Overwrite the `dim_queue_staff_groups` tab.
4. The `build` tab already points here — nothing to update there unless the GitHub URL changes.

---

## Follow-Up Ideas

- **SQL-ify `dim_queue_staff_groups`** — currently Python. Could be another CTE-chained SQL file that reuses the `dim_queues` query and adds a `business_lines_to_staff_groups` VALUES CTE plus cross-join expansion. Tradeoff: duplicates the full `dim_queues` logic; cleaner would be to materialize `dim_queues` as a table/view and build staff_groups on top.
- **Split by ticket country** — would resolve Global-geography ambiguity and give accurate per-country Digital assignments.
- **Persist as a dbt model** (`app_support.dim_queues_afterpay`, `app_support.dim_queue_staff_groups_afterpay`) so downstream reporting can query directly.
- **Add `speed_to_answer_target`** — already in `cust_ops_queue_mapping`; useful for SLA joins.
- **Add "Licenced Team (US)" voice variants and Token Removal / Acknowledgement Team rows** to `business_lines_best` / source staff-group sheet to close the final unmapped gaps.
- **Snapshot runs** into a table with a `run_date` column so week-over-week volume trends are queryable without re-running.
