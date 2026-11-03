import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, lstatSync } from 'node:fs'
import { resolve, relative, dirname, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = fileURLToPath(new URL('../../', import.meta.url))
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
const slash = value => value.split(sep).join('/')
function collect(path) {
  const info = lstatSync(path)
  assert.equal(info.isSymbolicLink(), false, 'declared installed payload must not point outside its package')
  return info.isDirectory() ? readdirSync(path).flatMap(name => collect(resolve(path, name))) : [slash(relative(root, path))]
}
const payload = new Set(['package.json', ...pkg.files.flatMap(path => collect(resolve(root, path)))])

test('declared publication payload closes every installed relative JavaScript import', () => {
  for (const path of payload) {
    assert.ok(!/^(?:tests|vendor|node_modules|upstream|better-workspace)\//.test(path), `unexpected development payload: ${path}`)
    if (!path.endsWith('.js')) continue
    const source = readFileSync(resolve(root, path), 'utf8')
    for (const [, request] of source.matchAll(/(?:from\s+|import\s*\(\s*)['"](\.[^'"]+)['"]/g)) {
      const target = slash(relative(root, resolve(root, dirname(path), request)))
      assert.ok(payload.has(target), `unshipped relative import ${path} -> ${request}`)
    }
  }
  for (const path of [pkg.main, pkg.exports['./client'], 'lib/protocol.js', 'renderer/workspace-navigator.html', 'renderer/workspace-navigator.js', 'renderer/workspace-navigator.css']) {
    assert.ok(payload.has(path.replace(/^\.\//, '')), `missing installed entry/asset: ${path}`)
  }
})

test('native payload ships the exact recorded executable, relative DLLs and redistribution license together', () => {
  const base = 'native/win-x64/'
  const manifest = JSON.parse(readFileSync(resolve(root, base, 'build-manifest.json'), 'utf8'))
  assert.equal(manifest.architecture, 'win-x64')
  assert.match(manifest.sdkSha256, /^[a-f0-9]{64}$/)
  const required = ['Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll', 'WebView2-LICENSE.txt', 'WebView2Loader.dll', 'WorkspaceNavigator.exe', 'WorkspaceNavigator.exe.config']
  assert.deepEqual(Object.keys(manifest.files).sort(), required.sort())
  for (const name of required) {
    assert.ok(payload.has(base + name), `native dependency not published: ${name}`)
    const hash = createHash('sha256').update(readFileSync(resolve(root, base, name))).digest('hex')
    assert.equal(hash, manifest.files[name], `native payload differs from its recorded hash: ${name}`)
  }
  assert.ok(payload.has(base + 'build-manifest.json'))
})

test('published Host imports only Node, its own files and explicitly declared package dependencies', () => {
  const dependencies = new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.peerDependencies ?? {})])
  for (const path of payload) {
    if (!path.startsWith('src/') || !path.endsWith('.js') || path === 'src/client.js') continue
    const source = readFileSync(resolve(root, path), 'utf8')
    for (const [, request] of source.matchAll(/(?:from\s+|import\s*\(\s*)['"]([^'"]+)['"]/g)) {
      if (request.startsWith('.') || request.startsWith('node:')) continue
      assert.ok(dependencies.has(request), `undeclared Host dependency ${path} -> ${request}`)
    }
  }
})
