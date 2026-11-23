import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type { SessionTitleSource } from '@deepseek-ai/dsh-session-title'
import type { JsonSchemaNode, ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { groupTitleHistory, titleHistory } from './history.js'
import type { TitleHistoryGroup } from './history.js'

export const TOOL_NAME = 'session_title_history'

/** The most title changes one `list` result carries; the rest are counted in `omitted`. */
export const LIST_LIMIT = 50

/** The Host services the tool needs, as structural picks so tests supply plain objects. */
export interface TitleHistoryToolServices {
  readonly sessionQuery: Pick<Context['sessionQuery'], 'observeSession'>
  /** The same Host method the session menu's rename reaches through the Remote entry. */
  readonly sessionController: Pick<Context['sessionController'], 'rename'>
}

/** One title change in a `list` result; same-text writes that followed it are counted, not listed. */
export interface TitleEntry {
  readonly title: string
  readonly seq: number
  readonly time: number
  readonly source: SessionTitleSource['kind']
  readonly inherited: boolean
  /** Later writes that kept this title. */
  readonly repeats: number
}

/** A refused call: the reason names the outcome and the message tells the model what to do next. */
export interface ToolFailure {
  readonly ok: false
  readonly reason: string
  readonly message: string
  /** The Host's stable failure code when a rename was refused. */
  readonly code?: string
}

/** The canonical tool value: one explicit outcome per call. */
export type ToolValue =
  | {
    readonly ok: true
    readonly action: 'list'
    readonly sessionId: string
    readonly current: string | null
    readonly titles: readonly TitleEntry[]
    readonly omitted: number
  }
  | {
    readonly ok: true
    readonly action: 'restore'
    readonly sessionId: string
    readonly previousTitle: string
    readonly title: string
    readonly seq: number
  }
  | ToolFailure

type ToolArgs =
  | { readonly action: 'list'; readonly sessionId?: string }
  | { readonly action: 'restore'; readonly title: string; readonly sessionId?: string }

type ParsedArgs = { readonly args: ToolArgs } | { readonly failure: ToolFailure }

const failure = (reason: string, message: string, code?: string): ToolFailure =>
  code === undefined ? { ok: false, reason, message } : { ok: false, reason, message, code }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

/** Validate the model's arguments before any Host work; the schema alone cannot express the action rules. */
export function parseArgs(value: unknown): ParsedArgs {
  if (!isRecord(value)) return { failure: failure('invalid-arguments', 'Arguments must be an object.') }
  const { action, title } = value
  let sessionId: string | undefined
  if (value.sessionId !== undefined) {
    if (typeof value.sessionId !== 'string' || value.sessionId.trim() === '') {
      return { failure: failure('invalid-arguments', 'sessionId must be a non-empty string when given.') }
    }
    sessionId = value.sessionId
  }
  if (action === 'list') return { args: { action, sessionId } }
  if (action !== 'restore') return { failure: failure('invalid-arguments', 'action must be "list" or "restore".') }
  if (typeof title !== 'string' || title.trim() === '') {
    return { failure: failure('invalid-arguments', 'restore needs title: the exact text of a past title from action "list".') }
  }
  return { args: { action, title, sessionId } }
}

type TitleGroups = readonly TitleHistoryGroup[]

/** Read one Session's accepted title writes through the same fold the history dialog reads. */
async function readHistory(services: TitleHistoryToolServices, sessionId: string, signal: AbortSignal): Promise<
  { readonly groups: TitleGroups } | { readonly failure: ToolFailure }
> {
  try {
    const observed = await services.sessionQuery.observeSession(sessionId as SessionId, { signal, projectionMode: 'none' })
    try {
      signal.throwIfAborted()
      return { groups: groupTitleHistory(titleHistory(observed.events, observed.inheritedEventCount)) }
    } finally {
      observed[Symbol.dispose]()
    }
  } catch (error) {
    // Cancellation belongs to the executor's canonical aborted result.
    if (signal.aborted) throw error
    const missing = isRecord(error) && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND'
    return {
      failure: missing
        ? failure('session-not-found', `Session ${sessionId} was not found.`)
        : failure('history-unavailable', `Could not read the title history of session ${sessionId}.`),
    }
  }
}

const entryOf = ({ revision, unchanged }: TitleHistoryGroup): TitleEntry => ({
  title: revision.title,
  seq: revision.seq,
  time: revision.time,
  source: revision.source.kind,
  inherited: revision.inherited,
  repeats: unchanged.length,
})

const isEntry = (value: unknown): value is TitleEntry =>
  isRecord(value) && typeof value.title === 'string' && typeof value.seq === 'number'

const sourceLabel = (entry: TitleEntry): string =>
  entry.source === 'user' ? 'manual edit' : entry.source === 'provider' ? 'automatically generated' : 'built-in rule'

/** Model-facing text for one canonical value. */
export function render(_args: unknown, value: unknown): { type: 'text'; text: string }[] {
  if (!isRecord(value) || value.ok !== true) {
    const message = isRecord(value) && typeof value.message === 'string' ? value.message : 'The call returned no result.'
    const code = isRecord(value) && typeof value.code === 'string' ? ` (${value.code})` : ''
    return [{ type: 'text', text: `${message}${code}` }]
  }
  if (value.action === 'restore') {
    return [{ type: 'text', text: `Session title restored to “${String(value.title)}”; it was “${String(value.previousTitle)}”.` }]
  }
  const entries = Array.isArray(value.titles) ? value.titles.filter(isEntry) : []
  if (entries.length === 0) return [{ type: 'text', text: `Session ${String(value.sessionId)} has no title history.` }]
  const lines = entries.map((entry, index) => {
    const notes = [index === 0 ? 'current' : sourceLabel(entry)]
    if (entry.inherited) notes.push('inherited from the parent session')
    if (entry.repeats > 0) notes.push(`written ${entry.repeats + 1} times`)
    return `${index + 1}. “${String(entry.title)}” — ${notes.join(', ')}`
  })
  const omitted = typeof value.omitted === 'number' && value.omitted > 0 ? `\n${value.omitted} older titles not shown.` : ''
  return [{ type: 'text', text: `Title history of session ${String(value.sessionId)}, newest first:\n${lines.join('\n')}${omitted}` }]
}

const entrySchema: JsonSchemaNode = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'seq', 'time', 'source', 'inherited', 'repeats'],
  properties: {
    title: { type: 'string' },
    seq: { type: 'integer' },
    time: { type: 'integer' },
    source: { type: 'string', enum: ['user', 'provider', 'fallback'] },
    inherited: { type: 'boolean' },
    repeats: { type: 'integer' },
  },
}

