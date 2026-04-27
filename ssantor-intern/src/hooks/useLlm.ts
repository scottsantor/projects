import { useCallback, useState } from 'react'

interface LlmOptions {
  systemPrompt?: string
  jsonSchema?: object
  extensions?: string[]
}

interface UseLlmResult {
  complete: (prompt: string, options?: LlmOptions) => Promise<string>
  isLoading: boolean
  error: Error | null
}

const pendingRequests = new Map<
  string,
  { resolve: (content: string) => void; reject: (error: Error) => void }
>()

if (typeof window !== 'undefined') {
  window.addEventListener('message', (event) => {
    if (event.data?.type === 'cloudflare-llm-response') {
      const { requestId, success, content, error } = event.data
      const pending = pendingRequests.get(requestId)
      if (pending) {
        pendingRequests.delete(requestId)
        if (success) pending.resolve(content)
        else pending.reject(new Error(error || 'LLM request failed'))
      }
    }
  })
}

export function useLlm(): UseLlmResult {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<Error | null>(null)

  const complete = useCallback(
    async (prompt: string, options?: LlmOptions): Promise<string> => {
      setIsLoading(true)
      setError(null)

      const requestId = crypto.randomUUID()

      try {
        const result = await new Promise<string>((resolve, reject) => {
          pendingRequests.set(requestId, { resolve, reject })

          window.parent.postMessage(
            {
              type: 'cloudflare-llm-request',
              requestId,
              messages: [{ role: 'user', content: prompt }],
              systemPrompt: options?.systemPrompt,
              jsonSchema: options?.jsonSchema,
              extensions: options?.extensions,
            },
            '*'
          )

          setTimeout(() => {
            if (pendingRequests.has(requestId)) {
              pendingRequests.delete(requestId)
              reject(new Error('LLM request timed out'))
            }
          }, 300000)
        })

        return result
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err))
        setError(e)
        throw e
      } finally {
        setIsLoading(false)
      }
    },
    []
  )

  return { complete, isLoading, error }
}
