import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { PropsRuntime, PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { HISTORY_PATH } from '../lib/history.js'
import type { TitleRevision } from '../lib/history.js'
import { labels } from './locale.js'

const ID = 'dsh-session-title-history'
const MENU = 'sidebar.workspaces.session.menu.item'
const OVERLAY = 'shell.overlay'

export const inject = ['locale', 'slots']

type Translation = PropsLocale<typeof ID>['t']
type Target = { sessionId: SessionId; displayTitle: string }
type LoadState = { status: 'loading' | 'failed' } | { status: 'loaded'; rows: TitleRevision[] }
type ModalProps = {
  title: string
  closeLabel: string
  onClose: () => void
  children: React.ReactNode
}

const css = `
  .title-history-menu {
    display: flex; align-items: center; min-height: 32px; width: 100%; padding: 4px 10px;
    text-align: start; border: 0; border-radius: 6px; font: inherit; color: inherit;
    background: transparent; cursor: pointer;
  }
  .title-history-menu:hover, .title-history-menu:focus-visible { background: var(--dsw-alias-bg-layer-2, #8882); }
  .title-history-dialog {
    color: var(--dsw-alias-label-primary, CanvasText); background: var(--dsw-alias-bg-overlay, Canvas);
    border: 1px solid var(--dsw-alias-border-l1, #8885); border-radius: 14px;
    width: min(32rem, calc(100% - 2rem)); max-height: 85vh; padding: 0; font: inherit; pointer-events: auto;
  }
  .title-history-dialog::backdrop { background: #0006; }
  .title-history-dialog > header { display: flex; align-items: center; justify-content: space-between; padding: 1rem; gap: 1rem; }
  .title-history-dialog h2 { margin: 0; font-size: 1rem; }
  .title-history-dialog header button { color: inherit; background: transparent; border: 0; font: inherit; cursor: pointer; }
  .title-history-content { width: min(30rem, 100%); max-height: min(58vh, 36rem); overflow: auto; padding: 0 .25rem; }
  .title-history-content:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, Highlight); outline-offset: -2px; }
  .title-history-dialog .title-history-content { width: auto; padding: 0 1rem 1rem; }
  .title-history-source { flex-basis: 100%; overflow-wrap: anywhere; }
  .title-history-content > p { margin: 0 0 .75rem; color: var(--dsw-alias-label-secondary, inherit); overflow-wrap: anywhere; }
  .title-history-content ol { margin: 0; padding: 0; list-style: none; }
  .title-history-content li { padding: .75rem .1rem; border-top: 1px solid var(--dsw-alias-border-l1, #8883); }
  .title-history-meta { display: flex; flex-wrap: wrap; gap: .25rem .75rem; align-items: baseline; }
  .title-history-meta time { margin-inline-start: auto; }
  .title-history-meta, .title-history-notes, .title-history-previous { color: var(--dsw-alias-label-secondary, inherit); font-size: .8125em; }
  .title-history-content li p { margin: .25rem 0 0; overflow-wrap: anywhere; white-space: pre-wrap; }
  .title-history-notes { display: flex; flex-wrap: wrap; gap: .25rem .75rem; }
`

/** Prefer the DSH shell's shared Modal when present in the browser module table. */
function nativeModal(): typeof import('@deepseek-ai/dsh-client-ui-primitives').Modal | undefined {
  try {
    const module = require('@deepseek-ai/dsh-client-ui-primitives') as Partial<typeof import('@deepseek-ai/dsh-client-ui-primitives')>
    return typeof module.Modal === 'function' ? module.Modal : undefined
  } catch {
    return undefined
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

function HistoryList({ rows, t, language }: { rows: TitleRevision[]; t: Translation; language: string }) {
  const dates = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'medium' })
  return <ol>{rows.map(row => {
    const source = row.source.kind === 'user' ? t('manual') : t(row.source.kind)
    const details = row.source.kind === 'provider'
      ? row.source.model ? `${row.source.provider} · ${row.source.model.provider}/${row.source.model.model}` : row.source.provider
      : undefined
    return <li key={row.seq}>
      <div className="title-history-meta">
        <span>{source}</span>
        <time dateTime={new Date(row.time).toISOString()}>{dates.format(row.time)}</time>
        {details !== undefined && <bdi className="title-history-source">{details}</bdi>}
      </div>
      <p><strong dir="auto">{row.title}</strong></p>
      {row.previousTitle !== null && row.previousTitle !== row.title && <p className="title-history-previous">
        {t('previous')} <bdi>{row.previousTitle}</bdi>
      </p>}
      <div className="title-history-notes">
        {row.previousTitle === null && <span>{t('first')}</span>}
        {row.previousTitle === row.title && <span>{t('unchanged')}</span>}
        {row.inherited && <span>{t('inherited')}</span>}
      </div>
    </li>
  })}</ol>
}

function HistoryContent({ target, t, language }: { target: Target; t: Translation; language: string }) {
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
  return <div ref={region} className="title-history-content" role="region" aria-label={t('history')} tabIndex={0}>
    {target.displayTitle && <p dir="auto">{target.displayTitle}</p>}
    <div role="status">
      {state.status === 'loading' && <p>{t('loading')}</p>}
      {state.status === 'loaded' && state.rows.length === 0 && <p>{t('empty')}</p>}
    </div>
    {state.status === 'failed' && <>
      <p role="alert">{t('failed')}</p>
      <button type="button" onClick={() => {
        region.current?.focus()
        setState({ status: 'loading' })
        setAttempt(attempt + 1)
      }}>{t('retry')}</button>
    </>}
    {state.status === 'loaded' && state.rows.length > 0 && <HistoryList rows={state.rows} t={t} language={language} />}
  </div>
}

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(ID, labels), `${ID}: locale`)
  const Modal = nativeModal()
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
  const close = () => setTarget(null)

  function HistoryAction({ sessionId, displayTitle, useMenuOpenState, t }: PropsRuntime<typeof MENU> & PropsLocale<typeof ID>) {
    const [, setOpen] = useMenuOpenState()
    return <button className="title-history-menu" type="button" role="menuitem" onClick={() => {
      setOpen(false)
      setTarget({ sessionId, displayTitle })
    }}>{t('history')}</button>
  }

  function HistoryOverlay({ t }: PropsLocale<typeof ID>) {
    const selected = useSyncExternalStore(subscribe, getTarget)
    if (!selected) return <style>{css}</style>
    const content = <HistoryContent key={selected.sessionId} target={selected} t={t} language={ctx.locale.getLocale().active} />
    return <><style>{css}</style>{Modal
      ? <Modal open onClose={close} title={t('history')} closeLabel={t('close')}>{content}</Modal>
      : <BrowserModal onClose={close} title={t('history')} closeLabel={t('close')}>{content}</BrowserModal>}
    </>
  }

  ctx.effect(() => ctx.slots.inject(OVERLAY, () => ctx.slots.register({ name: OVERLAY, id: ID, locale: ID }, HistoryOverlay)), `${ID}: overlay`)
  ctx.effect(() => ctx.slots.inject(MENU, () => ctx.slots.register({ name: MENU, id: ID, locale: ID }, HistoryAction)), `${ID}: menu`)
}
