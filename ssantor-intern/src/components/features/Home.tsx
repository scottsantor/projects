import { Ticket, ListTodo, NotebookPen, Sparkles, Pencil, DollarSign, Link as LinkIcon } from 'lucide-react'
import { Card, CardContent } from '../ui/card'

interface HomeProps {
  onNavigate: (tab: string) => void
}

interface Tile {
  id: string
  icon: React.ComponentType<{ className?: string }>
  title: string
  prompt: string
  blurb: string
}

const TILES: Tile[] = [
  {
    id: 'create',
    icon: Ticket,
    title: 'Create Ticket',
    prompt: 'Do I want to create a ticket?',
    blurb: 'File a CUSTDS ticket into Linear.',
  },
  {
    id: 'mine',
    icon: ListTodo,
    title: 'To-Do',
    prompt: 'Do I want to look at my to-dos?',
    blurb: 'Linear tickets assigned to me, plus my todos.',
  },
  {
    id: 'notepad',
    icon: NotebookPen,
    title: 'Meeting Notes',
    prompt: 'Do I want to do meeting notes?',
    blurb: 'Running log of meeting notes across days.',
  },
  {
    id: 'polish',
    icon: Sparkles,
    title: 'Polish Writeup',
    prompt: 'Do I want to polish a writeup?',
    blurb: 'Rewrite a draft in my voice — tight, forward-looking, clean.',
  },
  {
    id: 'cost',
    icon: DollarSign,
    title: 'Claude Cost',
    prompt: 'Do I want to look at my cloud costs?',
    blurb: 'How much I\'m spending on Claude sessions.',
  },
  {
    id: 'links',
    icon: LinkIcon,
    title: 'Links',
    prompt: 'Do I want my quick links?',
    blurb: 'Jump to dashboards, docs, and go/ links.',
  },
  {
    id: 'scratch',
    icon: Pencil,
    title: 'Scratch',
    prompt: 'Do I want a scratch pad?',
    blurb: 'Open pad for typing, pasting, and copying back out.',
  },
]

export function Home({ onNavigate }: HomeProps) {
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-lg font-semibold">What do you want to do?</h2>
        <p className="text-sm text-text-secondary">
          Pick one to jump in — or use the tabs at the top anytime.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {TILES.map((t) => {
          const Icon = t.icon
          return (
            <Card
              key={t.id}
              onClick={() => onNavigate(t.id)}
              className="cursor-pointer transition hover:border-border-secondary hover:shadow-md"
            >
              <CardContent className="flex items-start gap-3 py-4">
                <div className="mt-[2px] text-text-secondary">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="flex flex-col gap-1">
                  <div className="text-sm font-semibold text-text-primary">
                    {t.prompt}
                  </div>
                  <div className="text-xs text-text-secondary">{t.blurb}</div>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
