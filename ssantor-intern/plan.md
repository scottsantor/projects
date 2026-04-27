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

## Meeting Notes tab — reframed as a persistent running log

Done 2026-04-24 (versions 21–22). The tab was originally framed as a single-day notepad: a date input filtered the view to one day, and the heading read "Today · Fri Apr 24 · N meetings". After a few days of use it became confusing — past notes were still in D1, but invisible unless you remembered to switch the date picker.

Reframed in `src/components/features/Notepad.tsx`:

- Tab label: **Notepad → Meeting Notes** (in `App.tsx`).
- Heading: "Meeting Notes" with subtitle "N meetings — your running log of notes, kept across days".
- `GET /api/meetings` is now called without a `date=` query param, returning **all** meetings across all dates. Server already supported this — `server/index.ts:193–206` returns the unfiltered set ordered by `meeting_date DESC, start_time ASC, id ASC` when `date` is absent.
- Add-meeting form still has a date input, but it's now scoped to *the new meeting being created* (not a view filter). Defaults to today, resets to today after each submit.
- Client-side `sortMeetings` updated to sort by `meeting_date` DESC first, then `start_time` ASC, then `id` — newest day at the top of the list.
- Removed the now-unused `formatDateLabel` and `addDaysISO` helpers.

Each card still prefixes the title with `formatShortDate(meeting_date)` (e.g. `Fri Apr 24 – Standup`), so days are visually distinguishable in the merged list.

No DB migration needed — the same `meetings` table backs both views; only the read query changed.

## Header subtitle reframe

Done 2026-04-24 (version 22). The header subtitle in `src/App.tsx` was "Linear cockpit — create CUSTDS tickets and track what's assigned to you", which was accurate for v1 but undersold the app once Notepad/Polish/Cost/Links were added. Replaced with: "One-stop shop for Scott to stay on top of his work — tickets, todos, meeting notes, costs, and quick links, all in one place."

Tradeoff: the subtitle now lists tabs by name. If the tab list changes meaningfully, update the subtitle too.

## Polish Writeup tab — voice-matched LLM rewrite

Done 2026-04-24 (version 23). New tab that takes a draft and rewrites it in Scott's voice using the G2 LLM bridge.

### Files

- `src/hooks/useLlm.ts` — new. Implements the `cloudflare-llm-request` postMessage pattern from CLAUDE.md verbatim. 5-minute timeout, request map keyed by `crypto.randomUUID()`, single global `message` listener installed at module load. No changes needed beyond the template.
- `src/components/features/PolishWriteup.tsx` — new. Draft textarea (auto-grow, min height 160px) → **Polish** button → polished output card with **Copy** button. Uses `useLlm.complete(draft, { systemPrompt: SYSTEM_PROMPT })`.
- `src/App.tsx` — added tab trigger, content, and import.

### Voice profile (the critical part)

The system prompt encodes Scott's voice. It was distilled at build time from a 30-day Slack search (`sq agent-tools slack search-messages --from-user me --newer-than P30D --limit 100`), not fetched at runtime — keeps the polish call fast and keeps Slack content out of the deployed app.

Key voice rules baked into `SYSTEM_PROMPT`:
- Warm collaborative openers ("Hey", "FYI", "Heads up"), contractions throughout.
- Action-oriented and forward-looking — compresses past-failure context to one sentence and pivots forward. Explicit instruction: **"if the draft retreads a failed attempt, compress it to one sentence of context and pivot to the forward path."**
- Empathetic acknowledgement before redirecting ("I hear you", "I get where you're coming from").
- Humble hedging ("I think", "my understanding is", "IMO") instead of false certainty.
- **Preserves specifics** — names, numbers, dates, ticket links, queue/table names. Explicitly forbidden to strip these during rewrite.
- Bulleted summaries with TLDRs when long; light sign-offs when fitting.
- Avoids: apologetic filler, corporate stiffness, blame, hype, emoji unless the draft already uses one.
- Output format: returns ONLY the polished text — no preamble, no markdown fences, no "Here's the polished version:" lead-in.

A condensed version of the voice profile was also saved to user memory at `user_writing_voice.md` so future Claude conversations can ghostwrite for Scott without rescanning Slack. The app's `SYSTEM_PROMPT` is the canonical/full version — update it there first, then sync the memory if substantive.

### app.yaml

