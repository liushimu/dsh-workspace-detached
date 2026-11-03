import test from 'node:test'
import assert from 'node:assert/strict'
import { parseWorkspaceNavigatorModel, parseWorkspaceNavigatorCommand, parseWorkspaceNavigatorEvent } from '../../lib/protocol.js'
import { targetsMatch } from '../../src/host/validation.js'
import { setImmediate as turn } from 'node:timers/promises'
import { model, command, fixture, opened } from './fixtures.mjs'

function nested() {
  const value = model()
  value.workspaces[0].label = 'SteamLibrary'
  value.workspaces[0].rows.unshift({ id: 'child-workspace', kind: 'workspace', workspaceId: 'actual-child',
    label: '汉化', title: '汉化', depth: 0, activityAt: null, activityKnown: false, matches: true, expanded: true })
  value.workspaces[0].rows[1].depth = 1
  value.workspaces[0].rows[2].depth = 2
  return value
}

test('v3 preserves nested workspaces as preorder containers and accepts their fold target', () => {
  const value = nested()
  assert.equal(parseWorkspaceNavigatorModel(value), value)
  const intent = { instance: value.instance, revision: value.revision, commandId: 'layout-container', type: 'layout',
    layout: { focusedWorkspaceId: 'workspace-a', collapsedGroups: ['child-workspace'], scrolls: [] } }
  parseWorkspaceNavigatorCommand(intent)
  assert.equal(targetsMatch(value, intent), true)
  value.workspaces[0].rows[0].kind = 'session'
  assert.throws(() => parseWorkspaceNavigatorModel(value))
})

test('v2 and omitted ordering cannot silently enter the v3 interaction path', () => {
  const old = model(); old.version = 2
  assert.throws(() => parseWorkspaceNavigatorModel(old))
  const missing = model(); delete missing.sortMode
  assert.throws(() => parseWorkspaceNavigatorModel(missing))
})

test('menus/dialogs/operation are bounded display data, not executable callbacks or CSS', () => {
  const value = nested()
  value.contextMenu = { id: 'menu-1', targetId: 'session-a', title: '会话菜单', entries: [
    { id: 'rename', label: '重命名' }, { id: 'separator', label: '', separator: true }, { id: 'archive', label: '归档', disabled: true },
  ] }
  value.dialog = { id: 'dialog-1', title: '自定义外观', kind: 'appearance', appearance: { color: '#123456', weight: 600, glow: 2, shadow: true, stroke: false, strokeWidth: 1, strokeColor: '', icon: 'solid' } }
  value.operation = { id: 'command-1', status: 'pending', message: '正在处理' }
  assert.equal(parseWorkspaceNavigatorModel(value), value)
  for (const mutate of [
    bad => { bad.contextMenu.entries.push({ id: 'rename', label: 'duplicate' }) },
    bad => { bad.contextMenu.entries[0].run = 'doSomething()' },
    bad => { bad.contextMenu.targetId = 'removed' },
    bad => { bad.dialog.appearance.background = 'red' },
    bad => { bad.dialog.appearance.color = 'url(https://invalid/)' },
    bad => { bad.dialog.appearance.weight = Infinity },
    bad => { bad.operation.status = 'accepted' },
  ]) { const bad = structuredClone(value); mutate(bad); assert.throws(() => parseWorkspaceNavigatorModel(bad)) }
})

test('appearance preserves the existing finite automatic palette without admitting it as rendered CSS', () => {
  const value = model()
  value.dialog = { id: 'appearance-1', kind: 'appearance', title: '外观', appearance: { color: 'auto:12' } }
  assert.equal(parseWorkspaceNavigatorModel(value), value)
  value.dialog.appearance.color = 'auto:13'
  assert.throws(() => parseWorkspaceNavigatorModel(value))
  delete value.dialog
  value.workspaces[0].style = { color: 'auto:3' }
  assert.throws(() => parseWorkspaceNavigatorModel(value))
})

test('v3 interaction commands retain exact field sets and reject unknown execution data', () => {
  const common = { instance: 'main-a', revision: 1, commandId: 'intent-1' }
  for (const payload of [
    { type: 'context', id: 'session-a' }, { type: 'action', id: 'menu-1', action: 'rename' },
    { type: 'dialog', id: 'dialog-1', value: '新标题' }, { type: 'cancel-dialog', id: 'dialog-1' },
    { type: 'dialog', id: 'dialog-2', appearance: { color: '', weight: 0, stroke: false } },
    { type: 'drop', id: 'child-workspace', targetId: null, position: 'inside' },
    { type: 'sort', mode: 'manual' },
  ]) { const intent = { ...common, ...payload }; assert.equal(parseWorkspaceNavigatorCommand(intent), intent) }
  for (const payload of [
    { type: 'action', id: 'menu-1', action: 'rename', callback: 'arbitrary()' },
    { type: 'dialog', id: 'dialog-1', appearance: { cssText: 'background:url(x)' } },
    { type: 'drop', id: 'child-workspace', targetId: 'workspace-a', position: 'append-and-exec' },
    { type: 'sort', mode: 'updatedAt' },
  ]) assert.throws(() => parseWorkspaceNavigatorCommand({ ...common, ...payload }))
})

