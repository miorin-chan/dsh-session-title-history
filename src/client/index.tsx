import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type { ContextMenuTargetMap } from '@deepseek-ai/dsh-client-ui-context-menu/client'
import type { GlobalStandardProps, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { displayTitleOf, groupTitleHistory, HISTORY_PATH, isTitleSequence } from '../lib/history.js'
import type { TitleEdit, TitleHistoryGroup, TitleRevision } from '../lib/history.js'
import { labels } from './locale.js'
import { reapplyTitle } from './rename.js'

const ID = 'dsh-session-title-history'
const MENU_ICON = 'contextMenu.icon'
const OVERLAY = 'shell.overlay'
/** The endpoint the native Rename menu item is shown for. */
const RENAME_ACCESS = 'session/rename'

export const inject = ['locale', 'slots', 'contextMenus', 'sessions']

type Translation = PropsLocale<typeof ID>['t']
type Target = ContextMenuTargetMap['session']
type AccessProps = Pick<GlobalStandardProps, 'useSessionAccess'>
type Primitives = Pick<typeof import('@deepseek-ai/dsh-client-ui-primitives'),
  'Modal' | 'Button' | 'Input' | 'Tooltip' | 'Tag' | 'IconClockOutlineRegular' | 'IconEditOutlineRegular' | 'IconRightUpOutlineRegular'>
type LoadedHistory = { rows: TitleRevision[]; canEdit: boolean }
type LoadState = { status: 'loading' | 'failed' } | ({ status: 'loaded' } & LoadedHistory)
type Notice =
  | { status: 'idle' }
  | { status: 'pending'; title: string }
  | { status: 'restored'; title: string }
  | { status: 'edited'; seq: number }
  | { status: 'failed'; message: string }
type EditResult = { ok: true; title: string } | { ok: false; label: 'editFailed' | 'invalidTitle' | 'pastTitleMissing' }
type HistoryActions = {
  restore: (group: TitleHistoryGroup) => void
  startEdit: (seq: number) => void
  finishEdit: (seq: number) => void
  saveEdit: (edit: TitleEdit, signal: AbortSignal) => Promise<EditResult>
}
type ModalProps = {
  title: string
  closeLabel: string
  onClose: () => void
  children: React.ReactNode
}

const css = `
  /* DSH 0.2.2-rc.5 renders Copy session ID with its own separator. Suppress
     it only when the History row immediately precedes that native copy row. */
  [data-context-menu] [role="presentation"]
    > :has(> [role="menuitem"] .title-history-menu-clock)
    + [role="separator"]:has(+ * > [role="menuitem"] [data-icon="dsw-icon-copy-outline-regular"]) {
    display: none;
  }
  .title-history-dialog {
    color: var(--dsw-alias-label-primary, CanvasText); background: var(--dsw-alias-bg-overlay, Canvas);
    border: 1px solid var(--dsw-alias-border-l1); border-radius: 14px;
    width: min(32rem, calc(100% - 2rem)); max-height: 85vh; padding: 0; font: inherit; pointer-events: auto;
  }
  .title-history-dialog::backdrop { background: var(--dsw-alias-bg-mask-1); }
  .title-history-dialog > header { display: flex; align-items: center; justify-content: space-between; padding: 1rem; gap: 1rem; }
  .title-history-dialog h2 { margin: 0; font-size: 1rem; }
  .title-history-dialog header button { color: inherit; background: transparent; border: 0; font: inherit; cursor: pointer; }
  .title-history-modal { width: min(28rem, 100%); max-height: 100%; }
  .title-history-modal-content { min-height: 0; }
  .title-history-modal-content > :last-child { min-height: 0; margin-top: 0; }
  .title-history-content { max-height: min(60vh, 32rem); min-height: 0; overflow: auto; }
  .title-history-content:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: -2px; }
  .title-history-dialog .title-history-content { padding: 0 1rem 1rem; }
  .title-history-notice {
    margin: 0 0 10px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary);
    overflow-wrap: anywhere;
  }
  .title-history-notice[role="alert"] { color: var(--dsw-alias-state-error-primary); }
  .title-history-list, .title-history-repeats { margin: 0; padding: 0; list-style: none; }
  .title-history-group { padding: 10px 0; }
  .title-history-group + .title-history-group { border-top: 1px solid var(--dsw-alias-border-l1); }
  .title-history-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  .title-history-title { margin: 0; font-size: 14px; font-weight: 500; line-height: 22px; overflow-wrap: anywhere; }
  /* A title with same-text writes toggles them from its whole line; the padding only widens the hover plate. */
  .title-history-toggle {
    display: flex; flex: 1; align-items: baseline; gap: 6px; min-width: 0;
    margin: -3px 0 -3px -6px; padding: 3px 6px; border: 0; border-radius: 6px;
    background: transparent; color: inherit; font: inherit; text-align: start; cursor: pointer;
  }
  @media (hover: hover) {
    .title-history-toggle:hover { background: var(--dsw-alias-interactive-bg-hover); }
  }
  .title-history-toggle:focus-visible {
    outline: var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-brand-primary));
    outline-offset: -2px;
  }
  .title-history-count { flex: none; }
  .title-history-row-actions {
    --title-history-action-size: 28px;
    display: grid; grid-template-columns: repeat(2, var(--title-history-action-size)); gap: 2px;
  }
  /* Square icon controls, as the native row icon buttons (DSH 0.2.2-rc.5, dsh-client-ui-workspace .iconButton). */
  .title-history-heading .title-history-action {
    width: var(--title-history-action-size); height: var(--title-history-action-size);
    margin-block: -3px; padding: 0; border-radius: var(--dsw-radius-sm);
    color: var(--dsw-alias-label-secondary);
  }
  .title-history-restore { grid-column: 2; }
  .title-history-action-fallback { border: 0; background: transparent; font: inherit; cursor: pointer; }
  @media (hover: hover) {
    .title-history-heading .title-history-action:hover:not(:disabled) { color: var(--dsw-alias-label-primary); }
  }
  /* Touch gets a larger target without a tooltip to explain the glyph. */
  @media (any-pointer: coarse) {
    .title-history-row-actions { --title-history-action-size: 36px; }
    .title-history-heading .title-history-action { margin-block: -7px; }
  }
  .title-history-action:disabled { cursor: not-allowed; opacity: 0.4; }
  .title-history-editor { display: grid; gap: 8px; margin-bottom: 8px; }
  .title-history-editor-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
  .title-history-editor .title-history-notice { margin: 0; }
  .title-history-input-fallback {
    min-width: 0; padding: 6px 8px; border: 1px solid var(--dsw-alias-border-l2); border-radius: var(--dsw-radius-sm);
    background: var(--dsw-alias-bg-base); color: inherit; font: inherit;
  }
  .title-history-meta {
    display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 8px;
    margin-top: 4px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary);
  }
  .title-history-meta time { margin-inline-start: auto; }
  .title-history-provider {
    border: 0; padding: 0; background: transparent; color: inherit; font: inherit; cursor: help;
    text-decoration: underline dotted; text-underline-offset: 3px;
  }
  .title-history-provider-details { max-width: 100%; overflow-wrap: anywhere; }
  .title-history-repeats {
    margin-top: 8px; padding-inline-start: 10px;
    border-inline-start: 1px solid var(--dsw-alias-border-l1);
  }
  .title-history-repeats > li { padding: 3px 0; }

`

/** Use the primitive components supplied by the Web shell's module table. */
function nativePrimitives(): Partial<Primitives> {
  try {
    return require('@deepseek-ai/dsh-client-ui-primitives') as Partial<Primitives>
  } catch {
    return {}
  }
}

function BrowserModal({ title, closeLabel, onClose, children }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null)
  const heading = useId()
  useEffect(() => {
    const node = ref.current
    if (!node) return
    node.showModal()
    return () => node.close()
  }, [])
  return <dialog ref={ref} className="title-history-dialog" aria-labelledby={heading}
    onCancel={event => { event.preventDefault(); onClose() }}
    onClick={event => {
      if (event.target !== event.currentTarget) return
      const { left, right, top, bottom } = event.currentTarget.getBoundingClientRect()
      if (event.clientX < left || event.clientX > right || event.clientY < top || event.clientY > bottom) onClose()
    }}>
    <header>
      <h2 id={heading}>{title}</h2>
      <button type="button" aria-label={closeLabel} onClick={onClose} autoFocus>×</button>
    </header>
    {children}
  </dialog>
}

