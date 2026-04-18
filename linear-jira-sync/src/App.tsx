import { useState, useEffect, useCallback, useRef } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'
import { NewRequests } from './components/features/NewRequests'
import { SyncUpdates } from './components/features/SyncUpdates'
import { ActivityLog } from './components/features/ActivityLog'
import { Settings } from './components/features/Settings'

export interface TicketMapping {
  id: number
  jira_key: string
  jira_url: string
  jira_summary: string
  linear_id: string | null
  linear_identifier: string | null
  linear_url: string | null
  linear_project_id: string | null
  linear_project_url: string | null
  status: string
  created_at: string
  updated_at: string
}

function App() {
  const [mappings, setMappings] = useState<TicketMapping[]>([])
  const [loadingMappings, setLoadingMappings] = useState(true)

  const fetchMappings = useCallback(async () => {
    try {
      const res = await fetch('/api/mappings')
      if (!res.ok) {
        setMappings([])
        return
      }
      const data = await res.json()
      setMappings(data.mappings || [])
    } catch {
      setMappings([])
    } finally {
      setLoadingMappings(false)
    }
  }, [])

  useEffect(() => {
    fetchMappings()
  }, [fetchMappings])

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex justify-end gap-4 text-xs text-text-secondary mb-2">
        <span>Questions? ssantor@ or #data-help-customer-support</span>
        <a
          href="https://github.com/scottsantor/projects/tree/main/linear-jira-sync"
          target="_blank"
          rel="noopener noreferrer"
          className="text-text-info hover:underline"
        >
          Build: GitHub
        </a>
      </div>
      <header className="mb-8 flex items-center justify-center gap-5">
        <img src="/jira_logo.png" alt="Jira" className="h-16 w-16" />
        <svg className="h-8 w-8 text-text-secondary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="4" y1="12" x2="20" y2="12" />
          <polyline points="14 6 20 12 14 18" />
          <line x1="20" y1="12" x2="4" y2="12" />
          <polyline points="10 6 4 12 10 18" />
        </svg>
        <img src="/linear_logo.png" alt="Linear" className="h-16 w-16" />
        <div className="ml-2">
          <h1 className="text-3xl font-bold text-text-primary">Linear / Jira Sync</h1>
          <p className="text-text-secondary text-sm">COA CCOPORT tickets to RADS CUSTDS Linear requests</p>
        </div>
      </header>

      {/* Tabs — forceMount keeps state alive across tab switches */}
      <Tabs defaultValue="new-requests">
        <TabsList>
          <TabsTrigger value="new-requests">New Requests</TabsTrigger>
          <TabsTrigger value="sync-updates">Sync Updates</TabsTrigger>
          <TabsTrigger value="activity">Activity Log</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>
        <TabsContent value="new-requests" forceMount className="data-[state=inactive]:hidden">
          <NewRequests mappings={mappings} onMappingsChange={fetchMappings} />
        </TabsContent>
        <TabsContent value="sync-updates" forceMount className="data-[state=inactive]:hidden">
          <SyncUpdates mappings={mappings} onMappingsChange={fetchMappings} />
        </TabsContent>
        <TabsContent value="activity" forceMount className="data-[state=inactive]:hidden">
          <ActivityLog />
        </TabsContent>
        <TabsContent value="settings" forceMount className="data-[state=inactive]:hidden">
          <Settings />
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default App
