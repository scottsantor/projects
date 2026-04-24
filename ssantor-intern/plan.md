# Push local changes to GitHub

Run from `/Users/ssantor/claude/projects/ssantor-intern`:

```bash
git add .
git commit -m "what you changed"
git push
```

---

# Claude Cost tab — execution plan

Run from `/Users/ssantor/claude/projects/ssantor-intern`.

## 1. Eyeball locally

Start the app dev server and g2, then open the app in g2 and click the **Claude Cost** tab.

```bash
npm run dev -- --port 3000
# in another terminal: cd <g2-repo> && just run
# open http://localhost:5173/apps/ssantor-intern
```

Check:
- Totals row matches the bottom of the weekly table.
- `lastRefreshed` reads sensibly (shows "Xm ago").
- Bar chart widths look right (widest week is fully filled).
- Table is readable in both light and dark themes.

## 2. Build

```bash
npm run build
```

If typecheck fails on `src/lib/g2-fetch-proxy.ts`, ignore — those 2 errors are pre-existing in a DO-NOT-MODIFY file (per CLAUDE.md).

## 3. Deploy

```bash
appkit deploy ssantor-intern ./build
```

No `app.yaml` changes needed — the tab uses only bundled JSON, no new extensions or MCP tools.

## 4. Refreshing the data later

The deployed worker can't read `~/.claude/projects/`, so refresh is manual via Claude. The **Refresh data** button in the tab header copies a canonical prompt to clipboard — paste it into a fresh Claude Code terminal. The prompt lives in `REFRESH_PROMPT` at the top of `src/components/features/ClaudeCost.tsx`:

```
refresh the claude cost tab at https://g2.stage.sqprod.co/apps/ssantor-intern.

Work in /Users/ssantor/claude/ssantor-intern/ssantor-intern. See
~/.claude/projects/-Users-ssantor/memory/project_ssantor_intern_cost_tab.md
for the scanner/pricing logic. Rescan ~/.claude/projects/**/*.jsonl, bucket
by ISO week (Mon start), and overwrite src/data/claude-cost.json — the
schema is the CostPayload interface in src/components/features/ClaudeCost.tsx.
Then run `npm run build` and `appkit deploy ssantor-intern ./build`.
```

Why the prompt is self-contained: a fresh Claude session won't have this file's context, so the prompt names the memory doc (auto-loaded), the project dir to cd into, the input/output paths, the schema source of truth, and the build+deploy commands. Keep `REFRESH_PROMPT` in sync if the app URL, project path, or schema location ever moves.

If `npm run dev` is running, HMR picks up the JSON change — no rebuild needed. Otherwise the prompt ends with rebuild+deploy so it works either way.

## Files touched in this change

- `src/data/claude-cost.json` — new, bundled snapshot
- `src/components/features/ClaudeCost.tsx` — new, renders the tab
- `src/App.tsx` — added tab trigger + content

## Claude Cost — follow-up polish (version 3–4)

Done 2026-04-22. All changes are in `src/components/features/ClaudeCost.tsx`.

- **Trend line above the table.** Inline SVG polyline of weekly USD — no chart library. Uses `viewBox={\`0 0 800 160\`}` with `preserveAspectRatio="none"` so it scales to the card width. Colors come from semantic tokens (`text-text-info` wrapper + `currentColor`, `fill-text-tertiary`, `stroke-border-primary`) so light/dark themes adapt for free. `<title>` on each circle gives native hover tooltips. Skip rendering if fewer than 2 weeks.
- **USD column moved** to the second position in the weekly table (right after "Week of"), ahead of Msgs/Tokens. Applied to both the header row and the Total row.
- **Refresh button** in the card header — see the "Refreshing the data later" section for the prompt and rationale.

## To-do tab — D1-backed build steps (what worked)

Tested 2026-04-22 against staging `ssantor-intern`.

### 1. Write the migration

Add a numbered SQL file under `migrations/` (e.g. `001_create_todos.sql`). `apply_migration` runs files in order and skips already-applied ones by checksum — **never edit a migration after it's applied** (CHECKSUM_MISMATCH); add a new one instead.

### 2. Claim the site before applying the migration

On a fresh site, `apply_migration` returns `API error (404): site <name> does not exist` — the D1 database is provisioned by `claim_site`, not by the migration tool. Order is:

1. `check_site_availability(site_name)`
2. `claim_site(site_name)` — creates the D1 database
3. `apply_migration(site_name, migrations_path)`

`migrations_path` is the **directory** (absolute path), not a single `.sql` file.

### 3. Build and deploy

```bash
npm run build
appkit deploy ssantor-intern ./build
```

Same caveat as the Claude Cost deploy: ignore the 2 typecheck errors in `src/lib/g2-fetch-proxy.ts`. The build pipeline is `build:client` (vite) → `build:server` (esbuild) → `build:manifest` (copies `app.yaml`); all three must succeed.

### 4. app.yaml

No extensions/MCP changes needed for D1-only features — D1 access is implicit once the site is claimed.

