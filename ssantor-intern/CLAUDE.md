# ssantor-intern - Agent Instructions

This file provides instructions for AI coding agents working on this React project.

## Project Context

- **App Name**: ssantor-intern
- **App ID**: ssantor-intern
- **Brand**: block
- **Type**: ui
- **Framework**: React + Vite + TypeScript
- **Runtime**: cloudflare-worker
- **Database**: true
- **Deploy Command**: `appkit deploy ssantor-intern ./build`

## Critical Rules

### DO NOT MODIFY These Files
These files are auto-generated and should never be changed:
- `src/lib/kgoose.ts` - G2 API helpers (g2Get, g2Post, g2Fetch)
- `src/lib/g2-fetch-proxy.ts` - Fetch interceptor for G2 proxy
- `src/lib/mcp.ts` - MCP tool invocation client (G2 postMessage bridge)
- `src/lib/utils.ts` - Class merging utility (cn)
- `src/hooks/useKgoose.ts` - React hooks for external API calls
- `src/hooks/usePermissionCheck.ts` - Snowflake table permission gating hook (dashboard apps only)
- `src/hooks/useMetricData.ts` - Block Data MCP metric fetching hook (dashboard apps only)
- `src/hooks/useSqlQuery.ts` - Query Expert SQL execution hook (dashboard apps only)
- `src/dashboard.config.ts` - Dashboard config types, BUILD_HASH export (dashboard apps only)
- `scripts/write-build-hash.mjs` - Prebuild hash computation script (dashboard apps only)
- `src/styles/theme.css` - Brand CSS variables
- `server/lib/logger.ts` - Logging utilities
- `server/lib/errors.ts` - Error handling utilities
- `server/lib/db.ts` - Database utilities (if present)

### Required Directory Structure
```
ssantor-intern/
├── agent.md              # This file (read-only reference)
├── app.yaml              # App manifest - UPDATE when adding capabilities
├── vite.config.ts        # Vite configuration
├── tsconfig.json         # TypeScript configuration
├── index.html            # Vite entry point
├── scripts/
│   └── write-build-hash.mjs  # Prebuild script (DO NOT MODIFY)
├── src/
│   ├── main.tsx          # React entry point
│   ├── App.tsx           # Main component - START HERE
│   ├── components/
│   │   └── ui/           # Design system components (Button, Card, Input, etc.)
│   ├── hooks/            # useKgoose lives here (DO NOT MODIFY)
│   ├── lib/              # kgoose.ts + utils.ts live here (DO NOT MODIFY)
│   ├── metrics/          # Metric config JSON files (dashboard apps only)
│   ├── queries/          # SQL query files, one per query (dashboard apps only)
│   └── styles/           # main.css — Tailwind + design tokens
├── server/               # Backend code
│   ├── index.ts          # Hono API server
│   ├── routes/           # API route handlers
│   └── lib/              # DO NOT MODIFY
├── tests/                # Test files
└── migrations/           # SQL migrations (if database enabled)
```

## React Patterns

### How External API Calls Work

All external API calls are proxied through G2, which handles authentication automatically.
Users never need to provide API credentials.

The flow:
1. `g2-fetch-proxy.ts` (initialized in `main.tsx`) intercepts all external `fetch()` calls
2. External requests are forwarded to the G2 parent window via `postMessage`
3. G2 authenticates via kgoose and returns the response
4. The `X-G2-Extension` header tells G2 which service to authenticate with

Use the helpers in `src/lib/kgoose.ts` or plain `fetch()` with `X-G2-Extension`:

```tsx
import { g2Get, g2Post } from './lib/kgoose'

// GET
const monitors = await g2Get('https://api.datadoghq.com/api/v1/monitor', 'datadog')

// POST
await g2Post('https://slack.com/api/chat.postMessage', 'slack', {
  channel: '#general', text: 'Hello!'
})

// Plain fetch also works (the proxy intercepts it):
await fetch('https://api.datadoghq.com/api/v1/monitor', {
  headers: { 'X-G2-Extension': 'datadog' }
})
```

### useKgoose Hook (for loading/error state)

Wraps g2Get/g2Post with React state management. GET if no body, POST if body provided:

