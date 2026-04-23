import { useCallback, useEffect, useRef, useState } from 'react'
import { Trash2, Plus, Pencil, Link as LinkIcon, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Skeleton } from '../ui/skeleton'

function AutoGrowTextarea(props: React.ComponentProps<typeof Textarea>) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [props.value])
  return (
    <Textarea
      {...props}
      ref={ref}
      style={{ overflow: 'hidden', ...props.style }}
    />
  )
}

interface Meeting {
  id: number
  title: string
  meeting_date: string
  start_time: string | null
  end_time: string | null
  notes: string
  notes_link: string | null
  created_at: string
  updated_at: string
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error((body as any)?.error?.message || `Request failed (${res.status})`)
  }
  return res.json() as Promise<T>
}

function todayISO(): string {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDaysISO(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, (m ?? 1) - 1, d ?? 1)
  date.setDate(date.getDate() + days)
  const yy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

function formatShortDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, (m ?? 1) - 1, d ?? 1)
  return date
    .toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    .replace(/,/g, '')
}

function formatDateLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, (m ?? 1) - 1, d ?? 1)
  const today = todayISO()
  const tomorrow = addDaysISO(today, 1)
  const yesterday = addDaysISO(today, -1)
  const base = date.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
  })
  if (iso === today) return `Today · ${base}`
  if (iso === tomorrow) return `Tomorrow · ${base}`
  if (iso === yesterday) return `Yesterday · ${base}`
  return base
}

