// Native DOM/SVG/CSS checks only; physical WebView2 alignment and motion remain user acceptance.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { rendererFixture } from './renderer-fixture.mjs'
import { model } from '../host/fixtures.mjs'

const coordinates = [[0, 0], [4.2, 0], [8.4, 0], [0, 4.2], [4.2, 4.2], [8.4, 4.2]]
const cssText = readFileSync(new URL('../../renderer/workspace-navigator.css', import.meta.url), 'utf8')
function projection() {
  const value = model()
  value.layout.focusedWorkspaceId = 'workspace-a'
  for (const row of value.workspaces[0].rows) row.status = 'ongoing'
  value.workspaces.push({ id: 'workspace-b', label: '其他工作区', title: '其他工作区', activityAt: null, activityKnown: false, matches: true,
    rows: [{ id: 'session-b', kind: 'session', label: '预览会话', title: '预览会话', depth: 0, activityAt: null, activityKnown: false, matches: true, status: 'ongoing' }] })
  return value
}
function update(value, patch = {}) { return { ...structuredClone(value), revision: value.revision + 1, ...patch } }
async function fixture(value = projection()) {
  const f = await rendererFixture(value)
  const style = f.document.createElement('style')
  style.textContent = cssText; f.document.head.append(style)
  return f
}

test('ongoing uses the AgentTeams six-rectangle work glyph in tree, groups and strip previews without a text triangle', async () => {
  const f = await fixture()
  try {
    const icons = [...f.document.querySelectorAll('.status[data-status="ongoing"] > svg')]
    assert.ok(icons.length >= 3)
    assert.ok(f.document.querySelector('.workspace-tree [data-kind="group"] .status svg'))
    assert.ok(f.document.querySelector('.workspace-preview .status svg'))
    for (const icon of icons) {
      assert.equal(icon.namespaceURI, 'http://www.w3.org/2000/svg')
      assert.equal(icon.getAttribute('viewBox'), '0 0 11 6.8')
      assert.equal(icon.getAttribute('preserveAspectRatio'), 'xMidYMid meet')
      assert.equal(icon.getAttribute('fill'), 'currentColor')
      assert.equal(icon.getAttribute('aria-hidden'), 'true')
      assert.equal(icon.getAttribute('focusable'), 'false')
      assert.equal(icon.getAttribute('width'), '11'); assert.equal(icon.getAttribute('height'), '11')
      const dots = [...icon.children]
      assert.equal(dots.length, 6)
      assert.deepEqual(dots.map(dot => [Number(dot.getAttribute('x')), Number(dot.getAttribute('y'))]), coordinates)
      dots.forEach((dot, index) => {
        assert.equal(dot.tagName, 'rect')
        assert.equal(dot.getAttribute('width'), '2.6'); assert.equal(dot.getAttribute('height'), '2.6')
        assert.equal(dot.getAttribute('rx'), '0.6')
        assert.ok(Math.abs(parseFloat(dot.style.animationDelay) - index * .15) < 1e-10)
      })
      assert.equal(icon.parentElement.textContent, '', 'no font-dependent play glyph remains')
      assert.equal(f.window.getComputedStyle(icon.parentElement).placeItems, 'center')
      assert.equal(f.window.getComputedStyle(icon).display, 'block')
      assert.equal(icon.querySelector('circle, path, polygon, image, use, script'), null)
    }
  } finally { f.close() }
})

test('ongoing glyph nodes survive same-status background updates, theme and density changes without restarting their animation', async () => {
  let value = projection()
  const f = await fixture(value)
  try {
    const icons = [...f.document.querySelectorAll('.status-work-glyph')]
    const dots = icons.map(icon => [...icon.children])
    for (const [dark, density] of [[true, 'roomy'], [false, 'compact'], [false, 'comfortable']]) {
      value = update(value, { dark, density })
      value.workspaces[0].rows[1].label = `更新标题:${density}`
      await f.publish(value)
      assert.deepEqual([...f.document.querySelectorAll('.status-work-glyph')], icons)
      icons.forEach((icon, index) => assert.deepEqual([...icon.children], dots[index]))
      assert.equal(f.document.querySelector('[data-row-id="session-a"]').getAttribute('aria-description').includes(value.labels.ongoing), true)
    }
    assert.equal(f.commands.length, 0)
  } finally { f.close() }
})

