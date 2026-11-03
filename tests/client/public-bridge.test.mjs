import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { webcrypto } from 'node:crypto'
import { EventMailbox } from '../../src/host/events.js'
import { HostBridge } from '../../src/host/bridge.js'
import { CONFIG, FakeRuntime, command, deadline, defer, model, peer } from '../host/fixtures.mjs'

const source = readFileSync(new URL('../../src/client.js', import.meta.url), 'utf8')
const start = source.indexOf('    const nativeNavigatorApi = (connection) => {')
const end = source.indexOf('    const navigationStyle', start)
assert.ok(start >= 0 && end > start)

function factory(errors = []) {
  return vm.runInNewContext(source.slice(start, end) + '\nnativeNavigatorApi', {
    crypto: webcrypto, AbortController,
    console: { error: (...args) => errors.push(args) },
  })
}

const turn = () => new Promise(resolve => setImmediate(resolve))
function transport() {
  const calls = [], pending = []
  let lastSequence = 0, bindingId = '1'.repeat(32)
  const connection = { rpc: { call: async (channel, method, payload, signal) => {
    calls.push({ channel, method, payload, signal })
    if (method !== 'events') return { ok: true, value: method === 'capabilities' ? { protocolVersion: 3, available: true, bindingId } : null }
    return new Promise((resolve, reject) => {
      const item = { resolve, reject, signal }
      pending.push(item)
      const abort = () => { const at = pending.indexOf(item); if (at !== -1) pending.splice(at, 1); reject(new Error('aborted')) }
      if (signal.aborted) abort()
      else signal.addEventListener('abort', abort, { once: true })
    })
  } } }
  return {
    connection, calls, pending,
    replaceBinding() { bindingId = '2'.repeat(32); lastSequence = 0 },
    batch(events, next) {
      const item = pending.shift()
      assert.ok(item, 'one held event request must exist')
      const entries = events.map(event => ({ sequence: ++lastSequence, event }))
      item.resolve({ ok: true, value: { events: entries, next: next ?? lastSequence } })
    },
    raw(value) { const item = pending.shift(); assert.ok(item); item.resolve({ ok: true, value }) },
    failure(code) { const item = pending.shift(); assert.ok(item); item.resolve({ ok: false, error: { code, message: code } }) },

  }
}

// The transport seam is tested without Electron, a private preload or the original plugin.
test('independent bridge uses public Connection RPC and distinct 128-bit client bindings', async () => {
  const f = transport(), create = factory()
  const first = create(f.connection), second = create(f.connection)
  await first.open({ version: 3, instance: 'one' })
  await first.publish({ version: 3, instance: 'one', revision: 2 })
  await first.focus()
  await second.open({ version: 3, instance: 'two' })
  assert.ok(f.calls.every(call => call.channel === '/workspace-navigator'))
  const ids = f.calls.filter(call => call.method !== 'capabilities').map(call => call.payload.clientId)
  assert.match(ids[0], /^[a-f0-9]{32}$/)
  assert.equal(ids[0], ids[1])
  assert.equal(ids[0], ids[2])
  assert.notEqual(ids[0], ids[3])
  assert.equal(first.protocolVersion, 3)
  await first.dispose(); await second.dispose()
})

test('event pump acknowledges sequence and forwards state plus non-ASCII intent without a second subscription', async () => {
  const f = transport(), api = factory()(f.connection), seen = []
  const unsubscribe = api.subscribe(event => seen.push(event))
  await turn()
  assert.equal(f.calls[0].method, 'capabilities')
  f.batch([{ kind: 'state', state: 'detached' }, { kind: 'command', command: { type: 'search', query: '图形 / 🎵' } }])
  await turn()
  assert.equal(seen.length, 2)
  assert.equal(seen[1].command.query, '图形 / 🎵')
  assert.equal(f.pending.length, 1)
  assert.equal(f.calls.at(-1).payload.after, 2)
  unsubscribe(); await api.dispose()
  assert.equal(f.pending.length, 0)
})

test('public bridge consumes a complete valid Host mailbox batch rather than imposing a lower private cap', async () => {
  const mailbox = new EventMailbox(20)
  for (let index = 0; index < 300; index++) assert.equal(mailbox.push({ kind: 'state', state: 'closed' }), true)
  const batch = await mailbox.read(0)
  const f = transport(), api = factory()(f.connection), seen = []
  api.subscribe(event => seen.push(event))
  await turn()
  f.raw(batch)
  await turn()
  assert.equal(seen.length, 300)
  assert.equal(f.calls.at(-1).payload.after, 300)
  await api.dispose(); mailbox.dispose()
})