export function Notepad() {
  const [date, setDate] = useState<string>(todayISO())
  const [meetings, setMeetings] = useState<Meeting[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [newTitle, setNewTitle] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const [savingId, setSavingId] = useState<number | null>(null)
  const [editingIds, setEditingIds] = useState<Set<number>>(new Set())
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set())
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [linkDrafts, setLinkDrafts] = useState<Record<number, string>>({})

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const isEditing = (m: Meeting) => editingIds.has(m.id) || !m.notes

  const beginEdit = (m: Meeting) => {
    setDrafts((prev) => ({ ...prev, [m.id]: m.notes }))
    setLinkDrafts((prev) => ({ ...prev, [m.id]: m.notes_link ?? '' }))
    setEditingIds((prev) => {
      const next = new Set(prev)
      next.add(m.id)
      return next
    })
  }

  const submitNotes = async (m: Meeting) => {
    const notes = drafts[m.id] ?? m.notes
    const notes_link = linkDrafts[m.id] ?? m.notes_link ?? ''
    await patchMeeting(m.id, { notes, notes_link: notes_link.trim() || null })
    setEditingIds((prev) => {
      const next = new Set(prev)
      next.delete(m.id)
      return next
    })
    setDrafts((prev) => {
      const next = { ...prev }
      delete next[m.id]
      return next
    })
    setLinkDrafts((prev) => {
      const next = { ...prev }
      delete next[m.id]
      return next
    })
  }

  const load = useCallback(async (d: string) => {
    setLoading(true)
    setError(null)
    try {
      const data = await api<{ meetings: Meeting[] }>(
        `/api/meetings?date=${encodeURIComponent(d)}`
      )
      setMeetings(data.meetings)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load(date)
  }, [date, load])

  const addMeeting = async (e: React.FormEvent) => {
    e.preventDefault()
    const title = newTitle.trim()
    if (!title) return
    setSubmitting(true)
    setError(null)
    try {
      const { meeting } = await api<{ meeting: Meeting }>('/api/meetings', {
        method: 'POST',
        body: JSON.stringify({ title, meeting_date: date }),
      })
      setMeetings((prev) => (prev ? [...prev, meeting].sort(sortMeetings) : [meeting]))
      setExpandedIds((prev) => {
        const next = new Set(prev)
        next.add(meeting.id)
        return next
      })
      setNewTitle('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const patchMeeting = async (
    id: number,
    patch: Partial<Pick<Meeting, 'title' | 'start_time' | 'end_time' | 'notes' | 'notes_link'>>
  ) => {
    setSavingId(id)
    setMeetings((prev) =>
      prev ? prev.map((m) => (m.id === id ? { ...m, ...patch } : m)).sort(sortMeetings) : prev
    )
    try {
      await api(`/api/meetings/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      load(date)
    } finally {
      setSavingId(null)
    }
  }

  const deleteMeeting = async (id: number) => {
    setMeetings((prev) => prev?.filter((m) => m.id !== id) ?? null)
    try {
      await api(`/api/meetings/${id}`, { method: 'DELETE' })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      load(date)
    }
  }

  const count = meetings?.length ?? 0

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Notepad</h2>
        <p className="text-sm text-text-secondary">
          {loading ? 'Loading…' : `${formatDateLabel(date)} · ${count} meeting${count === 1 ? '' : 's'}`}
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-border-primary bg-background-secondary px-3 py-2 text-sm text-text-danger">
          {error}
        </div>
      )}

      <Card>
        <CardContent className="py-3">
          <form onSubmit={addMeeting} className="flex flex-col gap-2 md:flex-row md:items-center">
            <Input
              placeholder="Meeting title…"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              disabled={submitting}
              className="flex-1"
            />
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="md:w-[150px]"
              aria-label="Meeting date"
            />
            <Button type="submit" disabled={submitting || !newTitle.trim()}>
              <Plus className="h-4 w-4" />
              Add
            </Button>
          </form>
        </CardContent>
      </Card>

      {loading && !meetings && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-32 w-full" />
          ))}
        </div>
      )}

      {meetings && meetings.length === 0 && !loading && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-text-secondary">
            No meetings for this day. Add one above.
          </CardContent>
        </Card>
      )}

      {meetings && meetings.length > 0 && (
        <div className="flex flex-col gap-3">
          {meetings.map((m) => {
            const editing = isEditing(m)
            const expanded = expandedIds.has(m.id)
            return (
              <Card key={m.id}>
                <CardContent className="flex flex-col gap-3 py-3">
                  <div className="flex items-start gap-2">
                    <button
                      type="button"
                      onClick={() => toggleExpand(m.id)}
                      className="text-text-tertiary hover:text-text-primary mt-[1px]"
                      aria-label={expanded ? 'Collapse' : 'Expand'}
                    >
                      {expanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>
                    <span className="text-sm font-semibold text-text-secondary whitespace-nowrap pt-[1px]">
                      {formatShortDate(m.meeting_date)} –
                    </span>
                    <input
                      defaultValue={m.title}
                      onBlur={(e) => {
                        const v = e.target.value.trim()
                        if (v && v !== m.title) patchMeeting(m.id, { title: v })
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 bg-transparent text-sm font-semibold outline-none border-b border-transparent hover:border-border-primary focus:border-ring-primary min-w-0"
                    />
                    {expanded && !editing && (
                      <button
                        type="button"
                        onClick={() => beginEdit(m)}
                        className="text-text-tertiary hover:text-text-primary"
                        aria-label="Edit notes"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => deleteMeeting(m.id)}
                      className="text-text-tertiary hover:text-text-danger"
                      aria-label="Delete meeting"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {expanded &&
                    (editing ? (
                      <>
                        <AutoGrowTextarea
                          rows={5}
                          placeholder="Notes…"
                          value={drafts[m.id] ?? m.notes}
                          onChange={(e) =>
                            setDrafts((prev) => ({ ...prev, [m.id]: e.target.value }))
                          }
                        />
                        <Input
                          type="url"
                          placeholder="Meeting notes link (optional)"
                          value={linkDrafts[m.id] ?? m.notes_link ?? ''}
                          onChange={(e) =>
                            setLinkDrafts((prev) => ({ ...prev, [m.id]: e.target.value }))
                          }
                        />
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] text-text-tertiary">
                            {savingId === m.id ? 'Saving…' : ''}
                          </span>
                          <Button
                            size="sm"
                            onClick={() => submitNotes(m)}
                            disabled={savingId === m.id}
                          >
                            Submit
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        {m.notes_link && (
                          <a
                            href={m.notes_link}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-sm text-text-info hover:underline w-fit"
                          >
                            <LinkIcon className="h-3.5 w-3.5" />
                            meeting notes link
                          </a>
                        )}
                        <div className="whitespace-pre-wrap text-sm text-text-primary">
                          {m.notes}
                        </div>
                      </>
                    ))}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

function sortMeetings(a: Meeting, b: Meeting): number {
  const at = a.start_time ?? '99:99'
  const bt = b.start_time ?? '99:99'
  if (at !== bt) return at < bt ? -1 : 1
  return a.id - b.id
}
