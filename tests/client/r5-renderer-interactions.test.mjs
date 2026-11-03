// Fixed-document DOM evidence with the compiled v3 validators; not WebView2/GUI/clipboard acceptance.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { rendererFixture } from './renderer-fixture.mjs'
import { model } from '../host/fixtures.mjs'

function projection() {
  const value = model()
  const labels = ['menu', 'cancel', 'submit', 'automatic', 'manual', 'sort', 'pending', 'invalidDrop',
    'color', 'glow', 'weight', 'shadow', 'stroke', 'strokeWidth', 'strokeColor', 'icon', 'reset', 'auto', 'iconSolid', 'iconOutline', 'iconNone']
  for (const key of labels) value.labels[key] = `投影:${key}`
  const row = (kind, id, label, depth, workspaceId) => ({ id, kind, label, title: `${label} 原始标题`, depth, workspaceId,
    activityAt: 10, activityKnown: true, matches: true })
  const card = (id, label, rows, kind = 'workspace') => ({ id, kind, label, title: label, activityAt: 10, activityKnown: true, matches: true, rows })
  value.workspaces = [
    card('w:steam', 'SteamLibrary', [
      row('workspace', 'w:local', '汉化', 0, 'real-local'),
      row('group', 'g:local', '同名组', 1, 'real-local'),
      { ...row('session', 's:local', '真正的汉化会话', 2, 'real-local'), selected: true },
      row('workspace', 'w:deep', '三级目录', 1, 'real-deep'),
      row('session', 's:deep', '三级会话', 2, 'real-deep'),
      row('workspace', 'w:mods', '游戏修改器', 0, 'real-mods'),
      row('session', 's:mods', '汉化/看似属于别处', 1, 'real-mods'),
      row('workspace-group', 'wg:nested', '逻辑工作区组', 1, 'real-mods'),
      row('workspace', 'w:virtual-child', '组内工作区', 2, 'real-virtual-child'),
      row('session', 's:virtual-child', '组内真实会话', 3, 'real-virtual-child'),
      row('group', 'g:empty', '显式空组', 1, 'real-mods'),
    ]),
    card('w:other', '另一个工作区', [row('session', 's:other', '其他会话', 0, 'real-other'), row('group', 'g:other', '同名组', 0, 'real-other')]),
    card('wg:root', '虚拟标题组', [row('workspace', 'w:empty', '空工作区', 0, 'real-empty')], 'workspace-group'),
  ]
  return value
}
function row(f, id, preview = false) { return f.document.querySelector(`${preview ? '.workspace-preview' : '.workspace-tree'} [data-row-id="${id}"]`) }
function card(f, id) { return f.document.querySelector(`[data-workspace-id="${id}"]`) }
function menu(value, id = 'menu-1', targetId = 's:local') {
  value.contextMenu = { id, targetId, title: 'Main 的菜单', entries: [
    { id: 'rename', label: 'Main:重命名' }, { id: 'disabled', label: '不可用', disabled: true },
    { id: 'sep', label: '', separator: true }, { id: 'archive', label: 'Main:归档', danger: true },
    { id: 'copy-id', label: 'Main:复制 SessionID' }, { id: 'cancel', label: value.labels.cancel },
  ] }
  return value
}
function update(value, patch = {}) { const next = structuredClone(value); next.revision++; Object.assign(next, patch); return next }
function type(f, element, value) { element.value = value; f.dispatch(element, 'input') }
const transfer = () => ({ effectAllowed: '', dropEffect: '', setData() {}, getData() { throw new Error('external transfer must not be read') }, get files() { throw new Error('files must not be read') } })
function start(f, element) { const dataTransfer = transfer(); const event = f.dispatch(element, 'dragstart', { dataTransfer }); return { dataTransfer, event } }
function over(f, element, ratio = 0.5, dataTransfer = transfer()) {
  const rect = { top: 100, bottom: 140, left: 0, right: 300, width: 300, height: 40 }
  const area = element.closest('.row, .workspace-header') ?? element
  area.getBoundingClientRect = () => rect
  return f.dispatch(element, 'dragover', { dataTransfer, clientY: 100 + 40 * ratio })
}
function drop(f, element, ratio = 0.5, dataTransfer = transfer()) { return f.dispatch(element, 'drop', { dataTransfer, clientY: 100 + 40 * ratio }) }

test('Native typography distinguishes every container kind and preserves explicit label appearance across theme/density updates', async () => {
  let value = projection()
  const f = await rendererFixture(value)
  try {
    const css = f.document.createElement('style')
    css.textContent = readFileSync(new URL('../../renderer/workspace-navigator.css', import.meta.url), 'utf8')
    f.document.head.append(css)
    const styleOf = element => f.window.getComputedStyle(element)
    for (const dark of [false, true]) {
      for (const density of ['comfortable', 'compact', 'roomy']) {
        value = update(value, { dark, density, layout: { ...value.layout, focusedWorkspaceId: 'w:other' } })
        await f.publish(value)
        const rows = [...f.document.querySelectorAll('.row[data-kind]')]
        for (const kind of ['workspace', 'workspace-group', 'group', 'session']) assert.ok(rows.some(row => row.dataset.kind === kind), kind)
        assert.ok(f.document.querySelector('.workspace-preview .row[data-kind="session"]'), 'cover preview titles as well as the tree')
        for (const row of rows) {
          assert.equal(styleOf(row).fontSize, row.dataset.kind === 'session' ? '13px' : '14px', `${dark}/${density}/${row.dataset.kind}`)
          assert.equal(styleOf(row).fontWeight, row.dataset.kind === 'session' ? '400' : '600', `${dark}/${density}/${row.dataset.kind}`)
        }
        const heading = f.document.querySelector('.workspace-heading')
        assert.equal(styleOf(heading).fontSize, '14px')
        assert.equal(styleOf(heading).fontWeight, '600')
      }
    }
    value = update(value)
    const group = value.workspaces[0].rows.find(row => row.id === 'g:local')
    const session = value.workspaces[0].rows.find(row => row.id === 's:local')
    group.style = { fontWeight: 500, color: '#123abc', textShadow: '0 0 2px #123abc' }
    session.style = { ...group.style, fontWeight: 700 }
    await f.publish(value)
    for (const [id, weight] of [['g:local', '500'], ['s:local', '700']]) {
      const rows = [...f.document.querySelectorAll(`[data-row-id="${id}"]`)]
      assert.ok(rows.length)
      for (const row of rows) {
        const label = row.querySelector('.label')
        assert.equal(styleOf(label).fontWeight, weight)
        assert.equal(row.style.color, 'rgb(18, 58, 188)')
        assert.equal(label.style.textShadow, '0 0 2px #123abc')
      }
    }
    value = update(value)
    for (const row of value.workspaces[0].rows) delete row.style
    await f.publish(value)
    for (const [id, weight] of [['g:local', '600'], ['s:local', '400']]) {
      for (const row of f.document.querySelectorAll(`[data-row-id="${id}"]`)) {
        assert.equal(row.querySelector('.label').style.fontWeight, '')
        assert.equal(row.querySelector('.label').style.textShadow, '')
        assert.equal(styleOf(row).fontWeight, weight)
      }
    }
  } finally { f.close() }
})

test('fixed Native document writes only the exact Main-authorized text and reports finite Web API outcomes', async t => {
  for (const behavior of ['resolve', 'deferred', 'denied', 'reject', 'missing', 'missing-method', 'sync-denied', 'sync-throw']) {
    await t.test(behavior, async () => {
      const writes = [], pending = Promise.withResolvers()
      const denied = Object.assign(new Error('PRIVATE exception text must never cross IPC'), { name: 'NotAllowedError' })
      const failed = new Error('PRIVATE exception text must never cross IPC')
      const clipboard = behavior === 'missing' ? undefined : behavior === 'missing-method' ? {} : {
        writeText(text) {
          assert.equal(this, clipboard)
          writes.push(text)
          if (behavior === 'sync-throw') throw failed
          if (behavior === 'sync-denied') throw denied
          if (behavior === 'denied') return Promise.reject(denied)
          if (behavior === 'reject') return Promise.reject(failed)
          if (behavior === 'deferred') return pending.promise
          return Promise.resolve()
        },
      }
      let value = projection(), f = await rendererFixture(value, { clipboard })
      try {
        // A held card and busy operation must not block already-authorized I/O/completion.
        f.dispatch(card(f, 'w:steam'), 'pointerover')
        const exactText = 'session:literal-not-a-projected-target/真实ID\n<not-markup>'
        value = update(value, { clipboard: { id: 'effect-1', text: exactText }, operation: { id: 'parent-copy', status: 'pending', message: '等待实际写入' } })
        await f.publish(value)
        assert.deepEqual(writes, behavior.startsWith('missing') ? [] : [exactText])
        const results = () => f.commands.filter(command => command.type === 'clipboard-result')
        if (behavior === 'deferred') {
          assert.equal(results().length, 0, 'prepared/transport acceptance cannot claim an unresolved OS API write succeeded')
          assert.equal(f.document.querySelector('#operation').dataset.status, 'pending')
          value = update(value, { connected: false, title: 'unrelated loading revision' })
          await f.publish(value)
          assert.equal(writes.length, 1)
          pending.resolve(); await f.settle()
        }
        const outcome = ['denied', 'sync-denied'].includes(behavior) ? 'denied' : ['reject', 'sync-throw'].includes(behavior) ? 'failed'
          : behavior.startsWith('missing') ? 'unavailable' : 'copied'
        assert.equal(results().length, 1)
        const result = results()[0]
        assert.equal(result.id, 'effect-1')
        assert.equal(result.outcome, outcome)
        assert.equal(result.instance, value.instance)
        assert.equal(result.revision, value.revision)
        assert.deepEqual(Object.keys(result).sort(), ['commandId', 'id', 'instance', 'outcome', 'revision', 'type'])
        assert.doesNotMatch(JSON.stringify(result), /PRIVATE|literal-not-a-projected-target/)
        assert.equal(f.document.querySelector('#operation').dataset.status, 'pending', 'accepted receipt is not a fabricated Main success projection')
        await f.publish(value)
        value = update(value); await f.publish(value)
        assert.deepEqual(writes, behavior.startsWith('missing') ? [] : [exactText], 'same instance/effect replay never writes twice')
        assert.equal(results().length, 1)
        value = update(value); delete value.clipboard; await f.publish(value)
        value = update(value, { clipboard: { id: 'effect-1', text: 'mutated replay must not write' } }); await f.publish(value)
        assert.equal(results().length, 1, 'withdrawn authorization cannot be resurrected by a replay')
        assert.equal(writes.length, behavior.startsWith('missing') ? 0 : 1)
        value = update(value, { clipboard: { id: 'effect-2', text: 'fresh-id-for-user-retry' } }); await f.publish(value)
        assert.equal(writes.length, behavior.startsWith('missing') ? 0 : 2, 'a new authorized copy may retry, never the old offer')
        assert.equal(results().length, 2)
        assert.equal(results().at(-1).id, 'effect-2')
        assert.equal(results().at(-1).outcome, outcome)
      } finally { pending.resolve(); f.close() }
    })
  }
})

