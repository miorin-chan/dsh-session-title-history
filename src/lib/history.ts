import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionTitleSource } from '@deepseek-ai/dsh-session-title'

export const HISTORY_PATH = '/api/session-title-history'

export interface TitleRevision {
  readonly seq: number
  readonly time: number
  readonly previousTitle: string | null
  readonly title: string
  readonly source: SessionTitleSource
  readonly inherited: boolean
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
