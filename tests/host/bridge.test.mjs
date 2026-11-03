import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate as turn } from 'node:timers/promises'
import { CLIENT_A, CLIENT_B, command, deadline, fixture, model, opened, peer } from './fixtures.mjs'
import { MAX_BINDINGS, MAX_FRAME_BYTES } from '../../src/host/validation.js'

function code(result, expected) {
  assert.equal(result.ok, false)
  assert.equal(result.error.code, `workspace-navigator/${expected}`)
  assert.deepEqual(result.error.details, {})
}

test('only an admitted live owner and the exact binding can operate on a window', async t => {
  const f = fixture(t)
  for (const caller of [undefined, peer('guest'), { id: 'fake', principal: { kind: 'owner' } }]) {
    code(await f.bridge.handle('open', { clientId: CLIENT_A, model: model() }, new AbortController().signal, caller), 'forbidden')
  }
  const gone = peer()
  gone.dispose()
  code(await f.call('capabilities', {}, undefined, gone), 'forbidden')
  code(await f.call('events', { after: 0, clientId: CLIENT_B }), 'unowned')
  await opened(f)
  await turn()
  const initialFocusCount = f.runtime.handles[0].requests.filter(request => request.op === 'focus').length
  assert.equal(initialFocusCount, 1, 'the admitted initial open reveals its own shell')
  code(await f.call('focus', {}, undefined, peer('owner', 'another-admitted-peer')), 'unowned')
  code(await f.call('publish', { clientId: CLIENT_B, model: model(2) }), 'unowned')
  assert.equal(f.runtime.handles.length, 1)
  assert.equal(f.runtime.handles[0].requests.filter(request => request.op === 'focus').length, initialFocusCount, 'a foreign binding cannot add a focus command')
})

test('rejects unknown methods, fields, invalid crypto IDs, invalid models and complete over-budget JSON', async t => {
  const f = fixture(t)
  code(await f.call('exec', { executable: 'cmd.exe' }), 'invalid')
  code(await f.call('open', { model: model(), url: 'https://example.invalid' }), 'invalid')
  for (const clientId of ['A'.repeat(32), 'a'.repeat(31), 'g'.repeat(32), '../native']) {
    code(await f.call('capabilities', { clientId }), 'invalid')
  }
  const malformed = model()
  malformed.workspaces[0].rows[1].icon = '<svg><script/></svg>'
  code(await f.call('open', { model: malformed }), 'invalid')
  const huge = model()
  huge.query = '界'.repeat(Math.ceil(MAX_FRAME_BYTES / 3))
  code(await f.call('open', { model: huge }), 'over-budget')
  code(await f.call('events', { after: -1 }), 'invalid')
  assert.equal(f.runtime.handles.length, 0)
})

test('fixed assets, isolated per-client browser data and stable profile state use the public spawn request', async t => {
  const f = fixture(t)
  await opened(f)
  const spec = f.runtime.specs[0]
  assert.match(spec.argv[0], /native[\\/]win-x64[\\/]WorkspaceNavigator\.exe$/u)
  assert.equal(spec.argv[1], '--assets')
  assert.match(spec.argv[2], /renderer$/u)
  assert.equal(spec.argv[3], '--user-data')
  assert.match(spec.argv[4], new RegExp(`${CLIENT_A}$`, 'u'))
  assert.equal(spec.argv.length, 7)
  assert.equal(spec.argv[5], '--state-data')
  assert.match(spec.argv[6], /[\\/]window-state$/u)
  assert.notEqual(spec.argv[4], spec.argv[6], 'browser cache and saved geometry have distinct owners')
  assert.deepEqual(spec.stdio, { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 65536 } })
  assert.equal(spec.graceMs, 10)
  assert.deepEqual(spec.env, {})
  assert.equal(spec.signal.aborted, false)
  assert.equal(f.runtime.handles[0].stderr, undefined)
})