test('a new legitimate copy ID permits retry, but withdrawal/instance/return/pagehide retire late Web API completion', async t => {
  for (const exit of ['withdraw', 'instance', 'return', 'pagehide']) await t.test(exit, async () => {
    const writes = [], pending = []
    const clipboard = { writeText(text) { writes.push(text); const next = Promise.withResolvers(); pending.push(next); return next.promise } }
    let value = { ...projection(), clipboard: { id: 'effect-1', text: 'actual-first-id' } }, f = await rendererFixture(value, { clipboard })
    try {
      assert.deepEqual(writes, ['actual-first-id'])
      if (exit === 'withdraw') {
        value = update(value); delete value.clipboard; await f.publish(value)
        value = update(value, { clipboard: { id: 'effect-2', text: 'actual-second-id' } }); await f.publish(value)
      } else if (exit === 'instance') {
        value = update(value, { instance: 'new-main-instance', clipboard: { id: 'effect-1', text: 'actual-second-id' } }); await f.publish(value)
      } else if (exit === 'return') {
        f.document.querySelector('#return').click()
        await f.settle() // This negative control retires on accepted Return, not the earlier click.
        assert.equal(f.commands.filter(command => command.type === 'return').length, 1)
      } else f.dispatch(f.window, 'pagehide')
      pending[0].resolve(); await f.settle()
      assert.equal(f.commands.filter(command => command.type === 'clipboard-result').length, 0, 'late old API completion cannot finish a replacement or returned copy')
      if (pending[1]) {
        assert.deepEqual(writes, ['actual-first-id', 'actual-second-id'])
        pending[1].resolve(); await f.settle()
        const result = f.commands.find(command => command.type === 'clipboard-result')
        assert.equal(result.instance, value.instance)
        assert.equal(result.id, value.clipboard.id)
        assert.equal(result.outcome, 'copied')
      }
    } finally { for (const item of pending) item.resolve(); f.close() }
  })
})

test('a non-admitted Return preserves the current clipboard completion in either RPC ordering without replaying I/O', async t => {
  for (const reply of ['refresh', 'disconnected', 'reject']) for (const order of ['write-before-reply', 'write-after-reply']) {
    await t.test(`${reply}; ${order}`, async () => {
      const io = Promise.withResolvers(), returnReply = Promise.withResolvers(), writes = []
      const value = { ...projection(), clipboard: { id: 'effect-1', text: 'authorized-real-id' },
        operation: { id: 'copy-parent', status: 'pending', message: 'waiting for actual I/O' } }
      const refreshed = update(value, { connected: false, title: 'same offer, unrelated revision/loading' })
      const f = await rendererFixture(value, { clipboard: { writeText(text) { writes.push(text); return io.promise } },
        command: command => command.type === 'return' ? returnReply.promise : Promise.resolve({ kind: 'accepted' }) })
      const receipts = () => f.commands.filter(command => command.type === 'clipboard-result')
      const finishReturn = () => reply === 'reject' ? returnReply.reject(new Error('private transport failure'))
        : returnReply.resolve({ kind: reply, model: refreshed })
      try {
        f.document.querySelector('#return').click()
        assert.equal(f.commands.filter(command => command.type === 'return').length, 1, 'Return dispatch is immediate even with unresolved I/O/layout')
        assert.deepEqual(writes, ['authorized-real-id'])
        if (order === 'write-after-reply') { finishReturn(); await f.settle() }
        io.resolve(); await f.settle()
        assert.equal(receipts().length, 1, 'a click or unsuccessful Return cannot strand the original API result')
        assert.equal(receipts()[0].id, value.clipboard.id)
        assert.equal(receipts()[0].outcome, 'copied')
        assert.equal(receipts()[0].instance, value.instance)
        assert.equal(receipts()[0].revision, order === 'write-after-reply' && reply !== 'reject' ? refreshed.revision : value.revision)
        if (order === 'write-before-reply') { finishReturn(); await f.settle() }
        await f.publish(update(reply === 'reject' ? value : refreshed))
        assert.deepEqual(writes, ['authorized-real-id'], 'retained authorization never repeats writeText')
        assert.equal(receipts().length, 1, 'refresh neither replays the I/O nor invents another completion')
        assert.equal(f.commands.filter(command => command.type === 'return').length, 1, 'business Return is never retried automatically')
      } finally { io.resolve(); returnReply.resolve({ kind: 'accepted' }); f.close() }
    })
  }
})

test('a late accepted Return cannot retire a newer clipboard flight or instance', async t => {
  for (const replacement of ['offer', 'instance']) await t.test(replacement, async () => {
    const returnReply = Promise.withResolvers(), writes = [], pending = []
    let value = { ...projection(), clipboard: { id: 'effect-1', text: 'first-real-id' } }
    const f = await rendererFixture(value, { clipboard: { writeText(text) { writes.push(text); const io = Promise.withResolvers(); pending.push(io); return io.promise } },
      command: command => command.type === 'return' ? returnReply.promise : Promise.resolve({ kind: 'accepted' }) })
    try {
      f.document.querySelector('#return').click()
      assert.equal(f.commands.filter(command => command.type === 'return').length, 1)
      value = update(value, replacement === 'instance'
        ? { instance: 'replacement-main', clipboard: { id: 'effect-1', text: 'next-real-id' } }
        : { clipboard: { id: 'effect-2', text: 'next-real-id' } })
      await f.publish(value)
      returnReply.resolve({ kind: 'accepted' }); await f.settle()
      pending[0].resolve(); await f.settle()
      assert.equal(f.commands.filter(command => command.type === 'clipboard-result').length, 0, 'replaced flight cannot complete the newer copy')
      pending[1].resolve(); await f.settle()
      const receipts = f.commands.filter(command => command.type === 'clipboard-result')
      assert.equal(receipts.length, 1, 'the old Return result must not clear the newer flight')
      assert.equal(receipts[0].id, value.clipboard.id)
      assert.equal(receipts[0].instance, value.instance)
      assert.equal(receipts[0].outcome, 'copied')
      await f.publish(update(value))
      assert.deepEqual(writes, ['first-real-id', 'next-real-id'])
    } finally { returnReply.resolve({ kind: 'accepted' }); for (const io of pending) io.resolve(); f.close() }
  })
})

test('terminal withdrawal or pagehide during pending Return still prevents a late clipboard receipt', async t => {
  for (const terminal of ['withdraw', 'pagehide']) await t.test(terminal, async () => {
    const io = Promise.withResolvers(), returnReply = Promise.withResolvers(), writes = []
    let value = { ...projection(), clipboard: { id: 'effect-1', text: 'authorized-real-id' } }
    const f = await rendererFixture(value, { clipboard: { writeText(text) { writes.push(text); return io.promise } },
      command: command => command.type === 'return' ? returnReply.promise : Promise.resolve({ kind: 'accepted' }) })
    try {
      f.document.querySelector('#return').click()
      if (terminal === 'withdraw') { value = update(value); delete value.clipboard; await f.publish(value) }
      else f.dispatch(f.window, 'pagehide')
      io.resolve(); await f.settle()
      returnReply.reject(new Error('late failed Return')); await f.settle()
      assert.deepEqual(writes, ['authorized-real-id'], 'already-dispatched OS I/O is not cancellable')
      assert.equal(f.commands.filter(command => command.type === 'clipboard-result').length, 0, 'failed Return cannot restore terminally withdrawn completion')
      if (terminal === 'withdraw') {
        value = update(value, { clipboard: { id: 'effect-1', text: 'authorized-real-id' } }); await f.publish(value)
        assert.equal(writes.length, 1, 'a retired instance/effect ID cannot replay OS I/O')
        assert.equal(f.commands.filter(command => command.type === 'clipboard-result').length, 0)
      }
    } finally { io.resolve(); returnReply.resolve({ kind: 'accepted' }); f.close() }
  })
})

test('a refresh that retains the current offer cannot replay clipboard I/O', async () => {
  let value = { ...projection(), clipboard: { id: 'effect-1', text: 'real-id' } }, calls = 0
  const fresh = update(value, { title: 'Host refreshed unrelated revision' })
  const f = await rendererFixture(value, { clipboard: { writeText() { calls++; return Promise.resolve() } },
    command: async () => ({ kind: 'refresh', model: fresh }) })
  try {
    assert.equal(calls, 1)
    assert.equal(f.commands.filter(command => command.type === 'clipboard-result').length, 1)
    assert.equal(f.document.title, fresh.title)
    await f.publish(update(fresh))
    assert.equal(calls, 1)
  } finally { f.close() }
})

test('a captured old clipboard transport callback cannot refresh or fail a newer copy', async t => {
  for (const outcome of ['refresh', 'reject']) await t.test(outcome, async () => {
    const oldReply = Promise.withResolvers(), nextWrite = Promise.withResolvers(), writes = []
    let value = { ...projection(), clipboard: { id: 'effect-1', text: 'first-id' } }
    const first = structuredClone(value)
    const f = await rendererFixture(value, { clipboard: { writeText(text) { writes.push(text); return writes.length === 1 ? Promise.resolve() : nextWrite.promise } },
      command: command => command.id === 'effect-1' ? oldReply.promise : Promise.resolve({ kind: 'accepted' }) })
    try {
      assert.equal(f.commands.filter(command => command.type === 'clipboard-result').length, 1)
      value = update(value, { clipboard: { id: 'effect-2', text: 'second-id' }, title: 'new copy remains current' })
      await f.publish(value)
      if (outcome === 'refresh') oldReply.resolve({ kind: 'refresh', model: first })
      else oldReply.reject(new Error('private old reply'))
      await f.settle()
      assert.equal(f.document.title, value.title)
      assert.equal(f.document.querySelector('#notice').hidden, true)
      assert.deepEqual(writes, ['first-id', 'second-id'])
      nextWrite.resolve(); await f.settle()
      assert.equal(f.commands.at(-1).id, 'effect-2')
      assert.equal(f.commands.at(-1).outcome, 'copied')
    } finally { oldReply.resolve({ kind: 'accepted' }); nextWrite.resolve(); f.close() }
  })
})

test('a background reparent cannot move a focused target or change visual keyboard parentage until interaction releases', async () => {
  let value = projection(), f = await rendererFixture(value)
  try {
    const tree = card(f, 'w:steam').querySelector('.workspace-tree'), element = row(f, 's:local')
    tree.focus()
    value = update(value)
    const rows = value.workspaces[0].rows
    const moved = { ...rows.find(row => row.id === 's:local'), depth: 1 }
    value.workspaces[0].rows = rows.filter(row => row.id !== 's:local')
    value.workspaces[0].rows.splice(6, 0, moved)
    await f.publish(value)
    assert.equal(row(f, 's:local'), element)
    assert.equal(element.getAttribute('aria-level'), '3')
    f.key(tree, 'ArrowLeft')
    assert.equal(f.document.getElementById(tree.getAttribute('aria-activedescendant')).dataset.rowId, 'g:local')
    f.document.querySelector('#search').focus()
    assert.equal(element.getAttribute('aria-level'), '2')
    assert.equal(f.commands.length, 0, 'display freeze is not a business remap')
  } finally { f.close() }
})

test('cross-card moves retain one focused visual slot with fresh target data, even for a new destination card', async t => {
  for (const newDestination of [false, true]) await t.test(newDestination ? 'new destination' : 'existing destination', async () => {
    let value = projection(), f = await rendererFixture(value)
    try {
      const source = card(f, 'w:steam'), tree = source.querySelector('.workspace-tree'), element = row(f, 's:local')
      tree.focus(); f.key(tree, 'Home'); f.key(tree, 'ArrowDown'); f.key(tree, 'ArrowDown')
      assert.equal(f.document.getElementById(tree.getAttribute('aria-activedescendant')).dataset.rowId, 's:local')
      value = update(value)
      const moved = { ...value.workspaces[0].rows.find(row => row.id === 's:local'), depth: 0, workspaceId: 'real-other', label: '后台的新标题', title: '新标题' }
      value.workspaces[0].rows = value.workspaces[0].rows.filter(row => row.id !== moved.id)
      const destination = newDestination ? { ...structuredClone(value.workspaces[1]), id: 'w:new', rows: [] } : value.workspaces[1]
      if (newDestination) value.workspaces.push(destination)
      destination.rows.push(moved)
      await f.publish(value)
      assert.equal(row(f, moved.id), element)
      assert.equal(element.closest('.workspace-card'), source)
      assert.equal(element.querySelector('.label').textContent, moved.label)
      assert.equal(element.getAttribute('aria-level'), '3', 'only the visual parentage is held')
      assert.equal(f.document.getElementById(tree.getAttribute('aria-activedescendant')), element)
      assert.equal(f.document.querySelectorAll(`.workspace-tree [data-row-id="${moved.id}"]`).length, 1)
      assert.equal(card(f, destination.id).querySelector(`.workspace-tree [data-row-id="${moved.id}"]`), null)
      f.key(tree, 'Enter'); await f.settle()
      assert.deepEqual(f.commands.at(-1).id, moved.id)
      assert.equal(f.commands.at(-1).revision, value.revision, 'held presentation cannot replay a stale model cut')
      f.document.querySelector('#search').focus()
      assert.equal(row(f, moved.id).closest('.workspace-card'), card(f, destination.id))
      assert.equal(row(f, moved.id).getAttribute('aria-level'), '1')
      assert.equal(f.document.querySelectorAll(`.workspace-tree [data-row-id="${moved.id}"]`).length, 1)
    } finally { f.close() }
  })
})