```tsx
import { useKgoose } from './hooks/useKgoose'

function MonitorList() {
  const { callService, isLoading, error, data } = useKgoose()

  return (
    <div>
      <button onClick={() => callService('https://api.datadoghq.com/api/v1/monitor', 'datadog')} disabled={isLoading}>
        Fetch Monitors
      </button>
      {error && <p className="error">{error.message}</p>}
      {data && <pre>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  )
}
```

### Convenience Hooks for Common Services

Pre-built hooks use real API URLs with the correct X-G2-Extension headers:

```tsx
import { useSlack, useLinear, useAirtable, useProvider } from './hooks/useKgoose'

// Slack - sends to https://slack.com/api/chat.postMessage
function SlackNotifier() {
  const { sendMessage, isLoading } = useSlack()

  return (
    <button onClick={() => sendMessage('#general', 'Hello!')} disabled={isLoading}>
      {isLoading ? 'Sending...' : 'Notify Slack'}
    </button>
  )
}

// Linear - sends GraphQL to https://api.linear.app/graphql
function IssueViewer() {
  const { query, isLoading, data } = useLinear()

  const fetchIssues = () => query('{ issues(first: 10) { nodes { id title } } }')

  return <button onClick={fetchIssues} disabled={isLoading}>Fetch Issues</button>
}

// Airtable - calls https://api.airtable.com/v0/{baseId}/{tableId}
function RecordFetcher() {
  const { listRecords, isLoading } = useAirtable()

  return <button onClick={() => listRecords('baseId', 'tableId')}>Fetch Records</button>
}

// Generic provider (for any service with a base URL)
function PagerDutyServices() {
  const pd = useProvider('pagerduty', 'https://api.pagerduty.com')

  return <button onClick={() => pd.get('/services')}>List Services</button>
}
```

### Using LLM Completions

Apps can call an LLM through the G2 parent window using postMessage. This is similar to the fetch proxy
pattern -- the app sends a request, G2 handles auth and routing to kgoose, and sends back the response.

Create a `useLlm` hook in `src/hooks/useLlm.ts`:

```tsx
import { useState, useCallback } from 'react'

interface LlmOptions {
  systemPrompt?: string
  jsonSchema?: object
  extensions?: string[]
}

interface UseLlmResult {
  complete: (prompt: string, options?: LlmOptions) => Promise<string>
  isLoading: boolean
  error: Error | null
}

const pendingRequests = new Map<string, {
  resolve: (content: string) => void
  reject: (error: Error) => void
}>()

// Listen for LLM responses from G2
if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'cloudflare-llm-response') {
      const { requestId, success, content, error } = event.data
      const pending = pendingRequests.get(requestId)
      if (pending) {
        pendingRequests.delete(requestId)
        if (success) {
          pending.resolve(content)
        } else {
          pending.reject(new Error(error || 'LLM request failed'))
        }
      }
    }
  })
}

export function useLlm(): UseLlmResult {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const complete = useCallback(async (prompt: string, options?: LlmOptions): Promise<string> => {
    setIsLoading(true)
    setError(null)

    const requestId = crypto.randomUUID()

    try {
      const result = await new Promise<string>((resolve, reject) => {
        pendingRequests.set(requestId, { resolve, reject })

        window.parent.postMessage({
          type: 'cloudflare-llm-request',
          requestId,
          messages: [{ role: 'user', content: prompt }],
          systemPrompt: options?.systemPrompt,
          jsonSchema: options?.jsonSchema,
          extensions: options?.extensions,
        }, '*')

        // Timeout after 5 minutes
        setTimeout(() => {
          if (pendingRequests.has(requestId)) {
            pendingRequests.delete(requestId)
            reject(new Error('LLM request timed out'))
          }
        }, 300000)
      })

      return result
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err))
      setError(e)
      throw e
    } finally {
      setIsLoading(false)
    }
  }, [])

  return { complete, isLoading, error }
}
```

Usage in a component:

```tsx
import { useLlm } from '../hooks/useLlm'

function SummaryGenerator() {
  const { complete, isLoading, error } = useLlm()
  const [summary, setSummary] = useState('')

  const handleSummarize = async (text: string) => {
    const result = await complete(text, {
      systemPrompt: 'Summarize the following text in 2-3 sentences.',
    })
    setSummary(result)
  }

  return (
    <div>
      <button onClick={() => handleSummarize('...')} disabled={isLoading}>
        {isLoading ? 'Generating...' : 'Summarize'}
      </button>
      {error && <p className="error">{error.message}</p>}
      {summary && <p>{summary}</p>}
    </div>
  )
}
```