test('duplicate/out-of-range event sequence fails closed instead of replaying an action or spinning', async () => {
  const f = transport(), errors = [], api = factory(errors)(f.connection), seen = []
  api.subscribe(event => seen.push(event))
  await turn()
  f.raw({ events: [{ sequence: 0, event: { kind: 'command', command: { type: 'activate', id: 's' } } }], next: 0 })
  await turn()
  assert.equal(seen.length, 1)
  assert.equal(seen[0].kind, 'state')
  assert.equal(seen[0].state, 'error')
  assert.equal(errors.length, 1)
  assert.equal(f.calls.filter(call => call.method === 'events').length, 1)
  await api.dispose()
})

test('unsubscribe/resubscribe within the same turn rearms one cancelled long poll', async () => {
  const f = transport(), api = factory()(f.connection), seen = []
  const unsubscribe = api.subscribe(() => {})
  unsubscribe()
  api.subscribe(event => seen.push(event))
  await turn()
  assert.equal(f.pending.length, 1, 'replacement subscriber must not lose its event pump')
  f.batch([{ kind: 'state', state: 'detached' }])
  await turn()
  assert.equal(seen[0].state, 'detached')
  assert.equal(f.pending.length, 1, 'only one event pump may own the binding')
  await api.dispose()
})

test('missing public RPC rejects visibly; no dependency on a patched shell is required', async () => {
  const api = factory()(undefined)
  await assert.rejects(api.open({ version: 3 }), /public Connection RPC unavailable/)
  await api.dispose()
  assert.equal(/dshDesktop|ipcRenderer|sessions\.manager|dsh-app:\/\/shell/.test(source), false, 'Client must not acquire a private shell dependency')
})

test('typed Host capability failure is not reported as a successful window or browser fallback', async () => {
  const api = factory()({ rpc: { call: async () => ({ ok: false, error: { code: 'unsupported', message: 'public capability missing' } }) } })
  await assert.rejects(api.open({ version: 3 }), /public capability missing/)
  await api.dispose()
})

test('disposing an active subscriber aborts the held call and closes only its own binding', async () => {
  const f = transport(), api = factory()(f.connection), seen = []
  api.subscribe(event => seen.push(event))
  await turn()
  const held = f.calls.at(-1)
  await api.dispose(); await turn()
  assert.equal(held.signal.aborted, true)
  assert.equal(f.pending.length, 0)
  assert.equal(seen.length, 0)
  const close = f.calls.find(call => call.method === 'close')
  assert.equal(close.payload.clientId, held.payload.clientId)
})

test('incompatible plugin protocol is refused before opening any native helper', async () => {
  for (const version of [1, 2, null]) {
    const methods = []
    const api = factory()({ rpc: { call: async (_channel, method) => {
      methods.push(method)
      return { ok: true, value: { protocolVersion: version } }
    } } })
    await assert.rejects(api.open({ version: 3 }), /incompatible plugin protocol/)
    assert.deepEqual(methods, ['capabilities'])
    await api.dispose()
  }
})

test('nonbreaking capability additions do not pin a future DSH version', async () => {
  const methods = []
  const api = factory()({ rpc: { call: async (_channel, method) => {
    methods.push(method)
    return { ok: true, value: method === 'capabilities' ? { protocolVersion: 3, bindingId: 'f'.repeat(32), future: { extra: true }, hostVersion: 'future-unverified' } : null }
  } } })
  await api.open({ version: 3 })
  assert.deepEqual(methods, ['capabilities', 'open'])
  await api.dispose()
})

test('missing or malformed binding identity fails admission without a compatibility fallback', async () => {
  for (const bindingId of [undefined, 'g'.repeat(32), 'a'.repeat(31), 123]) {
    const methods = []
    const api = factory()({ rpc: { call: async (_channel, method) => {
      methods.push(method)
      return { ok: true, value: { protocolVersion: 3, bindingId } }
    } } })
    await assert.rejects(api.open(model()), /invalid binding identity/)
    assert.deepEqual(methods, ['capabilities'])
    await api.dispose()
  }
})

