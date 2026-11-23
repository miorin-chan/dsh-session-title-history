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
import { groupTitleHistory, HISTORY_PATH } from '../lib/history.js'
import type { TitleHistoryGroup, TitleRevision } from '../lib/history.js'
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
  'Modal' | 'Button' | 'Tooltip' | 'Tag' | 'IconClockOutlineRegular' | 'IconRightUpOutlineRegular'>
type LoadState = { status: 'loading' | 'failed' } | { status: 'loaded'; rows: TitleRevision[] }
type RenameState =
  | { status: 'idle' }
  | { status: 'pending'; title: string }
  | { status: 'restored'; title: string }
  | { status: 'failed'; message: string }
/** One past title's re-apply action, present only where the Peer may rename. */
type Restore = { pending: boolean; run: () => void }
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
  .title-history-restore-fallback {
    flex: none; width: 28px; height: 28px; margin-block: -3px; padding: 0; border: 0; border-radius: var(--dsw-radius-sm);
    background: transparent; color: inherit; font: inherit; font-size: 14px; cursor: pointer;
  }
  /* Square icon control, as the native row icon buttons (DSH 0.2.2-rc.5, dsh-client-ui-workspace .iconButton). */
  .title-history-heading .title-history-restore {
    flex: none; width: 28px; height: 28px; margin-block: -3px; padding: 0; border-radius: var(--dsw-radius-sm);
    color: var(--dsw-alias-label-secondary);
  }
  @media (hover: hover) {
    .title-history-heading .title-history-restore:hover:not(:disabled) { color: var(--dsw-alias-label-primary); }
  }
  /* Touch gets a larger target without a tooltip to explain the glyph. */
  @media (any-pointer: coarse) {
    .title-history-heading .title-history-restore { width: 36px; height: 36px; margin-block: -7px; }
  }
  .title-history-restore:disabled, .title-history-restore-fallback:disabled { cursor: not-allowed; opacity: 0.4; }
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
  const { seq, time, title, previousTitle, inherited, source } = value as Record<string, unknown>
  if (typeof seq !== 'number' || !Number.isSafeInteger(seq) || seq < 0
    || typeof time !== 'number' || !Number.isFinite(new Date(time).getTime())
    || typeof title !== 'string' || (previousTitle !== null && typeof previousTitle !== 'string')
    || typeof inherited !== 'boolean' || source === null || typeof source !== 'object' || !('kind' in source)) return false
  if (source.kind === 'user' || source.kind === 'fallback') return true
  if (source.kind !== 'provider' || !('provider' in source) || typeof source.provider !== 'string') return false
  if (!('model' in source) || source.model === undefined) return true
  return source.model !== null && typeof source.model === 'object' && 'provider' in source.model
    && typeof source.model.provider === 'string' && 'model' in source.model && typeof source.model.model === 'string'
}

async function loadHistory(sessionId: SessionId, signal: AbortSignal): Promise<TitleRevision[]> {
  const url = new URL(HISTORY_PATH.slice(1), document.baseURI)
  url.searchParams.set('sessionId', sessionId)
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error(`Session title history request failed (${response.status})`)
  const data: unknown = await response.json()
  if (data === null || typeof data !== 'object' || !('history' in data) || !Array.isArray(data.history)
    || !data.history.every(isRevision)) throw new Error('Invalid session title history response')
  return data.history
}

function RevisionMeta({ row, dates, t, Tooltip, unchanged = false }: {
  row: TitleRevision
  dates: Intl.DateTimeFormat
  t: Translation
  Tooltip?: Primitives['Tooltip']
  unchanged?: boolean
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
    <time dateTime={new Date(row.time).toISOString()}>{dates.format(row.time)}</time>
  </div>
}

function HistoryGroup({ group, dates, t, ui, restore }: {
  group: TitleHistoryGroup
  dates: Intl.DateTimeFormat
  t: Translation
  ui: Partial<Primitives>
  /** Re-apply this group's title; absent for the current title or without rename access. */
  restore?: Restore
}) {
  const [expanded, setExpanded] = useState(false)
  const repeatsId = useId()
  const { revision, unchanged } = group
  const { Button, Tooltip, Tag, IconRightUpOutlineRegular: Arrow } = ui
  const setTitleLabel = t('setTitleOf', { title: revision.title })
  const toggleLabel = t(expanded ? 'hideUnchanged' : 'showUnchanged', { count: unchanged.length })
  const accept = restore === undefined ? undefined : Button
    ? <Button size="sm" variant="ghost" className="title-history-restore" onClick={restore.run} disabled={restore.pending}
      aria-label={setTitleLabel} icon={Arrow ? <Arrow /> : <span aria-hidden="true">↗</span>} />
    : <button type="button" className="title-history-restore-fallback" onClick={restore.run} disabled={restore.pending}
      title={setTitleLabel} aria-label={setTitleLabel}><span aria-hidden="true">↗</span></button>
  const count = unchanged.length === 0 ? undefined
    : Tag ? <Tag tone="quiet" className="title-history-count">×{unchanged.length}</Tag>
      : <span className="title-history-count" aria-hidden="true">×{unchanged.length}</span>
  // Same-text writes hide under their title; the whole title line toggles them.
  const name = unchanged.length === 0
    ? <p className="title-history-title" dir="auto">{revision.title}</p>
    : <button type="button" className="title-history-toggle" dir="auto" aria-expanded={expanded} aria-controls={repeatsId}
      title={Tooltip ? undefined : toggleLabel} onClick={() => setExpanded(!expanded)}>
      <span className="title-history-title">{revision.title}</span>{count}
    </button>
  return <li className="title-history-group" data-seq={revision.seq}>
    <div className="title-history-heading">
      {Tooltip && unchanged.length > 0
        ? <Tooltip label={toggleLabel} side="top" portal delayMs={260} maxWidth={320}>{name}</Tooltip>
        : name}
      {accept !== undefined && (Tooltip
        ? <Tooltip label={setTitleLabel} side="top" portal delayMs={260} maxWidth={320}>{accept}</Tooltip>
        : accept)}
    </div>
    <RevisionMeta row={revision} dates={dates} t={t} Tooltip={Tooltip} />
    {unchanged.length > 0 && <ol id={repeatsId} className="title-history-repeats" role="list" hidden={!expanded}>
      {expanded && unchanged.map(row => <li key={row.seq}>
        <RevisionMeta row={row} dates={dates} t={t} Tooltip={Tooltip} unchanged />
      </li>)}
    </ol>}
  </li>
}

function HistoryList({ rows, t, language, ui, actions, busy }: {
  rows: TitleRevision[]
  t: Translation
  language: string
  ui: Partial<Primitives>
  /** The shared re-apply state; absent when the Peer may not rename. */
  actions?: { run: (group: TitleHistoryGroup) => void }
  /** Whether a re-apply request is in flight. */
  busy: boolean
}) {
  const dates = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'medium' })
  const groups = groupTitleHistory(rows)
  const current = groups[0]?.revision.title
  return <ol className="title-history-list" role="list" aria-busy={busy}>{groups.map((group, index) =>
    // The newest group holds the current title, and re-applying its text would only add an unchanged write.
    <HistoryGroup key={group.revision.seq} group={group} dates={dates} t={t} ui={ui}
      restore={actions === undefined || index === 0 || group.revision.title === current ? undefined
        : { pending: busy, run: () => actions.run(group) }} />
  )}</ol>
}

