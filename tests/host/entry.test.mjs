import test from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../../src/index.js'

test('normal entry grants the route service and forwards it through one owned public registration context', async t => {
  let cleanup
  t.after(async () => { if (cleanup) await cleanup() })
  let initialize
  let extensions = 0
  let routes = 0
  let projections = 0
  const webServer = { register() {} }
  const registration = {
    webServer,
    get: name => name === 'profileContext' ? { dir: 'F:/isolated-profile-fixture' } : undefined,
    subprocess: { spawn() { throw new Error('entry test must not spawn') } },
    sessionProjections: { register(definition) {
      assert.equal(definition.key, 'workspaceNavigatorActivity')
      projections++
      let active = true
      return () => { if (active) { active = false; projections-- } }
    } },
    effect: function (setup) { const disposers = [...setup()]; cleanup = async () => { for (const dispose of disposers.splice(0).reverse()) await dispose() }; return cleanup },
  }
  registration.connection = { rpc: { handle(channel, handler) {
    assert.equal(Object.hasOwn(registration, 'webServer'), true)
    assert.equal(registration.webServer, webServer)
    assert.equal(channel, '/workspace-navigator')
    assert.equal(typeof handler, 'function')
    routes++
    let active = true
    return () => { if (active) { active = false; routes-- } }
  } } }
  apply({ inject(names, callback) {
    assert.deepEqual(names, ['connection', 'webServer', 'subprocess', 'sessionProjections'])
    initialize = callback
  } })
  assert.equal(typeof initialize, 'function')
  const result = await initialize({
    get(name) { assert.equal(name, 'webServer'); return webServer },
    extend(capability) { extensions++; assert.deepEqual(capability, { webServer }); return registration },
  })
  assert.equal(result, undefined, 'Cordis initialization must not return the Host diagnostics object as an effect')
  assert.equal(extensions, 1)
  assert.equal(routes, 1)
  assert.equal(projections, 1)
  await cleanup()
  assert.equal(routes, 0)
  assert.equal(projections, 0)
})
