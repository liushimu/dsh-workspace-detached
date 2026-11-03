/* Installed with AddScriptToExecuteOnDocumentCreatedAsync, before the fixed renderer script. */
(() => {
  'use strict'
  if (window !== window.top || location.origin !== 'https://navigator.local'
    || location.pathname !== '/workspace-navigator.html' || location.search) return

  const carrier = window.chrome?.webview
  if (!carrier) return
  const maxInnerBytes = 4 * 1024 * 1024
  const maxCarrierBytes = maxInnerBytes + 1024
  const maxPending = 128
  const encoder = new TextEncoder()
  const pending = new Map()
  const listeners = new Set()
  let serial = 0
  let disposed = false
  let latest

  function error(code) {
    const value = new Error(`workspace navigator: ${code}`)
    value.name = 'WorkspaceNavigatorError'
    return value
  }
  function failAll(code) {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error(code))
    }
    pending.clear()
  }
  function plain(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
  }
  function request(op, value) {
    if (disposed) return Promise.reject(error('closed'))
    if (pending.size >= maxPending) return Promise.reject(error('too-many-pending'))
    const id = `n${++serial}`
    let message
    try {
      if (op !== 'ready' && !plain(value)) throw error('invalid-message')
      if (op !== 'ready' && encoder.encode(JSON.stringify(value)).byteLength > maxInnerBytes)
        throw error('payload-too-large')
      message = op === 'ready' ? { op, id } : { op, id, value }
      if (encoder.encode(JSON.stringify(message)).byteLength > maxCarrierBytes) throw error('frame-too-large')
    } catch (cause) { return Promise.reject(cause) }
    return new Promise((resolve, reject) => {
      // Native also expires requests after 30 seconds. This last-resort deadline survives lost transport replies.
      const timer = setTimeout(() => { pending.delete(id); reject(error('reply-timeout')) }, 35000)
      pending.set(id, { resolve, reject, timer })
      try { carrier.postMessage(message) }
      catch (_cause) { clearTimeout(timer); pending.delete(id); reject(error('transport-failed')) }
    })
  }
  carrier.addEventListener('message', event => {
    const message = event.data
    if (!plain(message)) { failAll('invalid-reply'); return }
    if (message.op === 'model' && Object.keys(message).length === 2 && plain(message.model)) {
      latest = message.model
      for (const listener of [...listeners]) {
        try { listener(latest) } catch (_cause) { /* One consumer cannot strand other RPC promises. */ }
      }
    } else if (message.op === 'result' && Object.keys(message).length === 3
      && typeof message.id === 'string' && Object.hasOwn(message, 'value')) {
      const entry = pending.get(message.id)
      if (!entry) return
      clearTimeout(entry.timer)
      pending.delete(message.id)
      // Reserved transport error sentinel; valid model/accepted/refresh/disconnected values have no error key.
      if (plain(message.value) && Object.hasOwn(message.value, 'error')) {
        const code = typeof message.value.error === 'string' && /^[a-z][a-z0-9-]{0,63}$/u.test(message.value.error)
          ? message.value.error : 'host-error'
        entry.reject(error(code))
      } else entry.resolve(message.value)
    } else failAll('invalid-reply')
  })
  window.addEventListener('pagehide', () => {
    disposed = true
    failAll('closed')
    listeners.clear()
    latest = undefined
  }, { once: true })
  Object.defineProperty(window, 'workspaceNavigator', {
    configurable: false,
    writable: false,
    value: Object.freeze({
      ready: () => request('ready'),
      rendered: value => request('rendered', value),
      command: value => request('command', value),
      subscribe: listener => {
        if (disposed) throw error('closed')
        if (typeof listener !== 'function' || listeners.size >= 32) throw error('invalid-listener')
        listeners.add(listener)
        if (latest !== undefined) {
          const model = latest
          queueMicrotask(() => { if (!disposed && listeners.has(listener)) listener(model) })
        }
        return () => { listeners.delete(listener) }
      },
    }),
  })
})()
