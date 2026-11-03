import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url)))
const descriptor = JSON.parse(readFileSync(new URL('../../dsh.plugin.json', import.meta.url)))
const patch = readFileSync(new URL('../../cordis.patch.yml', import.meta.url), 'utf8')
const client = readFileSync(new URL('../../src/client.js', import.meta.url), 'utf8')
const entry = readFileSync(new URL('../../src/index.js', import.meta.url), 'utf8')
const protocol = readFileSync(new URL('../../src/protocol.ts', import.meta.url), 'utf8')
const license = readFileSync(new URL('../../LICENSE', import.meta.url), 'utf8')
const matches = (input, pattern) => assert.equal(pattern.test(input), true, pattern.source)
const notMatches = (input, pattern) => assert.equal(pattern.test(input), false, pattern.source)

test('package, plugin, client module and config row have their own identity', () => {
  assert.equal(pkg.name, 'dsh-workspace-detached')
  assert.equal(descriptor.id, 'liushimu/dsh-workspace-detached')
  assert.equal(descriptor.version, pkg.version)
  assert.equal(descriptor.main, './src/index.js')
  matches(patch, /id: workspace-navigator\s+name: dsh-workspace-detached/)
  matches(client, /id: 'dsh-workspace-detached'/)
  matches(entry, /name = 'dsh-workspace-detached'/)
  matches(client, /forms\.get\('workspace-navigator'\)/)
  assert.equal(pkg.exports['./package.json'], './package.json')
})

test('independent stores and locale never read or write the old plugin keys', () => {
  matches(client, /const NS = 'workspaceNavigator'/)
  matches(client, /persist: 'dsh\.workspaceNavigator\.view\.v1'/)
  matches(client, /TITLE_CACHE_KEY = 'dsh\.workspaceNavigator\.titles\.v1'/)
  notMatches(client, /dsh\.betterWorkspace\.|const NS = 'betterWorkspace'/)
  matches(client, /projectionValues\.workspaceNavigatorActivity/)
  notMatches(client, /projectionValues\.sessionContentActivity/)
})

test('runtime dependencies contain no original plugin, Electron or desktop-patch payload', () => {
  for (const dependencies of [pkg.dependencies, pkg.peerDependencies, pkg.optionalDependencies]) {
    assert.ok(!Object.keys(dependencies ?? {}).some(name => /better-workspace|^electron$/.test(name)))
  }
  notMatches(client, /dshDesktop|ipcRenderer|sessions\.manager|window\.open\(/)
  notMatches(entry + protocol, /ipcRenderer|from ['"]electron['"]|dsh-app:\/\/shell|WORKSPACE_NAVIGATOR_IPC/)
  assert.ok(!pkg.files.some(path => /app\.asar|upstream|better-workspace/.test(path)))
  notMatches(entry, /F:\\Projects|C:\\Users|AppData.*Programs/)
})

test('compatibility is capability-driven without pinning a DSH future-version upper bound', () => {
  assert.equal(pkg.engines.dsh, descriptor.engines.dsh)
  assert.equal(pkg.peerDependencies['@deepseek-ai/dsh'], pkg.engines.dsh)
  notMatches(pkg.engines.dsh, /[<~^]|\|/)
  assert.equal(pkg.peerDependenciesMeta['@deepseek-ai/dsh'].optional, true)
  matches(client, /connection\.rpc\.call\('\/workspace-navigator'/)
  matches(client, /invoke\('capabilities'\)/)
  matches(entry, /ctx\.inject\(\['connection', 'webServer', 'subprocess', 'sessionProjections'\]/)
})

test('MIT copyright attribution for reused grouping and renderer sources is retained', () => {
  matches(license, /MIT License/)
  matches(license, /2026 KannaKuron/)
  matches(license, /2026 DeepSeek/)
  matches(license, /copyright notice and this permission notice/)
})
