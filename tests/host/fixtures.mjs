/** Owner-local managed-handle fixtures. They never spawn executables or create data directories. */
import { PassThrough, Writable } from 'node:stream'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { HostBridge } from '../../src/host/bridge.js'

export const CLIENT_A = 'a'.repeat(32)
export const CLIENT_B = 'b'.repeat(32)
export const CONFIG = { startupMs: 500, pollMs: 50, leaseMs: 5000, graceMs: 10 }

export function defer() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

export function model(revision = 1, instance = 'main-a') {
  return {
    version: 3, sortMode: 'activity', instance, revision, title: '工作区', query: '', dark: false, connected: true,
    lang: 'zh-CN', direction: 'ltr', density: 'comfortable',
    labels: Object.fromEntries(['search', 'return', 'empty', 'disconnected', 'error', 'warning', 'ongoing', 'done',
      'overview', 'searchResults', 'noSessions', 'pinned', 'activityUnavailable'].map(key => [key, key])),
    workspaces: [{ id: 'workspace-a', label: '项目', title: '项目', activityAt: null, activityKnown: false, matches: true,
      rows: [{ id: 'group-a', kind: 'group', label: '组', title: '组', depth: 0, activityAt: null, activityKnown: false, matches: true },
        { id: 'session-a', kind: 'session', label: '会话', title: '会话', depth: 1, activityAt: null, activityKnown: false, matches: true }] }],
    layout: { focusedWorkspaceId: null, collapsedGroups: [], scrolls: [] },
  }
}

export function command(overrides = {}) {
  return { instance: 'main-a', revision: 1, commandId: 'command-1', type: 'activate', id: 'session-a', ...overrides }
}

export function peer(kind = 'owner', id = 'owner-peer') {
  const controller = new AbortController()
  return { id, principal: { kind }, signal: controller.signal, dispose: () => controller.abort() }
}

export class FakeHandle {
  constructor(options = {}) {
    this.options = options
    this.stdout = new PassThrough()
    this.stderr = undefined
    this.collected = { stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) } }
    this.control = undefined
    this.requests = []
    this.outcome = defer()
    this.range = defer()
    this.done = this.outcome.promise
    this.terminated = 0
    this.waits = 0
    this.ended = false
    this.pendingWrites = []
    this.stdin = new Writable({ write: (chunk, _encoding, callback) => {
      for (const line of chunk.toString('utf8').trimEnd().split('\n')) this.requests.push(JSON.parse(line))
      if (this.options.blockWrites) this.pendingWrites.push(callback)
      else callback()
      if (this.requests.at(-1)?.op === 'close' && this.options.autoClose !== false) this.finish()
    } })
  }

  send(value) { this.stdout.write(`${JSON.stringify(value)}\n`) }
  handshake(value = model()) {
    this.send({ op: 'ready', id: 'ready-1' })
    this.send({ op: 'rendered', id: 'rendered-1', value: { instance: value.instance, revision: value.revision } })
    this.send({ op: 'started' })
  }
  terminate() {
    this.terminated++
    if (this.options.autoTerminate !== false) this.finish()
  }
  waitForExit() {
    this.waits++
    if (this.options.waitReject) return Promise.reject(new Error('fixture cannot observe range'))
    return this.range.promise
  }
  finish({ exitCode = 0, reject = false, range = true } = {}) {
    if (!this.ended) {
      this.ended = true
      this.stdout.end()
      if (reject) this.outcome.reject(new Error('fixture private path must not leak'))
      else this.outcome.resolve({ exitCode, signal: null })
    }
    if (range) this.range.resolve(true)
    for (const callback of this.pendingWrites.splice(0)) callback()
  }
}

export class FakeRuntime {
  constructor(options = {}) { this.options = options; this.handles = []; this.specs = [] }
  spawn(spec) {
    if (this.options.throwSpawn) throw new Error('fixture private path must not leak')
    const handle = new FakeHandle(this.options)
    this.specs.push(spec)
    this.handles.push(handle)
    spec.signal.addEventListener('abort', () => handle.terminate(), { once: true })
    return handle
  }
}

export function fixture(t, options = {}) {
  const runtime = new FakeRuntime(options.runtime)
  const directory = fileURLToPath(new URL('./.fixture-data-not-created', import.meta.url))
  const bridge = new HostBridge(runtime, {
    ...CONFIG, ...options.config,
    packageDirectory: directory, rendererDirectory: join(directory, 'renderer'),
    executable: join(directory, 'native', 'win-x64', 'WorkspaceNavigator.exe'), dataDirectory: directory,
  })
  const owner = peer()
  t.after(async () => {
    for (const handle of runtime.handles) handle.finish()
    await bridge.dispose().catch(() => { /* Some tests intentionally leave range observation failed. */ })
  })
  const call = (endpoint, payload = {}, signal = new AbortController().signal, caller = owner) => bridge.handle(endpoint, { clientId: CLIENT_A, ...payload }, signal, caller)
  return { bridge, runtime, owner, call }
}

export async function opened(f, value = model(), clientId = CLIENT_A) {
  const pending = f.call('open', { clientId, model: value })
  const handle = f.runtime.handles.at(-1)
  handle.handshake(value)
  const result = await pending
  if (!result.ok) throw new Error(`fixture open failed: ${result.error.code}`)
  return handle
}

/** Bound a fixture notification without a polling loop. */
export async function deadline(promise, milliseconds = 1000) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('fixture notification timed out')), milliseconds)
    })])
  } finally { clearTimeout(timer) }
}
