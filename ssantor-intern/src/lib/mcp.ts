/**
 * MCP Tool Client - Invoke MCP tools through the G2 postMessage bridge.
 *
 * Protocol: cloudflare-mcp-tool-call / cloudflare-mcp-tool-call-response
 * G2 routes these to kgoose POST /v1/apps/tools/call with the app's STS token.
 *
 * Based on the reference implementation in g2-apps/query-expert-hybrid-dashboard.
 */

export interface McpToolCallRequest {
  type: 'cloudflare-mcp-tool-call'
  requestId: string
  extension: string
  tool: string
  args: Record<string, unknown>
}

export interface McpToolCallResponse {
  type: 'cloudflare-mcp-tool-call-response'
  requestId: string
  success: boolean
  error?: string
  result?: unknown
}

const pendingRequests = new Map<
  string,
  { resolve: (result: unknown) => void; reject: (error: Error) => void }
>()

/**
 * Unwrap the MCP tool call response envelope from kgoose.
 *
 * Kgoose wraps results in: { success, data: { is_error, structured_content_json, content } }
 * The actual tool result is in structured_content_json (a JSON string) or
 * content[].structured_content.data.
 */
function unwrapMcpResult(raw: unknown): unknown {
  if (!raw || typeof raw !== 'object') return raw

  const outer = raw as Record<string, unknown>

  // Unwrap { success, data: { ... } } envelope from kgoose
  const data = (outer.data ?? outer) as Record<string, unknown>

  // Check for MCP error
  if (data.is_error === true) {
    const errorText = (data.content as Array<Record<string, unknown>>)?.[0]
      ?.text as Record<string, unknown> | undefined
    throw new Error(String(errorText?.text ?? 'MCP tool returned an error'))
  }

  // Prefer structured_content_json (parsed)
  if (typeof data.structured_content_json === 'string') {
    try {
      return JSON.parse(data.structured_content_json)
    } catch {
      // fall through
    }
  }

  // Fallback: content[].structured_content.data
  if (Array.isArray(data.content)) {
    for (const item of data.content as Array<Record<string, unknown>>) {
      const sc = item.structured_content as Record<string, unknown> | undefined
      if (sc?.data) return sc.data
    }
    // Fallback: content[].text.text (plain text result)
    for (const item of data.content as Array<Record<string, unknown>>) {
      const text = item.text as Record<string, unknown> | undefined
      if (text?.text) return { result: String(text.text) }
    }
  }

  return raw
}

// Known G2 origins — used to validate inbound messages and target outbound postMessage.
const KNOWN_G2_ORIGINS = [
  /^https:\/\/g2\.(stage\.)?sqprod\.co$/,
  /^http:\/\/localhost:\d+$/,
]

function isKnownG2Origin(origin: string): boolean {
  return KNOWN_G2_ORIGINS.some((pattern) => pattern.test(origin))
}

// Resolve the G2 parent origin at init time so outbound postMessage is targeted.
let g2ParentOrigin: string | null = null

function resolveG2Origin(): string | null {
  if (typeof window === 'undefined') return null
  // ancestorOrigins is the most reliable source (Chromium-based browsers)
  if (window.location.ancestorOrigins?.length > 0) {
    try {
      const origin = new URL(window.location.ancestorOrigins[0]).origin
      if (isKnownG2Origin(origin)) return origin
    } catch {
      // fall through
    }
  }
  // Fallback: document.referrer is set when the iframe loads
  if (document.referrer) {
    try {
      const origin = new URL(document.referrer).origin
      if (isKnownG2Origin(origin)) return origin
    } catch {
      // fall through
    }
  }
  return null
}

if (typeof window !== 'undefined') {
  g2ParentOrigin = resolveG2Origin()

  window.addEventListener('message', (event) => {
    if (g2ParentOrigin) {
      if (event.origin !== g2ParentOrigin) return
    } else {
      if (!isKnownG2Origin(event.origin)) return
    }
    if (event.data?.type === 'cloudflare-mcp-tool-call-response') {
      const response = event.data as McpToolCallResponse
      const pending = pendingRequests.get(response.requestId)

      if (pending) {
        pendingRequests.delete(response.requestId)
        if (response.success) {
          try {
            pending.resolve(unwrapMcpResult(response.result))
          } catch (err) {
            pending.reject(err instanceof Error ? err : new Error(String(err)))
          }
        } else {
          pending.reject(new Error(response.error || 'MCP tool call failed'))
        }
      }
    }
  })
}

/**
 * Invoke an MCP tool through the G2 bridge.
 *
 * @param toolName - Tool in "extension/tool" format, e.g. "query-expert/check_permissions"
 * @param params - Arguments for the tool
 * @param options - Timeout configuration
 */
export async function invoke<T = unknown>(
  toolName: string,
  params: Record<string, unknown>,
  options?: { title?: string; description?: string; timeoutMs?: number },
): Promise<T> {
  const requestId = crypto.randomUUID()
  const timeoutMs = options?.timeoutMs ?? 60000

  // Split "extension/tool" into separate fields
  const slashIndex = toolName.indexOf('/')
  if (slashIndex === -1) {
    throw new Error(`Invalid tool name "${toolName}" — expected "extension/tool" format`)
  }
  const extension = toolName.slice(0, slashIndex)
  const tool = toolName.slice(slashIndex + 1)

  return new Promise<T>((resolve, reject) => {
    pendingRequests.set(requestId, {
      resolve: resolve as (result: unknown) => void,
      reject,
    })

    const message: McpToolCallRequest = {
      type: 'cloudflare-mcp-tool-call',
      requestId,
      extension,
      tool,
      args: params,
    }

    if (!g2ParentOrigin) {
      pendingRequests.delete(requestId)
      reject(new Error('Cannot send MCP tool call: G2 parent origin not resolved'))
      return
    }
    window.parent.postMessage(message, g2ParentOrigin)

    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId)
        reject(new Error('MCP tool call timed out'))
      }
    }, timeoutMs)
  })
}
