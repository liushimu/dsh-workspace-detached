import test from 'node:test'
import assert from 'node:assert/strict'
import { setImmediate as turn } from 'node:timers/promises'
import { CLIENT_A, deadline, fixture, model, opened } from './fixtures.mjs'

const rendered = (handle, revision, instance = 'main-a') => handle.send({
  op: 'rendered', id: `render-${instance}-${revision}`, value: { instance, revision },
})
const state = f => f.bridge.bindings.get(CLIENT_A).window
const code = (result, expected) => assert.equal(result.error?.code, `workspace-navigator/${expected}`)

test('first open reveals a managed-hidden shell only after the current render; background publish never focuses it', async t => {
  const f = fixture(t)
  const pending = f.call('open', { model: model(2) })
  const handle = f.runtime.handles[0]
  const focusCount = () => handle.requests.filter(item => item.op === 'focus').length
  handle.send({ op: 'started' })
  handle.send({ op: 'ready', id: 'ready' })
  rendered(handle, 1)
  await turn()
  assert.equal(focusCount(), 0)
  rendered(handle, 2)
  assert.equal((await deadline(pending)).ok, true)
  await turn()
  assert.equal(focusCount(), 1)
  assert.equal((await f.call('publish', { model: model(3) })).ok, true)
  rendered(handle, 3)
  await turn()
  assert.equal(focusCount(), 1, 'ordinary content updates must not steal OS focus')
  assert.equal((await f.call('open', { model: model(3) })).ok, true)
  await turn()
  assert.equal(focusCount(), 2)
  assert.equal(f.runtime.handles.length, 1)
})

test('explicit same-model refocus reports detached again; ordinary publish does not flicker main-sidebar state', async t => {
  const f = fixture(t), handle = await opened(f)
  assert.equal((await f.call('open', { model: model() })).ok, true)
  assert.equal(f.runtime.handles.length, 1)
  assert.equal(handle.requests.filter(item => item.op === 'focus').length, 2, 'initial open and explicit refocus each reveal the shell')
  assert.deepEqual((await f.call('events', { after: 0 })).value.events.map(item => item.event.state),
    ['opening', 'detached', 'opening', 'detached'])
  const sequence = f.bridge.bindings.get(CLIENT_A).mailbox.sequence
  assert.deepEqual(await f.call('publish', { model: model(2) }), { ok: true, value: null })
  assert.equal(state(f).phase, 'detached')
  assert.equal(state(f).rendered, undefined, 'publish acknowledges delivery, not UI completion')
  rendered(handle, 2)
  assert.equal(f.bridge.bindings.get(CLIENT_A).mailbox.sequence, sequence, 'ordinary publishes emit no opening/detached cycle')
})

test('reopen of a newer or already-published revision waits for the current matching render', async t => {
  for (const publishFirst of [false, true]) await t.test(`publishFirst=${publishFirst}`, async sub => {
    const f = fixture(sub), handle = await opened(f)
    if (publishFirst) assert.equal((await f.call('publish', { model: model(2) })).ok, true)
    let settled = false
    const pending = f.call('open', { model: model(2) }).then(value => { settled = true; return value })
    await turn()
    assert.equal(settled, false, 'lifetime readiness must not satisfy a new render cycle')
    assert.equal(state(f).phase, 'opening')
    rendered(handle, 1)
    rendered(handle, 2, 'other-instance')
    await turn()
    assert.equal(settled, false)
    assert.equal(handle.requests.at(-1).op, 'model')
    rendered(handle, 2)
    assert.deepEqual(await deadline(pending), { ok: true, value: null })
    assert.equal(state(f).phase, 'detached')
    assert.equal(f.runtime.handles.length, 1)
    const events = (await f.call('events', { after: 0 })).value.events
    assert.deepEqual(events.map(item => item.event.state), ['opening', 'detached', 'opening', 'detached'])
  })
})

test('concurrent reopens share one readiness deadline; cancellation and superseding publish do not lose it', async t => {
  const f = fixture(t), handle = await opened(f), controller = new AbortController()
  const first = f.call('open', { model: model(2) }, controller.signal)
  const gate = state(f).opened, timer = state(f).startupTimer
  let settled = false
  const second = f.call('open', { model: model(2) }).then(value => { settled = true; return value })
  assert.equal(state(f).opened, gate)
  assert.equal(state(f).startupTimer, timer)
  controller.abort()
  code(await deadline(first), 'cancelled')
  assert.equal((await f.call('publish', { model: model(3) })).ok, true)
  assert.equal(state(f).opened, gate)
  assert.equal(state(f).startupTimer, timer, 'superseding models cannot postpone the deadline')
  rendered(handle, 2)
  await turn()
  assert.equal(settled, false, 'superseded acknowledgement cannot satisfy the pending open')
  rendered(handle, 3)
  assert.equal((await deadline(second)).ok, true)
  assert.equal(state(f).rendered, 3)
  assert.equal(state(f).startupTimer, undefined)
  assert.equal(f.runtime.handles.length, 1)
})

test('close settles reopens before managed-range quiescence, without overlapping a successor', async t => {
  const f = fixture(t, { runtime: { autoClose: false, autoTerminate: false } }), handle = await opened(f)
  const pending = f.call('open', { model: model(2) })
  const closing = f.call('close')
  code(await deadline(pending), 'closed')
  const successor = f.call('open', { model: model(3) })
  handle.finish({ range: false })
  await turn()
  assert.equal(f.runtime.handles.length, 1)
  handle.range.resolve(true)
  assert.equal((await deadline(closing)).ok, true)
  await turn()
  assert.equal(f.runtime.handles.length, 2)
  f.runtime.handles[1].handshake(model(3))
  assert.equal((await deadline(successor)).ok, true)
})

test('missing/stale render and blocked delivery settle reopen at configured startupMs and clean up', async t => {
  for (const blockWrites of [false, true]) await t.test(`blockWrites=${blockWrites}`, async sub => {
    const f = fixture(sub, { config: { startupMs: 25 }, runtime: { autoClose: false } }), handle = await opened(f)
    handle.options.blockWrites = blockWrites
    const pending = f.call('open', { model: model(2) })
    if (!blockWrites) rendered(handle, 1)
    code(await deadline(pending), 'startup-timeout')
    await deadline(handle.range.promise)
    assert.equal((await deadline(f.call('close'))).ok, true)
    assert.equal(handle.terminated, 1)
    assert.equal(f.bridge.diagnostics().windows, 0)
  })
})

test('helper failure rejects the current reopen cycle rather than returning initial readiness', async t => {
  const f = fixture(t), handle = await opened(f)
  const pending = f.call('open', { model: model(2) })
  handle.send({ op: 'error', code: 'render-failed' })
  code(await deadline(pending), 'helper-error')
  await deadline(f.call('close'))
  assert.equal(f.bridge.diagnostics().windows, 0)
  assert.deepEqual((await f.call('events', { after: 0 })).value.events.map(item => item.event.state),
    ['opening', 'detached', 'opening', 'error', 'closed'])
})
