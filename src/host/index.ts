import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-tools'
import { string } from 'zod'
import { createHistory, HistoryEditError, HISTORY_PATH, isTitleSequence } from '../lib/history.js'
import { titleHistoryTool } from '../lib/tool.js'

export const inject = ['connection', 'sessionQuery', 'sessionController', 'storageDomain', 'tools']

const headers = { 'Cache-Control': 'no-store' }

export async function apply(ctx: Context): Promise<void> {
  const domain = await ctx.storageDomain.open({
    name: 'session_title_history',
    version: 1,
    tables: { edits: { valueSchema: string().min(1) } },
  })
  const lifetime = new AbortController()
  ctx.effect(() => async () => {
    lifetime.abort()
    await domain.close()
  })
  const history = createHistory(ctx.sessionQuery, domain.table('edits'))
  ctx.effect(() => ctx.tools.register(titleHistoryTool({
    history,
    sessionController: ctx.sessionController,
  })), 'session-title-history: title tool')
  // Connection admits its exact Fetch routes only for the profile owner.
  ctx.effect(() => ctx.connection.fetch.register({
    path: HISTORY_PATH,
    methods: ['GET', 'POST'],
    requestBody: 'buffered',
    async fetch(request) {
      const sessionId = new URL(request.url).searchParams.get('sessionId') as SessionId | null
      if (!sessionId || sessionId !== sessionId.trim() || sessionId.includes('\0')) {
        return Response.json({ error: 'invalid-session-id' }, { status: 400, headers })
      }
      const signal = AbortSignal.any([request.signal, lifetime.signal])
      try {
        if (request.method === 'GET') {
          return Response.json({ history: await history.read(sessionId, signal), canEdit: true }, { headers })
        }
        const type = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
        if (type !== 'application/json') {
          return Response.json({ error: 'invalid-edit' }, { status: 415, headers })
        }
        const input: unknown = await request.json().catch(() => null)
        if (input === null || typeof input !== 'object' || !('seq' in input) || !isTitleSequence(input.seq)
          || !('title' in input) || typeof input.title !== 'string') {
          return Response.json({ error: 'invalid-edit' }, { status: 400, headers })
        }
        const title = await history.edit(sessionId, { seq: input.seq, title: input.title }, signal)
        return Response.json({ title }, { headers })
      } catch (error) {
        if (signal.aborted) return new Response(null, { status: 503, headers })
        if (error instanceof HistoryEditError) {
          return Response.json({ error: error.reason }, { status: error.reason === 'title-invalid' ? 400 : 404, headers })
        }
        if (typeof error === 'object' && error !== null && 'code' in error
          && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
          return Response.json({ error: 'session-not-found' }, { status: 404, headers })
        }
        return Response.json({ error: 'history-unavailable' }, { status: 500, headers })
      }
    },
  }), 'session-title-history: authenticated history route')
}
