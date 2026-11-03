/** One managed native window: readiness, bounded protocol, and awaited range termination. */
import { join } from 'node:path'
import { HostError, helperMessage, targetsMatch } from './validation.js'
import { JsonLineWriter, readJsonLines } from './pipe.js'

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  // The owning Client may cancel its request before the process settles.
  void promise.catch(() => {})
  return { promise, resolve, reject }
}

/** A window generation is not reusable until its managed range is confirmed empty. */
export class NativeSession {
  constructor(runtime, options, clientId, model, emit, diagnose) {
    this.runtime = runtime
    this.options = options
    this.clientId = clientId
    this.model = model
    this.emit = emit
    this.diagnose = diagnose
    this.phase = 'opening'
    this.started = false
    this.ready = false
    this.rendered = undefined
    this.commands = new Set()
    this.opened = deferred()
    this.stopped = deferred()
    this.lifetime = new AbortController()
    this.handle = undefined
    this.writer = undefined
    this.removeReader = undefined
    this.startupTimer = undefined
    this.cleanup = undefined
  }

  /** Start through the injected public provider, never Node child_process or a shell. */
  start() {
    this.armReadiness()
    if (this.phase !== 'opening') return
    try {
      this.handle = this.runtime.spawn({
        argv: [this.options.executable, '--assets', this.options.rendererDirectory,
          '--user-data', join(this.options.dataDirectory, this.clientId),
          '--state-data', join(this.options.dataDirectory, 'window-state')],
        cwd: this.options.packageDirectory,
        stdio: { stdin: 'pipe', stdout: 'pipe', stderr: { maxBytes: 64 * 1024 } },
        graceMs: this.options.graceMs,
        signal: this.lifetime.signal,
        env: {},
      })
      // Observe done even when a provider fails to allocate one of the requested pipes.
      void this.handle.done.then(
        () => { if (this.phase !== 'closing' && this.phase !== 'closed') this.fail(new HostError('helper-exit')) },
        () => { if (this.phase !== 'closing' && this.phase !== 'closed') this.fail(new HostError('helper-start')) },
      )
      if (this.handle.stdin === undefined || this.handle.stdout === undefined) throw new HostError('helper-start')
      this.writer = new JsonLineWriter(this.handle.stdin, error => this.fail(error))
      this.removeReader = readJsonLines(this.handle.stdout, value => this.receive(helperMessage(value)), error => this.fail(error))
    } catch (error) {
      this.fail(error instanceof HostError ? error : new HostError('helper-start'))
    }
  }

  /** Replace only a strictly newer model of this same main-client instance. */
  async publish(model) {
    if (this.phase === 'closing' || this.phase === 'closed') throw new HostError('closed')
    if (model.instance !== this.model.instance || model.revision <= this.model.revision) throw new HostError('stale')
    this.model = model
    this.rendered = undefined
    this.commands.clear()
    if (this.ready) await this.send({ op: 'model', model })
  }

  /** One readiness cycle follows the current model, including superseding publishes, to a fixed deadline. */
  armReadiness() {
    if (!this.emit({ kind: 'state', state: 'opening' })) {
      this.fail(new HostError('queue-full'))
      return
    }
    this.startupTimer = setTimeout(() => this.fail(new HostError('startup-timeout')), this.options.startupMs)
  }

  /** Explicit open rearms readiness, not the process; ordinary publishes never toggle main-sidebar state. */
  async reopen(model) {
    if (this.phase === 'closing' || this.phase === 'closed') throw new HostError('closed')
    if (model.instance !== this.model.instance || model.revision < this.model.revision) throw new HostError('stale')
    if (this.phase === 'detached') {
      this.opened = deferred()
      this.phase = 'opening'
      this.armReadiness()
    }
    // Delivery can be blocked: readiness and close still settle open at the canonical deadline.
    if (model.revision > this.model.revision) void this.publish(model).catch(error => this.fail(error))
    this.tryDetach()
    await this.opened.promise
  }

  async focus() {
    if (this.phase === 'closing' || this.phase === 'closed') throw new HostError('closed')
    await this.send({ op: 'focus' })
  }

  send(value) {
    if (this.writer === undefined) return Promise.reject(new HostError('helper-start'))
    return this.writer.send(value)
  }

