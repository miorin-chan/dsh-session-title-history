import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import { HISTORY_PATH, titleHistory } from '../lib/history.js'

export const inject = ['connection', 'sessionQuery']

const headers = { 'Cache-Control': 'no-store' }

export function apply(ctx: Context): void {
  const lifetime = new AbortController()
  ctx.effect(() => () => lifetime.abort())
  ctx.effect(() => ctx.connection.fetch.register({
    path: HISTORY_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    async fetch(request) {
      const sessionId = new URL(request.url).searchParams.get('sessionId')
      if (!sessionId || sessionId !== sessionId.trim() || sessionId.includes('\0')) {
        return Response.json({ error: 'invalid-session-id' }, { status: 400, headers })
      }
      const signal = AbortSignal.any([request.signal, lifetime.signal])
      try {
        const observed = await ctx.sessionQuery.observeSession(sessionId as SessionId, { signal, projectionMode: 'none' })
        try {
          signal.throwIfAborted()
          return Response.json({ history: titleHistory(observed.events, observed.inheritedEventCount) }, { headers })
        } finally {
          observed[Symbol.dispose]()
        }
      } catch (error) {
        if (signal.aborted) return new Response(null, { status: 503, headers })
        if (typeof error === 'object' && error !== null && 'code' in error
          && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
          return Response.json({ error: 'session-not-found' }, { status: 404, headers })
        }
        return Response.json({ error: 'history-unavailable' }, { status: 500, headers })
      }
    },
  }), 'session-title-history: authenticated history route')
}