test('Host action admission uses the current menu id plus enabled entry, never a stale target-only request', () => {
  const value = nested()
  value.contextMenu = { id: 'menu-1', targetId: 'session-a', title: '', entries: [
    { id: 'rename', label: '重命名' }, { id: 'disabled', label: '禁用', disabled: true }, { id: 'sep', label: '', separator: true },
  ] }
  assert.equal(targetsMatch(value, command({ type: 'context', id: 'child-workspace' })), true)
  assert.equal(targetsMatch(value, command({ type: 'action', id: 'menu-1', action: 'rename' })), true)
  for (const intent of [
    { id: 'session-a', action: 'rename' }, { id: 'old-menu', action: 'rename' }, { id: 'menu-1', action: 'disabled' },
    { id: 'menu-1', action: 'sep' }, { id: 'menu-1', action: 'arbitrary' },
  ]) assert.equal(targetsMatch(value, command({ type: 'action', ...intent })), false)
  value.contextMenu = undefined
  assert.equal(targetsMatch(value, command({ type: 'action', id: 'menu-1', action: 'rename' })), false)
})

test('dialog selection validates its current identity and disabled choices before forwarding', () => {
  const value = model()
  value.dialog = { id: 'dialog-1', kind: 'select', title: '移动到分组', options: [{ id: '', label: '根' }, { id: 'group', label: '组' }, { id: 'no', label: '不可用', disabled: true }] }
  assert.equal(targetsMatch(value, command({ type: 'dialog', id: 'dialog-1', value: '' })), true)
  assert.equal(targetsMatch(value, command({ type: 'dialog', id: 'old-dialog', value: 'group' })), false)
  assert.equal(targetsMatch(value, command({ type: 'dialog', id: 'dialog-1', value: 'no' })), false)
  assert.equal(targetsMatch(value, command({ type: 'dialog', id: 'dialog-1', value: 'unknown' })), false)
  assert.equal(targetsMatch(value, command({ type: 'dialog', id: 'dialog-1', value: 'group', appearance: {} })), false)
  assert.equal(targetsMatch(value, command({ type: 'cancel-dialog', id: 'dialog-1' })), true)
})

test('automatic order admits regrouping but refuses fixed placement; removed/self/leaf targets never forward', () => {
  const value = nested()
  const drop = fields => command({ type: 'drop', id: 'child-workspace', targetId: 'workspace-a', position: 'inside', ...fields })
  assert.equal(targetsMatch(value, drop({})), true)
  assert.equal(targetsMatch(value, drop({ targetId: null })), true)
  for (const fields of [{ targetId: 'missing' }, { targetId: 'child-workspace' }, { targetId: 'session-a' }, { id: 'missing' }, { position: 'before' }]) assert.equal(targetsMatch(value, drop(fields)), false)
  value.sortMode = 'manual'
  assert.equal(targetsMatch(value, drop({ position: 'before' })), true)
})

test('actual parser/NativeSession seam forwards each finite interaction without treating admission as business success', async t => {
  const value = nested(), f = fixture(t)
  value.contextMenu = { id: 'menu-current', targetId: 'session-a', title: '', entries: [{ id: 'rename', label: '重命名' }] }
  value.dialog = { id: 'dialog-current', kind: 'select', title: '选择', options: [{ id: 'group-a', label: '组' }] }
  const handle = await opened(f, value)
  const payloads = [
    { type: 'context', id: 'child-workspace' },
    { type: 'action', id: 'menu-current', action: 'rename' },
    { type: 'dialog', id: 'dialog-current', value: 'group-a' },
    { type: 'cancel-dialog', id: 'dialog-current' },
    { type: 'drop', id: 'child-workspace', targetId: 'workspace-a', position: 'inside' },
    { type: 'sort', mode: 'manual' },
    { type: 'layout', layout: { focusedWorkspaceId: null, collapsedGroups: ['child-workspace'], scrolls: [] } },
  ]
  for (const [index, payload] of payloads.entries()) {
    const intent = { instance: value.instance, revision: value.revision, commandId: `intent-${index}`, ...payload }
    parseWorkspaceNavigatorCommand(intent)
    handle.send({ op: 'command', id: `wire-${index}`, value: intent })
    await turn()
    const reply = handle.requests.find(request => request.op === 'result' && request.id === `wire-${index}`)
    assert.equal(reply?.value.kind, 'accepted')
  }
  const batch = await f.call('events', { after: 0 })
  const forwarded = batch.value.events.filter(item => item.event.kind === 'command')
  assert.equal(forwarded.length, payloads.length)
  assert.equal(value.operation, undefined, 'Host admission cannot invent a Main business-success result')
  assert.equal(handle.requests.some(request => request.op === 'close'), false)
})

