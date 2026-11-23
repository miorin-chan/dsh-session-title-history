import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ContextMenuTargetMap } from '@deepseek-ai/dsh-client-ui-context-menu/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { groupTitleHistory, HISTORY_PATH } from '../lib/history.js'
import type { TitleHistoryGroup, TitleRevision } from '../lib/history.js'
import { labels } from './locale.js'

const ID = 'dsh-session-title-history'
const MENU_ICON = 'contextMenu.icon'
const OVERLAY = 'shell.overlay'

export const inject = ['locale', 'slots', 'contextMenus']

type Translation = PropsLocale<typeof ID>['t']
type Target = ContextMenuTargetMap['session']
type Primitives = Pick<typeof import('@deepseek-ai/dsh-client-ui-primitives'),
  'Modal' | 'Button' | 'Tooltip' | 'IconClockOutlineRegular' | 'IconChevronDownOutlineRegular'>
type LoadState = { status: 'loading' | 'failed' } | { status: 'loaded'; rows: TitleRevision[] }
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
  .title-history-list, .title-history-repeats { margin: 0; padding: 0; list-style: none; }
  .title-history-group { padding: 10px 0; }
  .title-history-group + .title-history-group { border-top: 1px solid var(--dsw-alias-border-l1); }
  .title-history-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
  .title-history-title { margin: 0; font-size: 14px; font-weight: 500; line-height: 22px; overflow-wrap: anywhere; }
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
  .title-history-disclosure { flex: none; margin-block: -3px; transition: opacity var(--ds-transition-duration); }
  .title-history-disclosure svg { transition: transform var(--ds-transition-duration); }
  .title-history-disclosure[aria-expanded="true"] svg { transform: rotate(180deg); }
  @media (hover: hover) and (pointer: fine) {
    .title-history-disclosure[aria-expanded="false"] { opacity: 0; }
    .title-history-group:hover .title-history-disclosure,
    .title-history-group:focus-within .title-history-disclosure { opacity: 1; }
  }
  @media (any-pointer: coarse) {
    .title-history-disclosure[aria-expanded="false"] { opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .title-history-disclosure, .title-history-disclosure svg { transition: none; }
  }
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

function HistoryGroup({ group, dates, t, ui }: {
  group: TitleHistoryGroup
  dates: Intl.DateTimeFormat
  t: Translation
  ui: Partial<Primitives>
}) {
  const [expanded, setExpanded] = useState(false)
  const repeatsId = useId()
  const { revision, unchanged } = group
  const { Button, Tooltip, IconChevronDownOutlineRegular: Chevron } = ui
  const disclosureLabel = t(expanded ? 'hideUnchanged' : 'showUnchanged', { count: unchanged.length })
  const disclosure = {
    type: 'button' as const,
    className: 'title-history-disclosure',
    'aria-label': disclosureLabel,
    'aria-expanded': expanded,
    'aria-controls': repeatsId,
    onClick: () => setExpanded(!expanded),
  }
  const icon = Chevron ? <Chevron size={14} /> : <span aria-hidden="true">{expanded ? '⌃' : '⌄'}</span>
  return <li className="title-history-group">
    <div className="title-history-heading">
      <p className="title-history-title" dir="auto">{revision.title}</p>
      {unchanged.length > 0 && (Button
        ? <Button {...disclosure} size="sm" variant="ghost" icon={icon} />
        : <button {...disclosure} title={disclosureLabel}>{icon}</button>)}
    </div>
    <RevisionMeta row={revision} dates={dates} t={t} Tooltip={Tooltip} />
    {unchanged.length > 0 && <ol id={repeatsId} className="title-history-repeats" role="list" hidden={!expanded}>
      {expanded && unchanged.map(row => <li key={row.seq}>
        <RevisionMeta row={row} dates={dates} t={t} Tooltip={Tooltip} unchanged />
      </li>)}
    </ol>}
  </li>
}

function HistoryList({ rows, t, language, ui }: {
  rows: TitleRevision[]
  t: Translation
  language: string
  ui: Partial<Primitives>
}) {
  const dates = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'medium' })
  return <ol className="title-history-list" role="list">{groupTitleHistory(rows).map(group =>
    <HistoryGroup key={group.revision.seq} group={group} dates={dates} t={t} ui={ui} />
  )}</ol>
}

function HistoryContent({ target, t, language, ui }: {
  target: Target
  t: Translation
  language: string
  ui: Partial<Primitives>
}) {
  const { Button } = ui
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
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
  return <div ref={region} className="title-history-content" role="region" aria-label={t('history')} tabIndex={0}>
    <div role="status">
      {state.status === 'loading' && <p>{t('loading')}</p>}
      {state.status === 'loaded' && state.rows.length === 0 && <p>{t('empty')}</p>}
    </div>
    {state.status === 'failed' && <>
      <p role="alert">{t('failed')}</p>
      {Button ? <Button variant="outline" onClick={retry}>{t('retry')}</Button>
        : <button type="button" onClick={retry}>{t('retry')}</button>}
    </>}
    {state.status === 'loaded' && state.rows.length > 0 && <HistoryList rows={state.rows} t={t} language={language} ui={ui} />}
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

  function HistoryOverlay({ t }: PropsLocale<typeof ID>) {
    const selected = useSyncExternalStore(subscribe, getTarget)
    if (!selected) return <style>{css}</style>
    const content = <HistoryContent key={selected.sessionId} target={selected} t={t} language={ctx.locale.getLocale().active}
      ui={ui} />
    return <><style>{css}</style>{Modal
      ? <Modal open className="title-history-modal" contentClassName="title-history-modal-content" onClose={close} title={t('history')} closeLabel={t('close')}>{content}</Modal>
      : <BrowserModal onClose={close} title={t('history')} closeLabel={t('close')}>{content}</BrowserModal>}
    </>
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
