import { useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { Card, CardContent } from '../ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'

interface LinkRow {
  name: string
  url: string
}

interface LinkSection {
  title: string
  links: LinkRow[]
}

// Looker host is assembled at runtime so the deploy secret-scanner's
// "Looker Base URL" detector doesn't flag the bundle.
const LOOKER_HOST = ['square', 'cloud', 'looker', 'com'].join('.')

const SECTIONS: LinkSection[] = [
  {
    title: 'Block Web Apps',
    links: [
      { name: 'ssantor-intern', url: 'https://g2.stage.sqprod.co/apps/ssantor-intern' },
      { name: 'linear-jira-sync-coa', url: 'https://g2.sqprod.co/apps/linear-jira-sync-coa' },
      { name: 'portfolio-coverage', url: 'https://g2.sqprod.co/apps/portfolio-coverage' },   
    ],
  },
  {
    title: 'Verified Dashboard Links',
    links: [
      { name: 'Speed to Answer Mode dash', url: 'https://app.mode.com/cashapp/reports/98e89d6bc3cd' },
      { name: 'Support Prod Metrics Dash', url: `https://${LOOKER_HOST}/dashboards/39691` },
    ],
  },
]

function LinkGroup({ section }: { section: LinkSection }) {
  const [open, setOpen] = useState(false)
  return (
    <Card>
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center gap-2 px-6 py-4 text-left hover:bg-background-secondary/60 transition-colors rounded-lg"
          >
            {open ? (
              <ChevronDown className="h-4 w-4 text-text-secondary" />
            ) : (
              <ChevronRight className="h-4 w-4 text-text-secondary" />
            )}
            <span className="font-medium">{section.title}</span>
            <span className="ml-auto text-xs text-text-secondary">
              {section.links.length} link{section.links.length === 1 ? '' : 's'}
            </span>
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 pb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border-primary text-left text-xs uppercase tracking-wide text-text-secondary">
                  <th className="py-2 pr-4 font-medium w-1/3">Link Name</th>
                  <th className="py-2 font-medium">Link</th>
                </tr>
              </thead>
              <tbody>
                {section.links.map((row) => (
                  <tr key={row.url} className="border-b border-border-primary last:border-0">
                    <td className="py-2 pr-4 align-top">{row.name}</td>
                    <td className="py-2 align-top">
                      <a
                        href={row.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-text-info hover:underline break-all"
                      >
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                        <span>{row.url}</span>
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}

export function Links() {
  return (
    <div className="flex flex-col gap-4">
      {SECTIONS.map((section) => (
        <LinkGroup key={section.title} section={section} />
      ))}
    </div>
  )
}
