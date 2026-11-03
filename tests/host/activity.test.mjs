import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { dshRequire as require, sdkFile } from '../support/dsh-sdk.mjs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setImmediate as turn } from 'node:timers/promises'
import { applyActivity, initialActivity, activityDefinition } from '../../src/host/activity.js'
import { installHost } from '../../src/host/index.js'
import { hostOptions } from '../../src/host/options.js'
import { CONFIG, CLIENT_A, FakeRuntime, model, peer } from './fixtures.mjs'

// Use the explicitly selected, built development SDK read-only; never a production profile.
const zodUrl = pathToFileURL(require.resolve('zod')).href
registerHooks({ resolve(specifier, context, next) {
  return specifier === 'zod' ? { url: zodUrl, shortCircuit: true } : next(specifier, context)
} })
const { z } = await import(zodUrl)

const user = (time, kind = 'user') => ({ type: 'user/message', time, data: { source: { kind } } })
const assistant = (time, content) => ({ type: 'assistant/message', time, data: { message: { content } } })
const splice = (time, kinds) => ({ type: 'agent/inbox/spliced', time, data: { inserted: kinds.map(kind => ({ source: { kind } })) } })

test('activity advances only accepted/surfaced human content and nonempty assistant settlements', () => {
  let state = initialActivity()
  assert.deepEqual(state, { lastContentAt: null })
  state = applyActivity(state, user(100))
  assert.deepEqual(state, { lastContentAt: 100 })
  const before = state
  for (const event of [user(1000, 'agent'), user(1000, 'system'), assistant(1000, []), splice(1000, ['agent', 'system']),
    { type: 'tool/result', time: 1000 }, { type: 'tool/call', time: 1000 }, { type: 'session/title', time: 1000 },
    { type: 'session/pin', time: 1000 }, { type: 'session/open', time: 1000 }, { type: 'agent/status', time: 1000 },
    { type: 'assistant/usage', time: 1000 }, { type: 'assistant/message/delta', time: 1000 }]) {
    assert.equal(applyActivity(state, event), before)
  }
  state = applyActivity(state, splice(200, ['agent', 'user']))
  assert.deepEqual(state, { lastContentAt: 200 })
  state = applyActivity(state, assistant(300, [{ type: 'reasoning', text: '' }]))
  assert.deepEqual(state, { lastContentAt: 300 }, 'nonempty content array qualifies regardless of content kind')
  assert.equal(applyActivity(state, user(100)), state)
  assert.equal(applyActivity(state, splice(300, ['user'])), state)
  assert.deepEqual(before, { lastContentAt: 100 }, 'prior state is immutable')
})

