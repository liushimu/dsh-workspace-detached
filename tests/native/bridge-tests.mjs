import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const directory = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(path.resolve(directory, '../../native/bridge.js'), 'utf8')
let passed = 0
function check(condition, label) { assert.ok(condition, label); passed++ }
async function rejects(promise, pattern) { await assert.rejects(promise, pattern); passed++ }

function fixture({ origin = 'https://navigator.local', pathname = '/workspace-navigator.html', frame = false } = {}) {
  const messages = [], callbacks = new Map(), timers = new Map(), microtasks = []
  let timerId = 0, throwPost = false
  const carrier = {
    addEventListener(type, callback) { callbacks.set(`carrier:${type}`, callback) },
    postMessage(value) { if (throwPost) throw new Error('closed pipe'); messages.push(value) },
  }
  const window = {
    chrome: { webview: carrier },
    addEventListener(type, callback) { callbacks.set(`window:${type}`, callback) },
  }
  window.top = frame ? {} : window
  const context = vm.createContext({
    window,
    location: { origin, pathname, search: '' },
    TextEncoder,
    setTimeout(callback) { const id = ++timerId; timers.set(id, callback); return id },
    clearTimeout(id) { timers.delete(id) },
    queueMicrotask(callback) { microtasks.push(callback) },
  })
  vm.runInContext(source, context)
  return {
    window, api: window.workspaceNavigator, messages, timers,
    receive(data) { callbacks.get('carrier:message')({ data }) },
    pagehide() { callbacks.get('window:pagehide')() },
    microtasks() { while (microtasks.length) microtasks.shift()() },
    throwPost(value) { throwPost = value },
  }
}

const test = fixture()
check(Object.keys(test.api).sort().join(',') === 'command,ready,rendered,subscribe', 'only the approved API')
check(Object.isFrozen(test.api), 'immutable API object')
check(!Object.getOwnPropertyDescriptor(test.window, 'workspaceNavigator').writable, 'cannot replace bridge')
let observed
const unsubscribe = test.api.subscribe(model => { observed = model })
const model = { instance: 'fixture-only', revision: 1 }
test.receive({ op: 'model', model })
check(observed === model, 'model subscription')
const ready = test.api.ready()
check(test.messages[0].op === 'ready' && typeof test.messages[0].id === 'string', 'ready uses string id')
test.receive({ op: 'result', id: test.messages[0].id, value: model })
check(await ready === model, 'ready resolves Host model')
const rendered = test.api.rendered({ instance: 'fixture-only', revision: 1 })
check(test.messages[1].op === 'rendered' && test.messages[1].value.revision === 1, 'actual renderer confirmation forwarded')
test.receive({ op: 'result', id: test.messages[1].id, value: null })
check(await rendered === null, 'rendered resolves null')
const command = test.api.command({ type: 'return' })
test.receive({ op: 'result', id: test.messages.at(-1).id, value: { kind: 'accepted' } })
check((await command).kind === 'accepted', 'finite command reply')
const unavailable = test.api.command({ type: 'return' })
test.receive({ op: 'result', id: test.messages.at(-1).id, value: { error: 'unavailable' } })
await rejects(unavailable, /unavailable/u)
const malformedError = test.api.ready()
test.receive({ op: 'result', id: test.messages.at(-1).id, value: { error: { untrusted: 'not reflected' } } })
await rejects(malformedError, /host-error/u)
const malformedReply = test.api.ready()
test.receive({ op: 'result', id: test.messages.at(-1).id })
await rejects(malformedReply, /invalid-reply/u)
check(test.timers.size === 0, 'reply failure clears pending timer')
unsubscribe()
observed = undefined
test.receive({ op: 'model', model: { revision: 2 } })
check(observed === undefined, 'unsubscribe is effective')
let replay
const removeReplay = test.api.subscribe(value => { replay = value })
test.microtasks()
check(replay.revision === 2, 'one latest model replay')
removeReplay()
const timeout = test.api.ready()
for (const callback of [...test.timers.values()]) callback()
await rejects(timeout, /reply-timeout/u)
// Fake timer callbacks are not automatically removed by this test harness.
test.timers.clear()
test.receive({ op: 'result', id: test.messages.at(-1).id, value: null })
check(test.timers.size === 0, 'late reply cannot recreate a request')
const budget = Array.from({ length: 128 }, () => test.api.ready())
await rejects(test.api.ready(), /too-many-pending/u)
for (const message of test.messages.slice(-128)) test.receive({ op: 'result', id: message.id, value: null })
check((await Promise.all(budget)).length === 128, 'bounded pending requests all resolve')
check(test.timers.size === 0, 'bounded pending timers are cleared')
await rejects(test.api.command({ query: '汉'.repeat(Math.floor(4 * 1024 * 1024 / 3)) }), /payload-too-large/u)
await rejects(test.api.rendered(null), /invalid-message/u)
const cyclic = {}; cyclic.self = cyclic
await rejects(test.api.command(cyclic), /circular/u)
test.throwPost(true)
await rejects(test.api.ready(), /transport-failed/u)
check(test.timers.size === 0, 'post failure removes pending request')
test.throwPost(false)
const pendingClose = test.api.ready()
test.pagehide()
await rejects(pendingClose, /closed/u)
await rejects(test.api.ready(), /closed/u)
assert.throws(() => test.api.subscribe(() => {}), /closed/u); passed++
check(fixture({ origin: 'https://example.invalid' }).api === undefined, 'bridge never installed for external origin')
check(fixture({ pathname: '/other.html' }).api === undefined, 'bridge only installed for fixed document')
check(fixture({ frame: true }).api === undefined, 'bridge not installed in frames')
console.log(JSON.stringify({ op: 'bridge-tests', passed, guiLaunched: false }))