function isRevision(value: unknown): value is TitleRevision {
  if (value === null || typeof value !== 'object') return false
  const { seq, time, title, previousTitle, inherited, source, editedTitle } = value as Record<string, unknown>
  if (!isTitleSequence(seq) || typeof time !== 'number' || !Number.isFinite(new Date(time).getTime())
    || typeof title !== 'string' || (previousTitle !== null && typeof previousTitle !== 'string')
    || (editedTitle !== undefined && typeof editedTitle !== 'string')
    || typeof inherited !== 'boolean' || source === null || typeof source !== 'object' || !('kind' in source)) return false
  if (source.kind === 'user' || source.kind === 'fallback') return true
  if (source.kind !== 'provider' || !('provider' in source) || typeof source.provider !== 'string') return false
  if (!('model' in source) || source.model === undefined) return true
  return source.model !== null && typeof source.model === 'object' && 'provider' in source.model
    && typeof source.model.provider === 'string' && 'model' in source.model && typeof source.model.model === 'string'
}

function historyUrl(sessionId: SessionId): URL {
  const url = new URL(HISTORY_PATH.slice(1), document.baseURI)
  url.searchParams.set('sessionId', sessionId)
  return url
}

async function loadHistory(sessionId: SessionId, signal: AbortSignal): Promise<LoadedHistory> {
  const response = await fetch(historyUrl(sessionId), { signal })
  if (!response.ok) throw new Error(`Session title history request failed (${response.status})`)
  const data: unknown = await response.json()
  if (data === null || typeof data !== 'object' || !('history' in data) || !Array.isArray(data.history)
    || !data.history.every(isRevision)) throw new Error('Invalid session title history response')
  return { rows: data.history, canEdit: 'canEdit' in data && data.canEdit === true }
}

