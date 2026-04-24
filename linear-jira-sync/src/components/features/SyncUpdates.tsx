import { useState, useEffect } from 'react'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import { llmComplete } from '../../lib/llm'
import { addActivityEntry } from '../../lib/activityLog'
import type { TicketMapping } from '../../App'

interface LinkedPair {
  id?: number
  jiraKey: string
  linearId: string
  linearIdentifier: string
  isProject: boolean
}

interface LinkedPairRow {
  id: number
  jira_key: string
  linear_id: string | null
  linear_identifier: string
  is_project: number
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

const LEGACY_PAIRS_KEY = 'ljs_linked_pairs'
const JIRA_TITLES_KEY = 'ljs_jira_titles'

function rowToPair(row: LinkedPairRow): LinkedPair {
  return {
    id: row.id,
    jiraKey: row.jira_key,
    linearId: row.linear_id || '',
    linearIdentifier: row.linear_identifier,
    isProject: !!row.is_project,
  }
}

async function fetchAllPairs(): Promise<LinkedPair[]> {
  const res = await fetch('/api/linked-pairs')
  if (!res.ok) throw new Error(`Failed to load linked pairs: ${res.status}`)
  const { pairs } = (await res.json()) as { pairs: LinkedPairRow[] }
  return (pairs || []).map(rowToPair)
}

function loadCachedTitles(): Record<string, string> {
  try {
    const stored = localStorage.getItem(JIRA_TITLES_KEY)
    return stored ? JSON.parse(stored) : {}
  } catch {
    return {}
  }
}

async function fetchJiraTitle(jiraKey: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.atlassian.com/ex/jira/31e7a210-9ba8-468d-a1d1-a806c34e5961/rest/api/3/issue/${jiraKey}?fields=summary`,
      { headers: { 'X-G2-Extension': 'jira' } }
    )
    if (!res.ok) return null
    const raw = await res.json()
    const data = raw?.data ?? raw
    return data?.fields?.summary || null
  } catch {
    return null
  }
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
  const [pairs, setPairs] = useState<LinkedPair[]>([])
  const [jiraTitles, setJiraTitles] = useState<Record<string, string>>(loadCachedTitles)

  const reloadPairs = async () => {
    try {
      setPairs(await fetchAllPairs())
    } catch (err) {
      console.warn('[LJS] Failed to load linked pairs:', err)
    }
  }

  // Initial load: migrate any legacy localStorage pairs into the DB, then fetch.
  useEffect(() => {
    ;(async () => {
      try {
        const legacy = localStorage.getItem(LEGACY_PAIRS_KEY)
        if (legacy) {
          const parsed: LinkedPair[] = JSON.parse(legacy)
          if (Array.isArray(parsed) && parsed.length > 0) {
            await Promise.all(
              parsed.map((p) =>
                fetch('/api/linked-pairs', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    jira_key: p.jiraKey,
                    linear_id: p.linearId || null,
                    linear_identifier: p.linearIdentifier,
                    is_project: !!p.isProject,
                  }),
                })
              )
            )
          }
          localStorage.removeItem(LEGACY_PAIRS_KEY)
        }
      } catch (err) {
        console.warn('[LJS] Legacy pair migration failed:', err)
      }
      await reloadPairs()
    })()
  }, [])

  useEffect(() => {
    const reload = () => { reloadPairs() }
    window.addEventListener('ljs-pairs-changed', reload)
    return () => window.removeEventListener('ljs-pairs-changed', reload)
  }, [])

  // Seed titles from mappings (DB-backed) when available, then fetch any still missing
  useEffect(() => {
    const mappingTitles: Record<string, string> = {}
    for (const m of mappings) {
      if (m.jira_key && m.jira_summary && !jiraTitles[m.jira_key]) {
        mappingTitles[m.jira_key] = m.jira_summary
      }
    }
    if (Object.keys(mappingTitles).length > 0) {
      setJiraTitles((prev) => {
        const next = { ...prev, ...mappingTitles }
        localStorage.setItem(JIRA_TITLES_KEY, JSON.stringify(next))
        return next
      })
    }
  }, [mappings])

  useEffect(() => {
    const missing = Array.from(new Set(pairs.map((p) => p.jiraKey))).filter(
      (key) => key && !jiraTitles[key]
    )
    if (missing.length === 0) return

    let cancelled = false
    ;(async () => {
      const results = await Promise.all(
        missing.map(async (key) => [key, await fetchJiraTitle(key)] as const)
      )
      if (cancelled) return
      setJiraTitles((prev) => {
        const next = { ...prev }
        for (const [key, title] of results) {
          if (title) next[key] = title
        }
        localStorage.setItem(JIRA_TITLES_KEY, JSON.stringify(next))
        return next
      })
    })()

    return () => {
      cancelled = true
    }
  }, [pairs])

  const [newJiraKey, setNewJiraKey] = useState('')
  const [newLinearInput, setNewLinearInput] = useState('')
  const [summaries, setSummaries] = useState<JiraSyncSummary[]>([])
  const [triageEntries, setTriageEntries] = useState<Array<{ jiraKey: string; linearIdentifier: string; linearUrl: string }>>([])
  const [loading, setLoading] = useState(false)
  const [submittingKey, setSubmittingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)

  const addPair = async () => {
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

    try {
      const res = await fetch('/api/linked-pairs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jira_key: jira,
          linear_id: parsed.id || null,
          linear_identifier: parsed.identifier,
          is_project: parsed.isProject,
        }),
      })
      if (!res.ok) throw new Error(`POST /api/linked-pairs failed: ${res.status}`)
      setNewJiraKey('')
      setNewLinearInput('')
      await reloadPairs()
      window.dispatchEvent(new CustomEvent('ljs-pairs-changed'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const removePair = async (idx: number) => {
    const pair = pairs[idx]
    if (!pair?.id) return
    try {
      const res = await fetch(`/api/linked-pairs/${pair.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`DELETE /api/linked-pairs failed: ${res.status}`)
      await reloadPairs()
      window.dispatchEvent(new CustomEvent('ljs-pairs-changed'))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const fetchLinearUpdates = async () => {
    if (pairs.length === 0) {
      setError('Add at least one Jira / Linear pair above first.')
      return
    }

    setLoading(true)
    setError(null)
    setSuccessMsg(null)
    setTriageEntries([])

    try {
      const allUpdates: LinearUpdate[] = []
      // Per-pair state snapshot used to emit a "no-updates" row for pairs that have nothing new
      const pairInfo = new Map<string, { linearUrl: string; stateName: string; stateType: string; isProject: boolean }>()
      const pairKey = (jiraKey: string, linearIdentifier: string) => `${jiraKey}|${linearIdentifier}`

      for (const pair of pairs) {
        if (pair.isProject) {
          // --- PROJECT: fetch project updates + all issue statuses/comments ---
          // Extract the short slugId and a search term from the URL slug
          const slugParts = pair.linearIdentifier.match(/([a-f0-9]{12})$/)
          const shortSlugId = slugParts ? slugParts[1] : pair.linearIdentifier
          // Turn "afterpay-support-migration-data-and-reporting-transition-plan-1e31dca079bc" into search terms
          const searchTerm = pair.linearIdentifier
            .replace(/-[a-f0-9]{12}$/, '') // remove trailing hash
            .replace(/-/g, ' ')            // hyphens to spaces
            .slice(0, 60)                  // limit length

          console.log(`[LJS] Searching projects with term: "${searchTerm}", slugId: ${shortSlugId}`)

          // Use searchProjects to find the project (much faster than paginating all projects)
          let matchedProjectId: string | null = null
          let matchedProjectName: string | null = null

          const searchRes = await fetch('https://api.linear.app/graphql', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-G2-Extension': 'linear',
            },
            body: JSON.stringify({
              query: `query($term: String!) { searchProjects(term: $term, first: 20) { nodes { id name slugId } } }`,
              variables: { term: searchTerm },
            }),
          })

          if (!searchRes.ok) {
            console.warn(`[LJS] Linear project search failed:`, searchRes.status)
            continue
          }

          const searchRaw = await searchRes.json()
          console.log('[LJS] Project search raw:', JSON.stringify(searchRaw).slice(0, 300))
          const searchData = searchRaw?.data?.data ?? searchRaw?.data ?? searchRaw
          const searchNodes = searchData?.searchProjects?.nodes ?? []
          const match = searchNodes.find((p: any) =>
            p.slugId === shortSlugId || pair.linearIdentifier.endsWith(p.slugId)
          )

          if (match) {
            matchedProjectId = match.id
            matchedProjectName = match.name
            console.log('[LJS] Matched project:', match.name, match.id)
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

          pairInfo.set(pairKey(pair.jiraKey, pair.linearIdentifier), {
            linearUrl: projectUrl,
            stateName: project.state || 'Unknown',
            stateType: 'project',
            isProject: true,
          })

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

          pairInfo.set(pairKey(pair.jiraKey, pair.linearIdentifier), {
            linearUrl: issueUrl,
            stateName: issueData.state?.name || 'Unknown',
            stateType: issueData.state?.type || 'unknown',
            isProject: false,
          })

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

      // Group updates by Jira key
      const byJira = new Map<string, LinearUpdate[]>()
      for (const u of allUpdates) {
        const existing = byJira.get(u.jiraKey) || []
        existing.push(u)
        byJira.set(u.jiraKey, existing)
      }

      // Emit a row for every Jira ticket in pairs — even when nothing new came from Linear
      const orderedJiraKeys: string[] = []
      const seenJira = new Set<string>()
      for (const p of pairs) {
        if (!seenJira.has(p.jiraKey)) {
          seenJira.add(p.jiraKey)
          orderedJiraKeys.push(p.jiraKey)
        }
      }

      const grouped: JiraSyncSummary[] = []
      const triageRows: Array<{ jiraKey: string; linearIdentifier: string; linearUrl: string }> = []
      for (const jiraKey of orderedJiraKeys) {
        const jiraUpdates = byJira.get(jiraKey) || []
        const pairsForJira = pairs.filter((p) => p.jiraKey === jiraKey)

        // No updates path — if every pair is still in triage, skip the full summary and
        // show a compact row in the triage-queue table instead. Otherwise emit a
        // deterministic status-only summary.
        if (jiraUpdates.length === 0) {
          const allTriage =
            pairsForJira.length > 0 &&
            pairsForJira.every((p) => {
              const info = pairInfo.get(pairKey(jiraKey, p.linearIdentifier))
              return info && !info.isProject && info.stateType === 'triage'
            })
          if (allTriage) {
            for (const p of pairsForJira) {
              const info = pairInfo.get(pairKey(jiraKey, p.linearIdentifier))!
              triageRows.push({
                jiraKey,
                linearIdentifier: p.linearIdentifier,
                linearUrl: info.linearUrl,
              })
            }
            continue
          }

          const linearSources: LinearSource[] = pairsForJira.map((p) => {
            const info = pairInfo.get(pairKey(jiraKey, p.linearIdentifier))
            const fallbackUrl = p.isProject
              ? `https://linear.app/squareup/project/${p.linearIdentifier}`
              : `https://linear.app/squareup/issue/${p.linearIdentifier}`
            return { identifier: p.linearIdentifier, url: info?.linearUrl || fallbackUrl }
          })

          const linkLines: string[] = ['Linear Sync Update:']
          for (const src of linearSources) {
            if (src.identifier.match(/^[A-Z]+-\d+$/)) {
              linkLines.push(`${src.identifier}: ${src.url}`)
            } else {
              linkLines.push(`Project: ${src.url}`)
            }
          }

          const statusLines: string[] = []
          for (const p of pairsForJira) {
            const info = pairInfo.get(pairKey(jiraKey, p.linearIdentifier))
            if (!info) {
              statusLines.push(`Could not reach Linear for ${p.linearIdentifier}.`)
              continue
            }
            if (info.isProject) {
              statusLines.push(`No new Linear project updates since last sync for ${p.linearIdentifier}.`)
            } else if (info.stateType === 'triage') {
              const team = p.linearIdentifier.match(/^([A-Z]+)-/)?.[1]
              const queue = team ? `Linear ${team} triage queue` : 'Linear triage queue'
              statusLines.push(`${p.linearIdentifier} is still sitting in the ${queue}.`)
            } else {
              statusLines.push(`${p.linearIdentifier}: No Linear updates since last sync. Currently in state "${info.stateName}".`)
            }
          }

          const combinedBody =
            linkLines.join('\n') +
            '\n\n' +
            statusLines.join(' ') +
            '\n\n(automated update from https://g2.sqprod.co/apps/linear-jira-sync-coa)'

          grouped.push({
            jiraKey,
            linearSources,
            updates: [],
            combinedBody,
          })
          continue
        }

        {
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
      }

      setSummaries(grouped)
      setTriageEntries(triageRows)
      const total = grouped.length + triageRows.length
      setSuccessMsg(`Fetched status for ${total} ticket${total === 1 ? '' : 's'}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const submitSingleToJira = async (jiraKey: string) => {
    const summary = summaries.find((s) => s.jiraKey === jiraKey)
    if (!summary) return

    setSubmittingKey(jiraKey)
    setError(null)
    setSuccessMsg(null)

    try {
      const sourceNames = summary.linearSources.map((s) => s.identifier).join(', ')
      const commentText = summary.combinedBody

      console.log(`[LJS] Posting comment to ${summary.jiraKey}:`, commentText.slice(0, 200))

      // Use PUT issue update with comment property (v3) — confirmed working
      const res = await fetch(
        `https://api.atlassian.com/ex/jira/31e7a210-9ba8-468d-a1d1-a806c34e5961/rest/api/3/issue/${summary.jiraKey}`,
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

      const rawRes = await res.json().catch(() => ({}))
      console.log(`[LJS] Jira response for ${summary.jiraKey}:`, JSON.stringify(rawRes).slice(0, 300))

      if (rawRes?.success === false) {
        throw new Error(`Failed to comment on ${summary.jiraKey}: ${rawRes.error || 'Unknown error'}`)
      }

      // Log activity
      const projectSource = summary.linearSources.find((s) => !s.identifier.match(/^[A-Z]+-\d+$/))
      addActivityEntry({
        type: 'jira_update',
        jiraKey: summary.jiraKey,
        jiraUrl: `https://block.atlassian.net/browse/${summary.jiraKey}`,
        linearIdentifier: projectSource?.identifier || sourceNames,
        linearUrl: projectSource?.url || summary.linearSources[0]?.url || '',
        summary: commentText.replace(/^Linear Sync Update:\n/, '').slice(0, 300),
      })

      // Remove this summary from the list and show success
      setSummaries((prev) => prev.filter((s) => s.jiraKey !== jiraKey))
      setSuccessMsg(`Jira comment posted successfully to ${jiraKey} (https://block.atlassian.net/browse/${jiraKey}). Check the Jira ticket to verify the update.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmittingKey(null)
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
            Add Jira / Linear pairs to sync. Pairs are shared across all users of this app.
          </p>

          <div className="overflow-x-auto mb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-primary">
                  <th className="text-left py-2 pr-4 text-text-secondary font-medium">Jira Title</th>
                  <th className="text-center py-2 pr-4 text-text-secondary font-medium">COA Jira Key</th>
                  <th className="text-left py-2 pr-4 text-text-secondary font-medium">Linear Issue (ID or URL)</th>
                  <th className="text-left py-2 text-text-secondary font-medium w-16"></th>
                </tr>
              </thead>
              <tbody>
                {pairs.map((pair, i) => (
                  <tr key={i} className="border-b border-border-secondary last:border-0">
                    <td className="py-2 pr-4 bg-background-secondary text-text-primary font-semibold border-r border-border-primary">
                      {jiraTitles[pair.jiraKey] || <span className="text-text-secondary italic font-normal">Loading...</span>}
                    </td>
                    <td className="py-2 pr-4 font-mono text-center">
                      <a href={`https://block.atlassian.net/browse/${pair.jiraKey}`} target="_blank" rel="noopener noreferrer" className="text-text-info hover:underline">
                        {pair.jiraKey}
                      </a>
                    </td>
                    <td className="py-2 pr-4 font-mono">
                      <a
                        href={
                          pair.isProject
                            ? `https://linear.app/squareup/project/${pair.linearIdentifier}`
                            : `https://linear.app/squareup/issue/${pair.linearIdentifier}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-text-info hover:underline"
                      >
                        {pair.linearIdentifier}
                      </a>
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
                  <td className="py-2 pr-4"></td>
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
            <div className="p-3 mb-4 rounded bg-background-danger text-white text-sm">
              {error}
            </div>
          )}
          {successMsg && (
            <div className="p-4 mb-4 rounded bg-background-success text-white text-sm font-medium">
              {successMsg}
            </div>
          )}

          {triageEntries.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-text-primary mb-2">
                Still in Linear triage queue ({triageEntries.length})
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border-primary">
                      <th className="text-left py-2 pr-4 text-text-secondary font-medium">Jira</th>
                      <th className="text-left py-2 pr-4 text-text-secondary font-medium">Linear</th>
                    </tr>
                  </thead>
                  <tbody>
                    {triageEntries.map((t, i) => (
                      <tr key={i} className="border-b border-border-secondary last:border-0">
                        <td className="py-2 pr-4 font-mono">
                          <a
                            href={`https://block.atlassian.net/browse/${t.jiraKey}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-text-info hover:underline"
                          >
                            {t.jiraKey}
                          </a>
                        </td>
                        <td className="py-2 pr-4 font-mono">
                          <a
                            href={t.linearUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-text-info hover:underline"
                          >
                            {t.linearIdentifier}
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {summaries.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-text-primary mb-2">
                Linear updates available ({summaries.length})
              </h3>
              <div className="space-y-4">
              {summaries.map((s) => (
                <Card key={s.jiraKey} className="border border-border-primary">
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
                      <Button
                        size="sm"
                        onClick={() => submitSingleToJira(s.jiraKey)}
                        disabled={submittingKey === s.jiraKey}
                      >
                        {submittingKey === s.jiraKey ? 'Posting...' : `Submit Update to ${s.jiraKey}`}
                      </Button>
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
