// DOM/pointer simulation with explicit geometry; not WebView2 physical drag or visual acceptance.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { rendererFixture } from './renderer-fixture.mjs'
import { model } from '../host/fixtures.mjs'

function projection() {
  const value = model()
  value.layout.focusedWorkspaceId = 'workspace-a'
  value.workspaces.push({ id: 'workspace-b', label: '其他工作区', title: '其他工作区', activityAt: null, activityKnown: false, matches: true,
    rows: [{ id: 'session-b', kind: 'session', label: '预览会话', title: '预览会话', depth: 0, activityAt: null, activityKnown: false, matches: true }] })
  return value
}
function update(value, patch = {}) { return { ...structuredClone(value), revision: value.revision + 1, ...patch } }
async function fixture(initial = projection()) {
  const f = await rendererFixture(initial)
  const view = f.document.querySelector('#view'), splitter = f.document.querySelector('#pane-splitter')
  const focused = f.document.querySelector('#focused'), strip = f.document.querySelector('#strip')
  let height = 2012
  const captured = new Set()
  // jsdom has no layout engine or pointer capture; supply only measured browser geometry/APIs.
  Object.defineProperty(view, 'clientHeight', { get: () => height })
  splitter.getBoundingClientRect = () => ({ height: 12 })
  focused.style.minHeight = '240px'
  strip.style.minHeight = '232px'
  splitter.setPointerCapture = id => captured.add(id)
  splitter.hasPointerCapture = id => captured.has(id)
  splitter.releasePointerCapture = id => { captured.delete(id); f.dispatch(splitter, 'lostpointercapture', { pointerId: id }) }
  const resize = next => { height = next; f.dispatch(f.window, 'resize') }
  resize(height)
  const share = () => Number(splitter.getAttribute('aria-valuenow'))
  const down = (fields = {}) => f.dispatch(splitter, 'pointerdown', { button: 0, isPrimary: true, pointerId: 7, clientY: 1600, ...fields })
  const move = (y, id = 7) => f.dispatch(f.window, 'pointermove', { pointerId: id, clientY: y })
  return { ...f, view, splitter, focused, strip, captured, resize, share, down, move }
}

test('pane splitter is focus-only, labelled by the controlled primary pane, and never changes Main layout', async () => {
  let value = projection()
  const before = structuredClone(value.layout), f = await fixture(value)
  try {
    assert.equal(f.splitter.hidden, false)
    assert.equal(f.splitter.getAttribute('role'), 'separator')
    assert.equal(f.splitter.getAttribute('aria-orientation'), 'horizontal')
    assert.equal(f.splitter.getAttribute('aria-controls'), 'focused strip')
    assert.equal(f.document.getElementById(f.splitter.getAttribute('aria-labelledby')).textContent, '项目')
    assert.equal(f.splitter.previousElementSibling, f.focused)
    assert.equal(f.splitter.nextElementSibling, f.strip)
    assert.equal(f.splitter.tabIndex, 0)
    assert.equal(f.share(), 80)
    f.down(); f.move(1000)
    assert.equal(f.share(), 50)
    assert.equal(f.view.style.getPropertyValue('--focused-flex'), '0 0 1000px', 'exact border-box target includes pane padding without redistributing it')
    f.dispatch(f.window, 'pointerup', { pointerId: 7 })
    await f.settle()
    assert.deepEqual(value.layout, before)
    assert.deepEqual(f.commands, [], 'geometry must not emit a business/layout command')
    value = update(value, { layout: { ...value.layout, focusedWorkspaceId: null } })
    await f.publish(value)
    assert.equal(f.splitter.hidden, true)
    assert.equal(f.splitter.tabIndex, -1)
    value = update(value, { layout: { ...value.layout, focusedWorkspaceId: 'workspace-b' } })
    await f.publish(value)
    assert.equal(f.splitter.hidden, false)
    assert.equal(f.share(), 50, 'focus changes retain the same document preference')
  } finally { f.close() }
})