async function saveTitleEdit(sessionId: SessionId, edit: TitleEdit, signal: AbortSignal): Promise<EditResult> {
  try {
    const response = await fetch(historyUrl(sessionId), {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(edit),
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    })
    const data: unknown = await response.json()
    if (data !== null && typeof data === 'object') {
      if (response.ok && 'title' in data && typeof data.title === 'string') return { ok: true, title: data.title }
      if ('error' in data) {
        if (data.error === 'title-invalid') return { ok: false, label: 'invalidTitle' }
        if (data.error === 'past-title-not-found') return { ok: false, label: 'pastTitleMissing' }
      }
    }
  } catch {
    // A transport or parsing failure leaves the draft available for retry.
  }
  return { ok: false, label: 'editFailed' }
}

function RevisionMeta({ row, dates, t, Tooltip, unchanged = false, saved = false }: {
  row: TitleRevision
  dates: Intl.DateTimeFormat
  t: Translation
  Tooltip?: Primitives['Tooltip']
  unchanged?: boolean
  saved?: boolean
}) {
  const source = row.source.kind === 'user' ? t('manual') : t(row.source.kind)
  const details = row.source.kind === 'provider'
    ? row.source.model ? `${row.source.provider} · ${row.source.model.provider}/${row.source.model.model}` : row.source.provider
    : undefined
  return <div className="title-history-meta">
    {details === undefined ? <span>{source}</span> : Tooltip
      ? <Tooltip label={details} side="top" portal delayMs={260} maxWidth={320} openOnClick>
        <button className="title-history-provider" type="button">{source}</button>
      </Tooltip>
      : <details className="title-history-provider-details"><summary>{source}</summary><bdi>{details}</bdi></details>}
    {row.previousTitle === null && <span>{t('first')}</span>}
    {unchanged && <span>{t('unchanged')}</span>}
    {row.inherited && <span>{t('inherited')}</span>}
    {saved ? <span role="status">{t('editSaved')}</span>
      : row.editedTitle !== undefined && <span>{t('editedInHistory')}</span>}
    <time dateTime={new Date(row.time).toISOString()}>{dates.format(row.time)}</time>
  </div>
}

