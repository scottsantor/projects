import { useState, useEffect } from 'react'
import { Button } from '../ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card'
import { Input } from '../ui/input'

export function Settings() {
  const [jiraEmail, setJiraEmail] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const stored = localStorage.getItem('ljs_settings')
    if (stored) {
      try {
        const parsed = JSON.parse(stored)
        setJiraEmail(parsed.jiraEmail || '')
      } catch {}
    }
  }, [])

  const save = () => {
    localStorage.setItem('ljs_settings', JSON.stringify({ jiraEmail }))
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="space-y-4 mt-4">
      <Card>
        <CardHeader>
          <CardTitle>Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-text-secondary text-sm mb-4">
            Authentication is handled automatically via G2. These settings are optional overrides stored in your browser.
          </p>

          <div className="space-y-4 max-w-md">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1">
                Your Jira Email (for requestor LDAP)
              </label>
              <Input
                value={jiraEmail}
                onChange={(e) => setJiraEmail(e.target.value)}
                placeholder="e.g. ssantor@squareup.com"
              />
              <p className="text-xs text-text-secondary mt-1">
                Used to auto-fill the Requestor field. Leave blank to use the Jira assignee.
              </p>
            </div>

            <Button onClick={save}>{saved ? 'Saved' : 'Save Settings'}</Button>
          </div>

          <div className="mt-8 pt-4 border-t border-border-primary">
            <h3 className="text-sm font-medium text-text-primary mb-2">Integration Info</h3>
            <div className="space-y-1 text-xs text-text-secondary">
              <p>Jira: Authenticated via G2 jira extension (read/write)</p>
              <p>Linear: Authenticated via G2 linear extension (read/write)</p>
              <p>CUSTDS Team ID: 0f2a0619-8b8c-490e-98da-7fb25874f979</p>
              <p>Template: CustOps Data Science Request Intake Form</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