test('a valid action frame for an old menu refreshes the live Native session rather than closing it', async t => {
  const value = nested(), f = fixture(t)
  value.contextMenu = { id: 'menu-current', targetId: 'session-a', title: '', entries: [{ id: 'rename', label: '重命名' }] }
  const handle = await opened(f, value)
  const intent = { instance: value.instance, revision: value.revision, commandId: 'old-menu-intent', type: 'action', id: 'old-menu', action: 'rename' }
  parseWorkspaceNavigatorCommand(intent)
  handle.send({ op: 'command', id: 'old-menu-frame', value: intent })
  await turn()
  const reply = handle.requests.find(request => request.op === 'result' && request.id === 'old-menu-frame')
  assert.equal(reply?.value.kind, 'refresh')
  assert.equal(handle.requests.some(request => request.op === 'close'), false)
  const batch = await f.call('events', { after: 0 })
  assert.equal(batch.value.events.some(item => item.event.kind === 'command'), false)
})

test('v3 clipboard offers are optional, exact bounded transient text; receipt cannot choose text or operations', () => {
  assert.equal(parseWorkspaceNavigatorModel(model()).clipboard, undefined, 'old v3 models remain legal')
  for (const size of [1, 512]) {
    const value = { ...model(), clipboard: { id: 'e'.repeat(128), text: '字'.repeat(size) } }
    assert.equal(parseWorkspaceNavigatorModel(value), value)
  }
  for (const clipboard of [null, {}, { id: '', text: 's1' }, { id: 'e'.repeat(129), text: 's1' },
    { id: 'e', text: '' }, { id: 'e', text: 'x'.repeat(513) }, { id: 'e', text: 1 },
    { id: 'e', text: 's1', script: 'write()' }, { id: 'e', text: 's1', url: 'https://invalid/' },
    { id: 'e', text: 's1', operation: 'arbitrary' }]) {
    assert.throws(() => parseWorkspaceNavigatorModel({ ...model(), clipboard }))
  }
  for (const outcome of ['copied', 'unavailable', 'denied', 'failed']) {
    const intent = command({ type: 'clipboard-result', id: 'e'.repeat(128), outcome })
    assert.equal(parseWorkspaceNavigatorCommand(intent), intent)
    assert.equal(parseWorkspaceNavigatorEvent({ kind: 'command', command: intent }).command, intent)
  }
  for (const fields of [{ id: '' }, { id: 'e'.repeat(129) }, { outcome: 'accepted' }, { outcome: 'prepared' },
    { outcome: 'unknown' }, { outcome: null }, { outcome: true }, { text: 'self-selected' }, { script: 'write()' },
    { url: 'https://invalid/' }, { operation: 'native-copy' }]) {
    assert.throws(() => parseWorkspaceNavigatorCommand(command({ type: 'clipboard-result', id: 'e', outcome: 'copied', ...fields })))
  }
  const missing = command({ type: 'clipboard-result', id: 'e', outcome: 'copied' }); delete missing.outcome
  assert.throws(() => parseWorkspaceNavigatorCommand(missing))
})

test('Host clipboard completion matches only the currently offered ID, not a business target', () => {
  const value = model(), result = command({ type: 'clipboard-result', id: 'effect-1', outcome: 'copied' })
  assert.equal(targetsMatch(value, result), false)
  value.clipboard = { id: 'effect-1', text: 'actual-session' }
  assert.equal(targetsMatch(value, result), true)
  for (const id of ['session-a', 'actual-session', 'other-effect']) assert.equal(targetsMatch(value, { ...result, id }), false)
  delete value.clipboard
  assert.equal(targetsMatch(value, result), false)
})