test('pane splitter captures only its primary pointer, supports mouse/pen/touch, and clamps to CSS minima', async t => {
  for (const pointerType of ['mouse', 'pen', 'touch']) await t.test(pointerType, async () => {
    const f = await fixture()
    try {
      assert.equal(f.down({ button: 2 }).defaultPrevented, false)
      assert.equal(f.down({ isPrimary: false }).defaultPrevented, false)
      assert.equal(f.captured.size, 0)
      assert.equal(f.down({ pointerType }).defaultPrevented, true)
      assert.equal(f.captured.has(7), true)
      assert.equal(f.document.querySelector('#navigator').dataset.resizing, 'true')
      assert.equal(f.document.activeElement, f.splitter)
      f.move(0, 8)
      assert.equal(f.share(), 80, 'another pointer cannot resize')
      f.dispatch(f.window, 'pointerup', { pointerId: 8 })
      assert.equal(f.captured.has(7), true)
      f.move(-10000)
      assert.equal(f.share(), 12, '240px primary minimum / 2000px usable height')
      f.move(10000)
      assert.equal(f.share(), 88.4, '232px preview minimum / 2000px usable height')
      f.move(1000)
      assert.equal(f.share(), 50)
      f.dispatch(f.window, 'pointerup', { pointerId: 7 })
      assert.equal(f.captured.size, 0)
      assert.equal(f.document.querySelector('#navigator').hasAttribute('data-resizing'), false)
      f.move(400)
      assert.equal(f.share(), 50, 'release ends resizing')
    } finally { f.close() }
  })
})

test('pane splitter keyboard range/reset follows CSS geometry without hijacking unrelated/composing keys', async () => {
  const f = await fixture()
  try {
    f.splitter.focus()
    f.key(f.splitter, 'ArrowUp'); assert.equal(f.share(), 79)
    f.key(f.splitter, 'ArrowDown'); assert.equal(f.share(), 80)
    f.key(f.splitter, 'ArrowUp', { shiftKey: true }); assert.equal(f.share(), 70)
    f.key(f.splitter, 'Home'); assert.equal(f.share(), 12)
    f.key(f.splitter, 'End'); assert.equal(f.share(), 88.4)
    f.key(f.splitter, 'Enter'); assert.equal(f.share(), 80)
    for (const fields of [{ isComposing: true }, { keyCode: 229 }, { ctrlKey: true }, { altKey: true }, { metaKey: true }]) {
      assert.equal(f.key(f.splitter, 'ArrowUp', fields).defaultPrevented, false)
      assert.equal(f.share(), 80)
    }
    assert.equal(f.key(f.splitter, 'ArrowLeft').defaultPrevented, false)
    f.key(f.splitter, 'Home')
    f.dispatch(f.splitter, 'dblclick')
    assert.equal(f.share(), 80)
    assert.equal(f.commands.length, 0)
  } finally { f.close() }
})

test('pane splitter retains desired ratio across geometry/density/model updates and safely disables if both minima cannot fit', async () => {
  let value = projection()
  const f = await fixture(value)
  try {
    f.resize(1012)
    assert.equal(f.share(), 76.8, 'small viewport clamps the default ratio')
    f.resize(2012)
    assert.equal(f.share(), 80, 'growing restores desired ratio instead of persisting the clamp')
    f.down(); f.move(1000)
    f.dispatch(f.window, 'pointerup', { pointerId: 7 })
    f.strip.style.minHeight = '250px'
    value = update(value, { dark: true, direction: 'rtl', density: 'roomy' })
    await f.publish(value)
    assert.equal(f.share(), 50)
    assert.equal(f.splitter.getAttribute('aria-valuemax'), '87.5')
    f.down(); f.move(1400)
    assert.equal(f.share(), 40)
    f.resize(400)
    assert.equal(f.splitter.getAttribute('aria-disabled'), 'true')
    assert.equal(f.splitter.tabIndex, -1)
    assert.equal(f.captured.size, 0)
    assert.equal(f.down().defaultPrevented, false)
    f.resize(2012)
    assert.equal(f.share(), 40)
    assert.equal(f.splitter.getAttribute('aria-disabled'), 'false')
    assert.equal(f.splitter.tabIndex, 0)
    value = update(value, { query: '临时搜索' }); await f.publish(value)
    assert.equal(f.splitter.hidden, true)
    value = update(value, { query: '' }); await f.publish(value)
    assert.equal(f.share(), 40)
    value = update(value, { instance: 'new-main' }); await f.publish(value)
    assert.equal(f.share(), 80, 'new owner starts at default; no cross-Main preference write')
  } finally { f.close() }
})