  receive(message) {
    if (this.phase === 'closing' || this.phase === 'closed') return
    switch (message.op) {
      case 'ready':
        this.ready = true
        this.fire({ op: 'result', id: message.id, value: this.model })
        return
      case 'started':
        this.started = true
        this.tryDetach()
        return
      case 'rendered': {
        if (!this.ready) throw new HostError('helper-protocol')
        const matches = message.value.instance === this.model.instance && message.value.revision === this.model.revision
        this.fire({ op: 'result', id: message.id, value: null })
        if (matches) {
          this.rendered = message.value.revision
          this.tryDetach()
        } else this.fire({ op: 'model', model: this.model })
        return
      }
      case 'command': {
        const value = this.command(message.value)
        const sent = this.send({ op: 'result', id: message.id, value })
        void sent.catch(error => this.fail(error))
        if (value.kind === 'accepted' && message.value.type === 'return') {
          // Flush the shell's acknowledgement before beginning ordinary close.
          void sent.then(() => this.close(), () => {}).catch(error => this.diagnose(error))
        }
        return
      }
      case 'closed':
        void this.close().catch(error => this.diagnose(error))
        return
      case 'error':
        this.helperErrorCode = message.code
        this.fail(new HostError('helper-error'))
        return
    }
  }

  fire(value) {
    void this.send(value).catch(error => this.fail(error))
  }

  tryDetach() {
    if (this.phase !== 'opening' || !this.started || !this.ready || this.rendered !== this.model.revision) return
    clearTimeout(this.startupTimer)
    this.startupTimer = undefined
    this.phase = 'detached'
    if (!this.emit({ kind: 'state', state: 'detached' })) {
      this.fail(new HostError('queue-full'))
      return
    }
    // Managed Windows targets start hidden; only an explicit ready open may reveal/focus the shell.
    this.fire({ op: 'focus' })
    this.opened.resolve()
  }

  command(command) {
    // Only completion of the still-offered I/O may cross unrelated revisions/loading.
    const clipboardReceipt = command.type === 'clipboard-result'
    if (this.phase !== 'detached' || command.instance !== this.model.instance
      || (clipboardReceipt ? command.revision > this.model.revision : command.revision !== this.model.revision)
      || this.commands.has(command.commandId) || this.commands.size >= 4096 || !targetsMatch(this.model, command)) {
      return { kind: 'refresh', model: this.model }
    }
    if (!this.model.connected && command.type !== 'return' && !clipboardReceipt) return { kind: 'disconnected', model: this.model }
    this.commands.add(command.commandId)
    if (!this.emit({ kind: 'command', command })) {
      this.fail(new HostError('queue-full'))
      return { kind: 'disconnected', model: this.model }
    }
    return { kind: 'accepted' }
  }

  /** Failure restores the main sidebar but does not operate on Sessions or Agents. */
  fail(error) {
    if (this.phase === 'closing' || this.phase === 'closed') return
    this.diagnose(error)
    const code = error instanceof HostError ? error.code : 'internal'
    this.failureCode = this.helperErrorCode ? `${code}/${this.helperErrorCode}` : code
    this.emit({ kind: 'state', state: 'error', code: this.failureCode })
    void this.close(error).catch(failure => this.diagnose(failure))
  }

  /**
   * Request graceful close, then terminate the provider-managed range and await it.
   * A rejected wait retains this generation as non-reusable instead of overlapping children.
   * @param error - Opening failure, or omission for an ordinary user close.
   * @returns Quiescence of the entire managed range, not just the top-level outcome.
   */
  close(error = new HostError('closed')) {
    if (this.cleanup !== undefined) return this.cleanup
    this.phase = 'closing'
    clearTimeout(this.startupTimer)
    this.startupTimer = undefined
    this.opened.reject(error)
    this.cleanup = this.release().then(() => {
      this.phase = 'closed'
      this.emit({ kind: 'state', state: 'closed', code: this.failureCode || (error instanceof HostError ? error.code : 'internal') })
      this.stopped.resolve()
    }, () => {
      const failure = new HostError('cleanup-failed')
      this.diagnose(failure)
      this.stopped.reject(failure)
      throw failure
    })
    return this.cleanup
  }

  async release() {
    const handle = this.handle
    if (handle === undefined) return
    // A blocked stdin write cannot postpone the termination deadline.
    void this.send({ op: 'close' }).catch(() => { /* Pipe failure is contained by range termination below. */ })
    // The public spawn signal begins the provider's managed-range termination procedure.
    const terminate = () => this.lifetime.abort()
    const timer = setTimeout(terminate, this.options.graceMs)
    try {
      if (!await handle.waitForExit()) throw new HostError('cleanup-failed')
      // done is outcome-only and may reject for startup; waitForExit has independently proved emptiness.
      await handle.done.catch(() => { /* Spawn/provider error is reported by the outcome observer. */ })
    } catch (error) {
      // Observation failure is not evidence of emptiness. Still request termination before reporting it.
      terminate()
      throw error
    } finally {
      clearTimeout(timer)
    }
    this.removeReader?.()
    this.writer?.dispose()
  }
}
