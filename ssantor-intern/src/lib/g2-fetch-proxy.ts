/**
 * G2 Fetch Proxy - Transparent fetch interception for G2-hosted apps.
 *
 * This module intercepts all fetch() calls and routes them appropriately:
 * - Same-origin requests → direct fetch (to the app's Cloudflare backend)
 * - External API requests → proxied through G2 parent window
 *
 * This is initialized automatically - app developers just use fetch() normally.
 */

interface G2FetchRequest {
  type: 'cloudflare-fetch-request'
  requestId: string
  url: string
  method: string
  headers?: Record<string, string>
  body?: string
}

interface G2FetchResponse {
  type: 'cloudflare-fetch-response'
  requestId: string
  ok: boolean
  status?: number
  headers?: Record<string, string>
  body?: string
  error?: string
}

interface G2UserInfo {
  ldap: string
  email: string
  name?: string
}

// Cached user identity received from G2 parent via postMessage
let cachedUserInfo: G2UserInfo | null = null

// Track pending requests
const pendingRequests = new Map<
  string,
  { resolve: (r: Response) => void; reject: (e: Error) => void }
>()

// Original fetch reference
let originalFetch: typeof fetch | null = null

// Whether proxy is initialized
let initialized = false

// The expected G2 parent origin, resolved at init time.
// Used to target postMessage and validate response origins.
let g2ParentOrigin: string | null = null

// Known G2 origins — used to validate resolved origin and as fallback.
// If the resolved origin doesn't match, we fail closed (refuse to proxy).
const KNOWN_G2_ORIGINS = [
  /^https:\/\/g2\.(stage\.)?sqprod\.co$/,
  /^http:\/\/localhost:\d+$/,
]

function isKnownG2Origin(origin: string): boolean {
  return KNOWN_G2_ORIGINS.some((pattern) => pattern.test(origin))
}