function HistoryActionButton({ ui, label, name, icon, disabled, onClick }: {
  ui: Partial<Primitives>
  label: string
  name: 'edit' | 'restore'
  icon: React.ReactNode
  disabled: boolean
  onClick: () => void
}) {
  const { Button, Tooltip } = ui
  const className = `title-history-action title-history-${name}`
  const button = Button
    ? <Button size="sm" variant="ghost" className={className} onClick={onClick} disabled={disabled}
      aria-label={label} icon={icon} />
    : <button type="button" className={`${className} title-history-action-fallback`} onClick={onClick}
      disabled={disabled} title={label} aria-label={label}>{icon}</button>
  return Tooltip ? <Tooltip label={label} side="top" portal delayMs={260} maxWidth={320}>{button}</Tooltip> : button
}

function HistoryEditor({ title, t, ui, save, cancel }: {
  title: string
  t: Translation
  ui: Partial<Primitives>
  save: (title: string, signal: AbortSignal) => Promise<EditResult>
  cancel: () => void
}) {
  const { Input, Button } = ui
  const [draft, setDraft] = useState(title)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<Extract<EditResult, { ok: false }>['label']>()
  const input = useRef<HTMLInputElement>(null)
  const request = useRef<AbortController>()
  const composition = useRef({ active: false, ended: false })
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
    return () => request.current?.abort()
  }, [])
  const blocked = pending || draft.trim() === '' || draft.trim() === title
  const submit = async () => {
    if (blocked || request.current || composition.current.active) return
    const controller = new AbortController()
    request.current = controller
    setError(undefined)
    setPending(true)
    const result = await save(draft, controller.signal)
    if (controller.signal.aborted) return
    request.current = undefined
    setPending(false)
    if (!result.ok) {
      setError(result.label)
      input.current?.focus()
    }
  }
  const inputProps = {
    ref: input, value: draft, dir: 'auto', 'aria-label': t('titleInput'),
    'aria-invalid': error === 'invalidTitle' || undefined, readOnly: pending,
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => { setDraft(event.currentTarget.value); setError(undefined) },
    onCompositionStart: () => { composition.current = { active: true, ended: false } },
    onCompositionEnd: () => { composition.current = { active: false, ended: true } },
    onBlur: () => { composition.current = { active: false, ended: false } },
  }
  return <form className="title-history-editor" aria-busy={pending} onSubmit={event => { event.preventDefault(); void submit() }}
    onKeyUp={() => { composition.current.ended = false }}
    onKeyDown={event => {
      const { active, ended } = composition.current
      composition.current.ended = false
      // Match the native modal's handling of the final key event of an IME composition.
      const inComposition = active || ended || event.nativeEvent.isComposing || event.keyCode === 229
      if (event.key === 'Enter' && inComposition) event.preventDefault()
      if (event.key !== 'Escape') return
      event.stopPropagation()
      if (inComposition) return
      event.preventDefault()
      if (!pending) cancel()
    }}>
    {Input ? <Input {...inputProps} /> : <input className="title-history-input-fallback" {...inputProps} />}
    {error && <p className="title-history-notice" role="alert">{t(error)}</p>}
    <div className="title-history-editor-actions">
      {Button ? <>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={cancel}>{t('cancel')}</Button>
        <Button type="submit" size="sm" variant="primary" disabled={blocked}>{t(pending ? 'saving' : 'save')}</Button>
      </> : <>
        <button type="button" disabled={pending} onClick={cancel}>{t('cancel')}</button>
        <button type="submit" disabled={blocked}>{t(pending ? 'saving' : 'save')}</button>
      </>}
    </div>
  </form>
}