test('a retired Host binding resets only its admission and cursor for an explicit retry', async () => {
  const f = transport(), api = factory()(f.connection), seen = []
  api.subscribe(event => seen.push(event))
  await turn()
  f.batch([{ kind: 'state', state: 'opening' }, { kind: 'state', state: 'detached' }])
  await turn()
  assert.equal(f.calls.at(-1).payload.after, 2)
  f.failure('workspace-navigator/unowned')
  await turn()
  assert.equal(seen.at(-1).state, 'error')
  assert.equal(f.pending.length, 0, 'lost binding must not create an automatic retry loop')
  f.replaceBinding()
  await api.open({ version: 3, instance: 'retry' })
  assert.equal(f.calls.filter(call => call.method === 'capabilities').length, 2)
  assert.equal(f.calls.findLast(call => call.method === 'events').payload.after, 0)
  assert.equal(f.pending.length, 1)
  await api.dispose()
})

// Compose the actual source adapter with the actual authenticated Host and mailbox.
// Only subprocess handles and the serializing Connection carrier are fixtures; no executable is invoked.
function composition(t) {
  const runtime = new FakeRuntime(), owner = peer(), bridges = [], calls = [], waiting = [], errors = []
  const fixtureDir = fileURLToPath(new URL('../host/.fixture-data-not-created', import.meta.url))
  const options = { ...CONFIG, pollMs: 5000, packageDirectory: fixtureDir,
    rendererDirectory: join(fixtureDir, 'renderer'), executable: join(fixtureDir, 'native', 'WorkspaceNavigator.exe'),
    dataDirectory: fixtureDir }
  let host, maximumHeld = 0, delayMethod
  const replace = () => { host = new HostBridge(runtime, options); bridges.push(host); return host }
  replace()
  const sample = () => {
    const held = bridges.flatMap(bridge => [...bridge.bindings.values()]).filter(binding => binding.mailbox.waiter).length
    maximumHeld = Math.max(maximumHeld, held)
  }
  const connection = { rpc: { call: (channel, method, payload, signal = new AbortController().signal) => {
    const remote = new AbortController(), wire = defer()
    const record = { channel, method, payload, signal, host, delayed: delayMethod === method }
    if (record.delayed) delayMethod = undefined
    record.fail = error => { wire.reject(error); remote.abort() }
    record.release = () => { record.delayed = false; if (record.result) wire.resolve(record.result) }
    calls.push(record)
    // The public RPC wire carries JSON, not vm-context object prototypes.
    record.actual = host.handle(method, JSON.parse(JSON.stringify(payload)), AbortSignal.any([signal, remote.signal]), owner)
    record.actual.then(result => { record.result = result; if (!record.delayed) wire.resolve(result); sample() }, wire.reject)
    sample()
    for (const item of [...waiting]) {
      if (calls.length - 1 >= item.offset && method === item.method && item.predicate(record)) {
        waiting.splice(waiting.indexOf(item), 1); item.resolve(record)
      }
    }
    return wire.promise
  } } }
  const api = factory(errors)(connection)
  t.after(async () => {
    await api.dispose()
    for (const handle of runtime.handles) handle.finish()
    await Promise.all(bridges.map(bridge => bridge.dispose()))
  })
  return { api, calls, runtime, errors, replace,
    get host() { return host }, get maximumHeld() { return maximumHeld },
    delayNext(method) { delayMethod = method },
    waitFor(method, offset = 0, predicate = () => true) {
      const found = calls.slice(offset).find(record => record.method === method && predicate(record))
      if (found) return Promise.resolve(found)
      const ready = defer()
      waiting.push({ method, offset, predicate, resolve: ready.resolve })
      return deadline(ready.promise)
    },
  }
}

async function composedOpen(f, value = model()) {
  const offset = f.calls.length
  const pending = f.api.open(value)
  await f.waitFor('open', offset)
  const handle = f.runtime.handles.at(-1)
  handle.handshake(value)
  assert.equal(await deadline(pending), null)
  return handle
}

async function acknowledged(f, after = 2, offset = 0) {
  const held = await f.waitFor('events', offset, record => record.payload.after === after)
  const binding = f.host.bindings.get(held.payload.clientId)
  assert.equal(binding.mailbox.acknowledged, after, 'cursor must be ACKNOWLEDGED, not just delivered')
  assert.notEqual(binding.mailbox.waiter, undefined)
  return held
}

function orderedRetry(f, offset) {
  assert.deepEqual(f.calls.slice(offset, offset + 3).map(record => record.method), ['capabilities', 'events', 'open'])
  assert.equal(f.maximumHeld, 1, 'there must never be two live held event requests')
}