For structured JSON responses, pass a `jsonSchema`:

```tsx
const result = await complete('List 3 colors', {
  systemPrompt: 'Return a list of colors.',
  jsonSchema: {
    type: 'object',
    properties: { colors: { type: 'array', items: { type: 'string' } } },
  },
})
const parsed = JSON.parse(result)
```

To enable kgoose extensions (backend tools like builderbot):

```tsx
const result = await complete('Build me a landing page', {
  extensions: ['builderbot'],
})
```

### X-G2-Extension Convention

The `X-G2-Extension` header tells G2 which service to authenticate with.
Use the service name that matches the connected extension in G2 settings.

Common extensions:
- `slack` - Slack API (https://slack.com/api/...)
- `linear` - Linear GraphQL API (https://api.linear.app/graphql)
- `datadog` - Datadog API (https://api.datadoghq.com/...)
- `pagerduty` - PagerDuty API (https://api.pagerduty.com/...)
- `sentry` - Sentry API (https://sentry.io/api/0/...)
- `airtable` - Airtable API (https://api.airtable.com/v0/...)

Use the real API URLs from each service's documentation.

### Component Structure

Organize components in `src/components/`:

```
src/components/
├── ui/                   # Design system primitives (pre-installed)
│   ├── button.tsx
│   ├── card.tsx
│   ├── input.tsx
│   ├── dialog.tsx
│   ├── ... (14 components total)
├── features/             # Feature-specific components
│   ├── MonitorList.tsx
│   ├── MonitorForm.tsx
│   └── QueryBuilder.tsx
└── layout/               # Layout components
    ├── Header.tsx
    ├── Sidebar.tsx
    └── PageContainer.tsx
```

### State Management

For simple apps, use React's built-in state:

```tsx
// Local state
const [items, setItems] = useState<Item[]>([])

// Complex state with reducer
const [state, dispatch] = useReducer(reducer, initialState)

// Shared state with Context
const AppContext = createContext<AppState | null>(null)

function AppProvider({ children }) {
  const [state, setState] = useState(initialState)
  return (
    <AppContext.Provider value={{ state, setState }}>
      {children}
    </AppContext.Provider>
  )
}
```

**Guidelines:**
- Pass props down, lift state up
- Use URL state for shareable views (query params)
- Only add Context for truly global state

## Infrastructure Constraints

### DO Use
- **External APIs**: `fetch()` with `X-G2-Extension` header (or `g2Get`/`g2Post` helpers)
- **Database**: Cloudflare D1 (SQLite-compatible) via server-side `db`
- **API Routes**: Hono framework in `server/index.ts`
- **Styling**: Tailwind CSS v4 with semantic design tokens
- **Logging**: `logger` from `server/lib/logger`
- **Errors**: Error classes from `server/lib/errors`

### DO NOT Use
- API keys, tokens, or credentials in code (G2 handles auth via X-G2-Extension)
- DynamoDB, PostgreSQL, MongoDB - use D1 instead
- Express, Fastify, Koa - use Hono instead
- External CSS frameworks - use Tailwind with design tokens
- `console.log` in production - use `logger` instead

### CRITICAL: External API Access

**NEVER** ask users for API keys or handle authentication directly. All external service
calls go through the G2 fetch proxy, which handles authentication automatically via the
`X-G2-Extension` header.

```tsx
// WRONG - Never handle auth manually:
const response = await fetch('https://api.slack.com/...', {
  headers: { 'Authorization': 'Bearer xoxb-...' }  // NO!
})

// RIGHT - Use g2Post (or g2Get, g2Fetch) which sets X-G2-Extension:
import { g2Post } from './lib/kgoose'
await g2Post('https://slack.com/api/chat.postMessage', 'slack', {
  channel: '#general',
  text: 'Hello!'
})
```

### If User Asks for Incompatible Tech
Explain the alternative politely:
- "D1 is our database here - it's SQLite-compatible and works similarly to [requested tech]"
- "We use Hono for API routes - it has a similar API to Express"
- "External APIs go through the G2 fetch proxy which handles all authentication"

## Code Patterns

### Creating a Component

```tsx
// src/components/features/ItemList.tsx
import { g2Get } from '../../lib/kgoose'
import { useState, useEffect } from 'react'

interface Item {
  id: string
  name: string
}

interface ItemListProps {
  onItemSelect?: (item: Item) => void
}

export function ItemList({ onItemSelect }: ItemListProps) {
  const [items, setItems] = useState<Item[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<Error | null>(null)

  useEffect(() => {
    const fetchItems = async () => {
      try {
        const result = await g2Get<Item[]>('https://api.example.com/items', 'example')
        setItems(result || [])
      } catch (err) {
        setError(err instanceof Error ? err : new Error(String(err)))
      } finally {
        setIsLoading(false)
      }
    }
    fetchItems()
  }, [])

  if (isLoading) return <div>Loading...</div>
  if (error) return <div className="error">{error.message}</div>

  return (
    <ul>
      {items.map(item => (
        <li key={item.id} onClick={() => onItemSelect?.(item)}>
          {item.name}
        </li>
      ))}
    </ul>
  )
}
```

### Creating an API Route

Add routes to `server/index.ts` before the static file handler:

```typescript
import { Hono } from 'hono'
import { logger } from './lib/logger'
import { NotFoundError, ValidationError } from './lib/errors'

const app = new Hono()

// Add your route
app.get('/api/items', async (c) => {
  logger.info('Fetching items')
  return c.json({ items: [] })
})

app.post('/api/items', async (c) => {
  const body = await c.req.json()

  if (!body.name) {
    throw new ValidationError('Name is required')
  }

  logger.info('Creating item', { name: body.name })
  return c.json({ id: 1, name: body.name }, 201)
})

// Static files must be last
app.get('/*', serveStatic({ root: './' }))
```

### Using the Database (if enabled)

```typescript
// In server-side code only
import { db } from './lib/db'

const users = await db.query<User>('SELECT * FROM users WHERE active = ?', [true])
const user = await db.first<User>('SELECT * FROM users WHERE id = ?', [userId])
const result = await db.execute('INSERT INTO users (name) VALUES (?)', [name])
```

### Design System

This app includes a design system with pre-built UI components and semantic design tokens.
Always use the design system components and Tailwind utility classes instead of custom CSS.

#### Available Components (`src/components/ui/`)

| Component | Import | Description |
|-----------|--------|-------------|
| Button | `./components/ui/button` | Variants: default, destructive, outline, secondary, ghost, link. Sizes: xs, sm, default, lg. Shapes: pill, round |
| Card | `./components/ui/card` | Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter |
| Input | `./components/ui/input` | Text input with focus/hover states |
| Dialog | `./components/ui/dialog` | Modal dialog with overlay, header, footer, title, description |
| Sheet | `./components/ui/sheet` | Slide-out panel (side: top, right, bottom, left) |
| Tabs | `./components/ui/tabs` | Tab navigation with content panels |
| DropdownMenu | `./components/ui/dropdown-menu` | Menu with items, checkboxes, radio groups, separators |
| Switch | `./components/ui/switch` | Toggle switch |
| ScrollArea | `./components/ui/scroll-area` | Custom scrollbar area |
| Separator | `./components/ui/separator` | Horizontal or vertical divider |
| Skeleton | `./components/ui/skeleton` | Loading placeholder |
| Tooltip | `./components/ui/tooltip` | Hover tooltip |
| Collapsible | `./components/ui/collapsible` | Expandable/collapsible section |
| Pill | `./components/ui/pill` | Badge/tag with variants: default, glass, solid, gradient, glow |

#### Using Components

```tsx
import { Button } from './components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card'
import { Input } from './components/ui/input'

function MyFeature() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Create Item</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Input placeholder="Item name" />
        <Button>Save</Button>
      </CardContent>
    </Card>
  )
}
```

#### Styling with Tailwind + Semantic Tokens

Use Tailwind utility classes with semantic token colors. Never use raw hex colors.

```tsx
{/* Semantic background/text classes */}
<div className="bg-background-primary text-text-primary">Primary content</div>
<div className="bg-background-secondary text-text-secondary">Secondary content</div>
<div className="bg-background-inverse text-text-inverse">Inverse (dark on light, light on dark)</div>

{/* Status colors */}
<div className="text-text-danger">Error message</div>
<div className="text-text-success">Success message</div>
<div className="bg-background-warning">Warning banner</div>

{/* Borders */}
<div className="border border-border-primary">Default border</div>

{/* Shadows */}
<div className="shadow-sm">Subtle shadow</div>
<div className="shadow-md">Medium shadow</div>
```

#### Extending Components with `cn()`

All components accept a `className` prop for overrides via `cn()`:

```tsx
import { cn } from './lib/utils'

<Button className="w-full">Full width button</Button>
<Card className={cn("max-w-md", isActive && "ring-2 ring-ring-info")}>...</Card>
```

## app.yaml Maintenance (CRITICAL)

When adding new capabilities, you MUST update `app.yaml`:

### Adding an External Service

```yaml
# In app.yaml, add to permissions:
permissions:
  connections: ["existing_service", "new_service"]
  extensions:
    existing_service:
      access: read
    new_service:
      access: read_write
```

The `extensions` block tells the STS scope generator what access level to request for each connection. Use `read` for read-only services and `read_write` for services that need write access. Known connection names are mapped to scope prefixes via `SCOPE_PREFIX` (e.g., `query-expert` → `query_expert`, `google` → `google_drive`). By default, hyphens in connection names are replaced with underscores.

### Adding MCP Tool Usage

```yaml
# In app.yaml, add to mcp_tools:
mcp_tools:
  - name: tool_name
    provider: service_name
    required: true
    description: Why this feature needs it
```

**Always tell the user**: "I've added [service] to app.yaml. You may need to approve this permission before the feature will work."

## Testing

### Writing Tests

```typescript
// tests/example.test.ts
import { describe, it, expect } from 'vitest'

describe('Feature', () => {
  it('should work correctly', () => {
    expect(true).toBe(true)
  })
})
```

### Testing Components

```typescript
// tests/components/ItemList.test.tsx
import { render, screen } from '@testing-library/react'
import { ItemList } from '../src/components/features/ItemList'

describe('ItemList', () => {
  it('renders loading state', () => {
    render(<ItemList />)
    expect(screen.getByText('Loading...')).toBeInTheDocument()
  })
})
```

### Running Tests

```bash
npm test
```

## Development

### Local development (with g2)

To test with full auth, kgoose proxy, and LLM completions:

1. Start the app dev server: `npm run dev -- --port 3000`
2. Start g2 locally: `cd <g2-repo> && just run` (runs on port 5173)
3. Open `http://localhost:5173/apps/ssantor-intern`

g2 auto-detects the local app by checking app.yaml and iframes it. Hot reload works.
Use `?dev=PORT` to override the port if needed (e.g. `?dev=4200`).

The `/api` routes proxy to the deployed staging worker by default (so the D1
database works). Set `API_TARGET=http://localhost:8787` to use a local backend.

### Start dev server
```bash
npm run dev -- --port 3000
```

### Build for production
```bash
npm run build
```

### Type checking
```bash
npm run typecheck
```

## Deploy Checklist

Before asking the user to deploy, ensure:

1. [ ] All tests pass (`npm test`)
2. [ ] Build succeeds (`npm run build`)
3. [ ] No TypeScript errors (`npm run typecheck`)
4. [ ] app.yaml is updated with any new permissions/tools
5. [ ] No hardcoded secrets or API keys
6. [ ] Loading and error states are handled in UI

Then the user can deploy with:
```bash
appkit deploy ssantor-intern ./build
```

## Build Hash & Verification

- `src/dashboard.config.json` stores `build_hash`, computed automatically by `scripts/write-build-hash.mjs` during `npm run build` (via the `prebuild` lifecycle hook).
- The hash covers **data-layer files only**: `src/queries/*.sql`, `src/metrics/*.json`, and `dashboard.config.json` metadata (with `build_hash` stripped to avoid circularity).
- **UI-only changes** (styling, layout, component structure) do **not** change the build hash. Only data-layer changes (new queries, new metrics, changed source tables) trigger a new hash.
- G2 is the verification authority — it stores status, verifier, and date against each build hash. G2 renders the verification badge in its own chrome, outside the app iframe.
- The app does not handle verification UI. It only reports its `build_hash`.

## Design Guidelines

- **No emojis** in the UI, code comments, or user-facing text
- **Always use design system components** (Button, Card, Input, etc.) before creating custom ones
- **Always use semantic token classes** (`bg-background-primary`, `text-text-secondary`) — never raw hex colors
- **Use Tailwind utilities** for layout, spacing, and responsive design
- Keep the interface clean and professional
- Both light and dark themes are supported via the `.dark` class — semantic tokens adapt automatically
- Icons: use `lucide-react` for consistent iconography
