/**
 * Server Entry Point - ssantor-intern
 *
 * This file sets up the Hono server with middleware and routes.
 * Add your API routes BEFORE the static file handler.
 */

import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import type { D1Database } from '@cloudflare/workers-types'
import { logger } from './lib/logger'
import { AppError, NotFoundError, ValidationError } from './lib/errors'
import { db, initDB } from './lib/db'

interface Env {
  DB: D1Database
}

const app = new Hono<{ Bindings: Env }>()

// =============================================================================
// Middleware
// =============================================================================

// DB binding — initialize per request (workers reuse module scope across requests)
app.use('*', async (c, next) => {
  if (c.env?.DB) initDB(c.env.DB)
  await next()
})

// Request logging
app.use('*', async (c, next) => {
  const start = Date.now()
  await next()
  const duration = Date.now() - start
  logger.info('Request', {
    method: c.req.method,
    path: c.req.path,
    status: c.res.status,
    duration,
  })
})

// Error handling
app.onError((err, c) => {
  if (err instanceof AppError) {
    logger.warn('App error', { code: err.code, message: err.message })
    return c.json(err.toJSON(), err.statusCode as any)
  }

  logger.error('Unhandled error', { message: err.message, stack: err.stack })
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500)
})

// =============================================================================
// API Routes
// =============================================================================

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', app: 'ssantor-intern' })
})

// -----------------------------------------------------------------------------
// Todos
// -----------------------------------------------------------------------------

interface TodoRow {
  id: number
  title: string
  done: number
  notes: string | null
  due_date: string | null
  position: number
  created_at: string
}

app.get('/api/todos', async (c) => {
  const rows = await db.query<TodoRow>(
    'SELECT id, title, done, notes, due_date, position, created_at FROM todos ORDER BY done ASC, position ASC, id ASC'
  )
  return c.json({ todos: rows })
})

app.post('/api/todos', async (c) => {
  const body = await c.req.json<{ title?: string; notes?: string; due_date?: string }>()
  const title = body.title?.trim()
  if (!title) throw new ValidationError('Title is required')

  const max = await db.first<{ max_pos: number | null }>(
    'SELECT MAX(position) AS max_pos FROM todos WHERE done = 0'
  )
  const position = (max?.max_pos ?? 0) + 1

  const result = await db.execute(
    'INSERT INTO todos (title, notes, due_date, position) VALUES (?, ?, ?, ?)',
    [title, body.notes?.trim() || null, body.due_date || null, position]
  )
  const id = result.meta.last_row_id
  const row = await db.first<TodoRow>(
    'SELECT id, title, done, notes, due_date, position, created_at FROM todos WHERE id = ?',
    [id]
  )
  return c.json({ todo: row }, 201)
})

app.patch('/api/todos/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (!Number.isFinite(id)) throw new ValidationError('Invalid id')

  const existing = await db.first<TodoRow>('SELECT * FROM todos WHERE id = ?', [id])
  if (!existing) throw new NotFoundError('Todo not found')

  const body = await c.req.json<{
    title?: string
    done?: boolean
    notes?: string | null
    due_date?: string | null
  }>()

  const sets: string[] = []
  const params: unknown[] = []
  if (typeof body.title === 'string') {
    const t = body.title.trim()
    if (!t) throw new ValidationError('Title cannot be empty')
    sets.push('title = ?')
    params.push(t)
  }
  if (typeof body.done === 'boolean') {
    sets.push('done = ?')
    params.push(body.done ? 1 : 0)
  }
  if (body.notes !== undefined) {
    sets.push('notes = ?')
    params.push(body.notes?.trim() || null)
  }
  if (body.due_date !== undefined) {
    sets.push('due_date = ?')
    params.push(body.due_date || null)
  }

  if (sets.length === 0) {
    return c.json({ todo: existing })
  }

  params.push(id)
  await db.execute(`UPDATE todos SET ${sets.join(', ')} WHERE id = ?`, params)

  const row = await db.first<TodoRow>(
    'SELECT id, title, done, notes, due_date, position, created_at FROM todos WHERE id = ?',
    [id]
  )
  return c.json({ todo: row })
})

app.delete('/api/todos/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (!Number.isFinite(id)) throw new ValidationError('Invalid id')
  await db.execute('DELETE FROM todos WHERE id = ?', [id])
  return c.json({ ok: true })
})

