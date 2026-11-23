import assert from 'node:assert/strict'
import { test } from 'node:test'
import { apply, inject } from '../index.js'
import { groupTitleHistory, HISTORY_PATH, titleHistory } from '../lib/history.js'

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

test('keeps accepted title writes in sequence order, including identical and inherited titles', () => {
  assert.deepEqual(titleHistory(events, 4), [
    { seq: 5, time: 1005, title: 'Renamed', previousTitle: 'Renamed', source: user, inherited: false },
    { seq: 4, time: 1004, title: 'Renamed', previousTitle: 'Generated', source: user, inherited: false },
    { seq: 3, time: 1003, title: 'Generated', previousTitle: 'Initial', source: provider, inherited: true },
    { seq: 1, time: 1001, title: 'Initial', previousTitle: null, source: fallback, inherited: true },
  ])
  assert.deepEqual(titleHistory([events[1]], 0), [])
})

test('groups adjacent same-title writes without merging distinct revisions that return to the same title', () => {
  const revisions = titleHistory([
    ...events,
    title(6, 'Renamed', provider),
    title(7, 'Different', user),
    title(8, 'Renamed', user),
  ], 6)
  const groups = groupTitleHistory(revisions)
  assert.deepEqual(groups.map(({ revision, unchanged }) => [revision.seq, unchanged.map(row => row.seq)]), [
    [8, []], [7, []], [4, [6, 5]], [3, []], [1, []],
  ])
  assert.equal(groups[2].unchanged[1].inherited, true)
  assert.equal(groups[2].unchanged[0].source, provider)
  assert.deepEqual(groupTitleHistory([]), [])
})

test('the route and tool share history edits and release their storage, observations and registrations', async () => {
  const disposers = []
  let route
  let tool
  let reads = 0
  let released = 0
  let readSignal
  let closed = false
  let writeFailure = false
  const edits = new Map()
  await apply({
    effect: effect => disposers.push(effect()),
    storageDomain: {
      async open(spec) {
        assert.equal(spec.name, 'session_title_history')
        assert.equal(spec.tables.edits.valueSchema.safeParse('Title').success, true)
        assert.equal(spec.tables.edits.valueSchema.safeParse('').success, false)
        return {
          table(name) {
            assert.equal(name, 'edits')
            return {
              get: key => edits.get(key),
              async put(key, value) {
                if (writeFailure) throw new Error('Storage write failed')
                edits.set(key, value)
              },
              async delete(key) { return edits.delete(key) },
            }
          },
          async close() { closed = true },
        }
      },
    },
    connection: { fetch: { register(next) { route = next; return () => { route = undefined } } } },
    sessionController: {},
    tools: { register(definition) { tool = definition; return () => { tool = undefined } } },
    sessionQuery: {
      observeSession(id, options) {
        reads++
        if (id === 'missing') throw Object.assign(new Error('Missing'), { code: 'SESSION_QUERY_SESSION_NOT_FOUND' })
        assert.ok(id === 'example-session' || id === 'other-session')
        assert.equal(options.projectionMode, 'none')
        readSignal = options.signal
        return { events, inheritedEventCount: 4, [Symbol.dispose]() { released++ } }
      },
    },
  })
  assert.deepEqual(inject, ['connection', 'sessionQuery', 'sessionController', 'storageDomain', 'tools'])
  assert.equal(tool.name, 'session_title_history')
  assert.equal(route.path, HISTORY_PATH)
  assert.deepEqual(route.methods, ['GET', 'POST'])
  const request = (id, init) => route.fetch(new Request(`http://localhost${HISTORY_PATH}?sessionId=${id}`, init))
  const post = (seq, title) => request('example-session', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ seq, title }),
  })
  assert.equal((await request('%00')).status, 400)
  assert.equal((await request('example-session', { method: 'POST', body: '{}' })).status, 415)
  assert.deepEqual(await (await post(-1, 'Text')).json(), { error: 'invalid-edit' })
  assert.deepEqual(await (await post(3, ' \u200B ')).json(), { error: 'title-invalid' })
  assert.equal(reads, 0)
  assert.equal((await request('missing')).status, 404)
  const response = await request('example-session')
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  const original = titleHistory(events, 4)
  assert.deepEqual(await response.json(), { history: original, canEdit: true })
  assert.equal(released, 1)

  for (const seq of [4, 5, 99]) {
    const rejected = await post(seq, 'Text')
    assert.equal(rejected.status, 404)
    assert.deepEqual(await rejected.json(), { error: 'past-title-not-found' })
  }
  assert.equal(edits.size, 0)
  const saved = await post(3, '  历\u200B史\t标题  ')
  assert.equal(saved.status, 200)
  assert.deepEqual(await saved.json(), { title: '历史 标题' })
  const read = async (id = 'example-session') => (await (await request(id)).json()).history
  assert.deepEqual(await read(), original.map(row => row.seq === 3 ? { ...row, editedTitle: '历史 标题' } : row))
  assert.deepEqual(await read('other-session'), original)
  writeFailure = true
  assert.equal((await post(3, 'Failed')).status, 500)
  assert.equal((await read()).find(row => row.seq === 3).editedTitle, '历史 标题')
  writeFailure = false

  const context = { signal: new AbortController().signal }
  const edit = await tool.execute({ action: 'edit', seq: 3, title: 'From tool', sessionId: 'example-session' }, context)
  assert.deepEqual(edit, { ok: true, action: 'edit', seq: 3, title: 'From tool', sessionId: 'example-session' })
  assert.equal((await read()).find(row => row.seq === 3).editedTitle, 'From tool')
  assert.equal((await post(3, 'Generated')).status, 200)
  assert.deepEqual(await read(), original)
  assert.deepEqual(titleHistory(events, 4), original, 'editing preserves the original log')
  assert.equal(released, reads - 1, 'every successful observation was released')
  for (const dispose of disposers.reverse()) await dispose()
  assert.equal(route, undefined)
  assert.equal(tool, undefined)
  assert.equal(readSignal.aborted, true)
  assert.equal(closed, true)
})
