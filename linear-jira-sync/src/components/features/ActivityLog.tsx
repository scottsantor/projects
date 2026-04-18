import { useState, useEffect } from 'react'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'

interface LogEntry {
  id: number
  mapping_id: number
  action: string
  actor: string
  details: string
  created_at: string
  jira_key: string | null
  linear_identifier: string | null
}

export function ActivityLog() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [loading, setLoading] = useState(true)

  const fetchLogs = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/activity')
      const data = await res.json()
      setLogs(data.logs || [])
    } catch (err) {
      console.error('Failed to fetch activity log:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLogs()
  }, [])

  const actionLabels: Record<string, string> = {
    submitted_to_linear: 'Submitted to Linear',
    synced_to_jira: 'Synced to Jira',
  }

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Activity Log</CardTitle>
            <Button variant="outline" onClick={fetchLogs} disabled={loading}>
              {loading ? 'Loading...' : 'Refresh'}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-text-secondary">Loading...</p>
          ) : logs.length === 0 ? (
            <p className="text-text-secondary text-sm">No activity yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border-primary">
                    <th className="text-left py-2 pr-4 text-text-secondary font-medium">Time (PT)</th>
                    <th className="text-left py-2 pr-4 text-text-secondary font-medium">Action</th>
                    <th className="text-left py-2 pr-4 text-text-secondary font-medium">Actor</th>
                    <th className="text-left py-2 pr-4 text-text-secondary font-medium">Tickets</th>
                    <th className="text-left py-2 text-text-secondary font-medium">Details</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log) => (
                    <tr key={log.id} className="border-b border-border-secondary last:border-0">
                      <td className="py-2 pr-4 text-xs text-text-secondary whitespace-nowrap">
                        {new Date(log.created_at + 'Z').toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}
                      </td>
                      <td className="py-2 pr-4">
                        <span className="text-xs font-medium">
                          {actionLabels[log.action] || log.action}
                        </span>
                      </td>
                      <td className="py-2 pr-4 font-mono text-xs">{log.actor}</td>
                      <td className="py-2 pr-4 text-xs">
                        {log.jira_key && <span className="font-mono">{log.jira_key}</span>}
                        {log.jira_key && log.linear_identifier && ' / '}
                        {log.linear_identifier && <span className="font-mono">{log.linear_identifier}</span>}
                      </td>
                      <td className="py-2 text-xs text-text-secondary max-w-md truncate">{log.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