test('detaches only after started, ready and the newest matching render; duplicate open focuses one child', async t => {
  const f = fixture(t)
  const opening = f.call('open', { model: model() })
  const handle = f.runtime.handles[0]
  handle.send({ op: 'started' })
  assert.deepEqual((await f.call('events', { after: 0 })).value.events.map(item => item.event.state), ['opening'])
  assert.deepEqual(await f.call('publish', { model: model(2) }), { ok: true, value: null })
  handle.send({ op: 'ready', id: 1 })
  assert.equal(handle.requests.at(-1).value.revision, 2)
  handle.send({ op: 'rendered', id: 2, value: { instance: 'main-a', revision: 1 } })
  assert.equal(f.bridge.bindings.get(CLIENT_A).window.phase, 'opening')
  assert.equal(handle.requests.at(-1).op, 'model')
  handle.send({ op: 'rendered', id: 3, value: { instance: 'main-a', revision: 2 } })
  assert.deepEqual(await opening, { ok: true, value: null })
  assert.deepEqual(await f.call('open', { model: model(2) }), { ok: true, value: null })
  assert.equal(f.runtime.handles.length, 1)
  assert.equal(handle.requests.at(-1).op, 'focus')
  const states = (await f.call('events', { after: 1 })).value
  assert.deepEqual(states.events.map(item => item.event.state), ['detached', 'opening', 'detached'])
  assert.equal(states.next, 4)
  code(await f.call('publish', { model: model(2) }), 'stale')
  code(await f.call('publish', { model: model(3, 'different-client') }), 'stale')
})

test('valid command forwarding is acknowledged; stale, duplicate and invalid targets never forward', async t => {
  const f = fixture(t)
  const handle = await opened(f)
  let cursor = (await f.call('events', { after: 0 })).value.next
  handle.send({ op: 'command', id: 10, value: command({ revision: 0 }) })
  assert.equal(handle.requests.at(-1).value.kind, 'refresh')
  handle.send({ op: 'command', id: 11, value: command({ instance: 'wrong-main' }) })
  assert.equal(handle.requests.at(-1).value.kind, 'refresh')
  handle.send({ op: 'command', id: 12, value: command({ id: 'not-a-session' }) })
  assert.equal(handle.requests.at(-1).value.kind, 'refresh')
  const next = f.call('events', { after: cursor })
  handle.send({ op: 'command', id: 13, value: command() })
  assert.deepEqual(handle.requests.at(-1), { op: 'result', id: 13, value: { kind: 'accepted' } })
  const batch = (await next).value
  assert.deepEqual(batch.events.map(item => item.event), [{ kind: 'command', command: command() }])
  assert.equal(batch.events[0].sequence, cursor + 1)
  cursor = batch.next
  handle.send({ op: 'command', id: 14, value: command() })
  assert.equal(handle.requests.at(-1).value.kind, 'refresh')
  const layout = { instance: 'main-a', revision: 1, commandId: 'layout', type: 'layout',
    layout: { focusedWorkspaceId: 'missing', collapsedGroups: [], scrolls: [] } }
  handle.send({ op: 'command', id: 15, value: layout })
  assert.equal(handle.requests.at(-1).value.kind, 'refresh')
  const disconnected = model(2)
  disconnected.connected = false
  await f.call('publish', { model: disconnected })
  handle.send({ op: 'command', id: 16, value: command({ revision: 2, commandId: 'offline' }) })
  assert.equal(handle.requests.at(-1).value.kind, 'disconnected')
  assert.equal(f.bridge.bindings.get(CLIENT_A).mailbox.sequence, cursor)
})

