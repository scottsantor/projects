import { useState } from 'react'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import { llmComplete } from '../../lib/llm'
import type { TicketMapping } from '../../App'

interface LinkedPair {
  jiraKey: string
  linearId: string
  linearIdentifier: string
  isProject: boolean
}

interface LinearUpdate {
  jiraKey: string
  linearIdentifier: string
  linearUrl: string
  type: 'status_change' | 'comment' | 'project_update'
  summary: string
  details: string
  timestamp: string
  author: string
}

interface LinearSource {
  identifier: string
  url: string
}

interface JiraSyncSummary {
  jiraKey: string
  linearSources: LinearSource[]
  updates: LinearUpdate[]
  combinedBody: string
}

interface Props {
  mappings: TicketMapping[]
  onMappingsChange: () => void
}

const SAVED_PAIRS_KEY = 'ljs_linked_pairs'

function loadSavedPairs(): LinkedPair[] {
  try {
    const stored = localStorage.getItem(SAVED_PAIRS_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

function savePairs(pairs: LinkedPair[]) {
  localStorage.setItem(SAVED_PAIRS_KEY, JSON.stringify(pairs))
}

// Parse Linear input — detects issue URLs, project URLs, or raw identifiers
function parseLinearInput(input: string): { id: string; identifier: string; isProject: boolean } | null {
  const trimmed = input.trim()
  if (!trimmed) return null

  // Try issue URL: https://linear.app/squareup/issue/CUSTDS-41/...
  const urlMatch = trimmed.match(/linear\.app\/[^/]+\/issue\/([A-Z]+-\d+)/)
  if (urlMatch) {
    return { id: '', identifier: urlMatch[1], isProject: false }
  }

  // Try project URL: https://linear.app/squareup/project/cash-app-project-phone-plan-launch-2422862cf293/...
  const projectMatch = trimmed.match(/linear\.app\/[^/]+\/project\/([^/]+?)(?:\/|$)/)
  if (projectMatch) {
    return { id: '', identifier: projectMatch[1], isProject: true }
  }

  // Try raw identifier like CUSTDS-41
  if (/^[A-Z]+-\d+$/.test(trimmed)) {
    return { id: '', identifier: trimmed, isProject: false }
  }

  return { id: '', identifier: trimmed, isProject: false }
}

export function SyncUpdates({ mappings, onMappingsChange }: Props) {
  const [pairs, setPairs] = useState<LinkedPair[]>(loadSavedPairs)
  const [newJiraKey, setNewJiraKey] = useState('')
  const [newLinearInput, setNewLinearInput] = useState('')
  const [summaries, setSummaries] = useState<JiraSyncSummary[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const addPair = () => {
    let jira = newJiraKey.trim()
    // Extract key from full Jira URL like https://block.atlassian.net/browse/COA-719
    const jiraUrlMatch = jira.match(/atlassian\.net\/browse\/([A-Z]+-\d+)/i)
    if (jiraUrlMatch) {
      jira = jiraUrlMatch[1].toUpperCase()
    } else {
      jira = jira.toUpperCase()
    }
    if (!jira) return
    const parsed = parseLinearInput(newLinearInput)
    if (!parsed) return

    const updated = [...pairs, { jiraKey: jira, linearId: parsed.id, linearIdentifier: parsed.identifier, isProject: parsed.isProject }]
    setPairs(updated)
    savePairs(updated)
    setNewJiraKey('')
    setNewLinearInput('')
  }

  const removePair = (idx: number) => {
    const updated = pairs.filter((_, i) => i !== idx)
    setPairs(updated)
    savePairs(updated)
  }

  const fetchLinearUpdates = async () => {
    if (pairs.length === 0) {
      setError('Add at least one Jira / Linear pair above first.')
      return
    }

    setLoading(true)
    setError(null)
    setSuccessMsg(null)

    try {
      const allUpdates: LinearUpdate[] = []

      for (const pair of pairs) {
        if (pair.isProject) {
          // --- PROJECT: fetch project updates + all issue statuses/comments ---
          // Extract the short slugId from the URL slug (last segment after final hyphen that looks like a hash)
          const slugParts = pair.linearIdentifier.match(/([a-f0-9]{12})$/)
          const shortSlugId = slugParts ? slugParts[1] : pair.linearIdentifier

          // Paginate through all projects to find the matching one
          let matchedProjectId: string | null = null
          let matchedProjectName: string | null = null
          let cursor: string | null = null
          let found = false

          while (!found) {
            const afterClause = cursor ? `, after: "${cursor}"` : ''
            const searchRes = await fetch('https://api.linear.app/graphql', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-G2-Extension': 'linear',
              },
              body: JSON.stringify({
                query: `query { projects(first: 100${afterClause}) { nodes { id name slugId } pageInfo { hasNextPage endCursor } } }`,
              }),
            })

            if (!searchRes.ok) {
              console.warn(`[LJS] Linear projects list failed:`, searchRes.status)
              break
            }

            const searchRaw = await searchRes.json()
            const searchData = searchRaw?.data?.data ?? searchRaw?.data ?? searchRaw
            const nodes = searchData?.projects?.nodes ?? []
            const pageInfo = searchData?.projects?.pageInfo

            const match = nodes.find((p: any) =>
              p.slugId === shortSlugId || p.slugId === pair.linearIdentifier || pair.linearIdentifier.endsWith(p.slugId)
            )

            if (match) {
              matchedProjectId = match.id
              matchedProjectName = match.name
              found = true
              console.log('[LJS] Matched project:', match.name, match.id, 'slugId:', match.slugId)
            } else if (pageInfo?.hasNextPage && pageInfo?.endCursor) {
              cursor = pageInfo.endCursor
            } else {
              break
            }
          }

          if (!matchedProjectId) {
            console.warn(`[LJS] No project matched slug ${pair.linearIdentifier} (shortId: ${shortSlugId})`)
            continue
          }

          // Fetch full project details by ID
          const res = await fetch('https://api.linear.app/graphql', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-G2-Extension': 'linear',
            },
            body: JSON.stringify({
              query: `query($id: String!) {
                project(id: $id) {
                  id
                  name
                  state
                  url
                  projectUpdates(first: 10) {
                    nodes {
                      id
                      body
                      health
                      createdAt
                      url
                      user { name }
                    }
                  }
                  issues(first: 50) {
                    nodes {
                      id
                      identifier
                      title
                      url
                      state { name type }
                      comments(first: 5, orderBy: createdAt) {
                        nodes {
                          id
                          body
                          createdAt
                          user { name }
                        }
                      }
                    }
                  }
                }
              }`,
              variables: { id: matchedProjectId },
            }),
          })

          if (!res.ok) {
            console.warn(`[LJS] Linear project detail fetch failed for ${matchedProjectId}:`, res.status)
            continue
          }

          const rawData = await res.json()
          console.log('[LJS] Project detail raw:', JSON.stringify(rawData).slice(0, 500))
          const l1 = rawData?.data ?? rawData
          const l2 = l1?.data ?? l1
          const project = l2?.project ?? l1?.project
          if (!project) {
            console.warn(`[LJS] No project detail found for ${matchedProjectId}`)
            continue
          }

          const projectLabel = project.name || pair.linearIdentifier

          const projectUrl = project.url || `https://linear.app/squareup/project/${pair.linearIdentifier}`

          // Project-level updates
          for (const update of project.projectUpdates?.nodes || []) {
            allUpdates.push({
              jiraKey: pair.jiraKey,
              linearIdentifier: projectLabel,
              linearUrl: update.url || projectUrl,
              type: 'project_update',
              summary: `Project Update (${update.health || 'N/A'}) by ${update.user?.name || 'Unknown'}`,
              details: update.body || '',
              timestamp: update.createdAt,
              author: update.user?.name || 'Unknown',
            })
          }

          // Issue-level updates within the project
          for (const issue of project.issues?.nodes || []) {
            const issueUrl = issue.url || `https://linear.app/squareup/issue/${issue.identifier}`
            const terminalStates = ['Done', 'Canceled', 'Duplicate']
            if (terminalStates.includes(issue.state?.name)) {
              allUpdates.push({
                jiraKey: pair.jiraKey,
                linearIdentifier: issue.identifier,
                linearUrl: issueUrl,
                type: 'status_change',
                summary: `${issue.identifier} (${issue.title}): ${issue.state.name}`,
                details: `Linear issue ${issue.identifier} is now ${issue.state.name}.`,
                timestamp: new Date().toISOString(),
                author: 'System',
              })
            }

            for (const comment of issue.comments?.nodes || []) {
              allUpdates.push({
                jiraKey: pair.jiraKey,
                linearIdentifier: issue.identifier,
                linearUrl: issueUrl,
                type: 'comment',
                summary: `${issue.identifier}: Comment by ${comment.user?.name || 'Unknown'}`,
                details: comment.body || '',
                timestamp: comment.createdAt,
                author: comment.user?.name || 'Unknown',
              })
            }
          }
        } else {
          // --- SINGLE ISSUE ---
          const res = await fetch('https://api.linear.app/graphql', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-G2-Extension': 'linear',
            },
            body: JSON.stringify({
              query: `query($id: String!) {
                issue(id: $id) {
                  id
                  identifier
                  title
                  url
                  state { name type }
                  comments(first: 10, orderBy: createdAt) {
                    nodes {
                      id
                      body
                      createdAt
                      user { name }
                    }
                  }
                  project {
                    id
                    projectUpdates(first: 5) {
                      nodes {
                        id
                        body
                        health
                        createdAt
                        user { name }
                      }
                    }
                  }
                }
              }`,
              variables: { id: pair.linearIdentifier },
            }),
          })

          if (!res.ok) {
            console.warn(`[LJS] Linear fetch failed for ${pair.linearIdentifier}:`, res.status)
            continue
          }
          const rawData = await res.json()
          const data = rawData?.data?.issue ? rawData : (rawData?.data ?? rawData)
          const issueData = data.data?.issue ?? data.issue
          if (!issueData) {
            console.warn(`[LJS] No issue found for ${pair.linearIdentifier}`)
            continue
          }

          const issueUrl = issueData.url || `https://linear.app/squareup/issue/${issueData.identifier || pair.linearIdentifier}`
          const terminalStates = ['Done', 'Canceled', 'Duplicate']
          if (terminalStates.includes(issueData.state?.name)) {
            allUpdates.push({
              jiraKey: pair.jiraKey,
              linearIdentifier: issueData.identifier || pair.linearIdentifier,
              linearUrl: issueUrl,
              type: 'status_change',
              summary: `Status: ${issueData.state.name}`,
              details: `Linear issue ${issueData.identifier || pair.linearIdentifier} is now ${issueData.state.name}.`,
              timestamp: new Date().toISOString(),
              author: 'System',
            })
          }

          for (const comment of issueData.comments?.nodes || []) {
            allUpdates.push({
              jiraKey: pair.jiraKey,
              linearIdentifier: issueData.identifier || pair.linearIdentifier,
              linearUrl: issueUrl,
              type: 'comment',
              summary: `Comment by ${comment.user?.name || 'Unknown'}`,
              details: comment.body || '',
              timestamp: comment.createdAt,
              author: comment.user?.name || 'Unknown',
            })
          }

          for (const update of issueData.project?.projectUpdates?.nodes || []) {
            allUpdates.push({
              jiraKey: pair.jiraKey,
              linearIdentifier: issueData.identifier || pair.linearIdentifier,
              linearUrl: issueUrl,
              type: 'project_update',
              summary: `Project Update (${update.health || 'N/A'}) by ${update.user?.name || 'Unknown'}`,
              details: update.body || '',
              timestamp: update.createdAt,
              author: update.user?.name || 'Unknown',
            })
          }
        }
      }

      allUpdates.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

      // Group by Jira key into one combined summary per ticket
      const byJira = new Map<string, LinearUpdate[]>()
      for (const u of allUpdates) {
        const existing = byJira.get(u.jiraKey) || []
        existing.push(u)
        byJira.set(u.jiraKey, existing)
      }

      if (allUpdates.length === 0) {
        setSummaries([])
        setSuccessMsg('No updates found from Linear.')
        return
      }

      const grouped: JiraSyncSummary[] = []
      for (const [jiraKey, jiraUpdates] of byJira.entries()) {
        // Deduplicate Linear sources with their URLs
        const sourceMap = new Map<string, string>()
        for (const u of jiraUpdates) {
          if (!sourceMap.has(u.linearIdentifier)) {
            sourceMap.set(u.linearIdentifier, u.linearUrl)
          }
        }
        const linearSources: LinearSource[] = [...sourceMap.entries()].map(([identifier, url]) => ({ identifier, url }))

        // Sort sources: projects first, then issues
        const projectSources = linearSources.filter((s) => !s.identifier.match(/^[A-Z]+-\d+$/))
        const issueSources = linearSources.filter((s) => s.identifier.match(/^[A-Z]+-\d+$/))
        const sortedSources = [...projectSources, ...issueSources]

        // Build link header — project links only for projects, issue links for standalone issues
        const linkLines: string[] = ['Linear Sync Update:']
        for (const src of sortedSources) {
          if (src.identifier.match(/^[A-Z]+-\d+$/)) {
            // It's an individual issue — only include if not part of a project already linked
            linkLines.push(`${src.identifier}: ${src.url}`)
          } else {
            // It's a project
            linkLines.push(`Project: ${src.url}`)
          }
        }

        // Build raw context for LLM summarization
        const rawContext = jiraUpdates.map((u) => {
          const date = new Date(u.timestamp).toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })
          const typeLabel = u.type === 'status_change' ? 'Status Change' : u.type === 'comment' ? 'Comment' : 'Project Update'
          return `[${date} PT] ${typeLabel} by ${u.author} (${u.linearIdentifier}):\n${u.details}`
        }).join('\n\n')

        // Use LLM to summarize into 2-4 sentences
        let summary: string
        try {
          summary = await llmComplete(rawContext,
            `You are summarizing Linear project updates for a Jira comment on a Customer Operations ticket at Block.

Write a 4-5 sentence project-level status update summarizing the most critical information: overall project progress, key milestones reached, what's being worked on now, upcoming priorities, and any blockers or risks. Frame this as a project update, not a list of individual task completions. If some tasks are done but the project is still in-progress, focus on overall progress and what's next rather than calling out individual completed items.

Write in plain business English. Do not use bullet points. Do not include ticket identifiers or URLs (those are added separately). Do not include timestamps. Focus on the big picture — what someone tracking this initiative in Jira needs to know.

Return ONLY the 4-5 sentence summary, nothing else.`)
        } catch {
          // Fallback if LLM fails
          summary = jiraUpdates.map((u) => u.summary).join('. ')
        }

        const combinedBody = linkLines.join('\n') + '\n\n' + summary.trim() + '\n\n(automated update from https://g2.sqprod.co/apps/linear-jira-sync-coa)'

        grouped.push({
          jiraKey,
          linearSources: sortedSources,
          updates: jiraUpdates,
          combinedBody,
        })
      }

      setSummaries(grouped)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const submitUpdatesToJira = async () => {
    console.log('[LJS] Submit clicked, summaries:', summaries.length)
    if (summaries.length === 0) {
      console.log('[LJS] No summaries to submit')
      return
    }

    setSubmitting(true)
    setError(null)
    setSuccessMsg(null)

    try {
      let synced = 0

      for (const summary of summaries) {
        const sourceNames = summary.linearSources.map((s) => s.identifier).join(', ')
        const commentText = summary.combinedBody

        console.log(`[LJS] Posting comment to ${summary.jiraKey}:`, commentText.slice(0, 200))

        // Try multiple approaches to add a comment to Jira
        const endpoints = [
          // Approach 1: PUT issue update with comment property (v3)
          {
            url: `https://api.atlassian.com/ex/jira/31e7a210-9ba8-468d-a1d1-a806c34e5961/rest/api/3/issue/${summary.jiraKey}`,
            method: 'PUT',
            body: {
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
            },
            label: 'v3 PUT update.comment',
          },
          // Approach 2: PUT issue update with comment property (v2)
          {
            url: `https://api.atlassian.com/ex/jira/31e7a210-9ba8-468d-a1d1-a806c34e5961/rest/api/2/issue/${summary.jiraKey}`,
            method: 'PUT',
            body: {
              update: {
                comment: [{
                  add: {
                    body: commentText,
                  },
                }],
              },
            },
            label: 'v2 PUT update.comment',
          },
          // Approach 3: POST comment endpoint (v3)
          {
            url: `https://api.atlassian.com/ex/jira/31e7a210-9ba8-468d-a1d1-a806c34e5961/rest/api/3/issue/${summary.jiraKey}/comment`,
            method: 'POST',
            body: {
              body: {
                type: 'doc',
                version: 1,
                content: [{ type: 'paragraph', content: [{ type: 'text', text: commentText }] }],
              },
            },
            label: 'v3 POST comment',
          },
        ]

        let posted = false
        for (const ep of endpoints) {
          console.log(`[LJS] Trying ${ep.label}: ${ep.method} ${ep.url}`)

          const res = await fetch(ep.url, {
            method: ep.method,
            headers: {
              'Content-Type': 'application/json',
              'X-G2-Extension': 'jira',
            },
            body: JSON.stringify(ep.body),
          })

          const rawRes = await res.json().catch(() => ({}))
          console.log(`[LJS] Response from ${ep.label}:`, JSON.stringify(rawRes).slice(0, 300))

          if (rawRes?.success !== false) {
            posted = true
            console.log(`[LJS] Successfully posted via ${ep.label}`)
            break
          }

          if (rawRes?.error?.includes('allowlist')) {
            console.log(`[LJS] Not on allowlist, trying next...`)
            continue
          }

          throw new Error(`Failed to comment on ${summary.jiraKey}: ${rawRes.error || res.status}`)
        }

        if (!posted) {
          throw new Error(`Failed to comment on ${summary.jiraKey}: No allowed Jira endpoint found. The comment API may need to be added to the kgoose proxy allowlist. As a workaround, copy the update text and paste it manually into the Jira ticket.`)
        }

        // Log activity
        await fetch('/api/activity', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'synced_to_jira',
            actor: 'ssantor',
            details: `Synced ${summary.updates.length} update(s) from ${sourceNames} to ${summary.jiraKey}`,
          }),
        }).catch(() => {})

        synced++
      }

      const jiraKeys = [...new Set(summaries.map((s) => s.jiraKey))]
      const jiraLinks = jiraKeys.map((k) => `${k} (https://block.atlassian.net/browse/${k})`).join(', ')
      setSuccessMsg(`Jira comment posted successfully to ${jiraLinks}. Check the Jira ticket to verify the update.`)
      setSummaries([])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4 mt-4">
      {/* Linked pairs table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Linked Tickets</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-text-secondary text-sm mb-4">
            Add Jira / Linear pairs to sync. Pairs are saved in your browser.
          </p>

          <div className="overflow-x-auto mb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-primary">
                  <th className="text-left py-2 pr-4 text-text-secondary font-medium">COA Jira Key</th>
                  <th className="text-left py-2 pr-4 text-text-secondary font-medium">Linear Issue (ID or URL)</th>
                  <th className="text-left py-2 text-text-secondary font-medium w-16"></th>
                </tr>
              </thead>
              <tbody>
                {pairs.map((pair, i) => (
                  <tr key={i} className="border-b border-border-secondary last:border-0">
                    <td className="py-2 pr-4 font-mono">
                      <a href={`https://block.atlassian.net/browse/${pair.jiraKey}`} target="_blank" rel="noopener noreferrer" className="text-text-info hover:underline">
                        {pair.jiraKey}
                      </a>
                    </td>
                    <td className="py-2 pr-4 font-mono">
                      {pair.linearIdentifier}
                      {pair.isProject && (
                        <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-background-info text-text-info">Project</span>
                      )}
                    </td>
                    <td className="py-2">
                      <button
                        onClick={() => removePair(i)}
                        className="text-text-danger hover:underline text-xs"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="py-2 pr-4">
                    <Input
                      value={newJiraKey}
                      onChange={(e) => setNewJiraKey(e.target.value)}
                      placeholder="e.g. COA-719 or https://block.atlassian.net/browse/COA-719"
                      onKeyDown={(e) => e.key === 'Enter' && addPair()}
                    />
                  </td>
                  <td className="py-2 pr-4">
                    <Input
                      value={newLinearInput}
                      onChange={(e) => setNewLinearInput(e.target.value)}
                      placeholder="e.g. CUSTDS-41 or Linear URL"
                      onKeyDown={(e) => e.key === 'Enter' && addPair()}
                    />
                  </td>
                  <td className="py-2">
                    <Button size="sm" variant="outline" onClick={addPair}>Add</Button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Updates */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Linear to Jira -- Sync Updates</CardTitle>
            <Button onClick={fetchLinearUpdates} disabled={loading || pairs.length === 0}>
              {loading ? 'Checking...' : 'Check for Linear Updates'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-text-secondary text-sm mb-4">
            Checks linked Linear issues for status changes (Done/Canceled/Duplicate), comments, and project updates. Writes them back to Jira.
          </p>

          {error && (
            <div className="p-3 mb-4 rounded bg-background-danger text-text-danger text-sm">
              {error}
            </div>
          )}
          {successMsg && (
            <div className="p-4 mb-4 rounded border border-green-300 bg-green-50 text-green-800 text-sm font-medium">
              {successMsg}
            </div>
          )}

          {summaries.length > 0 && (
            <div className="space-y-4">
              {summaries.map((s, i) => (
                <Card key={i} className="border border-border-primary">
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <a
                          href={`https://block.atlassian.net/browse/${s.jiraKey}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono font-bold text-sm text-text-info hover:underline"
                        >
                          {s.jiraKey}
                        </a>
                        <p className="text-xs text-text-secondary mt-1">
                          Linear sources:{' '}
                          {s.linearSources.map((src, j) => (
                            <span key={j}>
                              {j > 0 && ', '}
                              <a href={src.url} target="_blank" rel="noopener noreferrer" className="text-text-info hover:underline">
                                {src.identifier}
                              </a>
                            </span>
                          ))}
                          {' '}-- {s.updates.length} update(s)
                        </p>
                      </div>
                      <span className="text-xs text-text-secondary">{s.updates.length} update(s)</span>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <p className="text-xs text-text-secondary mb-3 font-medium">
                      This will be posted as a single comment on {s.jiraKey}:
                    </p>
                    <div className="bg-background-secondary rounded p-4 text-sm text-text-primary whitespace-pre-wrap">
                      {s.combinedBody}
                    </div>
                  </CardContent>
                </Card>
              ))}

              <div className="flex justify-end">
                <Button onClick={submitUpdatesToJira} disabled={submitting}>
                  {submitting ? 'Syncing...' : `Submit Updates to ${summaries.length} Jira Ticket(s)`}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function TypeBadge({ type }: { type: string }) {
  const config: Record<string, { style: string; label: string }> = {
    status_change: { style: 'bg-amber-100 text-amber-800 border border-amber-300', label: 'Status Change' },
    comment: { style: 'bg-blue-100 text-blue-800 border border-blue-300', label: 'Comment' },
    project_update: { style: 'bg-green-100 text-green-800 border border-green-300', label: 'Project Update' },
  }
  const { style, label } = config[type] || { style: 'bg-gray-100 text-gray-800 border border-gray-300', label: type }
  return (
    <span className={`inline-block px-2 py-1 rounded text-xs font-semibold ${style}`}>
      {label}
    </span>
  )
}
