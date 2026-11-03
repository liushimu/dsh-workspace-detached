// Isolated DOM/stdio-API simulation only; no WebView2, Host, desktop or user data is touched.
import { readFileSync } from 'node:fs'
import { dshRequire as require } from '../support/dsh-sdk.mjs'
import { webcrypto } from 'node:crypto'
import { setImmediate as turn } from 'node:timers/promises'
import { parseWorkspaceNavigatorModel, parseWorkspaceNavigatorCommand, parseWorkspaceNavigatorCommandResult, parseWorkspaceNavigatorRendered } from '../../lib/protocol.js'

const { JSDOM } = require('jsdom')
const html = readFileSync(new URL('../../renderer/workspace-navigator.html', import.meta.url), 'utf8')
const source = readFileSync(new URL('../../renderer/workspace-navigator.js', import.meta.url), 'utf8')

/** Simulate the fixed renderer document with JSON ownership equivalent to the real carrier. */
export async function rendererFixture(initial, { command: onCommand, clipboard } = {}) {
  parseWorkspaceNavigatorModel(initial)
  const dom = new JSDOM(html, { url: 'https://navigator.local/workspace-navigator.html', runScripts: 'outside-only', pretendToBeVisual: true })
  const { window } = dom
  Object.defineProperty(window, 'crypto', { value: webcrypto })
  if (clipboard !== undefined) Object.defineProperty(window.navigator, 'clipboard', { value: clipboard })
  window.HTMLElement.prototype.scrollIntoView = function () {}
  if (window.HTMLDialogElement) {
    window.HTMLDialogElement.prototype.showModal = function () { this.open = true }
    window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new window.Event('close')) }
  }
  let listener, current = initial, time = 1000, timerId = 0
  const commands = [], rendered = [], errors = [], timers = new Map()
  const clone = value => JSON.parse(JSON.stringify(value))
  // Deterministic UI debounces only, not polling or production lifecycle simulation.
  window.setTimeout = (callback, delay = 0) => { const id = ++timerId; timers.set(id, { at: time + delay, callback }); return id }
  window.clearTimeout = id => { timers.delete(id) }
  window.Date.now = () => time
  window.addEventListener('error', event => { errors.push(event.error); event.preventDefault() })
  window.workspaceNavigator = {
    ready: async () => clone(current),
    rendered: async value => { const receipt = clone(value); parseWorkspaceNavigatorRendered(receipt); rendered.push(receipt) },
    subscribe: callback => { listener = callback; return () => { listener = undefined } },
    command: async value => {
      const intent = clone(value)
      parseWorkspaceNavigatorCommand(intent)
      commands.push(intent)
      const result = onCommand ? await onCommand(intent) : { kind: 'accepted' }
      parseWorkspaceNavigatorCommandResult(result)
      return clone(result)
    },
  }
  window.eval(source)
  const settle = async () => { await turn(); await turn(); if (errors.length) throw new AggregateError(errors.splice(0), 'renderer DOM error') }
  const advance = async milliseconds => {
    const until = time + milliseconds
    while (true) {
      const entry = [...timers].filter(([, value]) => value.at <= until).sort((a, b) => a[1].at - b[1].at)[0]
      if (!entry) break
      const [id, value] = entry; timers.delete(id); time = value.at; value.callback(); await settle()
    }
    time = until; await settle()
  }
  const dispatch = (target, type, fields = {}) => {
    const event = new window.Event(type, { bubbles: true, cancelable: true })
    for (const [key, value] of Object.entries(fields)) Object.defineProperty(event, key, { value })
    target.dispatchEvent(event)
    return event
  }
  const key = (target, value, fields = {}) => { const event = new window.KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: value, ...fields }); target.dispatchEvent(event); return event }
  await settle()
  return {
    dom, window, document: window.document, commands, rendered, settle, advance, dispatch, key,
    async publish(value) {
      parseWorkspaceNavigatorModel(value)
      current = value
      listener?.(clone(value))
      await settle()
    },
    close() { window.dispatchEvent(new window.Event('pagehide')); window.close() },
  }
}
