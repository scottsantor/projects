import { useState } from 'react'
import { ChevronDown, ChevronRight, ExternalLink } from 'lucide-react'
import { Card, CardContent } from '../ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '../ui/collapsible'

interface LinkSection {
  title: string
  links: string[]
}

const SECTIONS: LinkSection[] = [
  {
    title: 'Block Web Apps',
    links: [
      'https://g2.stage.sqprod.co/apps/ssantor-intern',
      'https://g2.sqprod.co/apps/linear-jira-sync-coa',
    ],
  },
  {
    title: 'Verified Dashboard Links',
    links: [
      'https://app.mode.com/cashapp/reports/98e89d6bc3cd',
      'https://square.cloud.looker.com/dashboards/39691',
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
            <ul className="flex flex-col gap-2">
              {section.links.map((url) => (
                <li key={url}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm text-text-info hover:underline break-all"
                  >
                    <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    <span>{url}</span>
                  </a>
                </li>
              ))}
            </ul>
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
