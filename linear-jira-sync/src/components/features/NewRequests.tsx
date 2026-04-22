import { useState, useRef, useEffect } from 'react'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'
import { llmComplete } from '../../lib/llm'
import { addActivityEntry } from '../../lib/activityLog'
import type { TicketMapping } from '../../App'

// CUSTDS team and template IDs
const CUSTDS_TEAM_ID = '0f2a0619-8b8c-490e-98da-7fb25874f979'
const TRIAGE_STATE_ID = '5687f14f-3752-4dff-8eeb-ac29072490b0'

const JQL = `created >= -365d and component = "CCOPORT" and "Delivery Team[Select List (multiple choices)]" in ("COA","COA - CI") and issuetype in (Task, Sub-task) and status not in ("Done","Won't Do") order by created DESC`

interface JiraIssue {
  key: string
  url: string
  summary: string
  description: string
  parentKey: string | null
  parentSummary: string | null
  parentDescription: string | null
  parentReporter: string | null
  parentReporterEmail: string | null
  parentStatus: string | null
  parentDueDate: string | null
  parentComments: string[]
  assignee: string | null
  assigneeEmail: string | null
  priority: string | null
  dueDate: string | null
}

interface LinearFormData {
  title: string
  requestor: string
  requestDescription: string
  businessJustification: string
  requestedDueDate: string
  notes: string
}

interface FetchedTicket {
  jira: JiraIssue
  linearForm: LinearFormData
  alreadyLinked: boolean
  submitting?: boolean
  submittedIdentifier?: string
  submittedUrl?: string
}

interface Props {
  mappings: TicketMapping[]
  onMappingsChange: () => void
}

function extractTextFromAdf(node: any): string {
  if (!node) return ''
  if (typeof node === 'string') return node
  if (node.text) return node.text
  if (node.content) {
    return node.content.map(extractTextFromAdf).join(node.type === 'paragraph' ? '\n' : '')
  }
  return ''
}

function parseJiraDescription(descText: string): { requestDescription: string; businessJustification: string } {
  // Try to find structured sections
  const bizPatterns = [
    /business\s*justification[:\s]*([\s\S]*?)(?=(?:problem\s*statement|value\s*proposition|prioritization|requirements|$))/i,
    /value\s*proposition[:\s]*([\s\S]*?)(?=(?:problem\s*statement|business\s*justification|prioritization|requirements|$))/i,
    /prioritization\s*rationale[:\s]*([\s\S]*?)(?=(?:problem\s*statement|business\s*justification|value\s*proposition|requirements|$))/i,
  ]

  const reqPatterns = [
    /requirements?[:\s]*([\s\S]*?)(?=(?:business\s*justification|value\s*proposition|prioritization|$))/i,
    /problem\s*statement[:\s]*([\s\S]*?)(?=(?:business\s*justification|value\s*proposition|prioritization|requirements|$))/i,
  ]

  const bizParts: string[] = []
  for (const pattern of bizPatterns) {
    const match = descText.match(pattern)
    if (match?.[1]?.trim()) bizParts.push(match[1].trim())
  }

  const reqParts: string[] = []
  for (const pattern of reqPatterns) {
    const match = descText.match(pattern)
    if (match?.[1]?.trim()) reqParts.push(match[1].trim())
  }

  const reqDescription = reqParts.length > 0 ? reqParts.join('\n\n') : descText
  const bizJustification = bizParts.length > 0 ? bizParts.join('\n\n') : ''

  // If biz justification is the same as request description (or empty), return empty to signal we need to build it differently
  if (!bizJustification || bizJustification.trim() === reqDescription.trim()) {
    return { requestDescription: reqDescription, businessJustification: '' }
  }

  return { requestDescription: reqDescription, businessJustification }
}

const HOLD_STATUSES = ['on hold', 'blocked', 'backlog', 'paused short term', 'paused long term', 'awaiting prioritization', 'paused']

function detectHoldSignals(jira: JiraIssue): string[] {
  const signals: string[] = []

  // Check parent status
  if (jira.parentStatus) {
    const statusLower = jira.parentStatus.toLowerCase()
    if (HOLD_STATUSES.some((h) => statusLower.includes(h))) {
      signals.push(`Parent ticket status: "${jira.parentStatus}"`)
    }
  }

  // Check recent comments for hold/pause/block language
  for (const comment of jira.parentComments || []) {
    const lower = comment.toLowerCase()
    if (HOLD_STATUSES.some((h) => lower.includes(h)) || /\b(deprioritiz|put on hold|pushing out|delay|postpone|defer)/i.test(comment)) {
      signals.push(`Recent comment mentions hold/delay: ${comment.slice(0, 200)}`)
    }
  }

  return signals
}