test('NativeSession clipboard receipt crosses unrelated revisions/loading only while its authorized offer remains current', async t => {
  const f = fixture(t), value = { ...model(2), clipboard: { id: 'effect-1', text: 'actual-session' },
    contextMenu: { id: 'menu-current', targetId: 'session-a', title: '', entries: [{ id: 'copy-id', label: 'copy' }] },
    dialog: { id: 'dialog-current', kind: 'text', title: 'edit' }, operation: { id: 'copy-parent', status: 'pending', message: 'working' } }
  const handle = await opened(f, value)
  const next = { ...value, revision: 4, connected: false }
  assert.equal((await f.call('publish', { model: next })).ok, true)
  const receipt = { type: 'clipboard-result', id: 'effect-1', outcome: 'copied' }
  const send = (id, payload = receipt, fields = {}) => {
    const intent = { instance: value.instance, revision: 2, commandId: id, ...payload, ...fields }
    parseWorkspaceNavigatorCommand(intent)
    handle.send({ op: 'command', id, value: intent })
    return handle.requests.findLast(item => item.op === 'result' && item.id === id)?.value.kind
  }
  assert.equal(send('wrong-instance', receipt, { instance: 'other' }), 'refresh')
  assert.equal(send('wrong-effect', { ...receipt, id: 'old-effect' }), 'refresh')
  assert.equal(send('business-id', { ...receipt, id: 'actual-session' }), 'refresh')
  assert.equal(send('future-cut', receipt, { revision: 5 }), 'refresh')
  // All existing commands retain their exact revision and disconnected gates.
  const business = [
    { type: 'activate', id: 'session-a' }, { type: 'context', id: 'session-a' },
    { type: 'action', id: 'menu-current', action: 'copy-id' }, { type: 'dialog', id: 'dialog-current', value: 'new' },
    { type: 'cancel-dialog', id: 'dialog-current' }, { type: 'drop', id: 'session-a', targetId: 'group-a', position: 'inside' },
    { type: 'sort', mode: 'manual' }, { type: 'search', query: 'new' }, { type: 'layout', layout: value.layout },
  ]
  for (const payload of business) {
    assert.equal(send(`old-${payload.type}`, payload), 'refresh', payload.type)
    assert.equal(send(`offline-${payload.type}`, payload, { revision: 4 }), 'disconnected', payload.type)
  }
  assert.equal(send('old-return', { type: 'return' }), 'refresh')
  assert.equal(send('good-old-cut'), 'accepted', 'already-dispatched I/O may complete while unrelated content is loading')
  assert.equal(send('good-old-cut'), 'refresh', 'same command receipt is deduplicated')
  const batch = await f.call('events', { after: 0 })
  assert.deepEqual(batch.value.events.filter(item => item.event.kind === 'command').map(item => item.event.command.type), ['clipboard-result'])
  assert.equal(next.operation.status, 'pending', 'Host acceptance does not invent business completion')
  const retired = { ...next, revision: 5 }; delete retired.clipboard
  assert.equal((await f.call('publish', { model: retired })).ok, true)
  assert.equal(send('retired-old-cut'), 'refresh')
  assert.equal(send('retired-current-cut', receipt, { revision: 5 }), 'refresh')
  const newer = { ...retired, revision: 6, clipboard: { id: 'effect-2', text: 'another-real-id' } }
  assert.equal((await f.call('publish', { model: newer })).ok, true)
  assert.equal(send('late-effect-1', receipt, { revision: 6 }), 'refresh')
  assert.equal(send('good-effect-2', { ...receipt, id: 'effect-2' }, { revision: 6 }), 'accepted')
  assert.equal(send('offline-return', { type: 'return' }, { revision: 6 }), 'accepted', 'the pre-existing return exception remains')
})

test('clipboard completion cannot bypass NativeSession phase or existing command budget/dedup limits', async t => {
  const f = fixture(t), value = { ...model(), clipboard: { id: 'effect-1', text: 'session-a' } }
  await opened(f, value)
  const session = [...f.bridge.bindings.values()][0].window
  const result = command({ type: 'clipboard-result', id: 'effect-1', outcome: 'copied' })
  session.commands.add(result.commandId)
  assert.equal(session.command(result).kind, 'refresh')
  session.commands.clear()
  for (let index = 0; index < 4096; index++) session.commands.add('budget-' + index)
  assert.equal(session.command(result).kind, 'refresh')
  session.commands.clear()
  session.phase = 'opening'
  assert.equal(session.command(result).kind, 'refresh')
  session.phase = 'detached'
  await f.call('close')
  assert.equal(session.command(result).kind, 'refresh')
})

test('state notifications preserve stable failure codes but exclude payloads and unsafe diagnostic text', () => {
  const event = { kind: 'state', state: 'error', code: 'helper-error/renderer-failed' }
  assert.equal(parseWorkspaceNavigatorEvent(event), event)
  assert.throws(() => parseWorkspaceNavigatorEvent({ ...event, code: 'C:/private/file.json' }))
  assert.throws(() => parseWorkspaceNavigatorEvent({ ...event, detail: { token: 'no' } }))
})