test('only a valid maximum event time advances, without inspecting unrelated data', () => {
  const state = initialActivity()
  for (const time of [NaN, Infinity, -Infinity, -1, undefined, null, '10', Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(applyActivity(state, user(time)), state)
  }
  assert.deepEqual(applyActivity(state, user(0)), { lastContentAt: 0 })
  assert.deepEqual(applyActivity(state, user(Number.MAX_SAFE_INTEGER)), { lastContentAt: Number.MAX_SAFE_INTEGER })
  const metadata = { type: 'session/title', time: 1000, get data() { throw new Error('unrelated data inspected') } }
  assert.equal(applyActivity(state, metadata), state)
})

test('projection schema, initialization and wire view are plugin-owned and schema validated', () => {
  const definition = activityDefinition(z)
  assert.equal(definition.key, 'workspaceNavigatorActivity')
  assert.equal(definition.stateVersion, 1)
  const empty = definition.init()
  assert.equal(definition.wire.view(empty), empty)
  assert.deepEqual(definition.stateSchema.parse(empty), { lastContentAt: null })
  assert.deepEqual(definition.wire.viewSchema.parse({ lastContentAt: 42 }), { lastContentAt: 42 })
  for (const invalid of [{}, { lastContentAt: '42' }, { lastContentAt: NaN }, { lastContentAt: -1 },
    { lastContentAt: 42, privateClock: true }]) assert.throws(() => definition.stateSchema.parse(invalid))
})

test('public profileContext directory or explicit absolute config scopes data; tunables have no hidden defaults', () => {
  const profileDir = fileURLToPath(new URL('./isolated-profile/', import.meta.url))
  const options = hostOptions({ get: name => name === 'profileContext' ? { dir: profileDir } : undefined }, CONFIG)
  assert.match(options.dataDirectory, /isolated-profile[\\/]data[\\/]workspace-navigator$/u)
  assert.match(options.executable, /native[\\/]win-x64[\\/]WorkspaceNavigator\.exe$/u)
  assert.match(options.rendererDirectory, /renderer$/u)
  const noProfile = { get: () => undefined }
  assert.equal(hostOptions(noProfile, CONFIG).dataDirectory, undefined)
  assert.equal(hostOptions(noProfile, { ...CONFIG, dataDirectory: options.dataDirectory }).dataDirectory, options.dataDirectory)
  for (const config of [{ ...CONFIG, startupMs: 0 }, { ...CONFIG, pollMs: Infinity }, { ...CONFIG, graceMs: undefined },
    { ...CONFIG, leaseMs: CONFIG.pollMs }, { ...CONFIG, dataDirectory: '../production' }, { ...CONFIG, dataDirectory: '' }]) {
    assert.throws(() => hostOptions(noProfile, config), /workspace navigator/u)
  }
})

test('actual Cordis fiber disposal removes the public projection and RPC and awaits a managed fake window', async t => {
  const { Context } = await import(sdkFile('vendor/cordis/lib/index.js'))
  const { SessionProjectionRegistry } = await import(sdkFile('packages/session/session-projection/lib/index.js'))
  const ctx = new Context()
  const runtime = new FakeRuntime({ autoClose: false, autoTerminate: false })
  t.after(async () => {
    for (const handle of runtime.handles) handle.finish()
    await ctx.fiber.dispose()
  })
  const registryFiber = ctx.plugin(SessionProjectionRegistry)
  await registryFiber.await()
  const registry = ctx.get('sessionProjections')
  const routes = new Map()
  ctx.provide('connection', { rpc: { handle(path, handler) {
    assert.equal(routes.has(path), false)
    routes.set(path, handler)
    return () => { routes.delete(path) }
  } } })
  ctx.provide('subprocess', runtime)
  const root = hostOptions({ get: () => undefined }, CONFIG).packageDirectory
  let installed
  const plugin = { name: 'navigator-host-lifecycle-fixture', inject: ['connection', 'subprocess', 'sessionProjections'], async apply(child) {
    installed = await installHost(child, { ...CONFIG, dataDirectory: root })
  } }
  const fiber = ctx.plugin(plugin)
  await fiber.await()
  assert.equal(routes.has('/workspace-navigator'), true)
  const checkpoint = { workspaceNavigatorActivity: { ver: 1, seq: 0, val: { lastContentAt: 10 } } }
  assert.deepEqual(registry.viewCheckpoint(checkpoint), { workspaceNavigatorActivity: { lastContentAt: 10 } })
  assert.deepEqual(registry.viewCheckpoint({}), {})
  assert.deepEqual(registry.viewCheckpoint({ workspaceNavigatorActivity: { ver: 0, seq: 0, val: { lastContentAt: 10 } } }), {})
  assert.deepEqual(registry.viewCheckpoint({ workspaceNavigatorActivity: { ver: 1, seq: 0, val: { lastContentAt: 'bad' } } }), {})
  const call = routes.get('/workspace-navigator')
  const owner = peer()
  const opening = call('open', { clientId: CLIENT_A, model: model() }, new AbortController().signal, owner)
  runtime.handles[0].handshake()
  assert.deepEqual(await opening, { ok: true, value: null })
  let settled = false
  const disposal = fiber.dispose().then(() => { settled = true })
  let manualSettled = 0
  const manualOne = installed.dispose().then(() => { manualSettled++ })
  const manualTwo = installed.dispose().then(() => { manualSettled++ })
  await turn()
  assert.equal(settled, false, 'fiber must retain cleanup ownership until the managed range is empty')
  assert.equal(manualSettled, 0, 'manual/manual and fiber/manual disposal must join the same cleanup')
  runtime.handles[0].finish()
  await Promise.all([disposal, manualOne, manualTwo])
  assert.equal(routes.has('/workspace-navigator'), false)
  assert.deepEqual(registry.viewCheckpoint(checkpoint), {})
  assert.deepEqual(installed.diagnostics(), { lastError: null, bindings: 0, windows: 0, disposed: true })
  assert.equal(runtime.handles[0].waits, 1)
  assert.equal(runtime.handles[0].ended, true)
  const reloaded = ctx.plugin(plugin)
  await reloaded.await()
  assert.equal(routes.has('/workspace-navigator'), true)
  assert.deepEqual(registry.viewCheckpoint(checkpoint), { workspaceNavigatorActivity: { lastContentAt: 10 } })
  const secondOpening = routes.get('/workspace-navigator')('open', { clientId: CLIENT_A, model: model() }, new AbortController().signal, owner)
  runtime.handles[1].handshake()
  assert.equal((await secondOpening).ok, true)
  manualSettled = 0
  const firstManual = installed.dispose().then(() => { manualSettled++ })
  const secondManual = installed.dispose().then(() => { manualSettled++ })
  const reloadDisposal = reloaded.dispose()
  await turn()
  assert.equal(manualSettled, 0, 'manual-first disposal must remain pending until range emptiness')
  runtime.handles[1].finish()
  await Promise.all([firstManual, secondManual, reloadDisposal])
  assert.equal(routes.has('/workspace-navigator'), false)
  assert.deepEqual(registry.viewCheckpoint(checkpoint), {})
})