function HistoryGroup({ group, dates, t, ui, actions, canEdit, canRestore, disabled, editing, saved }: {
  group: TitleHistoryGroup
  dates: Intl.DateTimeFormat
  t: Translation
  ui: Partial<Primitives>
  actions?: HistoryActions
  canEdit: boolean
  canRestore: boolean
  disabled: boolean
  editing: boolean
  saved: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const repeatsId = useId()
  const { revision, unchanged } = group
  const { Tooltip, Tag, IconEditOutlineRegular: Pencil, IconRightUpOutlineRegular: Arrow } = ui
  const title = displayTitleOf(revision)
  const toggleLabel = t(expanded ? 'hideUnchanged' : 'showUnchanged', { count: unchanged.length })
  const count = unchanged.length === 0 ? undefined
    : Tag ? <Tag tone="quiet" className="title-history-count">×{unchanged.length}</Tag>
      : <span className="title-history-count" aria-hidden="true">×{unchanged.length}</span>
  // Same-text writes hide under their title; the whole title line toggles them.
  const name = unchanged.length === 0
    ? <p className="title-history-title" dir="auto">{title}</p>
    : <button type="button" className="title-history-toggle" dir="auto" aria-expanded={expanded} aria-controls={repeatsId}
      title={Tooltip ? undefined : toggleLabel} onClick={() => setExpanded(!expanded)}>
      <span className="title-history-title">{title}</span>{count}
    </button>
  return <li className="title-history-group" data-seq={revision.seq}>
    {editing && actions ? <HistoryEditor title={title} t={t} ui={ui}
      save={(value, signal) => actions.saveEdit({ seq: revision.seq, title: value }, signal)}
      cancel={() => actions.finishEdit(revision.seq)} />
      : <div className="title-history-heading">
        {Tooltip && unchanged.length > 0
          ? <Tooltip label={toggleLabel} side="top" portal delayMs={260} maxWidth={320}>{name}</Tooltip>
          : name}
        {actions && (canEdit || canRestore) && <div className="title-history-row-actions">
          {canEdit && <HistoryActionButton ui={ui} name="edit" label={t('editTitleOf', { title })} disabled={disabled}
            icon={Pencil ? <Pencil /> : <span aria-hidden="true">✎</span>} onClick={() => actions.startEdit(revision.seq)} />}
          {canRestore && <HistoryActionButton ui={ui} name="restore" label={t('setTitleOf', { title })} disabled={disabled}
            icon={Arrow ? <Arrow /> : <span aria-hidden="true">↗</span>} onClick={() => actions.restore(group)} />}
        </div>}
      </div>}
    <RevisionMeta row={revision} dates={dates} t={t} Tooltip={Tooltip} saved={saved} />
    {unchanged.length > 0 && <ol id={repeatsId} className="title-history-repeats" role="list" hidden={!expanded}>
      {expanded && unchanged.map(row => <li key={row.seq}>
        <RevisionMeta row={row} dates={dates} t={t} Tooltip={Tooltip} unchanged />
      </li>)}
    </ol>}
  </li>
}

function HistoryList({ rows, t, language, ui, actions, busy, editing, canEdit, savedSeq }: LoadedHistory & {
  t: Translation
  language: string
  ui: Partial<Primitives>
  actions?: HistoryActions
  busy: boolean
  editing: number | null
  savedSeq?: number
}) {
  const dates = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'medium' })
  const groups = groupTitleHistory(rows)
  const current = groups[0]?.revision.title
  return <ol className="title-history-list" role="list" aria-busy={busy}>{groups.map((group, index) =>
    <HistoryGroup key={group.revision.seq} group={group} dates={dates} t={t} ui={ui}
      actions={index === 0 ? undefined : actions} canRestore={displayTitleOf(group.revision) !== current} canEdit={canEdit}
      disabled={busy || editing !== null} editing={editing === group.revision.seq} saved={savedSeq === group.revision.seq} />
  )}</ol>
}