test('commands are independent per client and refresh against the current model, not prior rendered actions', async t => {
  const f = fixture(t)
  const a = await opened(f)
  const b = await opened(f, model(1, 'main-b'), CLIENT_B)
  const first = (await f.call('events', { after: 0 })).value
  const second = (await f.call('events', { clientId: CLIENT_B, after: 0 })).value
  assert.equal(first.next, second.next)
  const waiting = f.call('events', { after: first.next })
  a.send({ op: 'command', id: 'activate', value: command() })
  assert.equal((await waiting).value.events[0].event.command.instance, 'main-a')
  assert.equal(f.bridge.bindings.get(CLIENT_B).mailbox.sequence, second.next)
  code(await f.call('publish', { clientId: CLIENT_B, model: model(2) }), 'stale')
  assert.equal(b.requests.filter(item => item.op === 'model').length, 0)
  assert.notEqual(f.runtime.specs[0].argv[4], f.runtime.specs[1].argv[4])
  assert.equal(f.runtime.specs[0].argv[6], f.runtime.specs[1].argv[6], 'a new client uses the same profile geometry, not a reused browser identity')
})

test('held events are singly owned, cancellable and acknowledged without dropping unconfirmed events', async t => {
  const f = fixture(t)
  await f.call('capabilities')
  const controller = new AbortController()
  const held = f.call('events', { after: 0 }, controller.signal)
  assert.notEqual(f.bridge.bindings.get(CLIENT_A).mailbox.waiter, undefined)
  code(await f.call('events', { after: 0 }), 'busy')
  controller.abort()
  code(await held, 'cancelled')
  assert.equal(f.bridge.bindings.get(CLIENT_A).mailbox.waiter, undefined)
  code(await f.call('events', { after: 1 }), 'stale')
  await opened(f)
  const batch = (await f.call('events', { after: 0 })).value
  assert.equal(batch.next, 2)
  assert.deepEqual((await f.call('events', { after: 0 })).value, batch)
  const next = f.call('events', { after: batch.next })
  f.bridge.bindings.get(CLIENT_A).mailbox.push({ kind: 'state', state: 'opening' })
  assert.equal((await next).value.next, 3)
  code(await f.call('events', { after: 1 }), 'stale')
})

test('close interrupts opening and a racing reopen waits for the entire old managed range', async t => {
  const f = fixture(t, { runtime: { autoClose: false, autoTerminate: false } })
  const opening = f.call('open', { model: model() })
  const old = f.runtime.handles[0]
  const closing = f.call('close')
  code(await opening, 'closed')
  const reopening = f.call('open', { model: model(2) })
  assert.equal(f.runtime.handles.length, 1)
  old.finish({ range: false })
  await turn()
  assert.equal(f.runtime.handles.length, 1, 'top-level outcome alone is not range quiescence')
  old.range.resolve(true)
  assert.deepEqual(await closing, { ok: true, value: null })
  await turn()
  assert.equal(f.runtime.handles.length, 2)
  f.runtime.handles[1].handshake(model(2))
  assert.equal((await reopening).ok, true)
  assert.equal(old.waits, 1)
})

test('new helper startup failures, EOF, crashes and helper errors restore state and release the range', async t => {
  for (const failure of ['sync-spawn', 'spawn-rejection', 'eof', 'crash', 'error', 'bad-json', 'bad-operation']) {
    await t.test(failure, async sub => {
      const f = fixture(sub, { runtime: { throwSpawn: failure === 'sync-spawn' } })
      const opening = f.call('open', { model: model() })
      const handle = f.runtime.handles[0]
      if (failure === 'spawn-rejection') handle.finish({ reject: true })
      if (failure === 'eof') handle.stdout.end()
      if (failure === 'crash') handle.finish({ exitCode: 1 })
      if (failure === 'error') handle.send({ op: 'error', code: 'webview-failed' })
      if (failure === 'bad-json') handle.stdout.write('{broken}\n')
      if (failure === 'bad-operation') handle.send({ op: 'execute', value: 'cmd.exe' })
      const result = await deadline(opening)
      assert.equal(result.ok, false)
      assert.doesNotMatch(JSON.stringify(result), /fixture private path/u)
      assert.equal((await deadline(f.call('close'))).ok, true)
      const events = (await f.call('events', { after: 0 })).value.events
      assert.deepEqual(events.map(item => item.event.state), ['opening', 'error', 'closed'])
      assert.equal(f.bridge.diagnostics().windows, 0)
      if (handle) assert.equal(handle.waits, 1)
    })
  }
})

