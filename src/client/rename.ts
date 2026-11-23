import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session'

const ID = 'dsh-session-title-history'

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    /** Re-applying a past title from the title history dialog. */
    'dsh-session-title-history': unknown
  }
}

/**
 * Re-apply one title through the native rename path that the session menu's
 * Rename dialog uses (DSH 0.2.2-rc.5, `dsh-client-ui-workspace` `renameSession`).
 * The Host records the write as a manual title, which pins it against automatic
 * regeneration, and the list row updates before the control stream confirms it.
 *
 * @param sessions - Client sessions service.
 * @param sessionId - Session to rename.
 * @param title - Raw title text; the Host normalizes acceptance.
 * @returns the accepted title.
 * @throws the Host's reason when the rename is refused, or the acquisition failure.
 */
export async function reapplyTitle(
  sessions: Pick<ISessions, 'using'>,
  sessionId: SessionId,
  title: string,
): Promise<string> {
  const result = await sessions.using(sessionId, { source: ID }, reference => reference.binding.session.rename(title))
  if (!result.ok) throw new Error(result.error.message)
  return result.value.title
}
