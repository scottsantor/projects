# Linear-Jira Sync — Plan

## Overview
A Block App Kit web app that bridges COA Jira tickets (with CCOPORT component) to RADS Linear tickets via the CUSTDS team's "CustOps Data Science Request Intake Form". Two-tab interface with human-in-the-loop approval before any submissions.

**Live app:** https://g2.sqprod.co/apps/linear-jira-sync-coa

---

## Objective 1: Jira → Linear (New Requests)

### Trigger
- New COA Jira tickets with the **CCOPORT** component, filtered by this JQL (adjust `created >= -365d` to a shorter window for ongoing use):
  ```
  created >= -365d and component = "CCOPORT" and "Delivery Team[Select List (multiple choices)]" in ("COA","COA - CI") and issuetype in (Task, Sub-task) and status not in ("Done","Won't Do") order by created DESC
  ```

### Data Flow
1. **Read COA ticket** — pull title, description, dates, assignee, etc.
2. **Read parent ticket** (COPGM-* or COTPM-*) — pull description, reporter, status, due date, and last 5 comments.
3. **Translate into Linear submission fields** (see field mapping below).

### Field Mapping

- **Title** — COA ticket summary.
- **Requestor** — Use the **Reporter** field from the **parent ticket** (COPGM/COTPM), NOT the assignee on the COA ticket. The COA assignee is typically the data analyst working the request; the parent Reporter is the person who originated it. Extract LDAP from their email (e.g., `torikrikau@squareup.com` → `torikrikau`).
- **Request Description** — Parse the COA and parent ticket descriptions. Deduplicate if both contain the same text (use the longer one). Frame as a request to a data analyst — extract the specific data ask plus enough business context.
- **Business Justification** — First try to parse structured sections (Business Justification, Value Proposition, Prioritization Rationale) from the description. If none found or the result would duplicate the request description, use the **LLM** (Claude Sonnet via G2 postMessage bridge) to generate a 2-3 sentence justification from all available context (COA description, parent description, parent comments, priority, dates). The justification must explain *why* — how the business or customers benefit, regulatory/compliance drivers, what problem is solved, strategic importance. Never restate the task itself. Never output metadata like priority levels or ticket status. All LLM calls complete before tickets are displayed (no blank fields).
- **Requested Due Date** — From COA ticket due date field.
- **Notes (optional)** — Source links (COA URL, parent URL). Only add additional content if there are **critical timing/hold signals** from the parent ticket (status is on hold/blocked/paused, or recent comments mention delays/deprioritization). Summarize in 1-2 sentences max. End with attribution: `Submitted with the help of https://g2.sqprod.co/apps/linear-jira-sync-coa`.