test('startup deadline terminates a helper that never acknowledges the displayed model', async t => {
  const f = fixture(t, { config: { startupMs: 25 }, runtime: { autoClose: false } })
  const result = await deadline(f.call('open', { model: model() }))
  code(result, 'startup-timeout')
  const handle = f.runtime.handles[0]
  await deadline(handle.range.promise)
  await f.call('close')
  assert.equal(handle.terminated, 1)
  assert.equal(f.bridge.diagnostics().windows, 0)
})

test('lease expiry and Peer disposal release only their own helper', async t => {
  const f = fixture(t, { config: { leaseMs: 80, pollMs: 10 } })
  const a = await opened(f)
  const otherPeer = peer('owner', 'other-peer')
  const pending = f.call('open', { clientId: CLIENT_B, model: model(1, 'main-b') }, undefined, otherPeer)
  const b = f.runtime.handles[1]
  b.handshake(model(1, 'main-b'))
  assert.equal((await pending).ok, true)
  otherPeer.dispose()
  await deadline(b.range.promise)
  await turn()
  assert.equal(f.bridge.bindings.has(CLIENT_B), false)
  assert.equal(a.ended, false)
  await deadline(a.range.promise)
  await turn()
  assert.equal(f.bridge.bindings.has(CLIENT_A), false)
  assert.equal(f.bridge.diagnostics().lastError, 'lease-expired')
})

test('a failed quiescence observation blocks a successor and is reported instead of hiding a live generation', async t => {
  const f = fixture(t, { runtime: { autoClose: false, waitReject: true } })
  const opening = f.call('open', { model: model() })
  code(await f.call('close'), 'cleanup-failed')
  code(await opening, 'closed')
  code(await f.call('open', { model: model(2) }), 'cleanup-failed')
  assert.equal(f.runtime.handles.length, 1)
  assert.equal(f.bridge.diagnostics().windows, 1)
  assert.equal(f.runtime.handles[0].terminated, 1, 'failed observation still requests termination')
})

test('independent Host installations share no binding, cursor or cleanup state', async t => {
  const a = fixture(t)
  const b = fixture(t)
  await opened(a)
  const handle = await opened(b)
  await a.bridge.dispose()
  code(await a.call('capabilities'), 'disposed')
  assert.equal(handle.ended, false)
  assert.equal((await b.call('events', { after: 0 })).value.next, 2)
  assert.equal(b.bridge.diagnostics().disposed, false)
})

test('capabilities exposes only an opaque per-binding incarnation, stable until that binding retires', async t => {
  const f = fixture(t)
  const first = (await f.call('capabilities')).value
  assert.match(first.bindingId, /^[a-f0-9]{32}$/u)
  assert.notEqual(first.bindingId, CLIENT_A)
  assert.equal((await f.call('capabilities')).value.bindingId, first.bindingId)
  assert.notEqual((await f.call('capabilities', { clientId: CLIENT_B })).value.bindingId, first.bindingId)
  await f.bridge.bindings.get(CLIENT_A).retire('closed')
  assert.notEqual((await f.call('capabilities')).value.bindingId, first.bindingId)
  assert.deepEqual(first.methods, ['capabilities', 'open', 'publish', 'focus', 'close', 'events'])
  assert.equal('peer' in first || 'clientId' in first || 'path' in first, false)
})

test('binding count is bounded and disposal cancels held reads without affecting an Agent', async t => {
  const f = fixture(t)
  for (let index = 0; index < MAX_BINDINGS; index++) {
    assert.equal((await f.call('capabilities', { clientId: index.toString(16).padStart(32, '0') })).ok, true)
  }
  code(await f.call('capabilities'), 'binding-limit')
  const id = '0'.repeat(32)
  const held = f.call('events', { clientId: id, after: 0 })
  await f.bridge.dispose()
  code(await held, 'disposed')
  assert.deepEqual(f.bridge.diagnostics(), { lastError: null, bindings: 0, windows: 0, disposed: true })
})