test('status transitions clear the work glyph and retain original warning/done/absent presentation in every row copy', async () => {
  let value = projection()
  const f = await fixture(value)
  try {
    for (const [status, text] of [['warning', '!'], ['done', '✓'], [undefined, ''], ['ongoing', '']]) {
      value = update(value)
      for (const card of value.workspaces) for (const row of card.rows) {
        if (status === undefined) delete row.status
        else row.status = status
      }
      await f.publish(value)
      for (const marker of f.document.querySelectorAll('.status')) {
        assert.equal(marker.hidden, status === undefined)
        assert.equal(marker.dataset.status, status ?? '')
        assert.equal(marker.textContent, text)
        assert.equal(marker.querySelectorAll('svg').length, status === 'ongoing' ? 1 : 0)
      }
    }
  } finally { f.close() }
})

test('work glyph remains decorative and clicking its rectangles preserves existing tree and preview activation', async t => {
  for (const preview of [false, true]) await t.test(preview ? 'preview' : 'tree', async () => {
    const value = projection()
    if (preview) value.layout.focusedWorkspaceId = 'workspace-b'
    const f = await fixture(value)
    try {
      const selector = `${preview ? '.workspace-preview' : '.workspace-tree'} [data-row-id="session-a"]`
      const row = f.document.querySelector(selector), marker = row.querySelector('.status')
      assert.equal(marker.getAttribute('aria-hidden'), 'true')
      assert.equal(row.getAttribute('aria-description').includes(value.labels.ongoing), true)
      f.dispatch(marker.querySelector('rect'), 'click')
      await f.settle()
      assert.equal(f.commands.at(-1).type, 'activate')
      assert.equal(f.commands.at(-1).id, 'session-a')
      assert.equal(f.commands.some(command => ['action', 'drop', 'sort'].includes(command.type)), false)
    } finally { f.close() }
  })
})

test('work glyph CSS preserves source animation, centered slot, reduced-motion and theme state colors without the old circle', () => {
  const ongoing = cssText.match(/\.status\[data-status="ongoing"\] \{([^}]+)\}/)[1]
  assert.doesNotMatch(ongoing, /border|radius|background/)
  assert.match(cssText, /\.status-work-glyph \{ display: block; width: 11px; height: 11px; \}/)
  assert.match(cssText, /\.status-work-glyph rect \{ opacity: \.5; animation: wn-status-dot 1\.1s ease-in-out infinite; \}/)
  assert.match(cssText, /@keyframes wn-status-dot \{ 0%, 100% \{ opacity: \.25; \} 50% \{ opacity: 1; \} \}/)
  assert.match(cssText, /@media \(prefers-reduced-motion: reduce\) \{ \.status-work-glyph rect \{ animation: none; \} \}/)
  assert.match(cssText, /:root\[data-dark="true"\] \.status\[data-status="ongoing"\] \{ color: #a6baff; \}/)
})

test('work glyph ships with MIT attribution and does not introduce an AgentTeams runtime dependency', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))
  assert.equal(Object.keys({ ...pkg.dependencies, ...pkg.peerDependencies }).some(name => name.includes('agent-teams')), false)
  assert.match(readFileSync(new URL('../../THIRD_PARTY_NOTICES.md', import.meta.url), 'utf8'), /@nanmicoder\/dsh-agent-teams[\s\S]*WorkGlyph[\s\S]*0\.1\.27/)
  assert.match(readFileSync(new URL('../../LICENSE', import.meta.url), 'utf8'), /Copyright \(c\) 2026 程序员阿江\(Relakkes\)/)
})