async function forwarded(f, handle, revision = 1) {
  const wanted = command({ revision, commandId: `after-retry-${revision}` }), seen = []
  const unsubscribe = f.api.subscribe(event => seen.push(event))
  handle.send({ op: 'command', id: 'forward', value: wanted })
  await turn()
  assert.deepEqual(handle.requests.at(-1), { op: 'result', id: 'forward', value: { kind: 'accepted' } })
  assert.deepEqual(seen.find(event => event.kind === 'command')?.command, wanted)
  unsubscribe()
}

test('actual Host disposed during explicit retry cannot orphan the replacement command/lifecycle pump', async t => {
  const f = composition(t), states = []
  f.api.subscribe(event => { if (event.kind === 'state') states.push(event.state) })
  const initial = await f.waitFor('events')
  initial.delayed = true
  await f.host.dispose()
  assert.equal((await initial.actual).error.code, 'workspace-navigator/disposed', 'use the real typed unload failure')
  f.replace()
  const offset = f.calls.length
  const pending = f.api.open(model())
  // Deliver the actual typed failure only while explicit retry is draining the old flight.
  initial.release()
  await f.waitFor('open', offset)
  const handle = f.runtime.handles.at(-1)
  handle.handshake()
  assert.equal(await deadline(pending), null)
  await turn()
  orderedRetry(f, offset)
  assert.equal(f.calls[offset + 1].payload.after, 0)
  assert.deepEqual(states.slice(-2), ['opening', 'detached'])
  await forwarded(f, handle)
  assert.equal(f.host.bindings.values().next().value.mailbox.queue.length, 0, 'replacement notifications have an active consumer')
})

test('actual retained mailbox preserves a nonzero acknowledged cursor across generic transport failure', async t => {
  const f = composition(t), states = []
  f.api.subscribe(event => { if (event.kind === 'state') states.push(event.state) })
  const handle = await composedOpen(f), held = await acknowledged(f)
  const identity = (await f.calls.findLast(record => record.method === 'capabilities').actual).value.bindingId
  held.fail(new Error('fixture transient transport failure'))
  await turn()
  assert.equal(states.at(-1), 'error')
  const offset = f.calls.length
  await turn()
  assert.equal(f.calls.length, offset, 'failure must not create an automatic retry loop')
  await deadline(f.api.open(model()))
  await turn()
  orderedRetry(f, offset)
  assert.equal((await f.calls[offset].actual).value.bindingId, identity)
  assert.equal(f.calls[offset + 1].payload.after, 2, 'after=0 would be stale below retained ACK=2')
  assert.equal(f.runtime.handles.length, 1, 'explicit retry refocuses the existing child')
  assert.deepEqual(states.slice(-2), ['opening', 'detached'])
  await forwarded(f, handle)
})

test('actual replacement mailbox resets a nonzero cursor only after confirming a different bindingId', async t => {
  const f = composition(t), states = []
  f.api.subscribe(event => { if (event.kind === 'state') states.push(event.state) })
  await composedOpen(f)
  const held = await acknowledged(f)
  const identity = (await f.calls.findLast(record => record.method === 'capabilities').actual).value.bindingId
  held.fail(new Error('fixture lost carrier'))
  await turn()
  await f.host.dispose()
  f.replace()
  const offset = f.calls.length
  const handle = await composedOpen(f, model(2))
  await turn()
  orderedRetry(f, offset)
  assert.notEqual((await f.calls[offset].actual).value.bindingId, identity)
  assert.equal(f.calls[offset + 1].payload.after, 0, 'events payload is captured after admission reconciliation')
  assert.deepEqual(states.slice(-2), ['opening', 'detached'])
  await forwarded(f, handle, 2)
})

test('actual expired binding gets a distinct incarnation and a fresh cursor on explicit open', async t => {
  const f = composition(t), seen = []
  f.api.subscribe(event => seen.push(event))
  await composedOpen(f)
  const held = await acknowledged(f)
  const binding = f.host.bindings.get(held.payload.clientId), identity = binding.incarnation
  await binding.retire('lease-expired')
  await turn()
  const offset = f.calls.length
  const handle = await composedOpen(f, model(2))
  await turn()
  orderedRetry(f, offset)
  assert.notEqual((await f.calls[offset].actual).value.bindingId, identity)
  assert.equal(f.calls[offset + 1].payload.after, 0)
  assert.equal(seen.at(-1).state, 'detached')
  await forwarded(f, handle, 2)
})