test('a moved workspace subtree keeps its old visual parent without duplicating descendants during hover', async () => {
  let value = projection(), f = await rendererFixture(value)
  try {
    const source = card(f, 'w:steam'), element = row(f, 'w:local'), child = row(f, 's:local')
    f.dispatch(source, 'pointerover')
    value = update(value)
    const original = value.workspaces[0].rows
    const moved = original.slice(0, 5)
    value.workspaces[0].rows = original.slice(5)
    value.workspaces[1].rows.push(...moved)
    await f.publish(value)
    assert.equal(row(f, 'w:local'), element)
    assert.equal(row(f, 's:local'), child)
    assert.equal(child.closest('.workspace-card'), source)
    assert.equal(f.document.querySelectorAll('.workspace-tree [data-row-id="s:local"]').length, 1)
    f.dispatch(source, 'pointerout', { relatedTarget: f.document.querySelector('#title') })
    assert.equal(row(f, 'w:local').closest('.workspace-card'), card(f, 'w:other'))
    assert.equal(f.commands.length, 0)
  } finally { f.close() }
})

test('a valid former top-branch target can hold its card slot until release, without publishing obsolete scroll roots', async () => {
  let value = projection(), f = await rendererFixture(value)
  try {
    const source = card(f, 'wg:root'), tree = source.querySelector('.workspace-tree'), element = row(f, 'w:empty')
    tree.focus()
    value = update(value)
    const branch = value.workspaces.pop(), { rows, ...header } = branch
    value.workspaces[0].rows.push({ ...header, depth: 0 }, ...rows.map(item => ({ ...item, depth: item.depth + 1 })))
    await f.publish(value)
    assert.equal(card(f, 'wg:root'), source)
    assert.equal(row(f, 'w:empty'), element)
    assert.equal(f.document.getElementById(tree.getAttribute('aria-activedescendant')), element)
    source.querySelector('.workspace-heading').click(); await f.settle()
    const intent = f.commands.at(-1)
    assert.equal(intent.type, 'layout')
    assert.equal(intent.layout.focusedWorkspaceId, 'w:steam', 'focus resolves through the current projected branch owner')
    assert.equal(intent.layout.scrolls.some(item => item.id === 'wg:root'), false)
    f.document.querySelector('#search').focus()
    assert.equal(card(f, 'wg:root'), null)
    assert.equal(row(f, 'w:empty').closest('.workspace-card'), card(f, 'w:steam'))
  } finally { f.close() }
})

test('removing an old group retires that ancestor slot without hiding its focused surviving session', async () => {
  let value = projection(), f = await rendererFixture(value)
  try {
    const tree = card(f, 'w:steam').querySelector('.workspace-tree'), element = row(f, 's:local')
    tree.focus(); f.key(tree, 'Home'); f.key(tree, 'ArrowDown'); f.key(tree, 'ArrowDown')
    value = update(value)
    value.workspaces[0].rows = value.workspaces[0].rows.filter(item => item.id !== 'g:local')
      .map(item => item.id === 's:local' ? { ...item, depth: 1, label: '离开已删分组的存活会话' } : item)
    await f.publish(value)
    assert.equal(row(f, 'g:local'), null)
    assert.equal(row(f, 's:local'), element)
    assert.equal(element.getAttribute('aria-level'), '2')
    assert.equal(element.querySelector('.label').textContent, '离开已删分组的存活会话')
    assert.equal(f.document.getElementById(tree.getAttribute('aria-activedescendant')), element)
    assert.equal(f.document.querySelectorAll('.workspace-tree [data-row-id="s:local"]').length, 1)
    const ids = [...tree.children].map(item => item.dataset.rowId)
    assert.ok(ids.indexOf('s:local') < ids.indexOf('w:deep'), 'the vacated ancestor slot does not append the child behind later siblings')
    f.key(tree, 'ArrowLeft')
    assert.equal(f.document.getElementById(tree.getAttribute('aria-activedescendant')).dataset.rowId, 'w:local')
    f.document.querySelector('#search').focus()
    assert.equal(row(f, 's:local'), element)
    assert.equal(row(f, 'g:local'), null)
  } finally { f.close() }
})

test('globally deleted targets are removed immediately from a frozen cross-card slot and cannot activate', async () => {
  let value = projection(), f = await rendererFixture(value)
  try {
    const tree = card(f, 'w:steam').querySelector('.workspace-tree')
    tree.focus()
    value = update(value)
    const moved = { ...value.workspaces[0].rows.find(item => item.id === 's:local'), depth: 0 }
    value.workspaces[0].rows = value.workspaces[0].rows.filter(item => item.id !== moved.id)
    value.workspaces[1].rows.push(moved)
    await f.publish(value)
    assert.ok(row(f, moved.id))
    value = update(value)
    value.workspaces[1].rows = value.workspaces[1].rows.filter(item => item.id !== moved.id)
    await f.publish(value)
    assert.equal(row(f, moved.id), null)
    assert.notEqual(f.document.getElementById(tree.getAttribute('aria-activedescendant'))?.dataset.rowId, moved.id)
    f.key(tree, 'Enter'); await f.settle()
    assert.equal(f.commands.some(command => command.type === 'activate' && command.id === moved.id), false)
  } finally { f.close() }
})

test('removing the interaction owner releases its hold so surviving children remain visible in their real branch', async t => {
  for (const interaction of ['hover', 'focus']) await t.test(interaction, async () => {
    let value = projection(), f = await rendererFixture(value)
    try {
      const source = card(f, 'w:steam')
      if (interaction === 'hover') f.dispatch(source, 'pointerover')
      else source.querySelector('.workspace-tree').focus()
      value = update(value)
      const removed = value.workspaces.shift()
      value.workspaces[0].rows.push(...removed.rows)
      await f.publish(value)
      assert.equal(card(f, removed.id), null)
      assert.equal(row(f, 's:local').closest('.workspace-card'), card(f, 'w:other'))
      assert.equal(f.document.querySelectorAll('.workspace-tree [data-row-id="s:local"]').length, 1)
    } finally { f.close() }
  })
})

test('a deleted top-card owner cannot hide surviving rows while another card keeps its independent hover hold', async t => {
  for (const promotion of ['new-root', 'existing-root']) await t.test(promotion, async () => {
    let value = projection()
    const survivor = { ...value.workspaces[0].rows.find(item => item.id === 's:local'), id: 's:orphan', workspaceId: 'real-empty', depth: 1 }
    value.workspaces[2].rows.push(survivor)
    value.workspaces[0].rows.find(item => item.id === 's:local').selected = false
    const f = await rendererFixture(value)
    try {
      const held = card(f, 'w:other'), unchanged = row(f, 's:other'), oldTree = card(f, 'wg:root').querySelector('.workspace-tree')
      f.dispatch(held, 'pointerover'); oldTree.focus(); f.key(oldTree, 'End')
      assert.equal(f.document.getElementById(oldTree.getAttribute('aria-activedescendant')).dataset.rowId, survivor.id)
      value = update(value)
      const dissolved = value.workspaces.pop(), [workspace, session] = dissolved.rows
      if (promotion === 'new-root') value.workspaces.push({ ...structuredClone(value.workspaces[1]), id: workspace.id, label: workspace.label,
        title: workspace.title, rows: [{ ...session, depth: 0, label: '当前存活会话' }] })
      else value.workspaces[1].rows.push(workspace, { ...session, label: '当前存活会话' })
      await f.publish(value)
      assert.equal(card(f, dissolved.id), null)
      assert.equal(row(f, 's:other'), unchanged, 'the unrelated hovered card retains its keyed slot')
      const element = row(f, survivor.id), targetCard = card(f, promotion === 'new-root' ? workspace.id : 'w:other')
      assert.ok(element, 'the current surviving session is recovered without waiting for pointerout')
      assert.equal(element.closest('.workspace-card'), targetCard)
      assert.equal(element.querySelector('.label').textContent, '当前存活会话')
      assert.equal(f.document.querySelectorAll('.workspace-tree [data-row-id="s:orphan"]').length, 1)
      assert.equal(f.document.activeElement, targetCard.querySelector('.workspace-tree'))
      assert.equal(f.document.getElementById(f.document.activeElement.getAttribute('aria-activedescendant')), element)
      f.dispatch(held, 'pointerout', { relatedTarget: f.document.querySelector('#title') })
      f.document.querySelector('#search').focus()
      assert.equal(f.document.querySelectorAll('.workspace-tree [data-row-id="s:orphan"]').length, 1)
      assert.equal(row(f, survivor.id).getAttribute('aria-level'), promotion === 'new-root' ? '1' : '2')
    } finally { f.close() }
  })
})

test('strip relocation restores the surviving target ID instead of the old preview position, with safe unavailable-target fallbacks', async t => {
  for (const mode of ['visible', 'collapsed', 'collapsed-tree-destination', 'full-preview', 'disabled']) await t.test(mode, async () => {
    let value = projection()
    value.layout.focusedWorkspaceId = 'w:steam'
    if (mode.startsWith('collapsed')) value.layout.collapsedGroups = ['w:empty']
    value.workspaces[0].rows.find(item => item.id === 's:local').selected = false
    const survivor = { ...value.workspaces[0].rows.find(item => item.id === 's:local'), id: 's:strip-survivor', selected: true, workspaceId: 'real-empty', depth: 1, activityAt: 1 }
    value.workspaces[2].rows.push(survivor)
    if (mode === 'full-preview') for (const id of ['s:more-1', 's:more-2']) value.workspaces[1].rows.push({ ...value.workspaces[1].rows[0], id })
    const f = await rendererFixture(value)
    try {
      const destination = card(f, 'w:other'), origin = row(f, survivor.id, true).querySelector('.preview-open')
      origin.focus(); f.dispatch(destination, 'pointerover')
      assert.equal(f.document.activeElement, origin)
      value = update(value)
      const removed = value.workspaces.pop()
      value.workspaces[1].rows.push(...removed.rows.map(item => item.id === survivor.id && mode === 'disabled' ? { ...item, disabled: true } : item))
      if (mode === 'collapsed-tree-destination') value.layout.focusedWorkspaceId = 'w:other'
      await f.publish(value)
      assert.equal(card(f, removed.id), null)
      assert.equal(destination.dataset.placement, mode === 'collapsed-tree-destination' ? 'focus' : 'strip')
      if (mode === 'visible' || mode === 'collapsed') {
        const target = row(f, survivor.id, true).querySelector('.preview-open')
        assert.equal(f.document.activeElement, target)
        assert.notEqual([...destination.querySelectorAll('.preview-open')].indexOf(target), 0, 'same ID moved to a different preview index')
        target.click(); await f.settle()
        assert.equal(f.commands.at(-1).type, 'activate'); assert.equal(f.commands.at(-1).id, survivor.id)
        assert.equal(f.commands.at(-1).revision, value.revision)
      } else if (mode === 'collapsed-tree-destination') {
        const tree = destination.querySelector('.workspace-tree')
        assert.equal(row(f, survivor.id), null, 'the collapsed tree must not expose or activate its hidden session')
        assert.equal(f.document.activeElement, tree)
        assert.equal(f.document.getElementById(tree.getAttribute('aria-activedescendant')).dataset.rowId, 'w:empty')
        f.key(tree, 'Enter'); await f.settle()
        assert.equal(f.commands.some(command => command.type === 'activate'), false)
      } else if (mode === 'full-preview') {
        assert.equal(row(f, survivor.id, true), null, 'the unrelated hover retains its existing bounded preview slots')
        assert.equal(f.document.activeElement, destination.querySelector('.workspace-heading'))
        f.document.activeElement.click(); await f.settle()
        assert.equal(f.commands.at(-1).type, 'layout'); assert.equal(f.commands.at(-1).layout.focusedWorkspaceId, 'w:other')
      } else {
        assert.equal(row(f, survivor.id, true), null)
        assert.equal(f.document.activeElement, destination.querySelector('.workspace-heading'), 'the visual owner stays reachable even when its target is disabled')
      }
      assert.equal(f.commands.some(command => command.type === 'activate' && command.id === 's:other'), false)
    } finally { f.close() }
  })
})