/**
 * Build the `session_title_history` tool over the given Host services.
 * The history dialog's restore button and this tool both end in `sessionController.rename`, so the two
 * callers share one rename implementation: normalization, pinning against regeneration, and the log record.
 */
export function titleHistoryTool(services: TitleHistoryToolServices): ToolDefinition {
  return {
    name: TOOL_NAME,
    description: [
      'A session’s title history: every title it had, newest first, and a way to make a past title the current one again.',
      'Restoring re-applies the title exactly as the session menu’s Title history does, and records a manual edit.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'restore'],
          description: '`list` returns the history; `restore` makes `title` the current title.',
        },
        title: {
          type: 'string',
          description: '`restore` only: the exact text of a past title from `list`.',
        },
        sessionId: {
          type: 'string',
          description: 'Session to act on. Defaults to the current session.',
        },
      },
    },
    output: {
      schema: {
        oneOf: [
          {
            type: 'object',
            additionalProperties: false,
            required: ['ok', 'action', 'sessionId', 'current', 'titles', 'omitted'],
            properties: {
              ok: { type: 'boolean', const: true },
              action: { type: 'string', const: 'list' },
              sessionId: { type: 'string' },
              current: { oneOf: [{ type: 'string' }, { type: 'null' }] },
              titles: { type: 'array', items: entrySchema },
              omitted: { type: 'integer' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['ok', 'action', 'sessionId', 'previousTitle', 'title', 'seq'],
            properties: {
              ok: { type: 'boolean', const: true },
              action: { type: 'string', const: 'restore' },
              sessionId: { type: 'string' },
              previousTitle: { type: 'string' },
              title: { type: 'string' },
              seq: { type: 'integer' },
            },
          },
          {
            type: 'object',
            additionalProperties: false,
            required: ['ok', 'reason', 'message'],
            properties: {
              ok: { type: 'boolean', const: false },
              reason: { type: 'string' },
              message: { type: 'string' },
              code: { type: 'string' },
            },
          },
        ],
      },
      render,
    },
    presentCall(args: unknown) {
      const parsed = parseArgs(args)
      if ('failure' in parsed) return undefined
      return parsed.args.action === 'restore'
        ? { card: 'generic', title: 'Restore session title', kind: 'edit', rawInput: parsed.args.title }
        : { card: 'generic', title: 'Session title history', kind: 'read' }
    },
    async execute(args: unknown, exec: ToolRunContext): Promise<ToolValue> {
      const parsed = parseArgs(args)
      if ('failure' in parsed) return parsed.failure
      const { action, sessionId: given } = parsed.args
      const target = given ?? exec.agent?.session.header.id
      if (target === undefined) {
        return failure('no-session', 'No session to act on: pass sessionId when calling outside a session.')
      }
      const history = await readHistory(services, target, exec.signal)
      if ('failure' in history) return history.failure
      const { groups } = history
      if (action === 'list') {
        return {
          ok: true,
          action,
          sessionId: target,
          current: groups[0]?.revision.title ?? null,
          titles: groups.slice(0, LIST_LIMIT).map(entryOf),
          omitted: Math.max(0, groups.length - LIST_LIMIT),
        }
      }
      const wanted = parsed.args.title.trim()
      const group = groups.find(({ revision }) => revision.title === wanted)
      if (group === undefined) {
        return failure('unknown-title', `“${wanted}” is not a title this session had. Use action "list" to see its titles.`)
      }
      if (group === groups[0]) return failure('already-current', `“${wanted}” is already the current title.`)
      try {
        const accepted = await services.sessionController.rename({ sessionId: target as SessionId, title: group.revision.title })
        return {
          ok: true,
          action,
          sessionId: target,
          previousTitle: groups[0].revision.title,
          title: accepted.title,
          seq: accepted.seq,
        }
      } catch (error) {
        if (exec.signal.aborted) throw error
        const code = isRecord(error) && typeof error.code === 'string' ? error.code : undefined
        const message = error instanceof Error ? error.message : String(error)
        return failure('rename-refused', `The title was not changed: ${message}`, code)
      }
    },
  }
}