test('failed pump retires an in-flight open admission; its late failure cannot kill a replacement', async t => {
  const f = composition(t), seen = []
  f.api.subscribe(event => seen.push(event))
  f.delayNext('open')
  const pending = f.api.open(model())
  const oldOpen = await f.waitFor('open')
  const held = await acknowledged(f, 1)
  held.fail(new Error('fixture transport failed during opening'))
  await turn()
  assert.equal(seen.at(-1).state, 'error')
  await f.host.dispose()
  f.replace()
  const offset = f.calls.length
  const handle = await composedOpen(f, model(2))
  orderedRetry(f, offset)
  const rejected = assert.rejects(pending, /closed/i)
  oldOpen.release()
  await deadline(rejected)
  await turn()
  assert.equal(seen.at(-1).state, 'detached')
  await forwarded(f, handle, 2)
})

test('late old publish failure cannot invalidate a replacement admission or kill its live pump', async t => {
  const f = composition(t), seen = []
  f.api.subscribe(event => seen.push(event))
  await composedOpen(f)
  await acknowledged(f)
  f.delayNext('publish')
  const mark = f.calls.length, oldPublish = f.api.publish(model(2))
  const publish = await f.waitFor('publish', mark)
  await publish.actual
  await f.host.dispose()
  f.replace()
  const handle = await composedOpen(f, model(3))
  const count = f.calls.length
  publish.fail(new Error('fixture late old publish rejection'))
  await assert.rejects(oldPublish, /late old publish/)
  await turn()
  assert.equal(f.calls.length, count, 'late error must not trigger admission or poll replacement')
  assert.equal((await f.api.focus()), null)
  assert.equal(f.calls.filter(record => record.method === 'capabilities').length, 3)
  assert.equal(seen.at(-1).state, 'detached')
  await forwarded(f, handle, 3)
})

test('late capability failure cannot clear a newer explicit-open admission', async () => {
  const old = defer(), calls = [], identity = 'e'.repeat(32)
  const api = factory()({ rpc: { call: async (_channel, method) => {
    calls.push(method)
    if (calls.length === 1) return old.promise
    return { ok: true, value: method === 'capabilities' ? { protocolVersion: 3, bindingId: identity } : null }
  } } })
  const first = api.focus()
  await api.open(model())
  old.reject(new Error('fixture late admission failure'))
  await assert.rejects(first, /late admission/)
  await api.publish(model(2))
  assert.deepEqual(calls, ['capabilities', 'capabilities', 'open', 'publish'])
  await api.dispose()
})

test('actual concurrent same-open plus resubscribe while rendering retains exactly one pump and helper', async t => {
  const f = composition(t), seen = []
  let unsubscribe = f.api.subscribe(() => {})
  await f.waitFor('events')
  const offset = f.calls.length
  const first = f.api.open(model()), second = f.api.open(model())
  await f.waitFor('open', offset)
  await f.waitFor('events', offset, record => record.payload.after === 1)
  unsubscribe()
  unsubscribe = f.api.subscribe(event => seen.push(event))
  await turn()
  assert.notEqual(f.host.bindings.values().next().value.mailbox.waiter, undefined)
  f.runtime.handles[0].handshake()
  assert.equal(await deadline(first), null)
  assert.equal(await deadline(second), null)
  await turn()
  assert.equal(f.runtime.handles.length, 1)
  assert.equal(f.calls.slice(offset).filter(record => record.method === 'capabilities').length, 1)
  assert.equal(f.maximumHeld, 1)
  assert.equal(seen.at(-1).state, 'detached')
  unsubscribe()
})

test('actual close and dispose bound pending opens and polls; unsubscribed ready open remains valid', async t => {
  for (const operation of ['close', 'dispose']) await t.test(operation, async sub => {
    const f = composition(sub)
    f.api.subscribe(() => {})
    const pending = f.api.open(model())
    await f.waitFor('open')
    const rejected = assert.rejects(pending, /closed|disconnected/)
    await deadline(f.api[operation]())
    await deadline(rejected)
    if (operation === 'dispose') assert.equal(f.host.bindings.values().next().value.mailbox.waiter, undefined)
    assert.equal(f.runtime.handles[0].ended, true)
    assert.equal(f.maximumHeld, 1)
  })
  const f = composition(t)
  await composedOpen(f)
  assert.equal(f.calls.some(record => record.method === 'events'), false, 'ready open needs no invented subscriber requirement')
  await deadline(f.api.close())
  assert.equal(f.runtime.handles[0].ended, true)
})
