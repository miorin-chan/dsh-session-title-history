import assert from 'node:assert/strict'
import { test } from 'node:test'
import { assertSupportedJsonSchema, validateJsonSchemaValue } from '@deepseek-ai/dsh-tools'
import { LIST_LIMIT, parseArgs, render, titleHistoryTool, TOOL_NAME } from '../lib/tool.js'
import { createHistory } from '../lib/history.js'

const user = { kind: 'user' }
const provider = { kind: 'provider', provider: 'title-provider', model: { provider: 'fixture', model: 'model' } }
const fallback = { kind: 'fallback' }
const title = (seq, text, source) => ({ type: 'session/title', seq, time: 1000 + seq, data: { title: text, source, messageSeqs: [] } })
const events = [
  title(1, 'Initial', fallback),
  { type: 'turn/start', seq: 2, time: 1002, data: { turn: 1 } },
  title(3, 'Generated', provider),
  title(4, 'Renamed', user),
  title(5, 'Renamed', user),
]

/** Host services recording what the tool calls, plus one tool built over them. */
function fixture({ rows = events, inheritedEventCount = 4, missing = false, rename } = {}) {
  const calls = { renamed: [], disposed: 0, reads: [] }
  const edits = new Map()
  const history = createHistory({
    async observeSession(sessionId, options) {
      calls.reads.push({ sessionId, options })
      if (missing) throw Object.assign(new Error('Missing'), { code: 'SESSION_QUERY_SESSION_NOT_FOUND' })
      return { events: rows, inheritedEventCount, [Symbol.dispose]() { calls.disposed++ } }
    },
  }, {
    get: key => edits.get(key),
    async put(key, value) { edits.set(key, value) },
    async delete(key) { return edits.delete(key) },
  })
  const services = {
    history,
    sessionController: {
      async rename(request) {
        calls.renamed.push(request)
        if (typeof rename === 'function') return rename(request)
        if (rename !== undefined) throw rename
        return { title: request.title.trim(), seq: 9 }
      },
    },
  }
  return { calls, tool: titleHistoryTool(services) }
}

const context = (sessionId, signal = new AbortController().signal) => ({
  signal,
  ...(sessionId === undefined ? {} : { agent: { session: { header: { id: sessionId } } } }),
})
const valueOf = async (tool, args, sessionId = 'session-one') => {
  const value = await tool.execute(args, context(sessionId))
  const violations = [...validateJsonSchemaValue(tool.output.schema, value), ...validateJsonSchemaValue(tool.output.schema, value, '$')]
  assert.deepEqual([...new Set(violations)], [], `output schema rejects ${JSON.stringify(value)}`)
  return value
}

test('declares a compact tool whose schemas are within the supported JSON Schema subset', () => {
  const { tool } = fixture()
  assert.equal(tool.name, TOOL_NAME)
  assert.doesNotThrow(() => assertSupportedJsonSchema(tool.output.schema))
  assert.equal(tool.parameters.type, 'object')
  assert.equal(tool.parameters.additionalProperties, false)
  assert.deepEqual(tool.parameters.required, ['action'])
  assert.deepEqual(Object.keys(tool.parameters.properties).sort(), ['action', 'seq', 'sessionId', 'title'])
  const definition = JSON.stringify({ name: tool.name, description: tool.description, parameters: tool.parameters })
  assert.ok(definition.length < 1600, `definition is ${definition.length} characters`)
})

test('validates arguments before any Host work', () => {
  assert.deepEqual(parseArgs({ action: 'list' }), { args: { action: 'list', sessionId: undefined } })
  assert.deepEqual(parseArgs({ action: 'restore', title: 'Alpha', sessionId: 'session-two' }),
    { args: { action: 'restore', title: 'Alpha', sessionId: 'session-two' } })
  assert.deepEqual(parseArgs({ action: 'edit', seq: 0, title: 'Revised' }),
    { args: { action: 'edit', seq: 0, title: 'Revised', sessionId: undefined } })
  for (const [args, message] of [
    ['list', 'Arguments must be an object.'],
    [{ action: 'erase' }, 'action must be "list", "restore", or "edit".'],
    [{ action: 'edit', seq: 1.5, title: 'Revised' }, 'edit needs the seq of a past title from "list" and the new title text.'],
    [{ action: 'edit', seq: 3 }, 'edit needs the seq of a past title from "list" and the new title text.'],
    [{ action: 'restore' }, 'restore needs title: the exact text of a past title from action "list".'],
    [{ action: 'restore', title: '  ' }, 'restore needs title: the exact text of a past title from action "list".'],
    [{ action: 'list', sessionId: '' }, 'sessionId must be a non-empty string when given.'],
    [{ action: 'list', sessionId: 7 }, 'sessionId must be a non-empty string when given.'],
  ]) {
    assert.deepEqual(parseArgs(args), { failure: { ok: false, reason: 'invalid-arguments', message } })
  }
})

