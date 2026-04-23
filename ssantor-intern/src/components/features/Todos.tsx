import { useCallback, useEffect, useRef, useState } from 'react'
import { GripVertical, Trash2, ChevronDown, ChevronRight, Plus } from 'lucide-react'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import { Input } from '../ui/input'
import { Textarea } from '../ui/textarea'
import { Checkbox } from '../ui/checkbox'
import { Skeleton } from '../ui/skeleton'

interface Todo {
  id: number
  title: string
  done: number
  notes: string | null
  due_date: string | null
  position: number
  created_at: string
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

function formatDue(iso: string | null): string | null {
  if (!iso) return null
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(y, (m ?? 1) - 1, d ?? 1)
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function isOverdue(iso: string | null, done: boolean): boolean {
  if (!iso || done) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const [y, m, d] = iso.split('-').map(Number)
  const due = new Date(y, (m ?? 1) - 1, d ?? 1)
  return due.getTime() < today.getTime()
}

export function Todos() {
  const [todos, setTodos] = useState<Todo[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const [newTitle, setNewTitle] = useState('')
  const [newNotes, setNewNotes] = useState('')
  const [newDueDate, setNewDueDate] = useState('')
  const [showNewDetails, setShowNewDetails] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editTitle, setEditTitle] = useState('')

  const dragIdRef = useRef<number | null>(null)
  const [dragOverId, setDragOverId] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    setError(null)
    try {
      const data = await api<{ todos: Todo[] }>('/api/todos')
      setTodos(data.todos)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const addTodo = async (e: React.FormEvent) => {
    e.preventDefault()
    const title = newTitle.trim()
    if (!title) return
    setSubmitting(true)
    setError(null)
    try {
      const { todo } = await api<{ todo: Todo }>('/api/todos', {
        method: 'POST',
        body: JSON.stringify({
          title,
          notes: newNotes.trim() || undefined,
          due_date: newDueDate || undefined,
        }),
      })
      setTodos((prev) => (prev ? [...prev, todo].sort(sortTodos) : [todo]))
      setNewTitle('')
      setNewNotes('')
      setNewDueDate('')
      setShowNewDetails(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }

  const patchTodo = async (id: number, patch: Partial<Pick<Todo, 'title' | 'notes' | 'due_date'>> & { done?: boolean }) => {
    // optimistic
    setTodos((prev) =>
      prev
        ? prev
            .map((t) =>
              t.id === id
                ? {
                    ...t,
                    ...(patch.title !== undefined ? { title: patch.title } : {}),
                    ...(patch.notes !== undefined ? { notes: patch.notes || null } : {}),
                    ...(patch.due_date !== undefined ? { due_date: patch.due_date || null } : {}),
                    ...(patch.done !== undefined ? { done: patch.done ? 1 : 0 } : {}),
                  }
                : t
            )
            .sort(sortTodos)
        : prev
    )
    try {
      await api(`/api/todos/${id}`, { method: 'PATCH', body: JSON.stringify(patch) })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      refresh()
    }
  }

  const deleteTodo = async (id: number) => {
    setTodos((prev) => prev?.filter((t) => t.id !== id) ?? null)
    try {
      await api(`/api/todos/${id}`, { method: 'DELETE' })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      refresh()
    }
  }

  const commitReorder = async (nextIds: number[]) => {
    try {
      await api('/api/todos/reorder', {
        method: 'PUT',
        body: JSON.stringify({ order: nextIds }),
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      refresh()
    }
  }

  const onDragStart = (id: number) => (e: React.DragEvent) => {
    dragIdRef.current = id
    e.dataTransfer.effectAllowed = 'move'
  }

  const onDragOver = (id: number) => (e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    if (dragOverId !== id) setDragOverId(id)
  }

  const onDragLeave = () => setDragOverId(null)

  const onDrop = (targetId: number) => (e: React.DragEvent) => {
    e.preventDefault()
    const sourceId = dragIdRef.current
    dragIdRef.current = null
    setDragOverId(null)
    if (sourceId == null || sourceId === targetId || !todos) return

    const active = todos.filter((t) => !t.done)
    const done = todos.filter((t) => t.done)
    const srcIdx = active.findIndex((t) => t.id === sourceId)
    const dstIdx = active.findIndex((t) => t.id === targetId)
    if (srcIdx < 0 || dstIdx < 0) return // only reorder within active

    const nextActive = [...active]
    const [moved] = nextActive.splice(srcIdx, 1)
    nextActive.splice(dstIdx, 0, moved)

    const reassigned = nextActive.map((t, i) => ({ ...t, position: i + 1 }))
    setTodos([...reassigned, ...done])
    commitReorder(reassigned.map((t) => t.id))
  }

  const startEdit = (todo: Todo) => {
    setEditingId(todo.id)
    setEditTitle(todo.title)
  }

  const saveEdit = async () => {
    if (editingId == null) return
    const title = editTitle.trim()
    const id = editingId
    setEditingId(null)
    if (!title) return
    await patchTodo(id, { title })
  }

  const activeCount = todos?.filter((t) => !t.done).length ?? 0
  const doneCount = todos?.filter((t) => t.done).length ?? 0

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">To-dos</h2>
        <p className="text-sm text-text-secondary">
          {loading
            ? 'Loading...'
            : `${activeCount} open${doneCount ? ` · ${doneCount} done` : ''}`}
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-border-primary bg-background-secondary px-3 py-2 text-sm text-text-danger">
          {error}
        </div>
      )}

      <Card>
        <CardContent className="py-3">
          <form onSubmit={addTodo} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <Input
                placeholder="Add a to-do..."
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                disabled={submitting}
              />
              <Button type="submit" disabled={submitting || !newTitle.trim()}>
                <Plus className="h-4 w-4" />
                Add
              </Button>
            </div>
            <button
              type="button"
              className="self-start text-xs text-text-secondary hover:text-text-primary inline-flex items-center gap-1"
              onClick={() => setShowNewDetails((v) => !v)}
            >
              {showNewDetails ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {showNewDetails ? 'Hide details' : 'Add notes or due date'}
            </button>
            {showNewDetails && (
              <div className="grid gap-2 md:grid-cols-[1fr_180px]">
                <Textarea
                  rows={2}
                  placeholder="Notes (optional)"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                />
                <Input
                  type="date"
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                />
              </div>
            )}
          </form>
        </CardContent>
      </Card>

      {loading && !todos && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {todos && todos.length === 0 && !loading && (
        <Card>
          <CardContent className="py-8 text-center text-sm text-text-secondary">
            Nothing yet. Add your first to-do above.
          </CardContent>
        </Card>
      )}

      {todos && todos.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {todos.map((todo) => {
            const done = !!todo.done
            const expanded = expandedId === todo.id
            const editing = editingId === todo.id
            const overdue = isOverdue(todo.due_date, done)
            const isDragOver = dragOverId === todo.id && !done

            return (
              <Card
                key={todo.id}
                className={`transition-colors ${isDragOver ? 'ring-2 ring-ring-info' : ''}`}
                onDragOver={!done ? onDragOver(todo.id) : undefined}
                onDragLeave={!done ? onDragLeave : undefined}
                onDrop={!done ? onDrop(todo.id) : undefined}
              >
                <CardContent className="flex items-start gap-2 py-2.5">
                  {!done ? (
                    <button
                      type="button"
                      draggable
                      onDragStart={onDragStart(todo.id)}
                      aria-label="Drag to reorder"
                      className="cursor-grab active:cursor-grabbing text-text-tertiary hover:text-text-primary mt-1"
                    >
                      <GripVertical className="h-4 w-4" />
                    </button>
                  ) : (
                    <div className="w-4 mt-1" />
                  )}

                  <Checkbox
                    checked={done}
                    onCheckedChange={(v) => patchTodo(todo.id, { done: !!v })}
                    className="mt-1"
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2">
                      {editing ? (
                        <input
                          autoFocus
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onBlur={saveEdit}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit()
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                          className="flex-1 bg-transparent text-sm outline-none border-b border-border-primary focus:border-ring-primary"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => !done && startEdit(todo)}
                          className={`flex-1 text-left text-sm ${
                            done
                              ? 'text-text-tertiary line-through'
                              : 'text-text-primary hover:text-text-info'
                          }`}
                        >
                          {todo.title}
                        </button>
                      )}

                      {todo.due_date && (
                        <span
                          className={`text-[11px] px-1.5 py-0.5 rounded whitespace-nowrap ${
                            overdue
                              ? 'bg-background-secondary text-text-danger'
                              : 'bg-background-secondary text-text-secondary'
                          }`}
                        >
                          {formatDue(todo.due_date)}
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={() => setExpandedId(expanded ? null : todo.id)}
                        className="text-text-tertiary hover:text-text-primary"
                        aria-label={expanded ? 'Collapse' : 'Expand'}
                      >
                        {expanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => deleteTodo(todo.id)}
                        className="text-text-tertiary hover:text-text-danger"
                        aria-label="Delete"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>

                    {expanded && (
                      <div className="mt-2 grid gap-2 md:grid-cols-[1fr_180px]">
                        <Textarea
                          rows={2}
                          placeholder="Notes"
                          defaultValue={todo.notes ?? ''}
                          onBlur={(e) => {
                            const v = e.target.value
                            if ((todo.notes ?? '') !== v) patchTodo(todo.id, { notes: v })
                          }}
                        />
                        <Input
                          type="date"
                          defaultValue={todo.due_date ?? ''}
                          onBlur={(e) => {
                            const v = e.target.value
                            if ((todo.due_date ?? '') !== v) patchTodo(todo.id, { due_date: v })
                          }}
                        />
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}

function sortTodos(a: Todo, b: Todo): number {
  if (a.done !== b.done) return a.done - b.done
  if (a.position !== b.position) return a.position - b.position
  return a.id - b.id
}