function resolveG2Origin(): string | null {
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

/**
 * Handle response messages from G2 parent.
 */
function handleMessage(event: MessageEvent): void {
  // Validate origin — only accept responses from known G2 origins.
  // If g2ParentOrigin was resolved, check exact match.
  // If not resolved, check against the known origins allowlist.
  if (g2ParentOrigin) {
    if (event.origin !== g2ParentOrigin) return
  } else {
    if (!isKnownG2Origin(event.origin)) return
  }

  // Handle user info from G2 parent
  if (
    event.data?.type === 'cloudflare-user-info' &&
    event.data.user &&
    typeof event.data.user.ldap === 'string' &&
    typeof event.data.user.email === 'string'
  ) {
    cachedUserInfo = {
      ldap: event.data.user.ldap,
      email: event.data.user.email,
      name: typeof event.data.user.name === 'string' ? event.data.user.name : undefined,
    }
    return
  }

  const data = event.data as G2FetchResponse
  if (data?.type !== 'cloudflare-fetch-response') return

  const pending = pendingRequests.get(data.requestId)
  if (!pending) return

  pendingRequests.delete(data.requestId)

  if (data.error) {
    pending.reject(new Error(data.error))
    return
  }

  // Reconstruct Response object
  const headers = new Headers(data.headers)
  const response = new Response(data.body, {
    status: data.status ?? 200,
    headers,
  })

  // Add ok property based on status
  Object.defineProperty(response, 'ok', {
    value: data.ok,
    writable: false,
  })

  pending.resolve(response)
}

/**
 * Proxy a fetch request through G2 parent.
 */
async function proxyFetch(url: string, init?: RequestInit): Promise<Response> {
  const requestId = crypto.randomUUID()

  // Extract headers as plain object
  const headers: Record<string, string> = {}
  if (init?.headers) {
    if (init.headers instanceof Headers) {
      init.headers.forEach((value, key) => {
        headers[key] = value
      })
    } else if (Array.isArray(init.headers)) {
      for (const [key, value] of init.headers) {
        headers[key] = value
      }
    } else {
      Object.assign(headers, init.headers)
    }
  }

  // Get body as string
  let body: string | undefined
  if (init?.body) {
    if (typeof init.body === 'string') {
      body = init.body
    } else if (init.body instanceof URLSearchParams) {
      body = init.body.toString()
    } else if (init.body instanceof FormData) {
      // FormData needs special handling - convert to JSON if possible
      const obj: Record<string, string> = {}
      init.body.forEach((value, key) => {
        if (typeof value === 'string') {
          obj[key] = value
        }
      })
      body = JSON.stringify(obj)
      headers['Content-Type'] = 'application/json'
    } else {
      body = String(init.body)
    }
  }

  return new Promise((resolve, reject) => {
    if (!g2ParentOrigin) {
      reject(new Error('G2 parent origin not resolved — cannot proxy request'))
      return
    }

    pendingRequests.set(requestId, { resolve, reject })

    const message: G2FetchRequest = {
      type: 'cloudflare-fetch-request',
      requestId,
      url,
      method: init?.method ?? 'GET',
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body,
    }

    window.parent.postMessage(message, g2ParentOrigin)

    // Timeout after 60 seconds
    setTimeout(() => {
      if (pendingRequests.has(requestId)) {
        pendingRequests.delete(requestId)
        reject(new Error('Proxy request timed out'))
      }
    }, 60000)
  })
}

/**
 * Intercepted fetch that routes requests appropriately.
 */
async function interceptedFetch(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  if (!originalFetch) {
    throw new Error('G2 fetch proxy not initialized')
  }

  // Get the URL string
  let url: string
  if (typeof input === 'string') {
    url = input
  } else if (input instanceof URL) {
    url = input.href
  } else {
    url = input.url
  }

  // Parse URL to check origin
  const parsedUrl = new URL(url, window.location.origin)
  const ownOrigin = window.location.origin

  // Same-origin requests go direct — inject identity header if available
  if (parsedUrl.origin === ownOrigin) {
    if (cachedUserInfo?.ldap) {
      const existingHeaders = init?.headers ?? (input instanceof Request ? input.headers : undefined)
      const headers = new Headers(existingHeaders)
      headers.set('X-G2-User', cachedUserInfo.ldap)
      return originalFetch(input, { ...init, headers })
    }
    return originalFetch(input, init)
  }

  // External requests get proxied through G2
  return proxyFetch(parsedUrl.href, init)
}

/**
 * Initialize the G2 fetch proxy.
 *
 * This is called automatically when the app loads. After initialization,
 * all external fetch() calls will be proxied through G2.
 */
export function initG2FetchProxy(): void {
  if (initialized) {
    return
  }

  // Only initialize if we're in an iframe (hosted in G2)
  if (window.parent === window) {
    // Not in an iframe - running standalone, skip proxy
    return
  }

  // Resolve the G2 parent origin before any messaging — must happen before
  // the message listener and fetch swap to avoid race conditions.
  g2ParentOrigin = resolveG2Origin()

  // Save original fetch
  originalFetch = window.fetch.bind(window)

  // Replace global fetch
  window.fetch = interceptedFetch

  // Listen for responses from parent
  window.addEventListener('message', handleMessage)

  initialized = true

  // Send per-app STS config to G2 for proactive OAuth consent.
  // Scopes are injected at deploy time via __STS_SCOPES__ meta tag.
  // Falls back to VITE_STS_SCOPES for apps that haven't migrated yet.
  const stsClientId = document.querySelector<HTMLMetaElement>('meta[name="sts-client-id"]')?.content
  const stsScopesMeta = document.querySelector<HTMLMetaElement>('meta[name="sts-scopes"]')?.content
  const stsScopes = (stsScopesMeta && stsScopesMeta !== '__STS_SCOPES__')
    ? stsScopesMeta
    : (import.meta as Record<string, Record<string, string>>).env?.VITE_STS_SCOPES ?? ''
  if (g2ParentOrigin && stsClientId && stsClientId !== '__STS_CLIENT_ID__') {
    window.parent.postMessage({
      type: 'cloudflare-sts-config',
      clientId: stsClientId,
      scopes: stsScopes ? stsScopes.split(',') : [],
    }, g2ParentOrigin)
  }

  // Send display name to G2 shell for browser tab title
  const displayName = (import.meta as Record<string, Record<string, string>>).env?.VITE_APP_DISPLAY_NAME
  if (g2ParentOrigin && displayName) {
    window.parent.postMessage({ type: 'cloudflare-app-title', title: displayName }, g2ParentOrigin)
  }

  // Trigger first contact so G2 sends cloudflare-user-info
  if (g2ParentOrigin) {
    window.parent.postMessage({ type: 'cloudflare-init' }, g2ParentOrigin)
  }
}

/**
 * Get the cached G2 user info, if available.
 * Returns null if user info hasn't been received yet.
 */
export function getG2UserInfo(): G2UserInfo | null {
  return cachedUserInfo
}

/**
 * Check if we're running inside G2.
 */
export function isInG2(): boolean {
  return window.parent !== window
}
