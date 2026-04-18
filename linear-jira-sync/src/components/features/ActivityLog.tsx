import { useState } from 'react'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { getActivityLog, type ActivityEntry } from '../../lib/activityLog'

export function ActivityLog() {
  const [logs, setLogs] = useState<ActivityEntry[]>(getActivityLog)

  const refresh = () => setLogs(getActivityLog())

  const radsRequests = logs.filter((l) => l.type === 'rads_request')
  const jiraUpdates = logs.filter((l) => l.type === 'jira_update')

  return (
    <div className="space-y-4 mt-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={refresh}>Refresh</Button>
      </div>

      {/* RADS Requests Submitted */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">RADS Requests Submitted</CardTitle>
        </CardHeader>
        <CardContent>
          {radsRequests.length === 0 ? (
            <p className="text-text-secondary text-sm">No RADS requests submitted yet.</p>
          ) : (
            <div className="space-y-3">
              {radsRequests.map((log) => (
                <div key={log.id} className="border-b border-border-secondary pb-3 last:border-0 last:pb-0">
                  <div className="flex items-center gap-3 text-xs text-text-secondary mb-1">
                    <span>{log.timestamp} PT</span>
                    <a
                      href={log.jiraUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-text-info hover:underline"
                    >
                      {log.jiraKey}
                    </a>
                    <span>→</span>
                    <a
                      href={log.linearUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-text-info hover:underline"
                    >
                      {log.linearIdentifier}
                    </a>
                  </div>
                  <p className="text-sm text-text-primary">{log.summary}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Jira Tickets Updated */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Jira Tickets Updated</CardTitle>
        </CardHeader>
        <CardContent>
          {jiraUpdates.length === 0 ? (
            <p className="text-text-secondary text-sm">No Jira tickets updated yet.</p>
          ) : (
            <div className="space-y-3">
              {jiraUpdates.map((log) => (
                <div key={log.id} className="border-b border-border-secondary pb-3 last:border-0 last:pb-0">
                  <div className="flex items-center gap-3 text-xs text-text-secondary mb-1">
                    <span>{log.timestamp} PT</span>
                    <a
                      href={log.jiraUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-text-info hover:underline"
                    >
                      {log.jiraKey}
                    </a>
                    <span>← updates from</span>
                    <a
                      href={log.linearUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-text-info hover:underline"
                    >
                      {log.linearIdentifier}
                    </a>
                  </div>
                  <p className="text-sm text-text-primary whitespace-pre-wrap">{log.summary}</p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
