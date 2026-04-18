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

### UI (Tab 1: "New Requests")
- **"Grab New COA Requests" button** — fetches CCOPORT tickets from Jira.
- **Summary count** — shows total fetched, how many are new vs already linked.
- **Collapsible ticket cards** — each card defaults to collapsed showing Jira key, summary, parent status, priority, and a "Submit to RADS Linear Cust Ops DS" button. Click to expand and see/edit all Linear form fields.
- **Auto-sizing text fields** — all textareas auto-expand to show full content without scrolling.
- **Per-ticket submit** — each card has its own submit button. After submission, fields become read-only and show a link to the created Linear issue.
- **All fields loaded before display** — LLM business justification calls run in parallel and complete before tickets appear. No blank fields.
- Linear issues are created on the **CUSTDS** team via GraphQL API with triage state.

---

## Objective 2: Linear → Jira (Status Updates)

### Linked Tickets Table
- The Sync Updates tab has an editable **Linked Tickets** table at the top where the user enters Jira/Linear pairs.
- **Jira input** accepts either a key (e.g., `COA-719`) or a full URL (e.g., `https://block.atlassian.net/browse/COA-719`) — the key is extracted automatically.
- **Linear input** accepts either an issue identifier (`CUSTDS-41`), an issue URL, or a **project URL** (e.g., `https://linear.app/squareup/project/cash-app-project-phone-plan-launch-2422862cf293/overview`).
- Project URLs are auto-detected and tagged with a "Project" badge.
- Pairs are persisted in browser localStorage.
- Jira keys in the table are clickable hyperlinks to the Jira ticket.

### Project vs Issue Handling
- **Project URL entered** — fetches all project-level updates AND all issues within the project (statuses + comments). The project is found by paginating through all Linear projects and matching the slug ID from the URL.
- **Issue URL/ID entered** — fetches that single issue's status, comments, and its parent project updates.

### Update Format
- All Linear updates for a given Jira ticket are consolidated into **one combined update** regardless of how many Linear issues/projects are linked.
- The update format is:
  1. **Linear links at top** — project URL (if it's a project), or individual issue links for standalone issues.
  2. **4-5 sentence LLM-generated project-level summary** — focuses on overall progress, key milestones, what's being worked on, upcoming priorities, blockers/risks. Framed as a project update, not individual task callouts. Does not call out individual issues as complete if the project is still in-progress.
  3. **Attribution footer** — `(automated update from https://g2.sqprod.co/apps/linear-jira-sync-coa)`
- Plain text only — no badges, no fancy formatting. This is straight text posted to Jira.

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

### Success Feedback
- After successfully posting to Jira, show a clear success message with the Jira ticket key and a link to verify: `Jira comment posted successfully to COA-719 (https://block.atlassian.net/browse/COA-719). Check the Jira ticket to verify the update.`

---

## Activity Log (Tab 3)

The Activity Log tab shows a history of all actions taken through the app, stored in browser localStorage (not the D1 database, which isn't reliably available for reads in the G2 iframe context).

### Two Sections
1. **RADS Requests Submitted** — logged each time a ticket is submitted to Linear from the New Requests tab. Shows timestamp (PT), Jira key (linked), Linear issue identifier (linked), and a summary of the request title + business justification.
2. **Jira Tickets Updated** — logged each time a sync update is posted to Jira from the Sync Updates tab. Shows timestamp (PT), Jira key (linked), Linear source (linked), and the summarized update content.

### Storage
- Uses `localStorage` key `ljs_activity_log` — persists in the user's browser.
- Each entry includes: type, timestamp, Jira key/URL, Linear identifier/URL, and summary.
- Keeps last 200 entries.

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
- **Logos** — stored in `public/` directory (`jira_logo.png`, `linear_logo.png`), must be copied into `build/client/` during deploy.
- **Attribution** — every submitted ticket's Notes field ends with `Submitted with the help of https://g2.sqprod.co/apps/linear-jira-sync-coa`. Sync updates end with `(automated update from https://g2.sqprod.co/apps/linear-jira-sync-coa)`.

### Database (D1)
- **ticket_mappings** — stores Jira key ↔ Linear issue ID/URL mapping, with status tracking.
- **activity_log** — records who did what, when (America/Los_Angeles timezone), and the details.

### Auth
- Default to the logged-in user's G2 Jira and Linear connections. Settings tab allows optional email override for the Requestor LDAP field.

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
- Deploy with `appkit deploy linear-jira-sync-coa ./build` (production environment)
- Database migrations: `appkit migrate linear-jira-sync-coa ./migrations` (production environment)

---

## Test Data
- **COA-719** / **COPGM-875** — Cash App Essentials: Phone Plans (Gigs)
- **Linear Project:** Cash App Project Phone Plan Launch — https://linear.app/squareup/project/cash-app-project-phone-plan-launch-2422862cf293/overview
