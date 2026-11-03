/** Bounded JSON and exact RPC/helper messages. All diagnostics exclude untrusted payloads. */
import {
  parseWorkspaceNavigatorModel, parseWorkspaceNavigatorCommand,
  parseWorkspaceNavigatorRendered, parseWorkspaceNavigatorEvent,
} from '../../lib/protocol.js'

export const MAX_MODEL_BYTES = 4 * 1024 * 1024
export const MAX_FRAME_BYTES = MAX_MODEL_BYTES + 1024
export const MAX_EVENTS_BYTES = MAX_MODEL_BYTES + 4096
export const MAX_QUEUED_EVENTS = 4096
export const MAX_BINDINGS = 32

const messages = {
  invalid: 'Invalid workspace navigator message.',
  'over-budget': 'Workspace navigator message exceeds its limit.',
  forbidden: 'Workspace navigator requires an authenticated owner.',
  unowned: 'This workspace navigator binding belongs to another client or is unavailable.',
  stale: 'Workspace navigator model or cursor is stale; refresh the client.',
  cancelled: 'Workspace navigator request was cancelled.',
  disposed: 'Workspace navigator Host has been unloaded.',
  busy: 'This workspace navigator client already has an event request.',
  unavailable: 'Workspace navigator requires an isolated profile data directory.',
  'binding-limit': 'Too many workspace navigator client bindings.',
  'queue-full': 'Workspace navigator event queue is full.',
  'helper-start': 'Workspace navigator helper could not start.',
  'helper-protocol': 'Workspace navigator helper sent an invalid message.',
  'helper-eof': 'Workspace navigator helper closed its output unexpectedly.',
  'helper-exit': 'Workspace navigator helper exited unexpectedly.',
  'helper-io': 'Workspace navigator helper pipe failed.',
  'helper-error': 'Workspace navigator helper reported an error.',
  'startup-timeout': 'Workspace navigator helper did not render before the startup deadline.',
  'lease-expired': 'Workspace navigator main-client lease expired.',
  'owner-ended': 'Workspace navigator owning main-client connection ended.',
  'cleanup-failed': 'Workspace navigator helper exit could not be confirmed.',
  closed: 'Workspace navigator window was closed.',
  internal: 'Workspace navigator operation failed.',
}

/** A stable error suitable for the Connection RPC failure envelope. */
export class HostError extends Error {
  constructor(code) {
    super(messages[code] ?? messages.internal)
    this.name = 'WorkspaceNavigatorHostError'
    this.code = Object.hasOwn(messages, code) ? code : 'internal'
  }
}

/** @param error - Local or parser failure. @returns A carrier-neutral, redacted failure. */
export function failure(error) {
  const normalized = error instanceof HostError ? error : new HostError(error?.code === 'invalid' ? 'invalid' : 'internal')
  return { ok: false, error: { code: `workspace-navigator/${normalized.code}`, message: normalized.message, details: {} } }
}

/** Require a plain object with only the listed own fields. */
export function exact(value, required, optional = []) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    || Object.keys(value).some(key => !required.includes(key) && !optional.includes(key))
    || required.some(key => !Object.hasOwn(value, key))) throw new HostError('invalid')
}

/**
 * Copy a complete JSON value after bounding its depth, nodes and encoded UTF-8 size.
 * Accessors, cycles, sparse arrays, non-finite numbers and non-JSON values are rejected.
 * @param value - Data from RPC or a helper pipe.
 * @param maximum - Complete encoded byte limit, including this message's fields.
 * @returns An independently owned JSON snapshot.
 */
export function boundedJson(value, maximum = MAX_FRAME_BYTES) {
  const ancestors = new Set()
  let nodes = 0
  let estimate = 0
  function visit(item, depth) {
    if (++nodes > 250_000 || depth > 32) throw new HostError('over-budget')
    if (item === null || typeof item === 'boolean') { estimate += 5; return }
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new HostError('invalid')
      estimate += 32
      return
    }
    if (typeof item === 'string') {
      if (item.length > maximum) throw new HostError('over-budget')
      estimate += item.length
      return
    }
    if (typeof item !== 'object' || ancestors.has(item)) throw new HostError('invalid')
    const array = Array.isArray(item)
    if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw new HostError('invalid')
    const keys = Reflect.ownKeys(item)
    if (array && keys.length !== item.length + 1) throw new HostError('invalid')
    ancestors.add(item)
    for (const key of keys) {
      if (array && key === 'length') continue
      const descriptor = Object.getOwnPropertyDescriptor(item, key)
      if (typeof key !== 'string' || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw new HostError('invalid')
      if (array && (!/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= item.length)) throw new HostError('invalid')
      estimate += key.length + 3
      if (estimate > maximum * 4) throw new HostError('over-budget')
      visit(descriptor.value, depth + 1)
    }
    ancestors.delete(item)
  }
  visit(value, 0)
  const json = JSON.stringify(value)
  if (Buffer.byteLength(json, 'utf8') > maximum) throw new HostError('over-budget')
  return JSON.parse(json)
}

