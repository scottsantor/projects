import { useCallback, useEffect, useState } from 'react'
import { g2Post } from '../../lib/kgoose'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import { Skeleton } from '../ui/skeleton'

const LINEAR_API = 'https://api.linear.app/graphql'
const CUSTDS_TEAM_ID = '0f2a0619-8b8c-490e-98da-7fb25874f979'

interface LinearIssue {
  id: string
  identifier: string
  title: string
  url: string
  priority: number
  dueDate: string | null
  state: { name: string; type: string; color: string }
  team: { id: string; key: string; name: string }
  updatedAt: string
}

interface ViewerResponse {
  data?: {
    viewer: {
      id: string
      name: string
      email: string
      assignedIssues: { nodes: LinearIssue[] }
    } | null
  }
  errors?: { message: string }[]
}

const PRIORITY_LABELS: Record<number, string> = {
  0: 'No priority',
  1: 'Urgent',
  2: 'High',
  3: 'Medium',
  4: 'Low',
}

const PRIORITY_STYLE: Record<number, string> = {
  1: 'bg-background-secondary text-text-danger',
  2: 'bg-background-secondary text-text-warning',
  3: 'bg-background-secondary text-text-info',
  4: 'bg-background-secondary text-text-secondary',
  0: 'bg-background-secondary text-text-tertiary',
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function formatDue(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Active state types (exclude completed and canceled).
const ACTIVE_STATE_TYPES = new Set(['triage', 'backlog', 'unstarted', 'started'])

export function MyTickets() {
  const [issues, setIssues] = useState<LinearIssue[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null)

  const [debugInfo, setDebugInfo] = useState<string | null>(null)

  const fetchIssues = useCallback(async () => {
    setLoading(true)
    setError(null)
    setDebugInfo(null)

    // Simple query — no server-side filter. We filter by team + active state client-side.
    // This sidesteps the G2 proxy's known issues with nested GraphQL filters.
    const query = `query {
      viewer {
        id
        name
        email
        assignedIssues(first: 250, orderBy: updatedAt) {
          nodes {
            id
            identifier
            title
            url
            priority
            dueDate
            updatedAt
            state { name type color }
            team { id key name }
          }
        }
      }
    }`

    try {
      const data = await g2Post<ViewerResponse>(LINEAR_API, 'linear', { query })

      if (data.errors?.length) {
        throw new Error(data.errors.map((e) => e.message).join(', '))
      }

      if (!data.data?.viewer) {
        throw new Error('No viewer returned — Linear auth may not be connected for this app.')
      }

      const viewer = data.data.viewer
      const allNodes = viewer.assignedIssues.nodes ?? []
      const custdsNodes = allNodes.filter((n) => n.team.id === CUSTDS_TEAM_ID)
      const active = custdsNodes.filter((n) => ACTIVE_STATE_TYPES.has(n.state.type))

      setIssues(active)
      setLastRefreshed(new Date())
      setDebugInfo(
        `viewer=${viewer.name} (${viewer.email}) · total assigned=${allNodes.length} · in CUSTDS=${custdsNodes.length} · active=${active.length}`
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchIssues()
  }, [fetchIssues])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">My CUSTDS Tickets</h2>
          <p className="text-sm text-text-secondary">
            {lastRefreshed
              ? `Last refreshed ${formatRelative(lastRefreshed.toISOString())}`
              : 'Loading...'}
            {issues && ` · ${issues.length} active`}
          </p>
        </div>
        <Button onClick={fetchIssues} disabled={loading} variant="outline">
          {loading ? 'Refreshing...' : 'Refresh'}
        </Button>
      </div>

      {error && (
        <div className="rounded-md border border-border-primary bg-background-secondary px-3 py-2 text-sm text-text-danger">
          {error}
        </div>
      )}

      {debugInfo && (
        <div className="rounded-md border border-border-primary bg-background-secondary px-3 py-2 text-xs font-mono text-text-secondary">
          {debugInfo}
        </div>
      )}

      {!issues && loading && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full" />
          ))}
        </div>
      )}

      {issues && issues.length === 0 && !loading && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-text-secondary">
            No active tickets assigned to you in CUSTDS.
          </CardContent>
        </Card>
      )}

      {issues && issues.length > 0 && (
        <div className="flex flex-col gap-2">
          {issues.map((issue) => (
            <Card key={issue.id}>
              <CardContent className="flex items-start gap-4 py-3">
                <div className="flex flex-col items-center gap-1 min-w-[70px]">
                  <span className="text-xs font-mono text-text-secondary">{issue.identifier}</span>
                  <span
                    className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${PRIORITY_STYLE[issue.priority]}`}
                  >
                    {PRIORITY_LABELS[issue.priority]}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <a
                    href={issue.url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium text-text-primary hover:underline break-words"
                  >
                    {issue.title}
                  </a>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-xs text-text-secondary">
                    <span className="inline-flex items-center gap-1">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ backgroundColor: issue.state.color }}
                      />
                      {issue.state.name}
                    </span>
                    {issue.dueDate && <span>Due {formatDue(issue.dueDate)}</span>}
                    <span>Updated {formatRelative(issue.updatedAt)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
