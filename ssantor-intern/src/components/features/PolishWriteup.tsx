import { useEffect, useRef, useState } from 'react'
import { Sparkles, Copy, Check } from 'lucide-react'
import { Button } from '../ui/button'
import { Card, CardContent } from '../ui/card'
import { Textarea } from '../ui/textarea'
import { useLlm } from '../../hooks/useLlm'

const SYSTEM_PROMPT = `You are a writing assistant that polishes drafts for Scott Santor (a data/analytics lead at Block). Your job is to rewrite his draft so it keeps his voice but reads tighter, cleaner, and more deliberate.

SCOTT'S VOICE — match these patterns:
- Warm, collaborative openings when appropriate ("Hey", "Hi [name]", "Heads up", "FYI", "Quick update"). Not stiff or corporate.
- Business-professional but conversational. Uses contractions (I'm, I'll, won't, we'll).
- Action-oriented and forward-looking. Defaults to "here's what we're doing next" over "here's what went wrong." Moves past friction rather than relitigating it.
- Clear asks with brief rationale. Prefers "Can you X? That way we can Y" over vague requests.
- Empathetic and appreciative without being saccharine. ("Thanks for...", "Appreciate the context", "Hope the week's going well"). Acknowledges others' perspective before redirecting ("I hear you", "I get where you're coming from", "Totally fair").
- Humble hedging where appropriate: "I think", "my understanding is", "IMO", "at first glance". Not falsely certain, not falsely apologetic.
- Specific and grounded. Keeps the concrete details the draft already contains (names, numbers, dates, ticket links, queue names, table names). Does not strip them.
- Bulleted summaries when listing multiple items or decisions. Short TLDRs up top when the message is longer than a few sentences.
- Prefers recommending over mandating: "I'd recommend", "I think we should", "Worth considering".
- Signs off lightly when it fits ("Thanks!", "Enjoy the weekend!", "Happy to jump on a call if it helps"). Skip the sign-off in short threaded replies.

AVOID:
- Dwelling on past mistakes, blame, or what didn't work. If the draft retreads a failed attempt, compress it to one sentence of context and pivot to the forward path.
- Apologetic filler ("Sorry to bother you", "I hate to ask but").
- Corporate stiffness ("Per our previous discussion", "Kindly advise", "Please be advised").
- Hype language, exclamation-point spam, or emoji unless the draft already uses one.
- Rewording that loses specifics — keep every concrete fact, name, link, and number from the draft.
- Making it longer than it needs to be. If the draft is wordy, tighten it.

ALSO:
- Fix grammar, spelling, punctuation, and awkward phrasing.
- Use standard business formatting: paragraph breaks for logical chunks, bullet lists for 3+ items, consistent capitalization, proper sentence punctuation.
- Preserve the draft's original intent and audience. If it's a Slack message, keep it Slack-y; if it's an email, keep it email-shaped; if it's a doc excerpt, keep it doc-shaped.

OUTPUT FORMAT:
Return ONLY the polished text. No preamble, no "Here's the polished version:", no explanation, no markdown code fences. Just the rewrite, ready to paste.`

function AutoGrowTextarea(props: React.ComponentProps<typeof Textarea>) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.max(el.scrollHeight, 160)}px`
  }, [props.value])
  return (
    <Textarea
      {...props}
      ref={ref}
      style={{ overflow: 'hidden', ...props.style }}
    />
  )
}

export function PolishWriteup() {
  const { complete, isLoading, error } = useLlm()
  const [draft, setDraft] = useState('')
  const [polished, setPolished] = useState('')
  const [copied, setCopied] = useState(false)

  const handlePolish = async () => {
    const text = draft.trim()
    if (!text) return
    setPolished('')
    try {
      const result = await complete(text, { systemPrompt: SYSTEM_PROMPT })
      setPolished(result.trim())
    } catch {
      // error surfaced by hook
    }
  }

  const handleCopy = async () => {
    if (!polished) return
    await navigator.clipboard.writeText(polished)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Polish Writeup</h2>
        <p className="text-sm text-text-secondary">
          Paste a draft and I'll polish it in your voice — warm, forward-looking,
          business-professional, action-oriented. Grammar, format, and flow cleaned up too.
        </p>
      </div>

      {error && (
        <div className="rounded-md border border-border-primary bg-background-secondary px-3 py-2 text-sm text-text-danger">
          {error.message}
        </div>
      )}

      <Card>
        <CardContent className="flex flex-col gap-3 py-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Draft</span>
            <span className="text-[11px] text-text-tertiary">
              {draft.length} char{draft.length === 1 ? '' : 's'}
            </span>
          </div>
          <AutoGrowTextarea
            placeholder="Paste your draft here — Slack message, email, doc excerpt, whatever…"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={isLoading}
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-text-tertiary">
              {isLoading ? 'Polishing…' : ''}
            </span>
            <Button onClick={handlePolish} disabled={isLoading || !draft.trim()}>
              <Sparkles className="h-4 w-4" />
              {isLoading ? 'Polishing…' : 'Polish'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {polished && (
        <Card>
          <CardContent className="flex flex-col gap-3 py-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold">Polished</span>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCopy}
                disabled={!polished}
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    Copy
                  </>
                )}
              </Button>
            </div>
            <div className="whitespace-pre-wrap rounded-md border border-border-primary bg-background-secondary px-3 py-2 text-sm text-text-primary">
              {polished}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