test('list returns title changes newest first with the current title first and same-text writes counted', async () => {
  const { tool, calls } = fixture()
  const value = await valueOf(tool, { action: 'list' })
  assert.equal(value.ok, true)
  assert.equal(value.action, 'list')
  assert.equal(value.sessionId, 'session-one')
  assert.equal(value.current, 'Renamed')
  assert.equal(value.omitted, 0)
  assert.deepEqual(value.titles, [
    { title: 'Renamed', seq: 4, time: 1004, source: 'user', inherited: false, repeats: 1 },
    { title: 'Generated', seq: 3, time: 1003, source: 'provider', inherited: true, repeats: 0 },
    { title: 'Initial', seq: 1, time: 1001, source: 'fallback', inherited: true, repeats: 0 },
  ])
  assert.deepEqual(calls.reads, [{ sessionId: 'session-one', options: { signal: context('session-one').signal, projectionMode: 'none' } }])
  assert.equal(calls.disposed, 1, 'the observation is released')
  assert.equal(calls.renamed.length, 0)
  const [{ text }] = render(null, value)
  assert.equal(text, [
    'Title history of session session-one, newest first:',
    '1. “Renamed” — current, written 2 times',
    '2. “Generated” — automatically generated, inherited from the parent session',
    '3. “Initial” — built-in rule, inherited from the parent session',
  ].join('\n'))
})

test('list acts on the named session and bounds what it returns', async () => {
  const many = Array.from({ length: LIST_LIMIT + 10 }, (_, index) => title(index + 1, `Title ${index + 1}`, user))
  const { tool, calls } = fixture({ rows: many, inheritedEventCount: 0 })
  const value = await valueOf(tool, { action: 'list', sessionId: 'session-two' })
  assert.equal(value.sessionId, 'session-two')
  assert.equal(value.current, `Title ${LIST_LIMIT + 10}`)
  assert.equal(value.titles.length, LIST_LIMIT)
  assert.equal(value.titles.at(-1).title, 'Title 11')
  assert.equal(value.omitted, 10)
  assert.match(render(null, value)[0].text, /10 older titles not shown\.$/)
  assert.equal(calls.reads[0].sessionId, 'session-two')
})

test('an empty history, a missing session, and an unreadable history are three distinct outcomes', async () => {
  const empty = await valueOf(fixture({ rows: [events[1]] }).tool, { action: 'list' })
  assert.deepEqual(empty, { ok: true, action: 'list', sessionId: 'session-one', current: null, titles: [], omitted: 0 })
  assert.equal(render(null, empty)[0].text, 'Session session-one has no title history.')
  const missing = await valueOf(fixture({ missing: true }).tool, { action: 'list' })
  assert.deepEqual(missing, { ok: false, reason: 'session-not-found', message: 'Session session-one was not found.' })
  const unreadable = await valueOf(fixture({ rows: null }).tool, { action: 'list' })
  assert.deepEqual(unreadable, { ok: false, reason: 'history-unavailable', message: 'Could not read the title history of session session-one.' })
  assert.match(render(null, unreadable)[0].text, /^Could not read/)
})

test('without a session to act on, the call fails before reading anything', async () => {
  const { tool, calls } = fixture()
  const value = await tool.execute({ action: 'list' }, context(undefined))
  assert.deepEqual(value, { ok: false, reason: 'no-session', message: 'No session to act on: pass sessionId when calling outside a session.' })
  assert.equal(calls.reads.length, 0)
})