function HistoryContent({ target, t, language, ui, canRename, rename }: {
  target: Target
  t: Translation
  language: string
  ui: Partial<Primitives>
  /** Whether the current Peer may rename this Session. */
  canRename: boolean
  /** Re-apply one title through the native rename path and resolve to the accepted title. */
  rename: (title: string) => Promise<string>
}) {
  const { Button } = ui
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const [renameState, setRenameState] = useState<RenameState>({ status: 'idle' })
  const region = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const controller = new AbortController()
    void loadHistory(target.sessionId, controller.signal).then(rows => {
      if (!controller.signal.aborted) setState({ status: 'loaded', rows })
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
      const target = which === 'same'
        ? groups.find(li => li.dataset.seq === String(seq))
        : groups.find(li => Number(li.dataset.seq) < seq)
      ;(target?.querySelector<HTMLElement>('.title-history-restore, .title-history-restore-fallback') ?? node)
        .focus({ preventScroll: true })
    })
  }
  const restore = async (group: TitleHistoryGroup) => {
    const title = group.revision.title
    // The clicked button leaves the list once its title is current, so hold focus on the region meanwhile.
    region.current?.focus({ preventScroll: true })
    setRenameState({ status: 'pending', title })
    let accepted: string
    try {
      accepted = await rename(title)
    } catch (error) {
      setRenameState({ status: 'failed', message: error instanceof Error ? error.message : String(error) })
      focusAfterRestore(group.revision.seq, 'same')
      return
    }
    // Keep the buttons disabled until the list shows the accepted write.
    try {
      const rows = await loadHistory(target.sessionId, new AbortController().signal)
      setState({ status: 'loaded', rows })
    } catch {
      setState({ status: 'failed' })
    }
    setRenameState({ status: 'restored', title: accepted })
    focusAfterRestore(group.revision.seq, 'older')
  }
  const pending = renameState.status === 'pending'
  return <div ref={region} className="title-history-content" role="region" aria-label={t('history')} tabIndex={0}>
    <div role="status">
      {state.status === 'loading' && <p>{t('loading')}</p>}
      {state.status === 'loaded' && state.rows.length === 0 && <p>{t('empty')}</p>}
      {renameState.status === 'pending' &&
        <p className="title-history-notice">{t('settingTitle', { title: renameState.title })}</p>}
      {renameState.status === 'restored' &&
        <p className="title-history-notice">{t('titleSet', { title: renameState.title })}</p>}
    </div>
    {renameState.status === 'failed' &&
      <p className="title-history-notice" role="alert">{t('setTitleFailed')} {renameState.message}</p>}
    {state.status === 'failed' && <>
      <p role="alert">{t('failed')}</p>
      {Button ? <Button variant="outline" onClick={retry}>{t('retry')}</Button>
        : <button type="button" onClick={retry}>{t('retry')}</button>}
    </>}
    {state.status === 'loaded' && state.rows.length > 0 &&
      <HistoryList rows={state.rows} t={t} language={language} ui={ui} busy={pending}
        actions={canRename ? { run: restore } : undefined} />}
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
    const rename = (title: string) => reapplyTitle(ctx.sessions, target.sessionId, title)
    const content = <HistoryContent key={target.sessionId} target={target} t={t} language={ctx.locale.getLocale().active}
      ui={ui} canRename={canRename} rename={rename} />
    return Modal
      ? <Modal open className="title-history-modal" contentClassName="title-history-modal-content" onClose={close} title={t('history')} closeLabel={t('close')}>{content}</Modal>
      : <BrowserModal onClose={close} title={t('history')} closeLabel={t('close')}>{content}</BrowserModal>
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