/** @returns The validated payload for one of the six public methods. */
export function request(endpoint, input) {
  if (!['capabilities', 'open', 'publish', 'focus', 'close', 'events'].includes(endpoint)) throw new HostError('invalid')
  const value = boundedJson(input)
  exact(value, endpoint === 'open' || endpoint === 'publish' ? ['clientId', 'model']
    : endpoint === 'events' ? ['clientId', 'after'] : ['clientId'])
  if (typeof value.clientId !== 'string' || !/^[a-f0-9]{32}$/u.test(value.clientId)) throw new HostError('invalid')
  if (endpoint === 'open' || endpoint === 'publish') parseWorkspaceNavigatorModel(value.model)
  if (endpoint === 'events' && (!Number.isSafeInteger(value.after) || value.after < 0)) throw new HostError('invalid')
  return value
}

function requestId(value) {
  if (!(typeof value === 'string' && value.length > 0 && value.length <= 128)
    && !(Number.isSafeInteger(value) && value >= 0)) throw new HostError('invalid')
}

/** @returns One exact helper message; unknown operations or fields are rejected. */
export function helperMessage(input) {
  const value = boundedJson(input)
  if (value?.op === 'ready') {
    exact(value, ['op', 'id'])
    requestId(value.id)
  } else if (value?.op === 'rendered' || value?.op === 'command') {
    exact(value, ['op', 'id', 'value'])
    requestId(value.id)
    if (value.op === 'rendered') parseWorkspaceNavigatorRendered(value.value)
    else parseWorkspaceNavigatorCommand(value.value)
  } else if (value?.op === 'started') {
    exact(value, ['op'])
  } else if (value?.op === 'error') {
    exact(value, ['op', 'code'])
    if (typeof value.code !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/u.test(value.code)) throw new HostError('invalid')
  } else if (value?.op === 'closed') {
    exact(value, ['op', 'bounds'])
    if (value.bounds !== null) {
      exact(value.bounds, ['x', 'y', 'width', 'height'])
      if (!Object.values(value.bounds).every(entry => Number.isSafeInteger(entry) && Math.abs(entry) <= 10_000_000)
        || value.bounds.width <= 0 || value.bounds.height <= 0) throw new HostError('invalid')
    }
  } else throw new HostError('invalid')
  return value
}

/** @returns A validated state/command notification and its complete queued UTF-8 size. */
export function queuedEvent(sequence, event) {
  const item = { sequence, event: parseWorkspaceNavigatorEvent(event) }
  return { item, bytes: Buffer.byteLength(JSON.stringify(item), 'utf8') + 1 }
}

/** @returns Whether a command's targets still exist in the current supplied display model. */
export function targetsMatch(model, command) {
  if (command.type === 'clipboard-result') return model.clipboard?.id === command.id
  if (command.type === 'activate') return model.workspaces.some(workspace => workspace.rows.some(
    row => row.id === command.id && row.kind === 'session' && row.disabled !== true,
  ))
  const targets = new Map(model.workspaces.flatMap(workspace => [[workspace.id, workspace], ...workspace.rows.map(row => [row.id, row])]))
  if (command.type === 'context') return targets.has(command.id)
  if (command.type === 'action') return model.contextMenu?.id === command.id && targets.has(model.contextMenu.targetId)
    && model.contextMenu.entries.some(entry => entry.id === command.action && !entry.disabled && !entry.separator)
  if (command.type === 'dialog' || command.type === 'cancel-dialog') {
    const dialog = model.dialog
    if (!dialog || dialog.id !== command.id) return false
    if (command.type === 'cancel-dialog') return true
    if (command.appearance !== undefined && dialog.kind !== 'appearance') return false
    if (dialog.kind === 'select') return dialog.options?.some(option => option.id === command.value && !option.disabled) === true
    return true
  }
  if (command.type === 'drop') {
    if (!targets.has(command.id) || command.id === command.targetId) return false
    if (command.position !== 'inside' && model.sortMode !== 'manual') return false
    if (command.targetId === null) return command.position === 'inside'
    const target = targets.get(command.targetId)
    return target !== undefined && (command.position !== 'inside' || target.kind !== 'session')
  }
  if (command.type !== 'layout') return true
  const workspaces = new Set(model.workspaces.map(workspace => workspace.id))
  const groups = new Set(model.workspaces.flatMap(workspace => workspace.rows.filter(row => row.kind !== 'session').map(row => row.id)))
  return (command.layout.focusedWorkspaceId === null || workspaces.has(command.layout.focusedWorkspaceId))
    && command.layout.collapsedGroups.every(id => groups.has(id))
    && command.layout.scrolls.every(scroll => scroll.id === 'overview' || scroll.id === 'strip' || workspaces.has(scroll.id))
}