test('restore re-applies a past title through the same Host rename the dialog uses', async () => {
  const { tool, calls } = fixture()
  const value = await valueOf(tool, { action: 'restore', title: ' Generated ' })
  assert.deepEqual(calls.renamed, [{ sessionId: 'session-one', title: 'Generated' }])
  assert.deepEqual(value, {
    ok: true, action: 'restore', sessionId: 'session-one', previousTitle: 'Renamed', title: 'Generated', seq: 9,
  })
  assert.equal(render(null, value)[0].text, 'Session title restored to “Generated”; it was “Renamed”.')
  // The named session is renamed, not the caller's.
  await tool.execute({ action: 'restore', title: 'Generated', sessionId: 'session-two' }, context('session-one'))
  assert.equal(calls.renamed.at(-1).sessionId, 'session-two')
})

test('restore refuses titles the session never had and the title it already has', async () => {
  const { tool, calls } = fixture()
  assert.deepEqual(await valueOf(tool, { action: 'restore', title: 'Invented' }), {
    ok: false, reason: 'unknown-title', message: '“Invented” is not a title this session had. Use action "list" to see its titles.',
  })
  assert.deepEqual(await valueOf(tool, { action: 'restore', title: 'Renamed' }), {
    ok: false, reason: 'already-current', message: '“Renamed” is already the current title.',
  })
  assert.equal(calls.renamed.length, 0, 'a refusal never reaches the rename')
})

test('edit replaces just the selected past entry and restore accepts its displayed title', async () => {
  const { tool, calls } = fixture()
  const saved = await valueOf(tool, { action: 'edit', seq: 3, title: 'Initial' })
  assert.deepEqual(saved, { ok: true, action: 'edit', sessionId: 'session-one', seq: 3, title: 'Initial' })
  const listed = await valueOf(tool, { action: 'list' })
  assert.equal(listed.current, 'Renamed')
  assert.deepEqual(listed.titles.map(({ title, seq, edited }) => ({ title, seq, edited })), [
    { title: 'Renamed', seq: 4, edited: undefined },
    { title: 'Initial', seq: 3, edited: true },
    { title: 'Initial', seq: 1, edited: undefined },
  ])
  assert.equal(calls.renamed.length, 0)
  assert.equal((await valueOf(tool, { action: 'edit', seq: 3, title: ' ' })).reason, 'title-invalid')
  assert.equal((await valueOf(tool, { action: 'edit', seq: 4, title: 'New current' })).reason, 'past-title-not-found')
  assert.deepEqual((await valueOf(tool, { action: 'list' })).titles, listed.titles)
  const restored = await valueOf(tool, { action: 'restore', title: 'Initial' })
  assert.equal(restored.title, 'Initial')
  assert.deepEqual(calls.renamed, [{ sessionId: 'session-one', title: 'Initial' }])
})

test('a refused rename reports the Host reason and code', async () => {
  const refusal = Object.assign(new Error('Title is too long'), { code: 'session/title-invalid' })
  const { tool } = fixture({ rename: refusal })
  const value = await valueOf(tool, { action: 'restore', title: 'Generated' })
  assert.deepEqual(value, {
    ok: false, reason: 'rename-refused', message: 'The title was not changed: Title is too long', code: 'session/title-invalid',
  })
  assert.equal(render(null, value)[0].text, 'The title was not changed: Title is too long (session/title-invalid)')
  const opaque = await valueOf(fixture({ rename: 'boom' }).tool, { action: 'restore', title: 'Generated' })
  assert.deepEqual(opaque, { ok: false, reason: 'rename-refused', message: 'The title was not changed: boom' })
})

test('cancellation is left to the executor instead of becoming a failure value', async () => {
  const { tool } = fixture()
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(tool.execute({ action: 'list' }, context('session-one', controller.signal)), { name: 'AbortError' })
})

test('invalid arguments fail without touching the Host, and the call card names the action', async () => {
  const { tool, calls } = fixture()
  const value = await tool.execute({ action: 'restore' }, context('session-one'))
  assert.deepEqual(value, { ok: false, reason: 'invalid-arguments', message: 'restore needs title: the exact text of a past title from action "list".' })
  assert.equal(calls.reads.length, 0)
  assert.deepEqual(tool.presentCall({ action: 'restore', title: 'Alpha' }), { card: 'generic', title: 'Restore session title', kind: 'edit', rawInput: 'Alpha' })
  assert.deepEqual(tool.presentCall({ action: 'list' }), { card: 'generic', title: 'Session title history', kind: 'read' })
  assert.equal(tool.presentCall({ action: 'erase' }), undefined)
})
