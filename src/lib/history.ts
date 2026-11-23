import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import type { SessionTitleSource } from '@deepseek-ai/dsh-session-title'
import type { KvTable } from '@deepseek-ai/dsh-storage-domain'

export const HISTORY_PATH = '/api/session-title-history'

export interface TitleRevision {
  readonly seq: number
  readonly time: number
  readonly previousTitle: string | null
  readonly title: string
  readonly source: SessionTitleSource
  readonly inherited: boolean
  /** Edited text in this session's history. `title` remains the logged value used for grouping. */
  readonly editedTitle?: string
}

export function displayTitleOf(revision: TitleRevision): string {
  return revision.editedTitle ?? revision.title
}

export interface TitleEdit {
  readonly seq: number
  readonly title: string
}

export function isTitleSequence(seq: unknown): seq is number {
  return typeof seq === 'number' && Number.isSafeInteger(seq) && seq >= 0
}

export class HistoryEditError extends Error {
  constructor(readonly reason: 'title-invalid' | 'past-title-not-found', message: string) {
    super(message)
  }
}

/** Fold one chronological Session cut and return the accepted writes newest first. */
export function titleHistory(events: readonly SessionEvent[], inheritedEventCount: number): TitleRevision[] {
  const history: TitleRevision[] = []
  let previousTitle: string | null = null
  for (const event of events) {
    if (event.type !== 'session/title') continue
    const { title, source } = event.data
    history.push({ seq: event.seq, time: event.time, previousTitle, title, source, inherited: event.seq < inheritedEventCount })
    previousTitle = title
  }
  return history.reverse()
}

export interface TitleHistoryGroup {
  readonly revision: TitleRevision
  readonly unchanged: readonly TitleRevision[]
}

/** Attach same-title writes to the preceding title change, keeping newest-first order within each group. */
export function groupTitleHistory(rows: readonly TitleRevision[]): TitleHistoryGroup[] {
  const groups: TitleHistoryGroup[] = []
  let unchanged: TitleRevision[] = []
  for (const revision of rows) {
    if (revision.previousTitle === revision.title) {
      unchanged.push(revision)
      continue
    }
    groups.push({ revision, unchanged })
    unchanged = []
  }
  return groups
}

/** The session id also scopes edits of log events inherited from a parent. */
function editKey(sessionId: SessionId, revision: TitleRevision): string {
  return JSON.stringify([sessionId, revision.seq, revision.time, revision.title])
}

export function createHistory(
  sessionQuery: Pick<Context['sessionQuery'], 'observeSession'>,
  edits: Pick<KvTable<string, string>, 'get' | 'put' | 'delete'>,
) {
  async function read(sessionId: SessionId, signal: AbortSignal): Promise<TitleRevision[]> {
    const observed = await sessionQuery.observeSession(sessionId, { signal, projectionMode: 'none' })
    try {
      signal.throwIfAborted()
      return titleHistory(observed.events, observed.inheritedEventCount).map(revision => {
        const editedTitle = edits.get(editKey(sessionId, revision))
        return editedTitle === undefined ? revision : { ...revision, editedTitle }
      })
    } finally {
      observed[Symbol.dispose]()
    }
  }

  async function edit(sessionId: SessionId, edit: TitleEdit, signal: AbortSignal): Promise<string> {
    // Use the same invisible-control ranges as dsh-session-title 0.2.2-rc.5, src/normalize.ts.
    const title = edit.title
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/gu, '')
      .replace(/\s+/gu, ' ').trim()
    if (!/[^\p{C}\p{Z}]/u.test(title)) throw new HistoryEditError('title-invalid', 'Enter a title with visible text.')
    const rows = await read(sessionId, signal)
    // A group begins with a changed title. A later changed title makes it historical.
    const group = groupTitleHistory(rows).find(({ revision }, index) => index > 0 && revision.seq === edit.seq)
    if (group === undefined) throw new HistoryEditError('past-title-not-found', 'Choose a past title from the history.')
    signal.throwIfAborted()
    const key = editKey(sessionId, group.revision)
    if (title === group.revision.title) await edits.delete(key)
    else await edits.put(key, title)
    return title
  }

  return { read, edit }
}

export type TitleHistory = ReturnType<typeof createHistory>
