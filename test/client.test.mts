import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'
import { reapplyTitle } from '../src/client/rename.ts'

let registration
globalThis.window = { __ModuleLoader__: { load(entry) { registration = entry } } }
await import('../client.js')
delete globalThis.window

const id = 'dsh-session-title-history'
const require = createRequire(import.meta.url)
const plugin = registration.factory(name => name === '@deepseek-ai/dsh-client-ui-primitives'
  ? { IconClockOutlineRegular: () => null }
  : require(name))

test('registers one native session action with a keyed icon and disposes its resources', () => {
  assert.equal(registration.id, `@miorin/${id}`)
  assert.deepEqual(plugin.inject, ['locale', 'slots', 'contextMenus', 'sessions'])
  const entries = new Map()
  const disposers = []
  let dictionaries
  let contribution
  const locale = {
    register(namespace, copy) {
      assert.equal(namespace, id)
      dictionaries = copy
      return () => { dictionaries = undefined }
    },
    bind(namespace) {
      assert.equal(namespace, id)
      return key => dictionaries.en[key]
    },
  }
  plugin.apply({
    effect: effect => disposers.push(effect()),
    locale,
    sessions: {},
    slots: {
      inject(slot, register) { return register() },
      register(options, component) {
        assert.equal(options.id ?? options.key, id)
        assert.equal(typeof component, 'function')
        entries.set(options.name, component)
        return () => entries.delete(options.name)
      },
    },
    contextMenus: {
      register(menu) {
        assert.equal(contribution, undefined)
        contribution = menu
        return () => { contribution = undefined }
      },
    },
  })
  assert.deepEqual([...entries.keys()], ['shell.overlay', 'contextMenu.icon'])
  assert.equal(contribution.target, 'session')
  assert.equal(contribution.order, 449)
  assert.deepEqual(contribution.observe(), [locale])
  const [{ run, ...action }] = contribution.resolve({ sessionId: 'session-one', displayTitle: 'Example' })
  assert.deepEqual(action, { id: 'open', label: 'Title history', icon: { key: id }, separatorBefore: true })
  assert.equal(typeof run, 'function')
  assert.deepEqual(Object.keys(dictionaries).sort(), ['de', 'en', 'es', 'fr', 'ja', 'pt', 'ru', 'zh'])
  for (const copy of Object.values(dictionaries)) assert.deepEqual(Object.keys(copy), Object.keys(dictionaries.en))
  for (const dispose of disposers.reverse()) dispose()
  assert.equal(entries.size, 0)
  assert.equal(dictionaries, undefined)
  assert.equal(contribution, undefined)
})

/** A sessions service whose retained reference exposes the given `rename`. */
function sessionsWith(rename) {
  const acquisitions = []
  return {
    acquisitions,
    async using(target, options, operation) {
      acquisitions.push({ target, options })
      return operation({ binding: { session: { rename } } })
    },
  }
}

test('re-applies a past title through the native rename path under its own reference source', async () => {
  const renames = []
  const sessions = sessionsWith(async title => {
    renames.push(title)
    return { ok: true, value: { title: title.trim(), seq: 9 } }
  })
  assert.equal(await reapplyTitle(sessions, 'session-one', '  Past title  '), 'Past title')
  assert.deepEqual(sessions.acquisitions, [{ target: 'session-one', options: { source: id } }])
  assert.deepEqual(renames, ['  Past title  '])
})

test('surfaces the Host reason when the rename is refused, and the failure when the Session cannot be acquired', async () => {
  const refused = sessionsWith(async () => ({ ok: false, error: { code: 'session/title-invalid', message: 'Title is too long' } }))
  await assert.rejects(reapplyTitle(refused, 'session-one', 'Past title'), /Title is too long/)
  const unreachable = { async using() { throw new Error('Session is unavailable') } }
  await assert.rejects(reapplyTitle(unreachable, 'session-one', 'Past title'), /Session is unavailable/)
})
