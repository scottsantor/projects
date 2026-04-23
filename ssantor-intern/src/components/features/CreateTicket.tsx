import { useState } from 'react'
import { g2Post } from '../../lib/kgoose'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../ui/card'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Label } from '../ui/label'

const LINEAR_TEAM_ID = '0f2a0619-8b8c-490e-98da-7fb25874f979'
const LINEAR_API = 'https://api.linear.app/graphql'

const STATES = [
  { id: '5687f14f-3752-4dff-8eeb-ac29072490b0', name: 'Triage' },
  { id: 'e377ff7f-c814-41d1-8368-4bd62988216d', name: 'Backlog' },
  { id: 'aa6cb1c4-a66b-4b58-a2df-599e2f499b07', name: 'Todo' },
  { id: 'bcb1868a-aca6-4c6f-bbf6-9fd9b8a00a99', name: 'In Progress' },
  { id: '0ad4f445-b99b-4b91-b5e1-dc040c953cd1', name: 'In Review' },
  { id: '770ffb5b-1bfe-4311-8183-16a9e88a0332', name: 'Blocked' },
  { id: '0c7d2d04-1949-40b5-b4c7-0d55a355d476', name: 'Done' },
]

const LABELS = [
  { id: '0316d46e-3d9c-4a5b-9ecc-1ee8d23a396a', name: 'Infrastructure' },
  { id: '2114557b-9a66-4ff8-a39b-40ad5a0d8e72', name: 'Analysis' },
  { id: '23fd81de-cef4-41bc-b188-8040d35a00e4', name: 'Automation' },
  { id: '94eea105-1aed-4159-b9d4-393f6f39e3e1', name: 'KTLO' },
]

const PRIORITIES = [
  { value: 0, name: 'No priority' },
  { value: 1, name: 'Urgent' },
  { value: 2, name: 'High' },
  { value: 3, name: 'Medium' },
  { value: 4, name: 'Low' },
]

const ASSIGNEES = [
  { id: '049f0974-8542-4e34-80b1-8fe7f528bbc1', name: 'Scott Santor' },
  { id: '', name: 'Unassigned' },
]

const ESTIMATE_TABLE = [
  [1, 0.5], [2, 1], [4, 2], [6, 3], [8, 4], [10, 5], [20, 10],
]

function tomorrowISO() {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toISOString().split('T')[0]
}

const selectClass =
  'h-9 w-full rounded-md border border-border-primary bg-background-primary px-3 py-1 text-sm text-text-primary focus:outline-none focus:ring-1 focus:ring-ring-primary'

type Result =
  | { kind: 'success'; identifier: string; title: string; url: string }
  | { kind: 'error'; message: string }
  | null