function buildNotes(jira: JiraIssue): string {
  const lines: string[] = []

  // Source links
  lines.push(`Source: ${jira.url}`)
  if (jira.parentKey) {
    lines.push(`Parent: https://block.atlassian.net/browse/${jira.parentKey}`)
  }

  // Only surface critical timing/hold info that impacts when this gets worked on
  const holdSignals = detectHoldSignals(jira)
  if (holdSignals.length > 0) {
    const statusNote = jira.parentStatus ? `Parent ticket (${jira.parentKey}) is currently "${jira.parentStatus}".` : ''
    const dateNote = jira.parentDueDate ? ` Target date: ${jira.parentDueDate}.` : ''
    const commentHint = holdSignals.find(s => s.startsWith('Recent comment'))
      ? ' Recent comments indicate potential delays.'
      : ''
    lines.push('')
    lines.push(`NOTE: ${statusNote}${dateNote}${commentHint}`.trim())
  }

  lines.push('')
  lines.push('Submitted with the help of https://g2.sqprod.co/apps/linear-jira-sync-coa')

  return lines.join('\n')
}

function translateToLinearForm(jira: JiraIssue, emailOverride?: string): LinearFormData {
  const descText = jira.description || ''
  const parentDesc = jira.parentDescription || ''

  // Deduplicate — if one contains the other, just use the longer one
  let combinedDesc: string
  if (descText && parentDesc) {
    if (descText.includes(parentDesc)) {
      combinedDesc = descText
    } else if (parentDesc.includes(descText)) {
      combinedDesc = parentDesc
    } else {
      combinedDesc = `${descText}\n\n${parentDesc}`
    }
  } else {
    combinedDesc = descText || parentDesc
  }

  const { requestDescription, businessJustification } = parseJiraDescription(combinedDesc)

  // Use email override if set, otherwise fall back to parent ticket's Reporter
  const requestorLdap = emailOverride
    ? emailOverride.split('@')[0]
    : jira.parentReporterEmail
      ? jira.parentReporterEmail.split('@')[0]
      : jira.parentReporter || jira.assignee || ''

  return {
    title: jira.summary,
    requestor: requestorLdap,
    requestDescription: `[Data Request from ${jira.key}${jira.parentKey ? ` / ${jira.parentKey}` : ''}]\n\n${requestDescription}`,
    businessJustification,
    requestedDueDate: jira.dueDate || '',
    notes: buildNotes(jira),
  }
}