app.put('/api/todos/reorder', async (c) => {
  const body = await c.req.json<{ order: number[] }>()
  if (!Array.isArray(body.order)) throw new ValidationError('order must be an array of ids')

  const statements = body.order.map((id, idx) => ({
    sql: 'UPDATE todos SET position = ? WHERE id = ?',
    params: [idx + 1, id],
  }))
  if (statements.length > 0) await db.batch(statements)
  return c.json({ ok: true })
})

// -----------------------------------------------------------------------------
// Meetings (manual entry — one row per meeting, notes stored inline)
// -----------------------------------------------------------------------------

interface MeetingRow {
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

const MEETING_COLS =
  'id, title, meeting_date, start_time, end_time, notes, notes_link, created_at, updated_at'

app.get('/api/meetings', async (c) => {
  const date = c.req.query('date')
  const rows = date
    ? await db.query<MeetingRow>(
        `SELECT ${MEETING_COLS} FROM meetings WHERE meeting_date = ?
         ORDER BY start_time IS NULL, start_time ASC, id ASC`,
        [date]
      )
    : await db.query<MeetingRow>(
        `SELECT ${MEETING_COLS} FROM meetings
         ORDER BY meeting_date DESC, start_time IS NULL, start_time ASC, id ASC`
      )
  return c.json({ meetings: rows })
})

app.post('/api/meetings', async (c) => {
  const body = await c.req.json<{
    title?: string
    meeting_date?: string
    start_time?: string
    end_time?: string
    notes?: string
    notes_link?: string | null
  }>()
  const title = body.title?.trim()
  const meeting_date = body.meeting_date?.trim()
  if (!title) throw new ValidationError('Title is required')
  if (!meeting_date) throw new ValidationError('meeting_date is required')

  const result = await db.execute(
    `INSERT INTO meetings (title, meeting_date, start_time, end_time, notes, notes_link)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      title,
      meeting_date,
      body.start_time || null,
      body.end_time || null,
      body.notes ?? '',
      body.notes_link?.trim() || null,
    ]
  )
  const id = result.meta.last_row_id
  const row = await db.first<MeetingRow>(
    `SELECT ${MEETING_COLS} FROM meetings WHERE id = ?`,
    [id]
  )
  return c.json({ meeting: row }, 201)
})

app.patch('/api/meetings/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (!Number.isFinite(id)) throw new ValidationError('Invalid id')

  const existing = await db.first<MeetingRow>('SELECT * FROM meetings WHERE id = ?', [id])
  if (!existing) throw new NotFoundError('Meeting not found')

  const body = await c.req.json<{
    title?: string
    meeting_date?: string
    start_time?: string | null
    end_time?: string | null
    notes?: string
    notes_link?: string | null
  }>()

  const sets: string[] = []
  const params: unknown[] = []
  if (typeof body.title === 'string') {
    const t = body.title.trim()
    if (!t) throw new ValidationError('Title cannot be empty')
    sets.push('title = ?')
    params.push(t)
  }
  if (typeof body.meeting_date === 'string' && body.meeting_date.trim()) {
    sets.push('meeting_date = ?')
    params.push(body.meeting_date.trim())
  }
  if (body.start_time !== undefined) {
    sets.push('start_time = ?')
    params.push(body.start_time || null)
  }
  if (body.end_time !== undefined) {
    sets.push('end_time = ?')
    params.push(body.end_time || null)
  }
  if (typeof body.notes === 'string') {
    sets.push('notes = ?')
    params.push(body.notes)
  }
  if (body.notes_link !== undefined) {
    const v = typeof body.notes_link === 'string' ? body.notes_link.trim() : ''
    sets.push('notes_link = ?')
    params.push(v || null)
  }

  if (sets.length === 0) return c.json({ meeting: existing })

  sets.push("updated_at = datetime('now')")
  params.push(id)
  await db.execute(`UPDATE meetings SET ${sets.join(', ')} WHERE id = ?`, params)

  const row = await db.first<MeetingRow>(
    `SELECT ${MEETING_COLS} FROM meetings WHERE id = ?`,
    [id]
  )
  return c.json({ meeting: row })
})

app.delete('/api/meetings/:id', async (c) => {
  const id = parseInt(c.req.param('id'), 10)
  if (!Number.isFinite(id)) throw new ValidationError('Invalid id')
  await db.execute('DELETE FROM meetings WHERE id = ?', [id])
  return c.json({ ok: true })
})

// =============================================================================
// Static Files (MUST BE LAST)
// =============================================================================

app.get('/*', serveStatic({ root: './' }))

export default app
