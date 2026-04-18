const ACTIVITY_LOG_KEY = 'ljs_activity_log'

export interface ActivityEntry {
  id: string
  type: 'rads_request' | 'jira_update'
  timestamp: string
  jiraKey: string
  jiraUrl: string
  linearIdentifier: string
  linearUrl: string
  summary: string
}

export function getActivityLog(): ActivityEntry[] {
  try {
    const stored = localStorage.getItem(ACTIVITY_LOG_KEY)
    return stored ? JSON.parse(stored) : []
  } catch {
    return []
  }
}

export function addActivityEntry(entry: Omit<ActivityEntry, 'id' | 'timestamp'>): void {
  const log = getActivityLog()
  log.unshift({
    ...entry,
    id: crypto.randomUUID(),
    timestamp: new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }),
  })
  // Keep last 200 entries
  if (log.length > 200) log.length = 200
  localStorage.setItem(ACTIVITY_LOG_KEY, JSON.stringify(log))
}
