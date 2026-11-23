import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

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
  assert.deepEqual(plugin.inject, ['locale', 'slots', 'contextMenus'])
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
  assert.deepEqual(action, { id: 'open', label: 'Title history', icon: { key: id } })
  assert.equal(typeof run, 'function')
  assert.deepEqual(Object.keys(dictionaries).sort(), ['de', 'en', 'es', 'fr', 'ja', 'pt', 'ru', 'zh'])
  for (const copy of Object.values(dictionaries)) assert.deepEqual(Object.keys(copy), Object.keys(dictionaries.en))
  for (const dispose of disposers.reverse()) dispose()
  assert.equal(entries.size, 0)
  assert.equal(dictionaries, undefined)
  assert.equal(contribution, undefined)
})