### UI (Tab 1: "Grab new COA Jira requests")
- **Bulleted description** at top — four bullets that explain what the tab does, prompt the user to click the button, show the JQL, and document the already-linked filter (see "Already-linked filter" below).
- **Jira email override field** — inline at the top; lets any user set their Jira email to override the auto-detected requestor LDAP. Stored in `localStorage` under `ljs_settings`. If blank, falls back to parent ticket's Reporter email.
- **"Grab New COA Requests" button** — fetches CCOPORT tickets from Jira.
- **Already-linked filter** — any COA ticket whose Jira key already appears in the DB `mappings` table OR in the D1 `linked_pairs` table (fetched live via `GET /api/linked-pairs`) is excluded from the fetched results. The count line reads, e.g., `8 new ticket(s) - 4 already linked in 'Sync Linear updates to Jira' tab` so the user can still see how many were filtered out.
- **Collapsible ticket cards** — each card defaults to collapsed showing Jira key, summary, parent status, priority, and a "Submit to RADS Linear Cust Ops DS" button. Click to expand and see/edit all Linear form fields.
- **Auto-sizing text fields** — all textareas auto-expand to show full content without scrolling.
- **Per-ticket submit** — each card has its own submit button. After a successful submit, the card's submit button is replaced with a small green pill (`Submitted: CUSTDS-xyz`, white text, links to the Linear issue) and form fields become read-only. The ticket stays visible in-session; the next "Grab" drops it because the filter now sees it.
- **Button lifecycle** — the "Grab New COA Requests" button shows `Fetching...` while loading and `Fetched` once the fetch finishes (handled via a `hasFetched` flag; `setLoading(false)` runs in a `finally` so the button doesn't stick on `Fetching...` when the happy path returns).
- **Empty state** — when zero tickets are returned after dedup the UI renders: _"No incremental COA Jira requests found that aren't already accounted for in the 'Sync Linear updates to Jira' tab."_
- **Auto-add to SyncUpdates pairs** — on successful submit, the handler POSTs to `/api/linked-pairs` (server upserts on `(jira_key, linear_identifier)`) and dispatches a `ljs-pairs-changed` CustomEvent. SyncUpdates listens for the event and re-fetches from the API, so the new row appears in the linked-pairs table on Tab 2 with no manual entry and no page reload.
- **All fields loaded before display** — LLM business justification calls run in parallel and complete before tickets appear. No blank fields.
- Linear issues are created on the **CUSTDS** team via GraphQL API with triage state.

### Linear GraphQL response unwrap (gotcha)
The G2 fetch proxy wraps Linear's GraphQL response as `{ success, data, statusCode }`, and Linear's GraphQL response itself has a top-level `data` key. The submit path must unwrap **twice**: detect the G2 envelope via `rawCreate?.statusCode !== undefined && rawCreate?.data`, then check `createData.data.issueCreate.success` on the inner payload. An earlier version of the code only unwrapped once, which caused the success check to throw *after* the Linear issue was already created — leaving orphan Linear issues with no DB mapping row.

---

## Objective 2: Linear → Jira (Status Updates)

### Linked Tickets Table
- The Sync Updates tab has an editable **Linked Tickets** table at the top where the user enters Jira/Linear pairs.
- **Jira input** accepts either a key (e.g., `COA-719`) or a full URL (e.g., `https://block.atlassian.net/browse/COA-719`) — the key is extracted automatically.
- **Linear input** accepts either an issue identifier (`CUSTDS-41`), an issue URL, or a **project URL** (e.g., `https://linear.app/squareup/project/cash-app-project-phone-plan-launch-2422862cf293/overview`).
- Project URLs are auto-detected and tagged with a "Project" badge.
- **Shared across users** — pairs live in the D1 `linked_pairs` table behind `/api/linked-pairs` (GET/POST/DELETE). Everyone who uses the app sees and edits the same list; there is no per-user isolation. Uniqueness is enforced on `(jira_key, linear_identifier)` so re-submitting the same pair is idempotent.
- **One-time localStorage migration** — on first load, SyncUpdates checks for a legacy `ljs_linked_pairs` localStorage entry and, if present, POSTs each pair to `/api/linked-pairs` before clearing the key. This carries forward what each user had stored locally before the switch to D1.
- **Auto-populated from Tab 1** — when a user submits a new COA request on Tab 1, the resulting pair is POSTed to `/api/linked-pairs` automatically (the server upsert dedupes) and a `ljs-pairs-changed` event causes this table to re-fetch from the API and render the new row immediately.
- **Column layout** (left → right):
  1. **Jira Title** — leftmost, styled with `bg-background-secondary` + `font-semibold` + a right border so it reads as the row's identifier spanning the Jira Key and Linear Issue columns. Titles are fetched via `GET /rest/api/3/issue/{key}?fields=summary` for any key not already present (DB mappings seed the cache first), and cached in localStorage under `ljs_jira_titles` to avoid refetching on each load.
  2. **COA Jira Key** — center-aligned; clickable hyperlink to the Jira ticket.
  3. **Linear Issue (ID or URL)** — clickable hyperlink to the Linear issue or project (URL built from `isProject`). Project rows also keep the small "Project" badge.
  4. Remove action.

### Project vs Issue Handling
- **Project URL entered** — fetches all project-level updates AND all issues within the project (statuses + comments). The project is found using `searchProjects` (see Jira API Configuration section for details on why pagination doesn't work).
- **Issue URL/ID entered** — fetches that single issue's status, comments, and its parent project updates.
- If a pair was added before project detection existed, it may have `isProject: false`. Remove and re-add the pair with the full project URL to fix.

### Update Format
- All Linear updates for a given Jira ticket are consolidated into **one combined update** regardless of how many Linear issues/projects are linked.
- The update format is:
  1. **Linear links at top** — project URL (if it's a project), or individual issue links for standalone issues.
  2. **4-5 sentence LLM-generated project-level summary** — focuses on overall progress, key milestones, what's being worked on, upcoming priorities, blockers/risks. Framed as a project update, not individual task callouts. Does not call out individual issues as complete if the project is still in-progress.
  3. **Attribution footer** — `(automated update from https://g2.sqprod.co/apps/linear-jira-sync-coa)`
- Plain text only — no badges, no fancy formatting. This is straight text posted to Jira.

### Triage table (no-summary path)
- Clicking "Check for Linear Updates" produces a row for **every** ticket in the Linked Tickets table — no silent skips.
- If a Linear issue has no new activity AND its state type is `triage` (including the default CUSTDS triage state newly-submitted tickets land in), it does **not** get a full LLM summary card. Instead it goes into a compact **Still in Linear triage queue (N)** table at the top of the results section showing Jira key and Linear identifier, both as live links. No Submit button.
- Non-triage pairs with no updates (e.g., "Backlog", "In Progress" with nothing new) still produce a deterministic "No Linear updates since last sync. Currently in state 'X'." summary card — these skip the LLM call entirely.
- The section below the triage table is headed **Linear updates available (N)** and contains the LLM summary cards with per-ticket Submit buttons. Section headers use `text-sm font-semibold`.
- Per-pair state (`stateName`, `stateType`, `isProject`, `linearUrl`) is captured in a `pairInfo` map during the fetch loop so the no-updates branch can emit the right row type without refetching.

### Writing Comments to Jira
- The Jira comment POST endpoint (`/issue/{key}/comment`) is **not on the kgoose proxy allowlist**.
- Instead, use `PUT /rest/api/3/issue/{key}` with an `update.comment` array to add a comment via the issue update API. This endpoint IS on the allowlist.
- Example:
  ```typescript
  await fetch(
    `https://api.atlassian.com/ex/jira/31e7a210-9ba8-468d-a1d1-a806c34e5961/rest/api/3/issue/${jiraKey}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-G2-Extension': 'jira',
      },
      body: JSON.stringify({
        update: {
          comment: [{
            add: {
              body: {
                type: 'doc',
                version: 1,
                content: [{ type: 'paragraph', content: [{ type: 'text', text: commentText }] }],
              },
            },
          }],
        },
      }),
    }
  )
  ```

### Per-Ticket Submit
- Each Jira ticket gets its own "Submit Update to COA-XXX" button on its card (similar to New Requests tab).
- After successful submission, that card is removed from the list and a success message shows with a link to the Jira ticket.
- Other cards remain so they can be submitted independently.

### Success Feedback
- After successfully posting to Jira, show a clear success message with the Jira ticket key and a link to verify: `Jira comment posted successfully to COA-719 (https://block.atlassian.net/browse/COA-719). Check the Jira ticket to verify the update.`

### Input Flexibility
- **Jira input** accepts either a key (`COA-719`) or a full URL (`https://block.atlassian.net/browse/COA-719`) — the key is extracted automatically.
- **Jira keys are clickable links** throughout the UI — in the linked pairs table and on sync update cards.

---

---

## Architecture

### Platform
- **Block App Kit** web app (React + Vite + TypeScript frontend, Hono serverless backend, Cloudflare D1 database).

### Integrations
- **Jira API** — read COA tickets + parent tickets, write comments back. See **Jira API Configuration** below.
- **Linear API** — create issues on CUSTDS team, read status/comments/project updates.
  - Extension: `linear`, URL: `https://api.linear.app/graphql`
  - CUSTDS Team ID: `0f2a0619-8b8c-490e-98da-7fb25874f979`
  - Triage State ID: `5687f14f-3752-4dff-8eeb-ac29072490b0`
  - Template: CustOps Data Science Request Intake Form (`0a385368-c071-4a92-98f9-8723a94cf95c`)
- **LLM** — Claude Sonnet via G2 postMessage bridge (`cloudflare-llm-request`), used for business justifications (Obj 1) and sync update summaries (Obj 2).

### Key Design Decisions
- **Human-in-the-loop** — no automatic submissions; user reviews and approves every action.
- **Per-ticket submission** — each ticket has its own submit button (no bulk submit).
- **Persist tab state** — use `forceMount` on TabsContent so fetched data survives tab switches.
- **Collapsible cards** — default collapsed so you can see all tickets at a glance.
- **Auto-sizing textareas** — fields expand to show full content, no scrolling within text boxes.
- **All fields loaded before display** — LLM calls complete before tickets appear.
- **1:1 Jira updates** — multiple Linear sources consolidated into one Jira comment per ticket.

### UI / Branding
- **Header** — Jira logo, bidirectional arrow (SVG), Linear logo, app title. Logos are 64px, title is text-3xl. Centered layout.
- **Top right bar** — contact info (`Questions? ssantor@ or #data-help-customer-support`) and a link to the GitHub build source (`Build: GitHub` linking to `https://github.com/scottsantor/projects/tree/main/linear-jira-sync`).
- **Logos** — stored in `public/` directory (`jira_logo.png`, `linear_logo.png`), must be copied into `build/client/` during deploy.
- **Status boxes** — success and error banners on both tabs, and the in-line "Submitted: CUSTDS-xyz" pill on Tab 1, use **white text** on the semantic `bg-background-success` / `bg-background-danger` backgrounds. The default `text-text-success` / `text-text-danger` tokens render dark in dark mode and become unreadable against the colored background.
- **Attribution** — every submitted ticket's Notes field ends with `Submitted with the help of https://g2.sqprod.co/apps/linear-jira-sync-coa`. Sync updates end with `(automated update from https://g2.sqprod.co/apps/linear-jira-sync-coa)`.

### Database (D1)
- **ticket_mappings** — stores Jira key ↔ Linear issue ID/URL mapping, with status tracking.
- **activity_log** — records who did what, when (America/Los_Angeles timezone), and the details.
- **linked_pairs** — shared Jira/Linear pair list backing the Sync Updates tab. Columns: `id`, `jira_key`, `linear_id`, `linear_identifier`, `is_project`, `created_at`. Unique index on `(jira_key, linear_identifier)`. Migration `0002_linked_pairs.sql`. Exposed via `GET /api/linked-pairs`, `POST /api/linked-pairs` (upsert), `DELETE /api/linked-pairs/:id`.

### Auth
- Default to the logged-in user's G2 Jira and Linear connections. Jira email override is configurable inline on the "Grab new COA Jira requests" tab (stored in localStorage).

---

## Jira API Configuration (Block App Kit)

### Extension Name
- Use **`jira`** as the `X-G2-Extension` header value.
- In `app.yaml`:
  ```yaml
  permissions:
    extensions:
      jira:
        access: read_write
  ```

### API URL Pattern
- **Base URL:** `https://api.atlassian.com/ex/jira/31e7a210-9ba8-468d-a1d1-a806c34e5961/rest/api/3/`
- Block's Jira Cloud ID: `31e7a210-9ba8-468d-a1d1-a806c34e5961`
- Do NOT use `block.atlassian.net` (not on kgoose proxy allowlist).
- Do NOT omit the `/ex/jira/<cloudId>` prefix (not on allowlist).

### Search Endpoint
- **Must use POST** to `POST /rest/api/3/search/jql` with JSON body.
- The older `GET /rest/api/3/search?jql=...` returns 410.

### Issue Fetch
- `GET /rest/api/3/issue/{key}?fields=description,summary,reporter,status,duedate,comment` with `X-G2-Extension: jira`.
- G2 proxy may wrap response in `{ success, data }` or `{ success, data: { data: ... } }` envelope — unwrap accordingly.

### Adding Comments
- `POST /rest/api/3/issue/{key}/comment` is **NOT on the allowlist**.
- Use `PUT /rest/api/3/issue/{key}` with `update.comment[].add` instead (see Objective 2 section for example).

### Linear Project Lookup
- The `projects(filter: { slugId: ... })` GraphQL query returns 400 through the G2 proxy.
- Paginating through `projects(first: 100)` is too slow — there are 250+ projects and pagination may not find the target.
- Use `searchProjects(term: "...")` instead — convert the URL slug to a search term by removing the trailing hash and replacing hyphens with spaces (e.g. `afterpay-support-migration-data-and-reporting-transition-plan-1e31dca079bc` → `"afterpay support migration data and reporting transition plan"`), then match the result by slugId suffix. This finds the project in one query.

### Reference
- Confirmed working patterns by inspecting the `portfolio-coverage` G2 app (`https://g2.sqprod.co/apps/portfolio-coverage`).

---

## Deploy Notes
- After `npm run build`, must copy logos into build output: `cp public/*.png build/client/`
- Deploy with `appkit deploy linear-jira-sync-coa ./build --env production`
- Database migrations: `appkit migrate linear-jira-sync-coa ./migrations` (production environment)

---

## Test Data
- **COA-719** / **COPGM-875** — Cash App Essentials: Phone Plans (Gigs)
- **Linear Project:** Cash App Project Phone Plan Launch — https://linear.app/squareup/project/cash-app-project-phone-plan-launch-2422862cf293/overview
