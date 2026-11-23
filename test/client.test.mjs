import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { test } from 'node:test'

let registration
globalThis.window = { __ModuleLoader__: { load(entry) { registration = entry } } }
await import('../client.js')
delete globalThis.window

const id = 'dsh-session-title-history'
const require = createRequire(import.meta.url)
const plugin = registration.factory(require)

test('registers and disposes the menu, overlay, and eight complete dictionaries', () => {
  assert.equal(registration.id, `@miorin/${id}`)
  assert.deepEqual(plugin.inject, ['locale', 'slots'])
  const entries = new Map()
  const disposers = []
  let dictionaries
  plugin.apply({
    effect: effect => disposers.push(effect()),
    locale: {
      register(namespace, copy) {
        assert.equal(namespace, id)
        dictionaries = copy
        return () => { dictionaries = undefined }
      },
    },
    slots: {
      inject(slot, register) { return register() },
      register(options, component) {
        assert.equal(options.id, id)
        assert.equal(options.locale, id)
        assert.equal(typeof component, 'function')
        entries.set(options.name, component)
        return () => entries.delete(options.name)
      },
    },
  })
  assert.deepEqual([...entries.keys()], ['shell.overlay', 'sidebar.workspaces.session.menu.item'])
  assert.deepEqual(Object.keys(dictionaries).sort(), ['de', 'en', 'es', 'fr', 'ja', 'pt', 'ru', 'zh'])
  for (const copy of Object.values(dictionaries)) assert.deepEqual(Object.keys(copy), Object.keys(dictionaries.en))
  for (const dispose of disposers.reverse()) dispose()
  assert.equal(entries.size, 0)
  assert.equal(dictionaries, undefined)
})
