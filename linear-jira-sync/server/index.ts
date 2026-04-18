/**
 * Server Entry Point - linear-jira-sync
 */

import { Hono } from 'hono'
import { serveStatic } from 'hono/cloudflare-workers'
import { logger } from './lib/logger'
import { AppError } from './lib/errors'
import { db } from './lib/db'

interface Env {
  DB: D1Database
}

const app = new Hono<{ Bindings: Env }>()

// =============================================================================
// Middleware
// =============================================================================

app.use('*', async (c, next) => {
  if (c.env.DB) {
    db.init(c.env.DB)
  }
  await next()
})

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

app.onError((err, c) => {
  if (err instanceof AppError) {
    logger.warn('App error', { code: err.code, message: err.message })
    return c.json(err.toJSON(), err.statusCode as any)
  }
  logger.error('Unhandled error', { message: err.message, stack: err.stack })
  return c.json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }, 500)
})

// =============================================================================
// API Routes — Ticket Mappings
// =============================================================================

app.get('/api/health', (c) => {
  return c.json({ status: 'ok', app: 'linear-jira-sync' })
})

app.get('/api/mappings', async (c) => {
  const mappings = await db.query(
    'SELECT * FROM ticket_mappings ORDER BY created_at DESC'
  )
  return c.json({ mappings })
})

app.post('/api/mappings', async (c) => {
  const body = await c.req.json()
  const { jira_key, jira_url, jira_summary, linear_id, linear_identifier, linear_url, linear_project_id, linear_project_url, status } = body

  const result = await db.execute(
    `INSERT INTO ticket_mappings (jira_key, jira_url, jira_summary, linear_id, linear_identifier, linear_url, linear_project_id, linear_project_url, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(jira_key) DO UPDATE SET
       linear_id = excluded.linear_id,
       linear_identifier = excluded.linear_identifier,
       linear_url = excluded.linear_url,
       linear_project_id = excluded.linear_project_id,
       linear_project_url = excluded.linear_project_url,
       jira_summary = excluded.jira_summary,
       status = excluded.status,
       updated_at = CURRENT_TIMESTAMP`,
    [jira_key, jira_url, jira_summary || '', linear_id || null, linear_identifier || null, linear_url || null, linear_project_id || null, linear_project_url || null, status || 'pending']
  )
  return c.json({ id: result.meta.last_row_id }, 201)
})

app.put('/api/mappings/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()
  const fields: string[] = []
  const values: unknown[] = []

  for (const [key, val] of Object.entries(body)) {
    if (['linear_id', 'linear_identifier', 'linear_url', 'linear_project_id', 'linear_project_url', 'status', 'jira_summary'].includes(key)) {
      fields.push(`${key} = ?`)
      values.push(val)
    }
  }
  if (fields.length === 0) return c.json({ error: 'No valid fields' }, 400)

  fields.push('updated_at = CURRENT_TIMESTAMP')
  values.push(id)

  await db.execute(
    `UPDATE ticket_mappings SET ${fields.join(', ')} WHERE id = ?`,
    values
  )
  return c.json({ success: true })
})

// =============================================================================
// API Routes — Activity Log
// =============================================================================

app.get('/api/activity', async (c) => {
  const logs = await db.query(
    `SELECT a.*, t.jira_key, t.linear_identifier
     FROM activity_log a
     LEFT JOIN ticket_mappings t ON a.mapping_id = t.id
     ORDER BY a.created_at DESC
     LIMIT 100`
  )
  return c.json({ logs })
})

app.post('/api/activity', async (c) => {
  const { mapping_id, action, actor, details } = await c.req.json()
  const result = await db.execute(
    'INSERT INTO activity_log (mapping_id, action, actor, details) VALUES (?, ?, ?, ?)',
    [mapping_id, action, actor, details]
  )
  return c.json({ id: result.meta.last_row_id }, 201)
})

// =============================================================================
// Static Files (MUST BE LAST)
// =============================================================================

app.get('/*', serveStatic({ root: './' }))

export default app