function HistoryContent({ target, t, language, ui, canRename, rename, editPending }: {
  target: Target
  t: Translation
  language: string
  ui: Partial<Primitives>
  /** Whether the current Peer may rename this Session. */
  canRename: boolean
  /** Re-apply one title through the native rename path and resolve to the accepted title. */
  rename: (title: string) => Promise<string>
  editPending: React.MutableRefObject<boolean>
}) {
  const { Button } = ui
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [notice, setNotice] = useState<Notice>({ status: 'idle' })
  const [editing, setEditing] = useState<number | null>(null)
  const region = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    void loadHistory(target.sessionId, controller.signal).then(history => {
      if (!controller.signal.aborted) setState({ status: 'loaded', ...history })
    }, () => {
      if (!controller.signal.aborted) setState({ status: 'failed' })
    })
    return () => controller.abort()
  }, [target.sessionId, attempt])
  const retry = () => {
    region.current?.focus()
    setState({ status: 'loading' })
    setAttempt(attempt + 1)
  }
  /** After the refreshed list commits, focus the clicked group's button again or the next older group's. */
  const focusAfterRestore = (seq: number, which: 'same' | 'older') => {
    requestAnimationFrame(() => {
      const node = region.current
      if (node === null) return
      const groups = [...node.querySelectorAll<HTMLElement>('li[data-seq]')]
      const restoreButton = (group: HTMLElement) => group.querySelector<HTMLButtonElement>('.title-history-restore')
      const target = which === 'same'
        ? groups.find(li => li.dataset.seq === String(seq))
        : groups.find(li => Number(li.dataset.seq) < seq && restoreButton(li) !== null)
      const focus = target === undefined ? node : restoreButton(target) ?? node
      focus.focus({ preventScroll: true })
    })
  }
  const restore = async (group: TitleHistoryGroup) => {
    const title = displayTitleOf(group.revision)
    // The clicked button leaves the list once its title is current, so hold focus on the region meanwhile.
    region.current?.focus({ preventScroll: true })
    setNotice({ status: 'pending', title })
    let accepted: string
    try {
      accepted = await rename(title)
    } catch (error) {
      setNotice({ status: 'failed', message: error instanceof Error ? error.message : String(error) })
      focusAfterRestore(group.revision.seq, 'same')
      return
    }
    // Keep the buttons disabled until the list shows the accepted write.
    try {
      const history = await loadHistory(target.sessionId, new AbortController().signal)
      setState({ status: 'loaded', ...history })
    } catch {
      setState({ status: 'failed' })
    }
    setNotice({ status: 'restored', title: accepted })
    focusAfterRestore(group.revision.seq, 'older')
  }
  const startEdit = (seq: number) => {
    setNotice({ status: 'idle' })
    setEditing(seq)
  }
  const finishEdit = (seq: number) => {
    setEditing(null)
    requestAnimationFrame(() => {
      const node = region.current
      const focus = node?.querySelector<HTMLButtonElement>(`li[data-seq="${seq}"] .title-history-edit`) ?? node
      focus?.focus({ preventScroll: true })
    })
  }
  const saveEdit = async (edit: TitleEdit, signal: AbortSignal): Promise<EditResult> => {
    editPending.current = true
    try {
      const result = await saveTitleEdit(target.sessionId, edit, signal)
      if (result.ok && !signal.aborted) {
        setState(current => current.status !== 'loaded' ? current : {
          ...current,
          rows: current.rows.map(row => row.seq === edit.seq
            ? { ...row, editedTitle: result.title === row.title ? undefined : result.title }
            : row),
        })
        setNotice({ status: 'edited', seq: edit.seq })
        finishEdit(edit.seq)
      }
      return result
    } finally {
      editPending.current = false
    }
  }
  const pending = notice.status === 'pending'
  return <div ref={region} className="title-history-content" role="region" aria-label={t('history')} tabIndex={0}>
    <div role="status">
      {state.status === 'loading' && <p>{t('loading')}</p>}
      {state.status === 'loaded' && state.rows.length === 0 && <p>{t('empty')}</p>}
      {notice.status === 'pending' &&
        <p className="title-history-notice">{t('settingTitle', { title: notice.title })}</p>}
      {notice.status === 'restored' &&
        <p className="title-history-notice">{t('titleSet', { title: notice.title })}</p>}
    </div>
    {notice.status === 'failed' &&
      <p className="title-history-notice" role="alert">{t('setTitleFailed')} {notice.message}</p>}
    {state.status === 'failed' && <>
      <p role="alert">{t('failed')}</p>
      {Button ? <Button variant="outline" onClick={retry}>{t('retry')}</Button>
        : <button type="button" onClick={retry}>{t('retry')}</button>}
    </>}
    {state.status === 'loaded' && state.rows.length > 0 &&
      <HistoryList rows={state.rows} canEdit={state.canEdit} t={t} language={language} ui={ui} busy={pending}
        editing={editing} savedSeq={notice.status === 'edited' ? notice.seq : undefined}
        actions={canRename ? { restore, startEdit, finishEdit, saveEdit } : undefined} />}
  </div>
}

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(ID, labels), `${ID}: locale`)
  const ui = nativePrimitives()
  const { Modal, IconClockOutlineRegular } = ui
  const menuLabel = ctx.locale.bind(ID)
  let target: Target | null = null
  const listeners = new Set<() => void>()
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
  const getTarget = () => target
  const setTarget = (next: Target | null) => {
    target = next
    for (const listener of listeners) listener()
  }
  let transitionFrame: number | undefined
  let returnFocus: HTMLElement | undefined
  const cancelTransition = () => {
    if (transitionFrame === undefined) return
    cancelAnimationFrame(transitionFrame)
    transitionFrame = undefined
  }
  ctx.effect(() => cancelTransition, `${ID}: menu focus handoff`)
  const open = (selected: Target) => {
    cancelTransition()
    // Let the native menu return focus to the trigger before opening the dialog.
    transitionFrame = requestAnimationFrame(() => {
      transitionFrame = undefined
      const focused = document.activeElement
      returnFocus = focused instanceof HTMLElement && focused !== document.body ? focused : undefined
      setTarget(selected)
    })
  }
  const close = () => {
    cancelTransition()
    setTarget(null)
    const trigger = returnFocus
    returnFocus = undefined
    if (trigger === undefined) return
    transitionFrame = requestAnimationFrame(() => {
      transitionFrame = undefined
      if (trigger.isConnected && document.activeElement === document.body) trigger.focus({ preventScroll: true })
    })
  }

  function HistoryOverlay({ t, useSessionAccess }: PropsLocale<typeof ID> & AccessProps) {
    const selected = useSyncExternalStore(subscribe, getTarget)
    if (!selected) return <style>{css}</style>
    return <><style>{css}</style><HistoryDialog t={t} target={selected} useSessionAccess={useSessionAccess} /></>
  }

  /** The open dialog, mounted per opening so the access Hook keeps a stable call order. */
  function HistoryDialog({ t, target, useSessionAccess }: { t: Translation; target: Target } & AccessProps) {
    const canRename = useSessionAccess(target.sessionId, RENAME_ACCESS)
    const editPending = useRef(false)
    const closeDialog = () => { if (!editPending.current) close() }
    const rename = (title: string) => reapplyTitle(ctx.sessions, target.sessionId, title)
    const content = <HistoryContent key={target.sessionId} target={target} t={t} language={ctx.locale.getLocale().active}
      ui={ui} canRename={canRename} rename={rename} editPending={editPending} />
    return Modal
      ? <Modal open className="title-history-modal" contentClassName="title-history-modal-content" onClose={closeDialog} title={t('history')} closeLabel={t('close')}>{content}</Modal>
      : <BrowserModal onClose={closeDialog} title={t('history')} closeLabel={t('close')}>{content}</BrowserModal>
  }

  ctx.effect(() => ctx.slots.inject(OVERLAY, () => ctx.slots.register({ name: OVERLAY, id: ID, locale: ID }, HistoryOverlay)), `${ID}: overlay`)
  if (IconClockOutlineRegular) {
    ctx.effect(() => ctx.slots.inject(MENU_ICON, () => ctx.slots.register({ name: MENU_ICON, key: ID },
      () => <IconClockOutlineRegular className="title-history-menu-clock" aria-hidden="true" />)), `${ID}: menu icon`)
  }
  ctx.effect(() => ctx.contextMenus.register({
    id: ID,
    target: 'session',
    // DSH 0.2.2-rc.5 registers Copy session ID at order 450.
    order: 449,
    observe: () => [ctx.locale],
    resolve: selected => [{
      id: 'open',
      label: menuLabel('history'),
      ...(IconClockOutlineRegular ? { icon: { key: ID }, separatorBefore: true } : {}),
      run: () => open(selected),
    }],
  }), `${ID}: menu action`)
}