export function CreateTicket() {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [priority, setPriority] = useState(3)
  const [stateId, setStateId] = useState(STATES[3].id)
  const [labelId, setLabelId] = useState(LABELS[2].id)
  const [estimate, setEstimate] = useState(1)
  const [dueDate, setDueDate] = useState(tomorrowISO())
  const [assigneeId, setAssigneeId] = useState(ASSIGNEES[0].id)
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState<Result>(null)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setResult(null)

    const input: Record<string, unknown> = {
      teamId: LINEAR_TEAM_ID,
      title: title.trim(),
      priority,
      stateId,
      labelIds: [labelId],
      estimate,
    }
    if (description.trim()) input.description = description.trim()
    if (dueDate) input.dueDate = dueDate
    if (assigneeId) input.assigneeId = assigneeId

    const query = `mutation($input: IssueCreateInput!) {
      issueCreate(input: $input) {
        success
        issue { identifier title url }
      }
    }`

    try {
      const data = await g2Post<{
        data?: { issueCreate?: { success: boolean; issue: { identifier: string; title: string; url: string } } }
        errors?: { message: string }[]
      }>(LINEAR_API, 'linear', { query, variables: { input } })

      if (data.errors?.length) {
        setResult({ kind: 'error', message: data.errors.map((e) => e.message).join(', ') })
      } else if (data.data?.issueCreate?.success) {
        const issue = data.data.issueCreate.issue
        setResult({ kind: 'success', identifier: issue.identifier, title: issue.title, url: issue.url })
        setTitle('')
        setDescription('')
      } else {
        setResult({ kind: 'error', message: 'Unexpected response from Linear API.' })
      }
    } catch (err) {
      setResult({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-[1fr_260px]">
      <Card>
        <CardHeader>
          <CardTitle>CUSTDS Ticket Creator</CardTitle>
          <CardDescription>Create Linear tickets for the CCO-DS team</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lt-title">Title *</Label>
              <Input
                id="lt-title"
                required
                placeholder="Brief summary of the work"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="lt-description">Description</Label>
              <Textarea
                id="lt-description"
                rows={4}
                placeholder="Details, context, acceptance criteria..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lt-priority">Priority</Label>
                <select
                  id="lt-priority"
                  className={selectClass}
                  value={priority}
                  onChange={(e) => setPriority(parseInt(e.target.value))}
                >
                  {PRIORITIES.map((p) => (
                    <option key={p.value} value={p.value}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lt-state">Status</Label>
                <select
                  id="lt-state"
                  className={selectClass}
                  value={stateId}
                  onChange={(e) => setStateId(e.target.value)}
                >
                  {STATES.map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lt-label">Label</Label>
                <select
                  id="lt-label"
                  className={selectClass}
                  value={labelId}
                  onChange={(e) => setLabelId(e.target.value)}
                >
                  {LABELS.map((l) => (
                    <option key={l.id} value={l.id}>{l.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lt-estimate">Estimate</Label>
                <select
                  id="lt-estimate"
                  className={selectClass}
                  value={estimate}
                  onChange={(e) => setEstimate(parseInt(e.target.value))}
                >
                  {Array.from({ length: 20 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lt-duedate">Due Date</Label>
                <Input
                  id="lt-duedate"
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="lt-assignee">Assignee</Label>
                <select
                  id="lt-assignee"
                  className={selectClass}
                  value={assigneeId}
                  onChange={(e) => setAssigneeId(e.target.value)}
                >
                  {ASSIGNEES.map((a) => (
                    <option key={a.name} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <Button type="submit" disabled={submitting || !title.trim()} className="self-start">
              {submitting ? 'Creating...' : 'Create Ticket'}
            </Button>

            {result?.kind === 'success' && (
              <div className="rounded-md border border-border-primary bg-background-secondary px-3 py-2 text-sm text-text-success">
                Created{' '}
                <a href={result.url} target="_blank" rel="noreferrer" className="underline font-medium">
                  {result.identifier}
                </a>
                : {result.title}
              </div>
            )}
            {result?.kind === 'error' && (
              <div className="rounded-md border border-border-primary bg-background-secondary px-3 py-2 text-sm text-text-danger">
                {result.message}
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      <aside className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Estimate → Days</CardTitle>
          </CardHeader>
          <CardContent>
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-primary text-text-secondary">
                  <th className="py-1 text-left font-medium">Points</th>
                  <th className="py-1 text-left font-medium">Biz Days</th>
                </tr>
              </thead>
              <tbody>
                {ESTIMATE_TABLE.map(([pts, days]) => (
                  <tr key={pts} className="border-b border-border-primary/40 last:border-0">
                    <td className="py-1">{pts}</td>
                    <td className="py-1">{days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <a
          className="text-sm text-text-info underline"
          href="https://docs.google.com/document/d/1dZjkB6nBtovrSlAMn6KUF9QSkhAv3qHRCPeSzQvt3CE/edit?tab=t.0#heading=h.61ibaa1xrlqd"
          target="_blank"
          rel="noreferrer"
        >
          RADS Linear guidelines
        </a>
      </aside>
    </div>
  )
}