test('same-card tree DOM reuse cannot bypass semantic target and reachable-ancestor restoration', async t => {
  for (const mode of ['enabled', 'disabled', 'retired', 'ancestor-enabled', 'ancestor-disabled', 'ancestor-fold', 'ancestor-fold-disabled']) await t.test(mode, async () => {
    let value = projection()
    const ancestor = mode.startsWith('ancestor'), source = value.workspaces[0]
    const session = { ...source.rows.find(item => item.id === 's:local'), depth: ancestor ? 1 : 0 }
    const other = { ...value.workspaces[1].rows[0], depth: 0 }
    const workspace = { ...source.rows[0], depth: 0 }
    value.workspaces = [{ ...source, rows: ancestor ? [other, workspace, session] : [session, other] }]
    const f = await rendererFixture(value)
    try {
      const selected = card(f, source.id), tree = selected.querySelector('.workspace-tree')
      tree.focus(); f.key(tree, ancestor ? 'End' : 'Home')
      assert.equal(f.document.getElementById(tree.getAttribute('aria-activedescendant')).dataset.rowId, session.id)
      value = update(value)
      if (mode === 'retired') value.workspaces[0].rows = value.workspaces[0].rows.filter(item => item.id !== session.id)
      if (mode === 'disabled' || mode === 'ancestor-disabled') value.workspaces[0].rows.find(item => item.id === session.id).disabled = true
      if (mode.startsWith('ancestor-fold')) value.layout.collapsedGroups = [workspace.id]
      if (mode === 'ancestor-fold-disabled') value.workspaces[0].rows.find(item => item.id === workspace.id).disabled = true
      await f.publish(value)
      assert.equal(card(f, source.id).querySelector('.workspace-tree'), tree, 'the tree DOM is unchanged, not the semantic permission')
      if (mode === 'disabled' || mode === 'ancestor-fold-disabled') {
        assert.equal(f.document.activeElement, selected.querySelector('.workspace-heading'))
        f.document.activeElement.click(); await f.settle()
        assert.equal(f.commands.some(command => command.type === 'activate'), false)
      } else {
        const expected = mode === 'retired' ? other.id : mode === 'ancestor-disabled' || mode === 'ancestor-fold' ? workspace.id : session.id
        assert.equal(f.document.activeElement, tree)
        assert.equal(f.document.getElementById(tree.getAttribute('aria-activedescendant')).dataset.rowId, expected)
        f.key(tree, 'Enter'); await f.settle()
        if (expected === workspace.id) assert.equal(f.commands.some(command => command.type === 'activate'), false)
        else { assert.equal(f.commands.at(-1).type, 'activate'); assert.equal(f.commands.at(-1).id, expected); assert.equal(f.commands.at(-1).revision, value.revision) }
      }
    } finally { f.close() }
  })
})

test('tree restoration cannot inherit an unrelated leaf when a current target has no enabled visible ancestor', async t => {
  for (const mode of ['target-enabled', 'target-disabled', 'ancestor-enabled', 'ancestor-disabled']) await t.test(mode, async () => {
    let value = projection()
    const ancestor = mode.startsWith('ancestor'), disabled = mode.endsWith('disabled')
    value.layout.focusedWorkspaceId = 'w:steam'
    if (ancestor) value.layout.collapsedGroups = ['w:empty']
    const survivor = { ...value.workspaces[0].rows.find(item => item.id === 's:local'), id: 's:tree-survivor', workspaceId: 'real-empty', depth: 1 }
    value.workspaces[0].rows.find(item => item.id === 's:local').selected = false
    value.workspaces[2].rows.push(survivor)
    const f = await rendererFixture(value)
    try {
      const destination = card(f, 'w:other'), origin = row(f, survivor.id, true).querySelector('.preview-open')
      origin.focus(); f.dispatch(destination, 'pointerover')
      value = update(value)
      const [workspace, session] = value.workspaces.pop().rows
      value.workspaces[1].rows.push(...(ancestor ? [{ ...workspace, disabled }, session] : [{ ...session, depth: 0, disabled }]))
      value.layout.focusedWorkspaceId = 'w:other'
      await f.publish(value)
      const tree = destination.querySelector('.workspace-tree')
      if (disabled) {
        assert.equal(f.document.activeElement, destination.querySelector('.workspace-heading'))
        f.document.activeElement.click(); await f.settle()
        assert.equal(f.commands.some(command => command.type === 'activate'), false)
      } else {
        assert.equal(f.document.activeElement, tree)
        assert.equal(f.document.getElementById(tree.getAttribute('aria-activedescendant')).dataset.rowId, ancestor ? 'w:empty' : survivor.id)
        f.key(tree, 'Enter'); await f.settle()
        if (ancestor) assert.equal(f.commands.some(command => command.type === 'activate'), false)
        else { assert.equal(f.commands.at(-1).type, 'activate'); assert.equal(f.commands.at(-1).id, survivor.id) }
      }
      assert.equal(f.commands.some(command => command.type === 'activate' && command.id === 's:other'), false)
    } finally { f.close() }
  })
})

test('explicit focus reveals a promoted current root even while it still occupies a held old row slot', async t => {
  for (const alreadyFocused of [false, true]) await t.test(`incoming focus already matches=${alreadyFocused}`, async () => {
    let value = projection(), f = await rendererFixture(value)
    try {
      const oldTree = card(f, 'w:steam').querySelector('.workspace-tree')
      oldTree.focus(); f.key(oldTree, 'Home')
      value = update(value)
      const [workspace, ...rows] = value.workspaces[0].rows.splice(0, 5)
      value.workspaces.push({ ...structuredClone(value.workspaces[1]), id: workspace.id, label: workspace.label, title: workspace.title,
        rows: rows.map(item => ({ ...item, depth: item.depth - 1 })) })
      if (alreadyFocused) value.layout.focusedWorkspaceId = workspace.id
      await f.publish(value)
      assert.equal(card(f, workspace.id), null, 'background promotion alone keeps the still-valid old slot')
      assert.equal(f.document.querySelector('#view').dataset.mode, 'overview')
      row(f, workspace.id).querySelector('.label').click(); await f.settle()
      const selected = card(f, workspace.id)
      assert.ok(selected)
      assert.equal(selected.dataset.placement, 'focus')
      assert.equal(f.document.querySelector('#view').dataset.mode, 'focus')
      assert.equal(row(f, workspace.id), null, 'the selected root is a header, not a duplicate retained row')
      assert.equal(f.document.activeElement, selected.querySelector('.workspace-heading'), 'focus cannot return to the connected but now unrelated old card tree')
      row(f, 's:local').querySelector('.label').click(); await f.settle()
      assert.equal(f.commands.at(-1).type, 'activate'); assert.equal(f.commands.at(-1).id, 's:local')
      assert.equal(f.commands.at(-1).revision, value.revision)
    } finally { f.close() }
  })
})