## My Work tab — merged CUSTDS tickets + to-dos

Done 2026-04-22 (version 2). Replaced the separate **My Tickets** and **To-dos** tabs with a single **My Work** tab. Tickets render on top, a `border-primary` hairline divider in the middle, to-dos below.

Pure composition in `src/App.tsx` — both `MyTickets` and `Todos` already render their own `<h2>` headers, so no component changes were needed:

```tsx
<TabsContent value="mine" forceMount className="data-[state=inactive]:hidden">
  <div className="flex flex-col gap-8">
    <MyTickets />
    <div className="h-px bg-border-primary" />
    <Todos />
  </div>
</TabsContent>
```

If you rebuild this from scratch, skip the separate tabs — go straight to the merged layout.

## Notepad tab — manual meeting notes

Done 2026-04-22. The tab lets you log meetings per-day and take notes on each. Files: `src/components/features/Notepad.tsx`, `server/index.ts` (`/api/meetings` routes), migrations `003_create_meetings.sql` and `004_add_meetings_notes_link.sql`.

### Schema (D1)

```sql
CREATE TABLE meetings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  meeting_date TEXT NOT NULL,         -- YYYY-MM-DD
  start_time TEXT,                    -- unused in current UI; column kept for future
  end_time TEXT,                      -- unused in current UI; column kept for future
  notes TEXT NOT NULL DEFAULT '',
  notes_link TEXT,                    -- optional URL, displayed as "meeting notes link"
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_meetings_date ON meetings(meeting_date);
```

The earlier `meeting_notes` table from migration 002 (keyed by Google Calendar event_id) is unused and was left in place — empty, harmless.

### Server routes

`GET /api/meetings?date=YYYY-MM-DD`, `POST /api/meetings`, `PATCH /api/meetings/:id`, `DELETE /api/meetings/:id`. PATCH uses dynamic `sets[]` builder pattern (same as `/api/todos/:id`) so partial updates work.

### UI behavior worth keeping

- **One date picker drives both adding and viewing.** Input is in the add-form row, defaults to today (`todayISO()`). Changing it refetches meetings for that date and adds new meetings to that date — single source of truth, no separate top-of-page nav.
- **Title prefix.** Each meeting renders as `Wed Apr 22 – <editable title>`. Date prefix is a non-editable `<span>`; only the title is the editable input.
- **Collapsed by default.** Each card shows just chevron + date + title + delete in collapsed state. Click chevron to expand. Newly-created meetings auto-expand (push their id into `expandedIds`) so you can immediately type and Submit.
- **Submit / Edit flow.** Notes textarea is controlled-by-`drafts[id]` only when in edit mode; persisted text renders as read-only `<div>` otherwise. `isEditing(m) = editingIds.has(m.id) || !m.notes` — meetings with empty notes auto-enter edit mode (so brand-new meetings start ready to type). Pencil icon (only visible in expanded view mode) calls `beginEdit` which seeds the drafts.
- **Auto-grow notes textarea.** `AutoGrowTextarea` wraps the design-system `Textarea`; uses a `useRef` + `useEffect` on `props.value` to set `style.height = scrollHeight + 'px'`, plus `overflow: hidden`. No vertical scrollbar ever appears. The component is local to `Notepad.tsx` — small enough not to extract.
- **Notes link.** Optional URL input below the textarea in edit mode. In view mode renders as a small link with text "meeting notes link" (literal, not the URL) + Lucide `Link` icon, opens in new tab. Stored as nullable column; empty string normalized to NULL on PATCH.

### Calendar integration — DO NOT RETRY without checking with platform team

Three protocols were attempted and all failed. Skip these dead ends:

1. **`X-G2-Extension: google-drive` fetch to `googleapis.com/calendar/v3/...`** — kgoose returned `{success:false, error:"API request failed with status 403", statusCode:403}` (HTTP 200 wrapper around 403). The `google-drive` extension covers Drive/Docs/Sheets endpoints only, not Calendar.
2. **`cloudflare-mcp-tool-call` postMessage** via the auto-generated `src/lib/mcp.ts` (`invoke('google_calendar/list_events', ...)`) — every tool name variant (`google_calendar/`, `google-calendar/`, `gcal/`, `google_calendar/get_calendar_events`) returned generic "Tool call failed".
3. **`cloudflare-action` postMessage** mirroring `apps/meeting-context-prepper` and `apps/integrations-testing` in g2-apps byte-for-byte — silent timeout, G2 never replied. Tried both with `extensions:` block and matching integrations-testing's manifest exactly (`connections` + `scopes` + `resources: {}` + `approval: auto`, no `extensions`). Either way, no response.

The transport code matched a working diagnostic app verbatim. Best guess: block-app-kit-deployed apps register with kgoose differently than g2-apps-repo apps, and `ssantor-intern` isn't authorized for the `google_calendar` MCP route on the kgoose side. Right next step if you want calendar back: file with the block-app-kit team referencing this transcript.
