import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate as turn } from 'node:timers/promises'
import { CLIENT_A, CONFIG, command, deadline, fixture, model, opened } from './fixtures.mjs'
import { HostBridge } from '../../src/host/bridge.js'
import { MAX_QUEUED_EVENTS } from '../../src/host/validation.js'

test('cancelled close keeps owning cleanup and a successor cannot overlap the old range', async t => {
  const f = fixture(t, { runtime: { autoClose: false, autoTerminate: false } })
  const old = await opened(f)
  const controller = new AbortController()
  const closing = f.call('close', {}, controller.signal)
  controller.abort()
  assert.equal((await closing).error.code, 'workspace-navigator/cancelled')
  const reopening = f.call('open', { model: model(2) })
  assert.equal(f.runtime.handles.length, 1)
  old.finish({ range: false })
  await turn()
  assert.equal(f.runtime.handles.length, 1)
  old.range.resolve(true)
  await turn()
  const current = f.runtime.handles[1]
  current.handshake(model(2))
  assert.equal((await reopening).ok, true)
})

test('a later close invalidates a reopen queued behind an older closing generation', async t => {
  const f = fixture(t, { runtime: { autoClose: false, autoTerminate: false } })
  const old = await opened(f)
  const firstClose = f.call('close')
  const queuedOpen = f.call('open', { model: model(2) })
  const laterClose = f.call('close')
  old.finish()
  assert.equal((await firstClose).ok, true)
  assert.equal((await laterClose).ok, true)
  assert.equal((await queuedOpen).error.code, 'workspace-navigator/closed')
  assert.equal(f.runtime.handles.length, 1)
  const currentOpen = f.call('open', { model: model(3) })
  f.runtime.handles[1].handshake(model(3))
  assert.equal((await currentOpen).ok, true)
})

test('cancelling one opening caller does not cancel a duplicate request for the same window', async t => {
  const f = fixture(t)
  const controller = new AbortController()
  const first = f.call('open', { model: model() }, controller.signal)
  const second = f.call('open', { model: model() })
  controller.abort()
  assert.equal((await first).error.code, 'workspace-navigator/cancelled')
  assert.equal(f.runtime.handles.length, 1)
  f.runtime.handles[0].handshake()
  assert.equal((await second).ok, true)
  assert.equal(f.runtime.handles[0].ended, false)
})

test('current return command is acknowledged before shell close and never opens a Session', async t => {
  const f = fixture(t)
  const handle = await opened(f)
  handle.send({ op: 'command', id: 5, value: { instance: 'main-a', revision: 1, commandId: 'return', type: 'return' } })
  await deadline(handle.range.promise)
  assert.deepEqual(handle.requests.slice(-2), [{ op: 'result', id: 5, value: { kind: 'accepted' } }, { op: 'close' }])
  await f.call('close')
  const events = (await f.call('events', { after: 0 })).value.events
  assert.deepEqual(events.map(item => item.event.kind === 'state' ? item.event.state : item.event.command.type),
    ['opening', 'detached', 'return', 'closed'])
})

test('invalid command grammar, invalid bounds, invalid helper ids and rendered-before-ready fail closed', async t => {
  const messages = [
    { op: 'command', id: 1, value: { ...command(), type: 'exec', executable: 'powershell.exe' } },
    { op: 'closed', bounds: { x: 0, y: 0, width: -1, height: 100 } },
    { op: 'ready', id: '../'.repeat(50) },
    { op: 'rendered', id: 1, value: { instance: 'main-a', revision: 1 } },
  ]
  for (const message of messages) await t.test(message.op, async sub => {
    const f = fixture(sub)
    const opening = f.call('open', { model: model() })
    f.runtime.handles[0].send(message)
    const result = await deadline(opening)
    assert.equal(result.error.code, 'workspace-navigator/helper-protocol')
    await f.call('close')
    assert.equal(f.bridge.diagnostics().windows, 0)
  })
})

test('bounded outstanding pipe writes fail the helper instead of allowing unbounded buffering', async t => {
  const f = fixture(t, { runtime: { blockWrites: true, autoClose: false } })
  const opening = f.call('open', { model: model() })
  const handle = f.runtime.handles[0]
  handle.send({ op: 'ready', id: 1 })
  handle.stdin.emit('error', new Error('fixture stdin failure'))
  assert.equal((await deadline(opening)).error.code, 'workspace-navigator/helper-io')
  await deadline(handle.range.promise)
  await f.call('close')
  assert.equal(f.bridge.diagnostics().windows, 0)
})

test('an event queue that cannot report opening must not spawn another process', async t => {
  const f = fixture(t)
  await f.call('capabilities')
  const binding = f.bridge.bindings.get(CLIENT_A)
  for (let index = 0; index < MAX_QUEUED_EVENTS; index++) assert.equal(binding.mailbox.push({ kind: 'state', state: 'closed' }), true)
  const result = await f.call('open', { model: model() })
  assert.equal(result.error.code, 'workspace-navigator/queue-full')
  assert.equal(f.runtime.handles.length, 0)
})

test('missing profile data is an explicit capability absence; it never guesses a home or spawns', async t => {
  const f = fixture(t)
  const bridge = new HostBridge(f.runtime, { ...f.bridge.options, ...CONFIG, dataDirectory: undefined })
  t.after(() => bridge.dispose())
  const controller = new AbortController()
  const owner = f.owner
  const capability = await bridge.handle('capabilities', { clientId: CLIENT_A }, controller.signal, owner)
  assert.equal(capability.ok, true)
  assert.equal(capability.value.available, false)
  const result = await bridge.handle('open', { clientId: CLIENT_A, model: model() }, controller.signal, owner)
  assert.equal(result.error.code, 'workspace-navigator/unavailable')
  assert.equal(f.runtime.handles.length, 0)
})