No changes. The G2 LLM bridge is implicit; no kgoose extensions are invoked unless `options.extensions` is passed to `complete()` (it isn't, by default).

## Home tab — default landing with click-to-navigate tiles

Done 2026-04-24 (version 24). New default tab that asks "What do you want to do?" and shows six clickable cards, one per other tab. Click a card → that tab activates.

### How navigation works

Tabs were converted from uncontrolled to controlled in `src/App.tsx`:

```tsx
const [tab, setTab] = useState('home')
<Tabs value={tab} onValueChange={setTab} ...>
```

`<Home onNavigate={setTab} />` receives `setTab` as a prop. Each tile in `Home.tsx` calls `onNavigate(tile.id)` on click — no router, no events, no context.

The header tabs and the Home tiles share the same `setTab` so both work; `forceMount` on every `TabsContent` (already in place from earlier work) means switching tabs doesn't unmount and remount components — important for the Notepad's expanded/edit state and the Polish Writeup's polished output to survive tab switches.

### Tile copy

Each tile shows a question prompt ("Do I want to create a ticket?") matching the way Scott described the design, plus a one-line blurb about what the tab does. Lucide icons: `Ticket`, `ListTodo`, `NotebookPen`, `Sparkles`, `DollarSign`, `Link`. Hover states use semantic tokens (`hover:border-border-secondary hover:shadow-md`) so light/dark themes adapt.

Layout: `grid-cols-1 md:grid-cols-2` — two-up on wider screens, single column on mobile.

### If you add a new tab later

Two places to touch:
1. `App.tsx` — add `<TabsTrigger>` + `<TabsContent>`.
2. `Home.tsx` — add a tile to the `TILES` array (`id` must match the `TabsTrigger value`).

(The header subtitle was removed in version 29, so there's no longer a third place that lists tabs by name.)

## Deploy note: `appkit` CLI vs. block-app-kit MCP

`appkit deploy ssantor-intern ./build` (per CLAUDE.md) requires the `appkit` CLI on PATH. On 2026-04-24 the CLI wasn't installed in the active shell, and deploys were done via the **block-app-kit MCP `deploy_site` tool** instead:

```
mcp__block-app-kit__deploy_site(
  site_name="ssantor-intern",
  build_path="/Users/ssantor/claude/projects/ssantor-intern/build",
  message="..."
)
```

Both paths produce the same artifact (a versioned site upload). Use whichever is available — CLI is faster from a terminal, MCP works from inside a Claude Code session without the binary installed.

## Scratch tab — open localStorage-backed pad

Done 2026-04-27 (versions 25–26). New tab whose entire purpose is "type stuff, paste stuff, copy stuff back out." No backend, no LLM, no API calls.

### Files

- `src/components/features/Scratch.tsx` — new. One textarea (`min-h-[60vh]`, monospace), Copy-all and Clear buttons in the header, char count next to them. Persists to `localStorage` under the key `ssantor-intern:scratch` on every keystroke; reads the same key on mount so content survives tab switches and reloads.
- `src/App.tsx` — added trigger, content, and import.
- `src/components/features/Home.tsx` — added a `Pencil`-icon tile.

### Tab order — Scratch sits at the far right

Scott's preference: utility/free-form tabs go to the right, scoped/structured tabs stay on the left. Final order (versions 26+):

`Home · Create Ticket · To-Do · Meeting Notes · Polish Writeup · Claude Cost · Links · Scratch`

The Home tile grid mirrors the same order. If you reorder the tabs, reorder `TILES` in `Home.tsx` to match — the two should never disagree.

### app.yaml

No changes. localStorage is browser-side, no extensions or scopes needed.

## Links — RADS Sprint Dashboard added to Block Web Apps

Done 2026-04-27 (versions 27–28). Added `https://blockcell.sqprod.co/sites/rads-sprint-dashboard/` to the **Block Web Apps** section in `src/components/features/Links.tsx` (originally placed under "Verified Dashboard Links" in v27, then moved on Scott's request).

Convention to follow when adding more links: Blockcell-hosted apps and g2-hosted apps both go under **Block Web Apps**. **Verified Dashboard Links** is reserved for Mode and Looker dashboards specifically.

## Header subtitle removed

Done 2026-04-27 (version 29). The header subtitle ("One-stop shop for Scott to stay on top of his work — tickets, todos, meeting notes, costs, and quick links, all in one place.") was deleted from `src/App.tsx`. The header is now just the H1 ("Scott's Intern") with no subtitle. Side effect: the "If you add a new tab later" checklist above lost its third item.

## My Work → To-Do rename

Done 2026-04-27 (version 30). The tab previously labeled **My Work** is now **To-Do**.

- `App.tsx` — `<TabsTrigger value="mine">To-Do</TabsTrigger>` (the `value` stayed as `"mine"`; only the visible label changed, so no other wiring breaks).
- `Home.tsx` — tile `title` → `'To-Do'`, prompt → `'Do I want to look at my to-dos?'`. Tile `id` and `blurb` unchanged.

The underlying component still composes `<MyTickets />` (Linear tickets assigned to me) + `<Todos />` (D1-backed todos), so the label is the only thing that moved.