export function NewRequests({ mappings, onMappingsChange }: Props) {
  const [tickets, setTickets] = useState<FetchedTicket[]>([])
  const [hiddenCount, setHiddenCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [successMsg, setSuccessMsg] = useState<string | null>(null)
  const [jiraEmail, setJiraEmail] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ljs_settings') || '{}').jiraEmail || '' } catch { return '' }
  })
  const [emailSaved, setEmailSaved] = useState(false)

  const saveEmail = () => {
    localStorage.setItem('ljs_settings', JSON.stringify({ jiraEmail }))
    setEmailSaved(true)
    setTimeout(() => setEmailSaved(false), 2000)
  }

  const fetchJiraTickets = async () => {
    setLoading(true)
    setError(null)
    setSuccessMsg(null)

    try {
      const jiraUrl = 'https://api.atlassian.com/ex/jira/31e7a210-9ba8-468d-a1d1-a806c34e5961/rest/api/3/search/jql'
      console.log('[LJS] Fetching Jira:', jiraUrl)

      // Fetch CCOPORT tickets via Jira REST API through G2 proxy (POST to match kgoose allowlist)
      const searchRes = await fetch(jiraUrl, {
        method: 'POST',
        headers: {
          'X-G2-Extension': 'jira',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jql: JQL,
          maxResults: 50,
          fields: ['summary', 'description', 'assignee', 'priority', 'duedate', 'parent', 'status'],
        }),
      })
      console.log('[LJS] Jira response status:', searchRes.status, searchRes.ok)
      if (!searchRes.ok) {
        const errBody = await searchRes.text().catch(() => '')
        throw new Error(`Jira search failed: ${searchRes.status} ${errBody}`)
      }
      const rawData = await searchRes.json()
      console.log('[LJS] Raw response:', JSON.stringify(rawData).slice(0, 500))

      // G2 proxy wraps in { success, data } envelope — unwrap it
      const searchData = rawData?.data ?? rawData
      // The Jira response itself may also be nested
      const jiraData = searchData?.issues ? searchData : (searchData?.data ?? searchData)
      console.log('[LJS] Unwrapped keys:', Object.keys(jiraData || {}))
      console.log('[LJS] Issues found:', jiraData?.issues?.length ?? 0)

      const existingKeys = new Set(mappings.map((m) => m.jira_key))
      // Also exclude anything already tracked in the SyncUpdates pairs table (localStorage)
      try {
        const stored = localStorage.getItem('ljs_linked_pairs')
        if (stored) {
          const pairs: Array<{ jiraKey: string }> = JSON.parse(stored)
          for (const p of pairs) existingKeys.add(p.jiraKey)
        }
      } catch {
        // ignore malformed localStorage
      }
      const fetched: FetchedTicket[] = []

      for (const issue of jiraData?.issues || []) {
        const fields = issue.fields
        let parentKey: string | null = null
        let parentSummary: string | null = null
        let parentDescription: string | null = null
        let parentReporter: string | null = null
        let parentReporterEmail: string | null = null
        let parentStatus: string | null = null
        let parentDueDate: string | null = null
        let parentComments: string[] = []

        // Fetch parent ticket if it exists — get description, reporter, status, duedate
        if (fields.parent?.key) {
          parentKey = fields.parent.key
          parentSummary = fields.parent.fields?.summary || null
          try {
            const parentRes = await fetch(
              `https://api.atlassian.com/ex/jira/31e7a210-9ba8-468d-a1d1-a806c34e5961/rest/api/3/issue/${parentKey}?fields=description,summary,reporter,status,duedate,comment`,
              { headers: { 'X-G2-Extension': 'jira' } }
            )
            if (parentRes.ok) {
              const rawParent = await parentRes.json()
              const parentData = rawParent?.data ?? rawParent
              parentDescription = extractTextFromAdf(parentData.fields?.description)
              parentSummary = parentData.fields?.summary || parentSummary
              parentReporter = parentData.fields?.reporter?.displayName || null
              parentReporterEmail = parentData.fields?.reporter?.emailAddress || null
              parentStatus = parentData.fields?.status?.name || null
              parentDueDate = parentData.fields?.duedate || null

              // Extract recent comments (last 5)
              const comments = parentData.fields?.comment?.comments || []
              parentComments = comments.slice(-5).map((c: any) => {
                const author = c.author?.displayName || 'Unknown'
                const date = c.created ? new Date(c.created).toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles' }) : ''
                const body = extractTextFromAdf(c.body)
                return `[${date}] ${author}: ${body}`
              })
            }
          } catch {
            // Parent fetch failed, continue without it
          }
        }

        const jira: JiraIssue = {
          key: issue.key,
          url: `https://block.atlassian.net/browse/${issue.key}`,
          summary: fields.summary || '',
          description: extractTextFromAdf(fields.description),
          parentKey,
          parentSummary,
          parentDescription,
          parentReporter,
          parentReporterEmail,
          parentStatus,
          parentDueDate,
          parentComments,
          assignee: fields.assignee?.displayName || null,
          assigneeEmail: fields.assignee?.emailAddress || null,
          priority: fields.priority?.name || null,
          dueDate: fields.duedate || null,
        }

        if (existingKeys.has(issue.key)) continue

        fetched.push({
          jira,
          linearForm: translateToLinearForm(jira, jiraEmail || undefined),
          alreadyLinked: false,
        })
      }

      // Enrich business justifications via LLM before showing tickets
      const llmPromises = fetched.map(async (t, i) => {
        if (t.alreadyLinked) return
        const needsLlm = !t.linearForm.businessJustification ||
          t.linearForm.businessJustification.trim() === t.linearForm.requestDescription.replace(/\[Data Request from.*?\]\n\n/, '').trim()
        if (!needsLlm) return

        try {
          const context = [
            `COA Ticket: ${t.jira.key} — ${t.jira.summary}`,
            t.jira.parentKey ? `Parent Ticket: ${t.jira.parentKey} — ${t.jira.parentSummary}` : '',
            `COA Description: ${t.jira.description}`,
            t.jira.parentDescription ? `Parent Description: ${t.jira.parentDescription}` : '',
            t.jira.parentStatus ? `Parent Status: ${t.jira.parentStatus}` : '',
            t.jira.parentDueDate ? `Parent Due Date: ${t.jira.parentDueDate}` : '',
            (t.jira.parentComments?.length ?? 0) > 0 ? `Recent parent comments:\n${t.jira.parentComments!.join('\n')}` : '',
          ].filter(Boolean).join('\n')

          const bizJustification = await llmComplete(context,
            `You are reading Jira ticket details for a Customer Operations initiative at Block (Cash App, Square, Afterpay).

Write a business justification in EXACTLY 2-3 sentences. No more than 3 sentences. Explain WHY this work matters:
- How will the business or customers benefit?
- Is there a regulatory, compliance, or legal requirement driving this?
- What problem does this solve for customers or operations?

Do NOT restate what the task is — explain the business impact.
Do NOT include metadata like priority levels, status, or ticket numbers.
Write in plain business English, as if explaining to a data analyst why this request matters.
Return ONLY the 2-3 sentence justification, nothing else.`)

          fetched[i] = {
            ...t,
            linearForm: { ...t.linearForm, businessJustification: bizJustification.trim() },
          }
        } catch (err) {
          console.warn(`[LJS] LLM enrichment failed for ${t.jira.key}:`, err)
        }
      })

      // Wait for all LLM calls to finish, then show everything at once
      await Promise.all(llmPromises)
      const totalFromJira = jiraData?.issues?.length ?? 0
      setHiddenCount(Math.max(0, totalFromJira - fetched.length))
      setTickets(fetched)
    } catch (err) {
      console.error('[LJS] Jira fetch error:', err)
      setError(err instanceof Error ? err.message : String(err))
      setLoading(false)
    }
  }

  const updateFormField = (idx: number, field: keyof LinearFormData, value: string) => {
    setTickets((prev) =>
      prev.map((t, i) =>
        i === idx ? { ...t, linearForm: { ...t.linearForm, [field]: value } } : t
      )
    )
  }

  const submitSingleToLinear = async (ticketIdx: number) => {
    const ticket = tickets[ticketIdx]
    if (!ticket || ticket.alreadyLinked) return

    setError(null)
    setSuccessMsg(null)

    // Mark this ticket as submitting
    setTickets((prev) =>
      prev.map((t, i) => (i === ticketIdx ? { ...t, submitting: true } : t))
    )

    try {
      const form = ticket.linearForm

      // Build description with form fields
      const description = [
        `**Requestor:** ${form.requestor}`,
        '',
        `**Request Description:**`,
        form.requestDescription,
        '',
        `**Business Justification:**`,
        form.businessJustification,
        '',
        form.requestedDueDate ? `**Requested Due Date:** ${form.requestedDueDate}` : '',
        '',
        form.notes ? `**Notes:**\n${form.notes}` : '',
      ].filter((line) => line !== undefined).join('\n')

      // Create Linear issue via GraphQL API
      const createRes = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-G2-Extension': 'linear',
        },
        body: JSON.stringify({
          query: `mutation($input: IssueCreateInput!) {
            issueCreate(input: $input) {
              success
              issue {
                id
                identifier
                url
              }
            }
          }`,
          variables: {
            input: {
              teamId: CUSTDS_TEAM_ID,
              title: form.title,
              description,
              stateId: TRIAGE_STATE_ID,
              priority: 0,
            },
          },
        }),
      })

      if (!createRes.ok) throw new Error(`Linear API failed: ${createRes.status}`)
      const rawCreate = await createRes.json()
      // Unwrap G2 proxy wrapper ({success, data, statusCode}) if present
      const createData = rawCreate?.statusCode !== undefined && rawCreate?.data
        ? rawCreate.data
        : rawCreate

      if (!createData?.data?.issueCreate?.success) {
        throw new Error(`Linear issue creation failed: ${JSON.stringify(createData?.errors || createData)}`)
      }

      const linearIssue = createData.data.issueCreate.issue

      // Save mapping to DB
      const mappingRes = await fetch('/api/mappings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jira_key: ticket.jira.key,
          jira_url: ticket.jira.url,
          jira_summary: ticket.jira.summary,
          linear_id: linearIssue.id,
          linear_identifier: linearIssue.identifier,
          linear_url: linearIssue.url,
          status: 'submitted',
        }),
      })

      const mappingData = await mappingRes.json()

      // Log activity
      await fetch('/api/activity', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mapping_id: mappingData.id,
          action: 'submitted_to_linear',
          actor: form.requestor || 'ssantor',
          details: `Created ${linearIssue.identifier} from ${ticket.jira.key}: ${form.title}`,
        }),
      })

      // Log activity
      addActivityEntry({
        type: 'rads_request',
        jiraKey: ticket.jira.key,
        jiraUrl: ticket.jira.url,
        linearIdentifier: linearIssue.identifier,
        linearUrl: linearIssue.url,
        summary: `${form.title} — ${form.businessJustification.slice(0, 150)}`,
      })

      // Mark as submitted
      setTickets((prev) =>
        prev.map((t, i) =>
          i === ticketIdx
            ? { ...t, alreadyLinked: true, submitting: false, submittedIdentifier: linearIssue.identifier, submittedUrl: linearIssue.url }
            : t
        )
      )
      // Add to the SyncUpdates pairs list in localStorage so the new link
      // shows up in the Sync-Linear-updates-to-Jira table without manual entry
      try {
        const stored = localStorage.getItem('ljs_linked_pairs')
        const existing: Array<{ jiraKey: string; linearId: string; linearIdentifier: string; isProject: boolean }> = stored ? JSON.parse(stored) : []
        const dup = existing.some(
          (p) => p.jiraKey === ticket.jira.key && p.linearIdentifier === linearIssue.identifier
        )
        if (!dup) {
          const updated = [
            ...existing,
            { jiraKey: ticket.jira.key, linearId: linearIssue.id, linearIdentifier: linearIssue.identifier, isProject: false },
          ]
          localStorage.setItem('ljs_linked_pairs', JSON.stringify(updated))
          window.dispatchEvent(new CustomEvent('ljs-pairs-changed'))
        }
      } catch {
        // non-fatal — submission already succeeded
      }

      setSuccessMsg(`Submitted ${ticket.jira.key} → ${linearIssue.identifier}`)
      onMappingsChange()
    } catch (err) {
      setTickets((prev) =>
        prev.map((t, i) => (i === ticketIdx ? { ...t, submitting: false } : t))
      )
      setError(`Failed to submit ${ticket.jira.key}: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Jira to Linear -- New Requests</CardTitle>
            <Button onClick={fetchJiraTickets} disabled={loading}>
              {loading ? 'Fetching...' : 'Grab New COA Requests'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ul className="text-text-secondary text-sm mb-4 space-y-1 list-disc list-inside">
            <li>Fetches COA tickets with CCOPORT component, reads parent ticket details, and translates into CUSTDS Linear request format.</li>
            <li>Click "Grab New COA Requests" to fetch tickets from Jira.</li>
            <li className="font-mono text-xs">JQL: created &gt;= -365d and component = "CCOPORT" and "Delivery Team[Select List (multiple choices)]" in ("COA","COA - CI") and issuetype in (Task, Sub-task) and status not in ("Done","Won't Do") order by created DESC</li>
            <li>Only captures net new COA tickets that have not already been linked to a Linear ticket in the 'Sync Linear updates to Jira' tab of this webpage.</li>
          </ul>

          <div className="flex items-center gap-2 mb-4 max-w-md">
            <label className="text-xs text-text-secondary whitespace-nowrap">Your Jira email (requestor override):</label>
            <Input
              value={jiraEmail}
              onChange={(e) => setJiraEmail(e.target.value)}
              placeholder="e.g. ssantor@squareup.com"
              className="text-xs h-7"
            />
            <Button size="sm" variant="outline" onClick={saveEmail} className="whitespace-nowrap">
              {emailSaved ? 'Saved' : 'Save'}
            </Button>
          </div>

          {error && (
            <div className="p-3 mb-4 rounded bg-background-danger text-white text-sm">
              {error}
            </div>
          )}
          {successMsg && (
            <div className="p-3 mb-4 rounded bg-background-success text-white text-sm">
              {successMsg}
            </div>
          )}

          {tickets.length > 0 && (
            <>
              <p className="text-sm text-text-primary mb-4 font-medium">
                {tickets.length} new ticket(s){hiddenCount > 0 && ` — ${hiddenCount} already linked and hidden`}
              </p>
              <div className="space-y-3">
                {tickets.map((ticket) => {
                  const actualIdx = tickets.indexOf(ticket)
                  return (
                    <TicketCard
                      key={ticket.jira.key}
                      ticket={ticket}
                      onFieldChange={(field, value) => updateFormField(actualIdx, field, value)}
                      onSubmit={() => submitSingleToLinear(actualIdx)}
                    />
                  )
                })}
              </div>
            </>
          )}

          {tickets.length === 0 && !loading && (
            <p className="text-text-secondary text-sm">No tickets loaded yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function TicketCard({
  ticket,
  onFieldChange,
  onSubmit,
}: {
  ticket: FetchedTicket
  onFieldChange: (field: keyof LinearFormData, value: string) => void
  onSubmit: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const { jira, linearForm } = ticket

  return (
    <Card className={`border ${ticket.alreadyLinked ? 'border-border-secondary opacity-70' : 'border-border-primary'}`}>
      <CardHeader
        className="cursor-pointer select-none"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-text-secondary text-xs w-4">{expanded ? '\u25BC' : '\u25B6'}</span>
            <a
              href={jira.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-info hover:underline font-mono text-sm"
              onClick={(e) => e.stopPropagation()}
            >
              {jira.key}
            </a>
            <span className="text-text-primary font-medium">{jira.summary}</span>
            {jira.priority && (
              <span className="text-xs px-2 py-0.5 rounded bg-background-secondary text-text-secondary">
                {jira.priority}
              </span>
            )}
            {jira.parentStatus && (
              <span className="text-xs px-2 py-0.5 rounded bg-background-secondary text-text-secondary">
                {jira.parentStatus}
              </span>
            )}
          </div>
          <div onClick={(e) => e.stopPropagation()}>
            {ticket.alreadyLinked ? (
              <span className="text-xs font-medium text-white px-3 py-1 rounded bg-background-success">
                {ticket.submittedIdentifier ? (
                  <a href={ticket.submittedUrl} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    Submitted: {ticket.submittedIdentifier}
                  </a>
                ) : 'Already linked'}
              </span>
            ) : (
              <Button onClick={onSubmit} disabled={ticket.submitting} size="sm">
                {ticket.submitting ? 'Submitting...' : 'Submit to RADS Linear Cust Ops DS'}
              </Button>
            )}
          </div>
        </div>
        {jira.parentKey && (
          <p className="text-xs text-text-secondary mt-1 ml-7">
            Parent:{' '}
            <a
              href={`https://block.atlassian.net/browse/${jira.parentKey}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-info hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {jira.parentKey}
            </a>{' '}
            — {jira.parentSummary}
          </p>
        )}
      </CardHeader>
      {expanded && (
        <CardContent>
          <div className="space-y-3">
            <FormField label="Title" value={linearForm.title} onChange={(v) => onFieldChange('title', v)} disabled={ticket.alreadyLinked} />
            <FormField label="Requestor (LDAP)" value={linearForm.requestor} onChange={(v) => onFieldChange('requestor', v)} disabled={ticket.alreadyLinked} />
            <FormTextarea
              label="Request Description"
              value={linearForm.requestDescription}
              onChange={(v) => onFieldChange('requestDescription', v)}
              disabled={ticket.alreadyLinked}
            />
            <FormTextarea
              label="Business Justification"
              value={linearForm.businessJustification}
              onChange={(v) => onFieldChange('businessJustification', v)}
              disabled={ticket.alreadyLinked}
            />
            <FormField
              label="Requested Due Date"
              value={linearForm.requestedDueDate}
              onChange={(v) => onFieldChange('requestedDueDate', v)}
              type="date"
              disabled={ticket.alreadyLinked}
            />
            <FormTextarea
              label="Notes (optional)"
              value={linearForm.notes}
              onChange={(v) => onFieldChange('notes', v)}
              disabled={ticket.alreadyLinked}
            />
          </div>
        </CardContent>
      )}
    </Card>
  )
}

function FormField({
  label,
  value,
  onChange,
  type = 'text',
  disabled = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  disabled?: boolean
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-text-secondary mb-1">{label}</label>
      <Input type={type} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} />
    </div>
  )
}

function FormTextarea({
  label,
  value,
  onChange,
  disabled = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (ref.current) {
      ref.current.style.height = 'auto'
      ref.current.style.height = ref.current.scrollHeight + 'px'
    }
  }, [value])

  return (
    <div>
      <label className="block text-xs font-medium text-text-secondary mb-1">{label}</label>
      <textarea
        ref={ref}
        className="w-full min-h-[60px] px-3 py-2 rounded-md border border-border-primary bg-background-primary text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-ring-info disabled:opacity-50 disabled:cursor-not-allowed overflow-hidden resize-none"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </div>
  )
}
