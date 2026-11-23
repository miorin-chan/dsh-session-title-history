import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionTitleSource } from '@deepseek-ai/dsh-session-title'
import type { JsonSchemaNode, ToolDefinition, ToolRunContext } from '@deepseek-ai/dsh-tools'
import { displayTitleOf, groupTitleHistory, HistoryEditError, isTitleSequence } from './history.js'
import type { TitleEdit, TitleHistory, TitleHistoryGroup } from './history.js'

export const TOOL_NAME = 'session_title_history'

/** The most title changes one `list` result carries; the rest are counted in `omitted`. */
export const LIST_LIMIT = 50

/** The Host services the tool needs, as structural picks so tests supply plain objects. */
export interface TitleHistoryToolServices {
  readonly history: TitleHistory
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
  readonly edited?: true
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
  | {
    readonly ok: true
    readonly action: 'edit'
    readonly sessionId: string
    readonly title: string
    readonly seq: number
  }
  | ToolFailure

type ToolArgs =
  | { readonly action: 'list'; readonly sessionId?: string }
  | { readonly action: 'restore'; readonly title: string; readonly sessionId?: string }
  | ({ readonly action: 'edit'; readonly sessionId?: string } & TitleEdit)

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
  if (action === 'edit') {
    if (!isTitleSequence(value.seq) || typeof title !== 'string') {
      return { failure: failure('invalid-arguments', 'edit needs the seq of a past title from "list" and the new title text.') }
    }
    return { args: { action, sessionId, seq: value.seq, title } }
  }
  if (action !== 'restore') return { failure: failure('invalid-arguments', 'action must be "list", "restore", or "edit".') }
  if (typeof title !== 'string' || title.trim() === '') {
    return { failure: failure('invalid-arguments', 'restore needs title: the exact text of a past title from action "list".') }
  }
  return { args: { action, title, sessionId } }
}

function historyFailure(error: unknown, sessionId: string, operation: 'read' | 'edit'): ToolFailure {
  if (error instanceof HistoryEditError) return failure(error.reason, error.message)
  if (isRecord(error) && error.code === 'SESSION_QUERY_SESSION_NOT_FOUND') {
    return failure('session-not-found', `Session ${sessionId} was not found.`)
  }
  return failure('history-unavailable', `Could not ${operation} the title history of session ${sessionId}.`)
}

type TitleGroups = readonly TitleHistoryGroup[]

/** Read one Session's accepted title writes through the same fold the history dialog reads. */
async function readHistory(services: TitleHistoryToolServices, sessionId: string, signal: AbortSignal): Promise<
  { readonly groups: TitleGroups } | { readonly failure: ToolFailure }
> {
  try {
    return { groups: groupTitleHistory(await services.history.read(sessionId as SessionId, signal)) }
  } catch (error) {
    // Cancellation belongs to the executor's canonical aborted result.
    if (signal.aborted) throw error
    return { failure: historyFailure(error, sessionId, 'read') }
  }
}

const entryOf = ({ revision, unchanged }: TitleHistoryGroup): TitleEntry => ({
  title: displayTitleOf(revision),
  seq: revision.seq,
  time: revision.time,
  source: revision.source.kind,
  inherited: revision.inherited,
  repeats: unchanged.length,
  ...(revision.editedTitle === undefined ? {} : { edited: true }),
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
  if (value.action === 'edit') {
    return [{ type: 'text', text: `History entry ${String(value.seq)} saved as “${String(value.title)}”.` }]
  }
  const entries = Array.isArray(value.titles) ? value.titles.filter(isEntry) : []
  if (entries.length === 0) return [{ type: 'text', text: `Session ${String(value.sessionId)} has no title history.` }]
  const lines = entries.map((entry, index) => {
    const notes = [index === 0 ? 'current' : sourceLabel(entry)]
    if (entry.edited) notes.push('edited in history')
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
    edited: { type: 'boolean', const: true },
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
      'List a session’s title history, restore a past title as the current one, or edit the text of a historical entry.',
      'Editing changes the history entry. Restoring records a new current title.',
    ].join(' '),
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'restore', 'edit'],
          description: '`list` returns the history, `restore` sets the current title, and `edit` saves the new text for a past title.',
        },
        title: {
          type: 'string',
          description: 'The exact text from `list` for `restore`, or the new text for `edit`.',
        },
        seq: {
          type: 'integer',
          description: 'Sequence number of the past title from `list`, required for `edit`.',
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
            required: ['ok', 'action', 'sessionId', 'title', 'seq'],
            properties: {
              ok: { type: 'boolean', const: true },
              action: { type: 'string', const: 'edit' },
              sessionId: { type: 'string' },
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
      if (parsed.args.action === 'list') return { card: 'generic', title: 'Session title history', kind: 'read' }
      return {
        card: 'generic', kind: 'edit', rawInput: parsed.args.title,
        title: parsed.args.action === 'restore' ? 'Restore session title' : 'Edit past session title',
      }
    },
    async execute(args: unknown, exec: ToolRunContext): Promise<ToolValue> {
      const parsed = parseArgs(args)
      if ('failure' in parsed) return parsed.failure
      const { action, sessionId: given } = parsed.args
      const target = given ?? exec.agent?.session.header.id
      if (target === undefined) {
        return failure('no-session', 'No session to act on: pass sessionId when calling outside a session.')
      }
      if (action === 'edit') {
        try {
          const title = await services.history.edit(target as SessionId, parsed.args, exec.signal)
          return { ok: true, action, sessionId: target, title, seq: parsed.args.seq }
        } catch (error) {
          if (exec.signal.aborted) throw error
          return historyFailure(error, target, 'edit')
        }
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
      const group = groups.find(({ revision }) => displayTitleOf(revision) === wanted)
      if (group === undefined) {
        return failure('unknown-title', `“${wanted}” is not a title this session had. Use action "list" to see its titles.`)
      }
      if (group === groups[0]) return failure('already-current', `“${wanted}” is already the current title.`)
      try {
        const accepted = await services.sessionController.rename({ sessionId: target as SessionId, title: displayTitleOf(group.revision) })
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