test('pane splitter stops on every matching capture/lifetime/mode terminator and ignores late movement', async t => {
  for (const ending of ['pointercancel', 'lostpointercapture', 'blur', 'resize', 'overview', 'search', 'single-card', 'disconnect', 'dialog', 'new-instance', 'pagehide']) {
    await t.test(ending, async () => {
      let value = projection()
      const f = await fixture(value)
      try {
        f.down(); f.move(1400)
        assert.equal(f.share(), 70)
        if (ending === 'pointercancel') f.dispatch(f.window, 'pointercancel', { pointerId: 7 })
        else if (ending === 'lostpointercapture') { f.captured.delete(7); f.dispatch(f.splitter, 'lostpointercapture', { pointerId: 7 }) }
        else if (ending === 'blur' || ending === 'pagehide') f.dispatch(f.window, ending)
        else if (ending === 'resize') f.resize(1512)
        else {
          value = update(value)
          if (ending === 'overview') value.layout.focusedWorkspaceId = null
          if (ending === 'search') value.query = '搜索'
          if (ending === 'single-card') value.workspaces.pop()
          if (ending === 'disconnect') value.connected = false
          if (ending === 'dialog') value.dialog = { id: 'editor', title: '编辑', kind: 'text', value: '草稿' }
          if (ending === 'new-instance') value.instance = 'replacement-main'
          await f.publish(value)
        }
        const after = f.share()
        assert.equal(f.document.querySelector('#navigator').hasAttribute('data-resizing'), false)
        assert.equal(f.captured.size, 0)
        f.move(1000)
        assert.equal(f.share(), after)
        assert.equal(f.commands.some(command => ['activate', 'drop', 'action', 'sort'].includes(command.type)), false)
      } finally { f.close() }
    })
  }
})

test('pane splitter and existing item drag/horizontal strip panning cannot claim each other', async () => {
  const f = await fixture()
  try {
    const row = f.document.querySelector('[data-row-id="session-a"]')
    const transfer = { effectAllowed: '', setData() {} }
    f.down()
    assert.equal(f.dispatch(row, 'dragstart', { dataTransfer: transfer }).defaultPrevented, true)
    f.dispatch(f.strip, 'pointerdown', { button: 0, pointerType: 'mouse', pointerId: 9, clientX: 200 })
    f.dispatch(f.window, 'pointermove', { pointerId: 9, clientX: 80, clientY: 200 })
    assert.equal(f.strip.scrollLeft, 0)
    f.dispatch(f.window, 'pointerup', { pointerId: 7 })
    f.dispatch(row, 'dragstart', { dataTransfer: transfer })
    assert.equal(row.dataset.dragging, 'true', 'existing HTML5 drag still starts after resizing')
    assert.equal(f.down().defaultPrevented, false, 'item drag owns its gesture')
    f.dispatch(row, 'dragend')
    f.strip.scrollLeft = 40
    f.dispatch(f.strip, 'pointerdown', { button: 0, pointerType: 'mouse', pointerId: 9, clientX: 200 })
    assert.equal(f.down().defaultPrevented, false, 'strip pan owns its gesture')
    f.dispatch(f.window, 'pointermove', { pointerId: 9, clientX: 180 })
    assert.equal(f.strip.scrollLeft, 60)
    f.dispatch(f.window, 'pointerup', { pointerId: 9 })
    assert.equal(f.down().defaultPrevented, true)
    f.move(1000)
    assert.equal(f.share(), 50)
    assert.equal(f.commands.filter(command => command.type === 'drop').length, 0)
  } finally { f.close() }
})

test('pane splitter styling preserves minimum-size ownership, existing typography and scoped touch/selection behavior', () => {
  const css = readFileSync(new URL('../../renderer/workspace-navigator.css', import.meta.url), 'utf8')
  assert.match(css, /#focused \{ flex: var\(--focused-flex, 4 0 0\); min-height: 240px;/)
  assert.match(css, /flex: 1 0 0; min-height: calc\(3 \* var\(--preview-height\) \+ 88px\)/)
  assert.match(css, /#pane-splitter \{[^}]*height: 12px;[^}]*cursor: row-resize; touch-action: none; user-select: none;/)
  assert.match(css, /#pane-splitter:hover::before, #pane-splitter:focus-visible::before/)
  assert.match(css, /\.row\[data-kind="workspace"\], \.row\[data-kind="workspace-group"\], \.row\[data-kind="group"\] \{ font-size: 14px; font-weight: 600; \}/)
})
