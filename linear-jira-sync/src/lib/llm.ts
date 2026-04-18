/**
 * Standalone LLM completion function for use outside React components.
 * Uses the G2 parent postMessage bridge.
 */

const G2_ORIGIN_RE = /^https:\/\/g2\.(stage\.)?sqprod\.co$/

let g2ParentOrigin: string | null = null

const pendingRequests = new Map<string, {
  resolve: (content: string) => void
  reject: (error: Error) => void
}>()

if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    if (!G2_ORIGIN_RE.test(event.origin)) return
    if (!g2ParentOrigin) g2ParentOrigin = event.origin
    if (event.data?.type === 'cloudflare-llm-response') {
      const { requestId, success, content, error } = event.data
      const pending = pendingRequests.get(requestId)
      if (pending) {
        pendingRequests.delete(requestId)
        if (success) {
          pending.resolve(content)
        } else {
          pending.reject(new Error(error || 'LLM request failed'))
        }
      }
    }
  })
}

export async function llmComplete(prompt: string, systemPrompt?: string): Promise<string> {
  const requestId = crypto.randomUUID()

  return new Promise<string>((resolve, reject) => {
    pendingRequests.set(requestId, { resolve, reject })

    window.parent.postMessage({
      type: 'cloudflare-llm-request',
      requestId,
      messages: [{ role: 'user', content: prompt }],
      systemPrompt,
      serviceProfile: 'kgoose-claude-sonnet-4-6',
    }, g2ParentOrigin ?? 'https://g2.sqprod.co')

    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId)
        reject(new Error('LLM request timed out'))
      }
    }, 60000)
  })
}