test('selected strip previews match their visual rule while current truth remains on the accessible button', async () => {
  const value = projection()
  value.layout.focusedWorkspaceId = 'w:other'
  const f = await rendererFixture(value)
  try {
    const preview = row(f, 's:local', true), button = preview.querySelector('.preview-open')
    assert.equal(preview.closest('.workspace-card').dataset.placement, 'strip')
    assert.equal(button.getAttribute('aria-current'), 'true')
    assert.equal(preview.matches('.preview-row[data-selected="true"]'), true)
    const css = readFileSync(new URL('../../renderer/workspace-navigator.css', import.meta.url), 'utf8')
    assert.match(css, /\.preview-row\[data-selected="true"\]\s*\{\s*background:\s*var\(--selected\)/)
    await f.publish(update(value, { workspaces: value.workspaces.map(branch => ({ ...branch, rows: branch.rows.map(item => ({ ...item, ...(item.id === 's:local' ? { selected: false } : {}) })) })) }))
    assert.equal(button.getAttribute('aria-current'), 'false')
    assert.equal(preview.matches('.preview-row[data-selected="true"]'), false)
  } finally { f.close() }
})

test('a held workspace row focuses its current projected branch for mouse, Enter and Space, not its old visual card', async t => {
  for (const interaction of ['click', 'Enter', ' ']) await t.test(JSON.stringify(interaction), async () => {
    let value = projection(), f = await rendererFixture(value)
    try {
      const source = card(f, 'w:steam'), tree = source.querySelector('.workspace-tree'), element = row(f, 'w:local')
      tree.focus(); f.key(tree, 'Home')
      value = update(value)
      const moved = value.workspaces[0].rows.splice(0, 5)
      value.workspaces[1].rows.push(...moved)
      await f.publish(value)
      assert.equal(row(f, 'w:local'), element)
      assert.equal(element.closest('.workspace-card'), source)
      if (interaction === 'click') element.querySelector('.label').click()
      else f.key(tree, interaction)
      await f.settle()
      const intent = f.commands.at(-1)
      assert.equal(intent.type, 'layout'); assert.equal(intent.revision, value.revision)
      assert.equal(intent.layout.focusedWorkspaceId, 'w:other')
      assert.equal(f.commands.some(command => command.type === 'activate'), false)
    } finally { f.close() }
  })
})

test('root focus followed by the overview control preserves the explicit null clear-focus intent', async () => {
  const f = await rendererFixture(projection())
  try {
    card(f, 'w:steam').querySelector('.workspace-heading').click(); await f.settle()
    assert.equal(f.document.querySelector('#view').dataset.mode, 'focus')
    assert.equal(f.commands.at(-1).layout.focusedWorkspaceId, 'w:steam')
    f.document.querySelector('#show-overview').click(); await f.settle()
    assert.equal(f.document.querySelector('#view').dataset.mode, 'overview')
    assert.equal(f.commands.at(-1).type, 'layout')
    assert.equal(f.commands.at(-1).layout.focusedWorkspaceId, null)
    assert.equal(f.commands.filter(command => command.type === 'layout').length, 2)
  } finally { f.close() }
})

test('captured scroll events cannot persist a held former root, while the current root scroll still saves', async () => {
  let value = projection(), f = await rendererFixture(value)
  try {
    const source = card(f, 'w:steam'), heldTree = source.querySelector('.workspace-tree')
    heldTree.focus()
    value = update(value)
    const branch = value.workspaces.shift(), { rows, ...header } = branch
    value.workspaces[0].rows.push({ ...header, depth: 0 }, ...rows.map(item => ({ ...item, depth: item.depth + 1 })))
    await f.publish(value)
    assert.equal(card(f, branch.id), source, 'the still-valid target keeps its visual slot')
    assert.equal(value.workspaces.some(item => item.id === branch.id), false, 'the slot is no longer a persistence root')
    heldTree.scrollTop = 42; f.dispatch(heldTree, 'scroll'); await f.advance(180)
    assert.equal(f.commands.filter(command => command.type === 'layout').length, 0)
    const currentTree = card(f, 'w:other').querySelector('.workspace-tree')
    currentTree.scrollTop = 73; f.dispatch(currentTree, 'scroll'); await f.advance(180)
    const intent = f.commands.at(-1)
    assert.equal(intent.type, 'layout'); assert.equal(intent.revision, value.revision)
    assert.deepEqual(intent.layout.scrolls, [{ id: 'w:other', top: 73 }])
  } finally { f.close() }
})

test('overview and independent card scroll drafts survive background updates and publish only bounded layout data', async () => {
  let value = projection(), f = await rendererFixture(value)
  try {
    const overview = f.document.querySelector('#overview'), first = card(f, 'w:steam').querySelector('.workspace-tree'), second = card(f, 'w:other').querySelector('.workspace-tree')
    overview.scrollTop = 35; first.scrollTop = 120; second.scrollTop = 70
    for (const element of [overview, first, second]) f.dispatch(element, 'scroll')
    value = update(value); await f.publish(value)
    assert.equal(first.scrollTop, 120); assert.equal(second.scrollTop, 70)
    await f.advance(180)
    const intent = f.commands.at(-1)
    assert.equal(intent.type, 'layout')
    assert.deepEqual(intent.layout.scrolls, [{ id: 'overview', top: 35 }, { id: 'w:steam', top: 120 }, { id: 'w:other', top: 70 }])
    value = update(value, { layout: intent.layout }); await f.publish(value)
    assert.equal(overview.scrollTop, 35); assert.equal(first.scrollTop, 120)
    assert.equal(f.commands.filter(command => command.type === 'layout').length, 1)
  } finally { f.close() }
})

test('existing SVG/style grammar remains validator-gated, reconstructed as safe geometry with unique mask identities', async () => {
  const value = projection()
  const svg = '<svg viewBox="0 0 16 16"><mask id="m"><rect x="0" y="0" width="16" height="16" fill="white"/></mask><g mask="url(#m)"><path d="M1 1L2 2" fill="currentColor"/></g></svg>'
  value.workspaces[0].icon = svg; value.workspaces[0].rows[0].icon = svg
  value.workspaces[0].rows[0].style = { color: '#123abc', fontWeight: 500, textShadow: '0 0 2px #123abc' }
  const f = await rendererFixture(value)
  try {
    const masks = [...f.document.querySelectorAll('mask')]
    assert.equal(masks.length, 2); assert.notEqual(masks[0].id, masks[1].id)
    assert.equal(row(f, 'w:local').querySelector('svg').getAttribute('aria-hidden'), 'true')
    assert.equal(row(f, 'w:local').querySelector('.label').style.fontWeight, '500')
    const bad = update(value); bad.workspaces[0].icon = '<svg><script>bad()</script></svg>'
    await assert.rejects(f.publish(bad), /invalid/)
    const unsafeStyle = update(value); unsafeStyle.workspaces[0].style = { color: 'url(evil)' }
    await assert.rejects(f.publish(unsafeStyle), /invalid/)
    assert.equal(f.document.querySelector('script:not([src])'), null)
  } finally { f.close() }
})

// Hierarchy is explicit preorder; no title, path or duplicate group label becomes a membership rule.
test('SteamLibrary retains nested real workspace containers, chevrons fold privately, labels focus only the top branch', async () => {
  const value = projection(), f = await rendererFixture(value)
  try {
    assert.equal(f.document.querySelectorAll('.workspace-card').length, 3)
    assert.equal(row(f, 'w:local').getAttribute('aria-expanded'), 'true')
    assert.equal(row(f, 's:local').getAttribute('aria-level'), '3')
    assert.equal(row(f, 'w:deep').getAttribute('aria-level'), '2')
    assert.equal(row(f, 's:mods').querySelector('.label').textContent, '汉化/看似属于别处')
    assert.equal(row(f, 's:virtual-child').getAttribute('aria-level'), '4')
    row(f, 'wg:nested').querySelector('.label').click()
    assert.equal(row(f, 'w:virtual-child'), null)
    row(f, 'wg:nested').querySelector('.label').click()
    assert.notEqual(row(f, 's:virtual-child'), null)
    await f.settle()
    row(f, 'w:local').querySelector('.chevron').click()
    await f.settle()
    assert.equal(row(f, 's:local'), null)
    assert.equal(row(f, 's:deep'), null)
    assert.notEqual(row(f, 's:mods'), null)
    assert.deepEqual(f.commands.at(-1).layout.collapsedGroups, ['w:local'])
    assert.equal(f.commands.some(command => command.type === 'activate'), false)
    row(f, 'w:local').querySelector('.label').click()
    await f.settle()
    assert.equal(f.commands.at(-1).type, 'layout')
    assert.equal(f.commands.at(-1).layout.focusedWorkspaceId, 'w:steam')
    assert.equal(f.document.querySelector('#view').dataset.mode, 'focus')
    assert.equal(card(f, 'w:steam').dataset.placement, 'focus')
    assert.equal(card(f, 'w:other').dataset.placement, 'strip')
    assert.equal(row(f, 'w:local').getAttribute('aria-expanded'), 'false', 'label focus is not a fold toggle')
    row(f, 'w:local').querySelector('.chevron').click()
    row(f, 'g:local').querySelector('.label').click()
    assert.equal(row(f, 's:local'), null, 'logical group labels expand/fold')
    row(f, 'g:local').querySelector('.label').click()
    row(f, 's:local').querySelector('.label').click()
    await f.settle()
    assert.deepEqual(f.commands.filter(command => command.type === 'activate').map(command => command.id), ['s:local'])
    assert.equal(value.workspaces[0].rows[2].workspaceId, 'real-local')
  } finally { f.close() }
})

test('header and row context triggers use projected target IDs, keyboard context key uses the active tree row', async () => {
  const value = projection(), f = await rendererFixture(value)
  try {
    const header = card(f, 'w:steam').querySelector('.workspace-header')
    f.dispatch(header, 'contextmenu', { clientX: 40, clientY: 60 })
    await f.settle()
    assert.deepEqual(f.commands.at(-1).id, 'w:steam')
    const next = update(value)
    await f.publish(next)
    row(f, 's:mods').querySelector('.menu-button').click()
    await f.settle()
    assert.equal(f.commands.at(-1).id, 's:mods')
    await f.publish(update(next))
    const tree = card(f, 'w:steam').querySelector('.workspace-tree')
    tree.focus(); f.key(tree, 'End'); f.key(tree, 'ContextMenu')
    await f.settle()
    assert.equal(f.commands.at(-1).type, 'context')
    assert.equal(f.commands.at(-1).id, 'g:empty')
    assert.match(row(f, 's:mods').querySelector('.menu-button').getAttribute('aria-label'), /投影:menu/)
  } finally { f.close() }
})

test('menu is entirely Main-projected, respects disabled/danger/separators and dispatches menu instance identity', async () => {
  const value = menu(projection()), f = await rendererFixture(value)
  try {
    const entries = f.document.querySelectorAll('.menu-entry')
    assert.equal(entries.length, 5)
    assert.equal(f.document.querySelector('[data-entry-id="sep"]').getAttribute('role'), 'separator')
    assert.equal(f.document.querySelector('[data-entry-id="archive"]').classList.contains('danger'), true)
    f.document.querySelector('[data-entry-id="disabled"]').click()
    assert.equal(f.commands.length, 0)
    const focused = f.document.querySelector('[data-entry-id="rename"]')
    focused.focus()
    const next = update(value); next.contextMenu.entries[0].label = '<svg onload=bad>'
    await f.publish(next)
    assert.equal(f.document.activeElement, focused)
    assert.equal(focused.textContent, '<svg onload=bad>')
    assert.equal(focused.querySelector('svg'), null)
    f.key(focused, 'ArrowDown')
    assert.equal(f.document.activeElement.dataset.entryId, 'archive')
    f.document.querySelector('[data-entry-id="copy-id"]').click()
    await f.settle()
    const intent = f.commands.at(-1)
    assert.equal(intent.type, 'action'); assert.equal(intent.id, 'menu-1'); assert.equal(intent.action, 'copy-id')
    assert.equal(intent.revision, next.revision)
    assert.equal(f.document.querySelector('#operation').hidden, true, 'transport acceptance is not copy success')
    await f.publish(update(next))
    assert.equal(f.document.querySelector('#menu-layer').hidden, true, 'an already chosen menu is not reopened by old same-id projection')
  } finally { f.close() }
})

test('Esc and outside dismissal send the offered cancel action, even with pending activity, and a new menu id resets', async () => {
  let value = menu(projection()), f = await rendererFixture(value)
  try {
    f.key(f.document.activeElement, 'Escape')
    await f.settle()
    assert.deepEqual(f.commands.at(-1).type, 'action')
    assert.equal(f.commands.at(-1).id, 'menu-1'); assert.equal(f.commands.at(-1).action, 'cancel')
    value = menu(update(value), 'menu-2')
    value.operation = { id: 'business-1', status: 'pending', message: 'Main 正在处理' }
    await f.publish(value)
    assert.equal(f.document.querySelector('#menu-layer').hidden, false)
    f.dispatch(f.document.querySelector('#title'), 'pointerdown')
    await f.settle()
    assert.equal(f.commands.at(-1).id, 'menu-2'); assert.equal(f.commands.at(-1).action, 'cancel')
    assert.equal(f.commands.filter(command => command.type === 'action').length, 2)
  } finally { f.close() }
})

test('menu and dialog return use the captured semantic tree target rather than its updated default leaf', async t => {
  for (const close of ['projected-close', 'Escape', 'dialog-close']) for (const state of ['enabled', 'disabled', 'retired', 'child-disabled', 'child-folded', 'ancestor-disabled']) {
    // Main cannot keep an offered session menu once its target has really retired.
    if (close === 'Escape' && state === 'retired') continue
    await t.test(`${close}; ${state}`, async () => {
      let value = projection()
      const nested = ['child-disabled', 'child-folded', 'ancestor-disabled'].includes(state), source = value.workspaces[0]
      const session = { ...source.rows.find(item => item.id === 's:local'), depth: nested ? 1 : 0 }
      const other = { ...value.workspaces[1].rows[0], depth: 0 }, workspace = { ...source.rows[0], depth: 0 }
      value.workspaces = [{ ...source, rows: nested ? [other, workspace, session] : [session, other] }]
      const f = await rendererFixture(value)
      try {
        const selected = card(f, source.id), tree = selected.querySelector('.workspace-tree')
        tree.focus(); f.key(tree, nested ? 'End' : 'Home'); f.key(tree, 'ContextMenu'); await f.settle()
        assert.equal(f.commands.at(-1).type, 'context'); assert.equal(f.commands.at(-1).id, session.id)
        value = menu(update(value), 'semantic-origin-menu', session.id); await f.publish(value)
        if (close === 'dialog-close') {
          f.document.querySelector('[data-entry-id="rename"]').click(); await f.settle()
          value = update(value); delete value.contextMenu
          value.dialog = { id: 'semantic-origin-dialog', kind: 'text', title: '原目标编辑', value: '保留草稿' }
          await f.publish(value)
        }
        value = update(value)
        if (state === 'retired') value.workspaces[0].rows = value.workspaces[0].rows.filter(item => item.id !== session.id)
        if (state === 'disabled' || state === 'child-disabled') value.workspaces[0].rows.find(item => item.id === session.id).disabled = true
        if (state === 'child-folded' || state === 'ancestor-disabled') value.layout.collapsedGroups = [workspace.id]
        if (state === 'ancestor-disabled') value.workspaces[0].rows.find(item => item.id === workspace.id).disabled = true
        if (close === 'projected-close') delete value.contextMenu
        await f.publish(value)
        if (close === 'Escape') { f.key(f.document.activeElement, 'Escape'); await f.settle() }
        if (close === 'dialog-close') { value = update(value); delete value.dialog; await f.publish(value) }
        if (state === 'disabled' || state === 'ancestor-disabled') {
          assert.equal(f.document.activeElement, selected.querySelector('.workspace-heading'))
          f.document.activeElement.click(); await f.settle()
          assert.equal(f.commands.some(command => command.type === 'activate'), false)
        } else {
          const expected = state === 'retired' ? other.id : nested && state !== 'enabled' ? workspace.id : session.id
          assert.equal(f.document.activeElement, tree)
          assert.equal(f.document.getElementById(tree.getAttribute('aria-activedescendant')).dataset.rowId, expected)
          f.key(tree, 'Enter'); await f.settle()
          if (expected === workspace.id) assert.equal(f.commands.some(command => command.type === 'activate'), false)
          else { assert.equal(f.commands.at(-1).type, 'activate'); assert.equal(f.commands.at(-1).id, expected); assert.equal(f.commands.at(-1).revision, value.revision) }
        }
      } finally { f.close() }
    })
  }
})

test('late menu cancellation cannot overwrite a newer explicit semantic focus claim in the same tree', async t => {
  for (const claim of ['same-tree', 'other-tree', 'keyboard', 'Escape']) for (const timing of ['immediate', 'deferred', 'projected-before-result']) await t.test(`${claim}; ${timing}`, async () => {
    let value = projection()
    const source = value.workspaces[0], group = { ...source.rows.find(item => item.kind === 'group'), depth: 0 }
    const session = { ...source.rows.find(item => item.id === 's:local'), depth: 1 }
    const destination = { ...group, id: 'g:claimed', label: '新认领的组' }
    value.workspaces = [{ ...source, rows: [group, session, ...(claim === 'other-tree' ? [] : [destination])] },
      ...(claim === 'other-tree' ? [{ ...value.workspaces[1], rows: [destination] }] : [])]
    const pending = Promise.withResolvers(), f = await rendererFixture(value, { command: command => command.type === 'action' && timing !== 'immediate' ? pending.promise : { kind: 'accepted' } })
    try {
      const tree = card(f, source.id).querySelector('.workspace-tree')
      tree.focus(); f.key(tree, 'Home'); f.key(tree, 'ArrowDown'); f.key(tree, 'ContextMenu'); await f.settle()
      value = menu(update(value), 'claim-menu', session.id); await f.publish(value)
      if (claim === 'Escape') f.key(f.document.activeElement, 'Escape')
      else if (claim === 'keyboard') { f.key(f.document.activeElement, 'Tab'); tree.focus(); f.key(tree, 'End') }
      else { const label = row(f, destination.id).querySelector('.label'); f.dispatch(label, 'pointerdown'); label.click() }
      const selectedTree = claim === 'other-tree' ? card(f, value.workspaces[1].id).querySelector('.workspace-tree') : tree
      if (claim !== 'Escape') assert.equal(f.document.getElementById(selectedTree.getAttribute('aria-activedescendant')).dataset.rowId, destination.id)
      if (timing === 'projected-before-result') { value = update(value); delete value.contextMenu; await f.publish(value) }
      if (timing !== 'immediate') pending.resolve({ kind: 'accepted' })
      await f.settle()
      const expected = claim === 'Escape' ? session.id : destination.id
      assert.equal(f.document.activeElement, selectedTree)
      assert.equal(f.document.getElementById(selectedTree.getAttribute('aria-activedescendant')).dataset.rowId, expected)
      f.key(selectedTree, 'Enter'); await f.settle()
      if (claim === 'Escape') { assert.equal(f.commands.at(-1).type, 'activate'); assert.equal(f.commands.at(-1).id, session.id); assert.equal(f.commands.at(-1).revision, value.revision) }
      else assert.equal(f.commands.some(command => command.type === 'activate'), false, 'the cancelled old menu cannot reopen its original session after a new claim')
    } finally { f.close() }
  })
})

test('menu cancellation restores Escape origin but never steals outside-click or Tab focus after transport settles', async t => {
  for (const cause of ['outside', 'Tab', 'Escape']) await t.test(cause, async () => {
    let value = projection(), f = await rendererFixture(value)
    try {
      const origin = card(f, 'w:steam').querySelector('.workspace-header .menu-button'), search = f.document.querySelector('#search')
      origin.focus(); origin.click(); await f.settle()
      value = menu(update(value), 'focus-menu', 'w:steam'); await f.publish(value)
      assert.ok(f.document.querySelector('#menu-layer').contains(f.document.activeElement))
      if (cause === 'outside') f.dispatch(search, 'pointerdown')
      else f.key(f.document.activeElement, cause)
      if (cause !== 'Escape') { search.focus(); type(f, search, '保留新的输入'); search.setSelectionRange(1, 3) }
      await f.settle()
      assert.equal(f.commands.at(-1).type, 'action')
      assert.equal(f.commands.at(-1).action, 'cancel'); assert.equal(f.commands.at(-1).id, 'focus-menu')
      assert.equal(f.document.activeElement, cause === 'Escape' ? origin : search)
      if (cause !== 'Escape') { assert.equal(search.value, '保留新的输入'); assert.equal(search.selectionStart, 1); assert.equal(search.selectionEnd, 3) }
    } finally { f.close() }
  })
})

test('same-id menu reorder preserves enabled keyed focus, removal selects a surviving entry and outside focus stays outside', async () => {
  let value = menu(projection()), f = await rendererFixture(value)
  try {
    const selected = f.document.querySelector('[data-entry-id="copy-id"]')
    selected.focus()
    value = update(value)
    value.contextMenu.entries = [value.contextMenu.entries.find(item => item.id === 'copy-id'), ...value.contextMenu.entries.filter(item => item.id !== 'copy-id')]
    await f.publish(value)
    assert.equal(f.document.querySelector('[data-entry-id="copy-id"]'), selected)
    assert.equal(f.document.activeElement, selected)
    f.key(selected, 'ArrowDown'); assert.equal(f.document.activeElement.dataset.entryId, 'rename')
    const search = f.document.querySelector('#search'); search.focus()
    value = update(value); value.contextMenu.entries.reverse(); await f.publish(value)
    assert.equal(f.document.activeElement, search)
    selected.focus()
    value = update(value); value.contextMenu.entries = value.contextMenu.entries.filter(item => item.id !== 'copy-id')
    await f.publish(value)
    assert.equal(f.document.querySelector('[data-entry-id="copy-id"]'), null)
    assert.ok(f.document.querySelector('#menu-layer').contains(f.document.activeElement))
    assert.equal(f.document.activeElement.disabled, false)
  } finally { f.close() }
})

test('same text dialog id preserves draft, selection, IME and focus on background updates; new id resets', async () => {
  let value = projection(); value.dialog = { id: 'edit-1', title: '重命名', kind: 'text', value: '原名称' }
  const f = await rendererFixture(value)
  try {
    const input = f.document.querySelector('.dialog-input')
    assert.equal(f.document.activeElement, input)
    type(f, input, '尚未完成的中文草稿'); input.setSelectionRange(2, 6, 'backward')
    f.dispatch(input, 'compositionstart')
    value = update(value); value.dialog.value = 'Main 不能抹掉草稿'; value.dialog.message = '后台变化'
    value.workspaces.reverse()
    await f.publish(value)
    assert.equal(f.document.querySelector('.dialog-input'), input)
    assert.equal(input.value, '尚未完成的中文草稿')
    assert.equal(input.selectionStart, 2); assert.equal(input.selectionEnd, 6); assert.equal(input.selectionDirection, 'backward')
    assert.equal(f.document.activeElement, input)
    f.key(input, 'Escape', { isComposing: true }); f.document.querySelector('[data-dialog-submit]').click()
    assert.equal(f.commands.some(command => command.type === 'dialog' || command.type === 'cancel-dialog'), false)
    f.dispatch(input, 'compositionend')
    f.document.querySelector('[data-dialog-submit]').click()
    await f.settle()
    assert.equal(f.commands.at(-1).type, 'dialog'); assert.equal(f.commands.at(-1).id, 'edit-1')
    assert.equal(f.commands.at(-1).value, '尚未完成的中文草稿')
    assert.equal(f.document.querySelector('#operation').hidden, true)
    value = update(value, { dialog: { id: 'edit-2', title: '下一个编辑', kind: 'text', value: '新初值' } })
    await f.publish(value)
    assert.notEqual(f.document.querySelector('.dialog-input'), input)
    assert.equal(f.document.querySelector('.dialog-input').value, '新初值')
    f.key(f.document.activeElement, 'Escape')
    await f.settle()
    assert.equal(f.commands.at(-1).type, 'cancel-dialog'); assert.equal(f.commands.at(-1).id, 'edit-2')
  } finally { f.close() }
})

test('confirm matches shared Main submit handler: no invented yes/magic value', async () => {
  const value = projection(); value.dialog = { id: 'confirm-1', title: '确认', kind: 'confirm', message: 'Main 的危险提示' }
  const f = await rendererFixture(value)
  try {
    assert.equal(f.document.querySelector('.dialog-message').textContent, 'Main 的危险提示')
    assert.equal(f.document.querySelector('.dialog-input'), null)
    f.document.querySelector('[data-dialog-submit]').click()
    await f.settle()
    const intent = f.commands.at(-1)
    assert.equal(intent.type, 'dialog'); assert.equal(intent.id, 'confirm-1')
    assert.equal(Object.hasOwn(intent, 'value'), false)
    assert.equal(Object.hasOwn(intent, 'appearance'), false)
  } finally { f.close() }
})

test('select keeps its draft through fresh options, honors newly disabled/deleted options and never silently changes destination', async () => {
  let value = projection(); value.dialog = { id: 'select-1', title: '目的地', kind: 'select', options: [], value: 'B' }
  const f = await rendererFixture(value)
  try {
    const input = f.document.querySelector('.dialog-input'), submit = f.document.querySelector('[data-dialog-submit]')
    assert.equal(submit.disabled, true)
    value = update(value); value.dialog.options = [{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }]
    await f.publish(value)
    assert.equal(input.value, 'B'); assert.equal(submit.disabled, false)
    input.value = 'A'; f.dispatch(input, 'change')
    value = update(value); value.dialog.options = [{ id: 'A', label: '最新 A', disabled: true }, { id: 'C', label: '新增 C' }]
    await f.publish(value)
    assert.equal(f.document.querySelector('.dialog-input'), input)
    assert.equal(f.document.activeElement, input)
    assert.equal(input.value, 'A'); assert.equal(input.options[0].disabled, true); assert.equal(submit.disabled, true)
    submit.click(); assert.equal(f.commands.length, 0)
    value = update(value); value.dialog.options = [{ id: 'C', label: 'C' }]
    await f.publish(value)
    assert.equal(input.selectedIndex, -1); assert.equal(submit.disabled, true)
    input.value = 'C'; f.dispatch(input, 'change'); submit.click()
    await f.settle()
    assert.equal(f.commands.at(-1).value, 'C'); assert.equal(f.commands.at(-1).id, 'select-1')
  } finally { f.close() }
})

test('appearance is finite data, preserves auto tokens and numeric/boolean drafts, and only exposes icon when Main owns the field', async () => {
  let value = projection(); value.dialog = { id: 'style-1', title: '外观', kind: 'appearance', appearance: {
    color: 'auto:12', glow: 3, weight: 500, shadow: true, stroke: true, strokeWidth: 1, strokeColor: 'auto',
  } }
  const f = await rendererFixture(value)
  try {
    const field = key => f.document.querySelector(`[data-appearance="${key}"]`)
    assert.equal(field('icon'), null, 'sessions/session groups cannot acquire icons')
    assert.equal(field('color').value, 'auto:12')
    assert.equal(f.document.querySelectorAll('datalist option').length, 13)
    assert.equal(f.document.querySelector('[data-appearance="color"]').getAttribute('aria-label'), value.labels.color)
    assert.equal(f.document.querySelector('button[data-reset]'), null, 'no uncontracted reset business action')
    type(f, field('color'), 'auto:0'); field('color').focus(); field('color').setSelectionRange(1, 4)
    value = update(value); value.dialog.appearance.color = '#ffffff'
    await f.publish(value)
    assert.equal(field('color').value, 'auto:0'); assert.equal(field('color').selectionStart, 1)
    type(f, field('glow'), '100'); type(f, field('weight'), '1000'); type(f, field('strokeWidth'), '32')
    field('shadow').checked = false; f.dispatch(field('shadow'), 'change')
    f.document.querySelector('[data-dialog-submit]').click()
    await f.settle()
    assert.deepEqual(f.commands.at(-1).appearance, { color: 'auto:0', glow: 100, weight: 1000, shadow: false, stroke: true, strokeWidth: 32, strokeColor: 'auto' })
    assert.equal(row(f, 's:local').style.color, '', 'editing tokens are never rendered as CSS')
    value = update(value, { dialog: { id: 'style-2', title: '工作区图标', kind: 'appearance', appearance: { icon: 'IconExistingSymbol' } } })
    await f.publish(value)
    assert.equal(field('icon').value, 'IconExistingSymbol')
    assert.equal(field('icon').querySelector('option[value="IconExistingSymbol"]').textContent, 'IconExistingSymbol')
    assert.equal(field('icon').options.length, 4, 'finite modes and the existing symbolic value, not an unsupported icon catalog')
    assert.equal(field('icon').querySelector('option[value="solid"]').textContent, value.labels.iconSolid)
    value = update(value); delete value.dialog.appearance.icon
    await f.publish(value)
    assert.equal(field('icon'), null)
    f.document.querySelector('[data-dialog-submit]').click()
    await f.settle()
    assert.equal(Object.hasOwn(f.commands.at(-1).appearance, 'icon'), false)
  } finally { f.close() }
})

test('invalid appearance editing is retained without emitting an out-of-bounds command', async () => {
  const value = projection(); value.dialog = { id: 'style-1', title: '外观', kind: 'appearance', appearance: { glow: 1, color: '' } }
  const f = await rendererFixture(value)
  try {
    const glow = f.document.querySelector('[data-appearance="glow"]'), color = f.document.querySelector('[data-appearance="color"]')
    type(f, glow, '101')
    f.dispatch(f.document.querySelector('.managed-form'), 'submit')
    assert.equal(f.commands.length, 0); assert.equal(glow.value, '101')
    type(f, glow, '100'); type(f, color, 'auto:13')
    f.dispatch(f.document.querySelector('.managed-form'), 'submit')
    assert.equal(f.commands.length, 0); assert.equal(color.value, 'auto:13')
    type(f, color, 'url(evil)')
    f.dispatch(f.document.querySelector('.managed-form'), 'submit')
    assert.equal(f.commands.length, 0)
    type(f, color, '#123abc')
    f.dispatch(f.document.querySelector('.managed-form'), 'submit')
    await f.settle()
    assert.equal(f.commands.at(-1).appearance.color, '#123abc')
  } finally { f.close() }
})

test('operation truth is Main-owned; pending does not strand return, and an error retains a retryable editor', async () => {
  let value = projection(); value.dialog = { id: 'edit-1', title: '编辑', kind: 'text', value: '草稿' }
  const f = await rendererFixture(value)
  try {
    const input = f.document.querySelector('.dialog-input')
    type(f, input, '保留的修改'); input.setSelectionRange(1, 3)
    f.document.querySelector('[data-dialog-submit]').click()
    await f.settle()
    assert.equal(f.document.querySelector('#operation').hidden, true)
    value = update(value, { operation: { id: 'op-1', status: 'pending', message: '提供方还在处理' } })
    await f.publish(value)
    assert.equal(f.document.querySelector('#operation').dataset.status, 'pending')
    assert.equal(f.document.querySelector('#operation').textContent, '提供方还在处理')
    assert.equal(f.document.querySelector('[data-dialog-submit]').disabled, true)
    assert.equal(input.disabled, false); assert.equal(input.value, '保留的修改'); assert.equal(input.selectionStart, 1)
    f.document.querySelector('[data-dialog-return]').click()
    await f.settle()
    assert.equal(f.commands.at(-1).type, 'return')
    assert.equal(f.document.querySelector('#navigator').hidden, false)
    value = update(value, { operation: { id: 'op-1', status: 'error', message: 'Main 的真实失败' } })
    await f.publish(value)
    assert.equal(f.document.querySelector('#operation').dataset.status, 'error')
    assert.equal(f.document.querySelector('#operation').textContent, 'Main 的真实失败')
    assert.equal(f.document.querySelector('[data-dialog-submit]').disabled, false)
    assert.equal(input.value, '保留的修改')
    value = update(value, { operation: { id: 'op-2', status: 'success', message: 'Main 确认完成' } }); delete value.dialog
    await f.publish(value)
    assert.equal(f.document.querySelector('#operation').dataset.status, 'success')
    assert.equal(f.document.querySelector('#dialog-layer').hidden, true)
  } finally { f.close() }
})

test('return does not wait behind an unresolved layout transport promise', async () => {
  let release
  const value = projection(), f = await rendererFixture(value, { command: intent => intent.type === 'layout' ? new Promise(resolve => { release = resolve }) : { kind: 'accepted' } })
  try {
    card(f, 'w:steam').querySelector('.workspace-heading').click()
    f.document.querySelector('#return').click()
    await f.settle()
    assert.equal(f.commands.at(-1).type, 'return')
  } finally { release?.({ kind: 'accepted' }); await f.settle(); f.close() }
})

test('sort selector sends a finite intent and waits for projected mode rather than inventing persisted order', async () => {
  let value = projection(), f = await rendererFixture(value)
  try {
    const input = f.document.querySelector('#sort-mode')
    assert.equal(input.options[0].textContent, value.labels.automatic)
    input.value = 'manual'; f.dispatch(input, 'change'); await f.settle()
    assert.equal(f.commands.at(-1).type, 'sort'); assert.equal(f.commands.at(-1).mode, 'manual')
    assert.equal(input.value, 'activity', 'Main has not yet changed the mode')
    value = update(value, { sortMode: 'manual' }); await f.publish(value)
    assert.equal(input.value, 'manual'); assert.equal(input.disabled, false)
    input.value = 'activity'; f.dispatch(input, 'change'); await f.settle()
    assert.equal(f.commands.at(-1).mode, 'activity')
  } finally { f.close() }
})

test('R5 HTML5 pointer handoff preserves item drag through pointercancel until its finite drop', async t => {
  const cases = [
    { name: 'activity session regroup', source: 's:mods', target: 'g:empty', position: 'inside' },
    { name: 'activity workspace parent', source: 'w:deep', target: 'w:mods', position: 'inside' },
    { name: 'activity workspace root', source: 'w:deep', target: null, position: 'inside' },
    { name: 'activity workspace-group parent', source: 'wg:nested', target: 'w:local', position: 'inside' },
    { name: 'manual session before', source: 's:local', target: 's:other', position: 'before', ratio: 0.1, manual: true },
    { name: 'manual session after', source: 's:local', target: 's:other', position: 'after', ratio: 0.9, manual: true },
    { name: 'manual group before', source: 'g:empty', target: 's:mods', position: 'before', ratio: 0.1, manual: true },
    { name: 'manual root-card before', source: 'w:other', target: 'w:steam', position: 'before', ratio: 0.1, manual: true, headers: true },
  ]
  for (const item of cases) await t.test(item.name, async () => {
    const value = projection(); if (item.manual) value.sortMode = 'manual'
    const f = await rendererFixture(value)
    try {
      const source = item.headers ? card(f, item.source).querySelector('.drag-handle') : row(f, item.source).querySelector('.drag-handle')
      const target = item.target === null ? f.document.querySelector('#root-drop')
        : item.headers ? card(f, item.target).querySelector('.workspace-header') : row(f, item.target)
      f.dispatch(source, 'pointerdown', { button: 0, pointerType: 'mouse', pointerId: 17, clientX: 200 })
      const { event, dataTransfer } = start(f, source)
      assert.equal(event.defaultPrevented, false)
      assert.equal(f.document.querySelector('#root-drop').hidden, false)
      // Normal HTML5 takeover cancels the pointer stream, not the item drag operation.
      f.dispatch(source, 'pointercancel', { pointerId: 17, pointerType: 'mouse' })
      assert.equal(f.document.querySelector('#root-drop').hidden, false)
      over(f, target, item.ratio ?? 0.5, dataTransfer)
      assert.equal((item.headers ? card(f, item.target) : target).dataset.drop, item.position)
      drop(f, target, item.ratio ?? 0.5, dataTransfer); await f.settle()
      const commands = f.commands.filter(command => command.type === 'drop')
      assert.equal(commands.length, 1)
      assert.equal(commands[0].id, item.source)
      assert.equal(commands[0].targetId, item.target)
      assert.equal(commands[0].position, item.position)
      assert.equal(commands[0].instance, value.instance)
      assert.equal(commands[0].revision, value.revision)
      assert.equal(f.document.querySelector('#root-drop').hidden, true)
      f.dispatch(source, 'dragend'); await f.settle()
      assert.equal(f.commands.filter(command => command.type === 'drop').length, 1)
    } finally { f.close() }
  })
})

test('R5 pointercancel still terminates only its matching strip-pan pointer', async () => {
  const value = projection(); value.layout.focusedWorkspaceId = 'w:steam'
  const f = await rendererFixture(value)
  try {
    const strip = f.document.querySelector('#strip'), open = row(f, 's:other', true).querySelector('.preview-open')
    f.dispatch(open, 'pointerdown', { button: 0, pointerType: 'mouse', pointerId: 41, clientX: 200 })
    f.dispatch(f.window, 'pointermove', { pointerId: 41, clientX: 160 })
    assert.equal(strip.scrollLeft, 40)
    assert.equal(strip.dataset.dragging, 'true')
    f.dispatch(open, 'pointercancel', { pointerId: 42 })
    f.dispatch(f.window, 'pointermove', { pointerId: 41, clientX: 150 })
    assert.equal(strip.scrollLeft, 50, 'another pointer does not cancel this pan')
    f.dispatch(open, 'pointercancel', { pointerId: 41 })
    assert.equal(strip.dataset.dragging, undefined)
    f.dispatch(f.window, 'pointermove', { pointerId: 41, clientX: 100 })
    assert.equal(strip.scrollLeft, 50)
    assert.equal(f.document.querySelector('#root-drop').hidden, true)
    assert.equal(f.commands.filter(command => command.type === 'drop').length, 0)
  } finally { f.close() }
})

test('R5 HTML5 drag terminators still revoke a handed-off item and cannot emit a later drop', async t => {
  for (const terminal of ['dragend', 'blur', 'source removed']) await t.test(terminal, async () => {
    let value = projection(); const f = await rendererFixture(value)
    try {
      const source = row(f, 's:mods'), handle = source.querySelector('.drag-handle')
      start(f, handle); f.dispatch(handle, 'pointercancel', { pointerId: 17 })
      assert.equal(f.document.querySelector('#root-drop').hidden, false)
      if (terminal === 'dragend') f.dispatch(source, 'dragend')
      else if (terminal === 'blur') f.dispatch(f.window, 'blur')
      else {
        value = update(value)
        value.workspaces[0].rows = value.workspaces[0].rows.filter(item => item.id !== 's:mods')
        await f.publish(value)
      }
      assert.equal(f.document.querySelector('#root-drop').hidden, true)
      assert.equal(source.dataset.dragging, undefined)
      over(f, row(f, 'g:empty')); drop(f, row(f, 'g:empty')); await f.settle()
      assert.equal(f.commands.filter(command => command.type === 'drop').length, 0)
    } finally { f.close() }
  })
})

test('activity drag regroups only; hover never mutates and external transfers cannot supply a source', async () => {
  const value = projection(), f = await rendererFixture(value)
  try {
    const target = row(f, 'w:mods')
    assert.equal(f.dispatch(f.document.body, 'drop', { dataTransfer: transfer() }).defaultPrevented, true)
    over(f, target, 0.05)
    assert.equal(f.commands.length, 0); assert.equal(target.dataset.drop, undefined)
    start(f, row(f, 's:local'))
    over(f, target, 0.05)
    assert.equal(target.dataset.drop, 'inside', 'activity does not pretend to pin a before/after position')
    assert.equal(f.commands.length, 0)
    drop(f, target, 0.05); await f.settle()
    const intent = f.commands.at(-1)
    assert.equal(intent.type, 'drop'); assert.equal(intent.id, 's:local'); assert.equal(intent.targetId, 'w:mods'); assert.equal(intent.position, 'inside')
    assert.equal(card(f, 'w:steam').querySelectorAll('.workspace-tree [data-row-id="s:local"]').length, 1, 'no optimistic local migration')
    assert.equal(value.workspaces[0].rows[2].workspaceId, 'real-local')
  } finally { f.close() }
})

test('manual drag admits before/after only at explicit edges and routes cross-workspace sessions to Main', async () => {
  const value = projection(); value.sortMode = 'manual'
  const f = await rendererFixture(value)
  try {
    for (const [ratio, position] of [[0.1, 'before'], [0.9, 'after']]) {
      start(f, row(f, 's:local')); over(f, row(f, 's:other'), ratio)
      assert.equal(row(f, 's:other').dataset.drop, position)
      drop(f, row(f, 's:other'), ratio); await f.settle()
      assert.equal(f.commands.at(-1).position, position); assert.equal(f.commands.at(-1).targetId, 's:other')
    }
    assert.equal(f.commands.filter(command => command.type === 'drop').length, 2)
    assert.equal(f.commands.some(command => command.type === 'dialog'), false, 'renderer does not invent provider confirmation or execute a migration')
  } finally { f.close() }
})

test('DnD refuses self, descendant, leaf-inside, group scope crossing and session null-root; explicit container root is admitted', async () => {
  const value = projection(), f = await rendererFixture(value)
  try {
    const refuse = async (source, target) => {
      start(f, source); over(f, target)
      assert.equal(target.dataset.drop, 'invalid')
      drop(f, target); await f.settle()
      assert.equal(f.commands.filter(command => command.type === 'drop').length, 0)
    }
    await refuse(row(f, 'w:local'), row(f, 'w:local'))
    await refuse(card(f, 'w:steam').querySelector('.drag-handle'), row(f, 'w:deep'))
    await refuse(row(f, 's:local'), row(f, 's:mods'))
    await refuse(row(f, 'g:local'), row(f, 'g:other'))
    start(f, row(f, 's:local'))
    const zone = f.document.querySelector('#root-drop')
    await refuse(row(f, 's:local'), zone)
    start(f, row(f, 'w:local')); over(f, zone)
    assert.equal(zone.dataset.drop, 'inside')
    drop(f, zone); await f.settle()
    assert.equal(f.commands.at(-1).targetId, null); assert.equal(f.commands.at(-1).position, 'inside')
    assert.equal(f.commands.at(-1).id, 'w:local')
    row(f, 's:mods').querySelector('.label').click()
    assert.equal(f.commands.some(command => command.type === 'activate'), false, 'the post-drag click is suppressed')
  } finally { f.close() }
})

test('hover, tree focus, menu, dialog and drag retain targets during activity updates, then release presentation ordering', async () => {
  let value = projection(), f = await rendererFixture(value)
  try {
    const original = [...card(f, 'w:steam').querySelectorAll('.workspace-tree .row')].map(element => element.dataset.rowId)
    f.dispatch(row(f, 'w:local'), 'pointerover')
    value = update(value)
    const rows = value.workspaces[0].rows
    value.workspaces[0].rows = [...rows.slice(5), ...rows.slice(0, 5)]
    value.workspaces.reverse()
    await f.publish(value)
    assert.deepEqual([...card(f, 'w:steam').querySelectorAll('.workspace-tree .row')].map(element => element.dataset.rowId), original)
    assert.equal(f.document.querySelector('#overview').firstElementChild.dataset.workspaceId, 'w:steam')
    f.dispatch(card(f, 'w:steam'), 'pointerout', { relatedTarget: f.document.querySelector('#title') })
    assert.equal(f.document.querySelector('#overview').firstElementChild.dataset.workspaceId, 'wg:root')
    const tree = card(f, 'w:steam').querySelector('.workspace-tree'); tree.focus()
    const before = [...tree.children].map(element => element.dataset.rowId)
    value = update(value); value.workspaces.find(item => item.id === 'w:steam').rows = rows
    await f.publish(value)
    assert.deepEqual([...tree.children].map(element => element.dataset.rowId), before)
    f.document.querySelector('#search').focus()
    assert.deepEqual([...tree.children].map(element => element.dataset.rowId), original)
    // Menu/dialog and item drag also hold ordering when focus is elsewhere.
    value = menu(update(value)); await f.publish(value)
    value = update(value); value.workspaces.reverse(); await f.publish(value)
    const held = [...f.document.querySelector('#overview').children].map(element => element.dataset.workspaceId)
    value = update(value, { dialog: { id: 'hold-editor', title: '保持输入', kind: 'text', value: 'x' } }); delete value.contextMenu
    await f.publish(value)
    assert.deepEqual([...f.document.querySelector('#overview').children].map(element => element.dataset.workspaceId), held)
    value = update(value); delete value.dialog; await f.publish(value)
    start(f, row(f, 's:local'))
    const dragging = [...f.document.querySelector('#overview').children].map(element => element.dataset.workspaceId)
    value = update(value); value.workspaces.reverse(); await f.publish(value)
    assert.deepEqual([...f.document.querySelector('#overview').children].map(element => element.dataset.workspaceId), dragging)
    f.dispatch(row(f, 's:local'), 'dragend')
  } finally { f.close() }
})

test('search remains temporary, IME-safe and keyboard navigable; private collapse/scroll is not rewritten by searching', async () => {
  let value = projection(); value.layout.collapsedGroups = ['w:local', 'g:local']; value.layout.scrolls = [{ id: 'w:steam', top: 90 }]
  const f = await rendererFixture(value)
  try {
    const search = f.document.querySelector('#search'), tree = card(f, 'w:steam').querySelector('.workspace-tree')
    assert.equal(tree.scrollTop, 90); assert.equal(row(f, 's:local'), null)
    f.dispatch(search, 'compositionstart'); type(f, search, '汉化')
    f.key(search, 'Enter', { isComposing: true }); await f.advance(200)
    assert.equal(f.commands.length, 0)
    value = update(value); value.workspaces[0].label = '仍在更新'; await f.publish(value)
    assert.equal(search.value, '汉化')
    f.dispatch(search, 'compositionend'); await f.settle()
    assert.equal(f.commands.at(-1).type, 'search'); assert.equal(f.commands.at(-1).query, '汉化')
    value = update(value, { query: '汉化' }); await f.publish(value)
    assert.equal(f.document.querySelector('#view').dataset.mode, 'search')
    assert.notEqual(row(f, 's:local'), null, 'temporary search reveals collapsed descendants')
    assert.equal(row(f, 'w:local').querySelector('.chevron').disabled, true)
    tree.scrollTop = 20; f.dispatch(tree, 'scroll'); await f.advance(200)
    assert.equal(f.commands.filter(command => command.type === 'layout').length, 0)
    f.key(search, 'ArrowDown'); assert.equal(f.document.activeElement, tree)
    f.key(tree, 'Home'); f.key(tree, 'ArrowDown'); f.key(tree, 'ArrowDown'); f.key(tree, 'Enter'); await f.settle()
    assert.equal(f.commands.at(-1).type, 'activate'); assert.equal(f.commands.at(-1).id, 's:local')
    value = update(value, { query: '' }); await f.publish(value)
    assert.equal(row(f, 's:local'), null)
    assert.equal(tree.scrollTop, 90)
    assert.deepEqual(value.layout.collapsedGroups, ['w:local', 'g:local'])
  } finally { f.close() }
})

test('strip previews, wheel/keyboard panning and pointer drag-scroll coexist with explicit item DnD in RTL/density/theme', async () => {
  const value = projection(); value.layout.focusedWorkspaceId = 'w:steam'; value.dark = true; value.direction = 'rtl'; value.density = 'compact'
  const f = await rendererFixture(value)
  try {
    const strip = f.document.querySelector('#strip'), preview = row(f, 's:other', true)
    assert.equal(f.document.documentElement.dir, 'rtl'); assert.equal(f.document.documentElement.dataset.dark, 'true')
    assert.equal(f.document.documentElement.dataset.density, 'compact')
    assert.equal(preview.querySelector('.preview-path').textContent, '其他会话 原始标题')
    f.dispatch(strip, 'wheel', { deltaX: 0, deltaY: 30, deltaMode: 0 })
    assert.equal(strip.scrollLeft, -30)
    strip.focus(); f.key(strip, 'ArrowRight'); assert.equal(strip.scrollLeft, 70)
    const open = preview.querySelector('.preview-open')
    f.dispatch(open, 'pointerdown', { button: 0, pointerType: 'mouse', pointerId: 1, clientX: 200 })
    f.dispatch(f.window, 'pointermove', { pointerId: 1, clientX: 150 })
    f.dispatch(f.window, 'pointerup', { pointerId: 1 })
    assert.equal(strip.scrollLeft, 120)
    open.click(); await f.settle()
    assert.equal(f.commands.some(command => command.type === 'activate'), false)
    await f.advance(500)
    const handle = preview.querySelector('.drag-handle')
    f.dispatch(handle, 'pointerdown', { button: 0, pointerType: 'mouse', pointerId: 2, clientX: 200 })
    start(f, handle)
    f.dispatch(f.window, 'pointermove', { pointerId: 2, clientX: 100 })
    assert.equal(strip.scrollLeft, 120, 'item DnD does not also pan the strip')
    over(f, row(f, 'w:mods')); drop(f, row(f, 'w:mods')); await f.settle()
    assert.equal(f.commands.at(-1).type, 'drop'); assert.equal(f.commands.at(-1).id, 's:other')
    await f.advance(500); open.click(); await f.settle()
    assert.equal(f.commands.at(-1).type, 'activate'); assert.equal(f.commands.at(-1).id, 's:other')
  } finally { f.close() }
})

test('all finite commands carry current identity/revision and distinct commandIds, stale transport refresh stays usable', async () => {
  let value = projection(), once = true
  const f = await rendererFixture(value, { command: intent => {
    if (intent.type === 'activate' && once) { once = false; value = update(value); return { kind: 'refresh', model: value } }
    return { kind: 'accepted' }
  } })
  try {
    row(f, 's:local').querySelector('.label').click(); await f.settle()
    assert.equal(f.document.querySelector('#navigator').hidden, false)
    assert.equal(f.document.querySelector('#notice').textContent, value.labels.error)
    row(f, 's:mods').querySelector('.label').click(); await f.settle()
    f.document.querySelector('#return').click(); await f.settle()
    assert.equal(f.commands.filter(command => command.type === 'return').length, 1)
    assert.equal(f.commands.at(-1).revision, value.revision)
    assert.equal(new Set(f.commands.map(command => command.commandId)).size, f.commands.length)
    assert.equal(f.commands.every(command => command.instance === value.instance), true)
  } finally { f.close() }
})
