/** Authenticated Connection RPC orchestration with independent, expiring Client bindings. */
import { stat } from 'node:fs/promises'
import { randomBytes } from 'node:crypto'
import { join } from 'node:path'
import { EventMailbox } from './events.js'
import { NativeSession } from './native-session.js'
import { HostError, MAX_BINDINGS, failure, request } from './validation.js'

/** Observe cancellation without cancelling another caller's shared window operation. */
function cancellable(promise, signal) {
  if (signal.aborted) return Promise.reject(new HostError('cancelled'))
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new HostError('cancelled')) }
    signal.addEventListener('abort', abort, { once: true })
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value) },
      error => { signal.removeEventListener('abort', abort); reject(error) })
  })
}

class ClientBinding {
  constructor(bridge, clientId, peer) {
    this.bridge = bridge
    this.clientId = clientId
    this.incarnation = randomBytes(16).toString('hex')
    this.peer = peer
    this.mailbox = new EventMailbox(bridge.options.pollMs)
    this.window = undefined
    this.closeVersion = 0
    this.expired = false
    this.cleanup = undefined
    this.timer = undefined
    this.onPeerGone = () => { void this.retire('owner-ended').catch(error => bridge.diagnose(error)) }
    peer.signal.addEventListener('abort', this.onPeerGone, { once: true })
    this.touch()
  }

  touch() {
    if (this.expired) return
    clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      void this.retire('lease-expired').catch(error => this.bridge.diagnose(error))
    }, this.bridge.options.leaseMs)
    this.timer.unref?.()
  }

  async open(model, signal) {
    const closeVersion = this.closeVersion
    if (this.window?.phase === 'closing' || this.window?.phase === 'closed') await cancellable(this.window.stopped.promise, signal)
    if (closeVersion !== this.closeVersion) throw new HostError('closed')
    if (this.expired) throw new HostError('unowned')
    if (signal.aborted) throw new HostError('cancelled')
    if (this.window !== undefined) return cancellable(this.window.reopen(model), signal)
    if (this.bridge.options.dataDirectory === undefined) throw new HostError('unavailable')
    const window = new NativeSession(this.bridge.runtime, this.bridge.options, this.clientId, model,
      event => this.mailbox.push(event), error => this.bridge.diagnose(error))
    this.window = window
    void window.stopped.promise.then(() => {
      if (this.window === window) this.window = undefined
    }, () => { /* Unconfirmed managed ranges remain owned and block reopening. */ })
    window.start()
    return cancellable(window.opened.promise, signal)
  }

  close(reason = new HostError('closed')) {
    // A later close also invalidates opens waiting for the previous generation to exit.
    this.closeVersion++
    return this.window === undefined ? Promise.resolve() : this.window.close(reason)
  }

  retire(code) {
    if (this.cleanup !== undefined) return this.cleanup
    this.expired = true
    clearTimeout(this.timer)
    this.peer.signal.removeEventListener('abort', this.onPeerGone)
    if (code === 'lease-expired' && this.window !== undefined) this.window.fail(new HostError(code))
    this.cleanup = this.close(new HostError(code)).then(() => {
      this.mailbox.dispose()
      this.bridge.bindings.delete(this.clientId)
    }, error => {
      this.mailbox.dispose()
      // Keep this binding reserved when process-range emptiness could not be observed.
      throw error
    })
    return this.cleanup
  }
}

/** Instance state is held here and leaves with the plugin's effect, not a module singleton. */
export class HostBridge {
  constructor(runtime, options) {
    this.runtime = runtime
    this.options = options
    this.bindings = new Map()
    this.disposed = false
    this.cleanup = undefined
    this.lastError = null
    this.handle = this.handle.bind(this)
  }

  diagnose(error) { this.lastError = error instanceof HostError ? error.code : 'internal' }

  /** Redacted process-local observations; this is not a seventh RPC method. */
  diagnostics() {
    return {
      lastError: this.lastError,
      bindings: this.bindings.size,
      windows: [...this.bindings.values()].filter(binding => binding.window !== undefined).length,
      disposed: this.disposed,
    }
  }

  binding(clientId, peer, create) {
    const existing = this.bindings.get(clientId)
    if (existing !== undefined) {
      if (existing.peer.id !== peer.id || existing.expired) throw new HostError('unowned')
      existing.touch()
      return existing
    }
    if (!create) throw new HostError('unowned')
    if (this.bindings.size >= MAX_BINDINGS) throw new HostError('binding-limit')
    const binding = new ClientBinding(this, clientId, peer)
    this.bindings.set(clientId, binding)
    return binding
  }

  /** Connection has authenticated the carrier; enforce owner principal again at this executor. */
  async handle(endpoint, input, signal, peer) {
    try {
      if (peer?.principal?.kind !== 'owner' || typeof peer.id !== 'string' || peer.id.length === 0
        || peer.signal === undefined || peer.signal.aborted) throw new HostError('forbidden')
      if (this.disposed) throw new HostError('disposed')
      if (signal.aborted) throw new HostError('cancelled')
      const value = request(endpoint, input)
      const binding = this.binding(value.clientId, peer, endpoint === 'capabilities' || endpoint === 'open')
      const cancellation = AbortSignal.any([signal, peer.signal])
      let result = null
      switch (endpoint) {
        case 'capabilities': result = await this.capabilities(binding); break
        case 'open': await binding.open(value.model, cancellation); break
        case 'publish':
          if (binding.window === undefined) throw new HostError('closed')
          await cancellable(binding.window.publish(value.model), cancellation)
          break
        case 'focus':
          if (binding.window === undefined) throw new HostError('closed')
          await cancellable(binding.window.focus(), cancellation)
          break
        case 'close': await cancellable(binding.close(), cancellation); break
        case 'events': result = await binding.mailbox.read(value.after, cancellation); break
      }
      if (this.disposed) throw new HostError('disposed')
      if (cancellation.aborted) throw new HostError('cancelled')
      if (binding.expired) throw new HostError('unowned')
      binding.touch()
      return { ok: true, value: result }
    } catch (error) {
      return failure(error)
    }
  }

  /** File presence is advisory; actual process startup/handshake remains the open operation's check. */
  async capabilities(binding) {
    const file = async (path) => {
      try { return (await stat(path)).isFile() } catch (error) { return false }
    }
    const [executable, renderer] = await Promise.all([
      file(this.options.executable), file(join(this.options.rendererDirectory, 'workspace-navigator.html')),
    ])
    const supported = process.platform === 'win32' && process.arch === 'x64'
    const reason = !supported ? 'unsupported-platform' : this.options.dataDirectory === undefined ? 'profile-unavailable'
      : !executable ? 'helper-missing' : !renderer ? 'renderer-missing' : null
    return {
      protocolVersion: 3,
      bindingId: binding.incarnation,
      available: reason === null,
      reason,
      methods: ['capabilities', 'open', 'publish', 'focus', 'close', 'events'],
      projection: { key: 'workspaceNavigatorActivity', stateVersion: 1 },
      native: { platform: 'win32-x64', executable, renderer },
      startupMs: this.options.startupMs, pollMs: this.options.pollMs,
      leaseMs: this.options.leaseMs, graceMs: this.options.graceMs,
    }
  }

  /** Deny new requests synchronously, then release every binding and owned managed range. */
  dispose() {
    if (this.cleanup !== undefined) return this.cleanup
    this.disposed = true
    this.cleanup = Promise.allSettled([...this.bindings.values()].map(binding => binding.retire('closed'))).then(results => {
      if (results.some(result => result.status === 'rejected')) throw new HostError('cleanup-failed')
    })
    return this.cleanup
  }
}
