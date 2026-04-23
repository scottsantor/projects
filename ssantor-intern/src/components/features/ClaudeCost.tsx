import { useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card'
import { Separator } from '../ui/separator'
import { Button } from '../ui/button'
import costData from '../../data/claude-cost.json'

const REFRESH_PROMPT = `refresh the claude cost tab at https://g2.stage.sqprod.co/apps/ssantor-intern.

Work in /Users/ssantor/claude/ssantor-intern/ssantor-intern. See ~/.claude/projects/-Users-ssantor/memory/project_ssantor_intern_cost_tab.md for the scanner/pricing logic. Rescan ~/.claude/projects/**/*.jsonl, bucket by ISO week (Mon start), and overwrite src/data/claude-cost.json — the schema is the CostPayload interface in src/components/features/ClaudeCost.tsx. Then run \`npm run build\` and \`appkit deploy ssantor-intern ./build\`.`

interface WeekRow {
  weekOf: string
  msgs: number
  tokens: number
  usd: number
  usdByFamily: { opus?: number; sonnet?: number; haiku?: number }
  tokensByType: { input: number; output: number; cacheCreate: number; cacheRead: number }
}

interface CostPayload {
  lastRefreshed: string
  startDate: string
  weeks: WeekRow[]
  total: {
    msgs: number
    tokens: number
    usd: number
    usdByFamily: { opus: number; sonnet: number; haiku: number }
  }
  notes: string[]
}

const data = costData as CostPayload

function fmtTokens(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function fmtUsd(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

function fmtRefreshedAt(iso: string): string {
  const then = new Date(iso)
  const diffMs = Date.now() - then.getTime()
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function ClaudeCost() {
  const maxUsd = useMemo(
    () => data.weeks.reduce((m, w) => Math.max(m, w.usd), 0),
    [],
  )

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Claude Code spend by week</CardTitle>
              <CardDescription>
                Scanned from local session logs in <code className="text-xs">~/.claude/projects/</code>
                {' '}since {data.startDate}. Last refreshed {fmtRefreshedAt(data.lastRefreshed)}
                {' '}({new Date(data.lastRefreshed).toLocaleString()}).
              </CardDescription>
            </div>
            <RefreshButton />
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
            <Stat label="Total spent" value={fmtUsd(data.total.usd)} emphasis />
            <Stat label="Messages" value={data.total.msgs.toLocaleString()} />
            <Stat label="Tokens" value={fmtTokens(data.total.tokens)} />
            <Stat
              label="By model"
              value={`O ${fmtUsd(data.total.usdByFamily.opus)} · S ${fmtUsd(
                data.total.usdByFamily.sonnet,
              )} · H ${fmtUsd(data.total.usdByFamily.haiku)}`}
              small
            />
          </div>

          <Separator className="my-3" />

          <TrendLine weeks={data.weeks} />

          <Separator className="my-3" />

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-text-secondary border-b border-border-primary">
                  <th className="py-2 pr-4 font-medium">Week of</th>
                  <th className="py-2 pr-4 font-medium text-right">USD</th>
                  <th className="py-2 pr-4 font-medium text-right">Msgs</th>
                  <th className="py-2 pr-4 font-medium text-right">Tokens</th>
                  <th className="py-2 pr-4 font-medium text-right">Opus</th>
                  <th className="py-2 pr-4 font-medium text-right">Sonnet</th>
                  <th className="py-2 pr-4 font-medium text-right">Haiku</th>
                  <th className="py-2 pl-2 font-medium w-32">Share</th>
                </tr>
              </thead>
              <tbody>
                {data.weeks.map((w) => (
                  <tr key={w.weekOf} className="border-b border-border-primary/60">
                    <td className="py-2 pr-4 font-mono text-xs">{w.weekOf}</td>
                    <td className="py-2 pr-4 text-right tabular-nums font-medium">
                      {fmtUsd(w.usd)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {w.msgs.toLocaleString()}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums">
                      {fmtTokens(w.tokens)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-text-secondary">
                      {fmtUsd(w.usdByFamily.opus ?? 0)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-text-secondary">
                      {fmtUsd(w.usdByFamily.sonnet ?? 0)}
                    </td>
                    <td className="py-2 pr-4 text-right tabular-nums text-text-secondary">
                      {fmtUsd(w.usdByFamily.haiku ?? 0)}
                    </td>
                    <td className="py-2 pl-2">
                      <div className="h-2 rounded bg-background-secondary overflow-hidden">
                        <div
                          className="h-full bg-background-inverse"
                          style={{
                            width: `${maxUsd > 0 ? (w.usd / maxUsd) * 100 : 0}%`,
                          }}
                        />
                      </div>
                    </td>
                  </tr>
                ))}
                <tr>
                  <td className="pt-3 pr-4 font-medium">Total</td>
                  <td className="pt-3 pr-4 text-right tabular-nums font-medium">
                    {fmtUsd(data.total.usd)}
                  </td>
                  <td className="pt-3 pr-4 text-right tabular-nums font-medium">
                    {data.total.msgs.toLocaleString()}
                  </td>
                  <td className="pt-3 pr-4 text-right tabular-nums font-medium">
                    {fmtTokens(data.total.tokens)}
                  </td>
                  <td className="pt-3 pr-4 text-right tabular-nums font-medium">
                    {fmtUsd(data.total.usdByFamily.opus)}
                  </td>
                  <td className="pt-3 pr-4 text-right tabular-nums font-medium">
                    {fmtUsd(data.total.usdByFamily.sonnet)}
                  </td>
                  <td className="pt-3 pr-4 text-right tabular-nums font-medium">
                    {fmtUsd(data.total.usdByFamily.haiku)}
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>

          {data.notes?.length ? (
            <ul className="mt-4 text-xs text-text-tertiary list-disc pl-5 space-y-1">
              {data.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>
    </div>
  )
}

function TrendLine({ weeks }: { weeks: WeekRow[] }) {
  if (weeks.length < 2) return null

  const W = 800
  const H = 160
  const PAD = { top: 16, right: 16, bottom: 28, left: 56 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const maxUsd = Math.max(...weeks.map((w) => w.usd), 1)
  const x = (i: number) => PAD.left + (i / (weeks.length - 1)) * innerW
  const y = (v: number) => PAD.top + innerH - (v / maxUsd) * innerH
  const points = weeks.map((w, i) => `${x(i)},${y(w.usd)}`).join(' ')

  const labelIdxs = new Set<number>([0, weeks.length - 1])
  if (weeks.length >= 5) labelIdxs.add(Math.floor(weeks.length / 2))

  return (
    <div className="w-full text-text-info">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full h-40"
        role="img"
        aria-label="Weekly Claude Code spend trend"
      >
        <text
          x={PAD.left - 6}
          y={PAD.top}
          textAnchor="end"
          dominantBaseline="middle"
          className="fill-text-tertiary text-[10px]"
        >
          {fmtUsd(maxUsd)}
        </text>
        <text
          x={PAD.left - 6}
          y={PAD.top + innerH}
          textAnchor="end"
          dominantBaseline="middle"
          className="fill-text-tertiary text-[10px]"
        >
          $0
        </text>

        <line
          x1={PAD.left}
          x2={PAD.left + innerW}
          y1={PAD.top + innerH}
          y2={PAD.top + innerH}
          className="stroke-border-primary"
          strokeWidth={1}
        />

        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {weeks.map((w, i) => (
          <circle key={w.weekOf} cx={x(i)} cy={y(w.usd)} r={3} fill="currentColor">
            <title>{`${w.weekOf}: ${fmtUsd(w.usd)}`}</title>
          </circle>
        ))}

        {weeks.map((w, i) =>
          labelIdxs.has(i) ? (
            <text
              key={w.weekOf}
              x={x(i)}
              y={H - 8}
              textAnchor={i === 0 ? 'start' : i === weeks.length - 1 ? 'end' : 'middle'}
              className="fill-text-tertiary text-[10px] font-mono"
            >
              {w.weekOf}
            </text>
          ) : null,
        )}
      </svg>
    </div>
  )
}

function RefreshButton() {
  const [status, setStatus] = useState<'idle' | 'copied' | 'error'>('idle')

  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(REFRESH_PROMPT)
      setStatus('copied')
    } catch {
      setStatus('error')
    }
    setTimeout(() => setStatus('idle'), 2500)
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" size="sm" onClick={onClick}>
        {status === 'copied'
          ? 'Copied — paste in Claude Code'
          : status === 'error'
            ? 'Copy failed'
            : 'Refresh data'}
      </Button>
      <span className="text-[11px] text-text-tertiary">
        Copies a refresh prompt for Claude Code
      </span>
    </div>
  )
}

function Stat({
  label,
  value,
  emphasis,
  small,
}: {
  label: string
  value: string
  emphasis?: boolean
  small?: boolean
}) {
  return (
    <div className="rounded border border-border-primary bg-background-secondary px-3 py-2">
      <div className="text-xs text-text-tertiary uppercase tracking-wide">{label}</div>
      <div
        className={
          emphasis
            ? 'text-2xl font-semibold tabular-nums'
            : small
              ? 'text-xs font-medium mt-1'
              : 'text-xl font-medium tabular-nums'
        }
      >
        {value}
      </div>
    </div>
  )
}
