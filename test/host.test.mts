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

test('reads exactly one session, rejects missing input, and releases the observation, tool, and route', async () => {
  const disposers = []
  let route
  let tool
  let reads = 0
  let released = 0
  let readSignal
  apply({
    effect: effect => disposers.push(effect()),
    connection: { fetch: { register(next) { route = next; return () => { route = undefined } } } },
    sessionController: {},
    tools: { register(definition) { tool = definition; return () => { tool = undefined } } },
    sessionQuery: {
      observeSession(id, options) {
        reads++
        if (id === 'missing') throw Object.assign(new Error('Missing'), { code: 'SESSION_QUERY_SESSION_NOT_FOUND' })
        assert.equal(id, 'example-session')
        assert.equal(options.projectionMode, 'none')
        readSignal = options.signal
        return { events, inheritedEventCount: 4, [Symbol.dispose]() { released++ } }
      },
    },
  })
  assert.deepEqual(inject, ['connection', 'sessionQuery', 'sessionController', 'tools'])
  assert.equal(tool.name, 'session_title_history')
  assert.equal(route.path, HISTORY_PATH)
  assert.deepEqual(route.methods, ['GET'])
  const get = query => route.fetch(new Request(`http://localhost${HISTORY_PATH}?${query}`))
  assert.equal((await get('sessionId=%00')).status, 400)
  assert.equal(reads, 0)
  assert.equal((await get('sessionId=missing')).status, 404)
  const response = await get('sessionId=example-session')
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('Cache-Control'), 'no-store')
  assert.deepEqual(await response.json(), { history: titleHistory(events, 4) })
  assert.equal(released, 1)
  for (const dispose of disposers.reverse()) dispose()
  assert.equal(route, undefined)
  assert.equal(tool, undefined)
  assert.equal(readSignal.aborted, true)
})
