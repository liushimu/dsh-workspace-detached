// Component/producer regression only: fake injected bridge, real grouped source and independent protocol. Not a native or Loader acceptance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dshRequire as dependencies, dshDesktopRequire as desktopDependencies, sdkFile } from '../support/dsh-sdk.mjs'
import { fileURLToPath } from 'node:url'
import { rendererFixture } from './renderer-fixture.mjs'
import { NativeSession } from '../../src/host/native-session.js'

const { JSDOM } = dependencies('jsdom')
const React = desktopDependencies('react')
// Load ReactDOM only after jsdom exists so feature detection does not select the IE input polyfill.
let createRoot
const { act } = React
const storeKit = await import(sdkFile('packages/client/store/lib/index.js'))
const artwork = await import(sdkFile('packages/client/ui-primitives/lib/types/icons/index.js'))
const { parseWorkspaceNavigatorModel, isWorkspaceNavigatorIcon } = await import(new URL('../../lib/protocol.js', import.meta.url))
const source = readFileSync(fileURLToPath(new URL('../../src/client.js', import.meta.url)), 'utf8')

function FixtureShell({ Browser, browserProps, onLayout }) {
  React.useLayoutEffect(() => { onLayout() })
  return React.createElement(Browser, browserProps)
}

function createFixture({ persistedView, compactChains = false, strictMode = false } = {}) {
  const dom = new JSDOM('<!doctype html><html><head></head><body><main id="root"></main></body></html>', { url: 'https://fixture.invalid/' })
  const saved = new Map()
  for (const key of ['window', 'document', 'navigator', 'localStorage', 'MutationObserver', 'HTMLElement', 'getComputedStyle', 'IS_REACT_ACT_ENVIRONMENT']) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key))
    const value = key === 'IS_REACT_ACT_ENVIRONMENT' ? true : dom.window[key]
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value })
  }
  dom.window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} })
  const calls = { opens: [], publishes: [], selected: [], business: [], clipboard: [], closes: 0, starts: 0 }
  let listener = null
  const api = {
    protocolVersion: 3,
    open: async model => {
      parseWorkspaceNavigatorModel(model); calls.opens.push(structuredClone(model))
      listener?.({ kind: 'state', state: 'opening' })
    },
    publish: async model => { parseWorkspaceNavigatorModel(model); calls.publishes.push(structuredClone(model)) },
    close: async () => { calls.closes++ }, focus: async () => {},
    subscribe: fn => { listener = fn; return () => { listener = null } },
  }
  let plugin
  dom.window.__ModuleLoader__ = { load: definition => { plugin = definition.factory } }
  const ui = {
    ...artwork,
    Button: ({ children, ...props }) => React.createElement('button', props, children),
    Modal: ({ open, title, children, footer }) => open ? React.createElement('section', { role: 'dialog', 'aria-label': title }, children, footer) : null,
    StateDot: () => React.createElement('span'),
    writeClipboard: async id => { calls.clipboard.push(id); return true },
  }
  const testSource = source.replace('      apply,\n    }\n  },', '      apply,\n      fixture: { BetterBrowser, createViewStore, nativeNavigatorApi, navigationIcon, createSessionMoveProvider, buildTree, compressTree, materializeChain, zh, en },\n    }\n  },')
    // Observe the real hook's existing owner for lifetime assertions, without a production export or mock effect.
    .replace('      const current = owner.current\n', '      const current = owner.current\n      window.__navigatorOwnerForTest = current\n')
  new Function('window', testSource)(dom.window)
  const loaded = plugin(name => ({ react: React, '@deepseek-ai/dsh-client-store': storeKit, '@deepseek-ai/dsh-client-ui-primitives': ui }[name]))
  const { BetterBrowser, createViewStore, nativeNavigatorApi, navigationIcon, createSessionMoveProvider, buildTree, compressTree, materializeChain, zh, en } = loaded.fixture
  if (persistedView !== undefined) dom.window.localStorage.setItem('dsh.workspaceNavigator.view.v1', JSON.stringify(persistedView))
  const view = createViewStore().create()
  view.actions.setWorkspaceGroupMode('disk')
  view.actions.setPref('compactChains', compactChains)
  const items = [
    { workspaceId: 'w1', title: '工作/项目一', path: 'F:/fixture/one', sessionIds: ['s1', 's2'] },
    { workspaceId: 'w2', title: '生活/项目二', path: 'F:/fixture/two', sessionIds: ['s3'] },
  ]
  const sessions = { phase: 'ready', ids: ['s1', 's2', 's3'], byId: {
    s1: { id: 's1', title: '翻译/首章', displayTitle: '翻译/首章', updatedAt: 10, retainedBy: { mainView: 1 } },
    s2: { id: 's2', title: '代码审核', displayTitle: '代码审核', updatedAt: 11 },
    s3: { id: 's3', title: '买菜清单', displayTitle: '买菜清单', updatedAt: 12 },
  } }
  for (const summary of Object.values(sessions.byId)) summary.projectionValues = { workspaceNavigatorActivity: { lastContentAt: summary.updatedAt } }
  const statuses = new Map([['s2', { running: true }]])
  const workspace = { phase: 'ready', state: 'idle', items, archivedSessionIds: [], pinnedSessionIds: [] }
  const useStore = selector => React.useSyncExternalStore(view.subscribe, () => selector(view.getSnapshot()))
  const props = {
    wide: true, expandSidebar() {}, useStore, actions: view.actions,
    useWorkspaces: selector => selector(workspace), useSessions: selector => selector(sessions),
    useSessionStatus: selector => selector(statuses),
    open: id => { calls.selected.push(id) }, startSession: () => { calls.starts++ },
    renameSession: async (id, title) => { calls.business.push(['rename-session', id, title]); sessions.byId = { ...sessions.byId, [id]: { ...sessions.byId[id], title, displayTitle: title } } },
    renameWorkspace: async (id, title) => { calls.business.push(['rename-workspace', id, title]); workspace.items = workspace.items.map(row => row.workspaceId === id ? { ...row, title } : row) },
    forkSession: async id => { calls.business.push(['fork', id]) },
    deleteWorkspace: async id => { calls.business.push(['delete-workspace', id]); workspace.items = workspace.items.filter(row => row.workspaceId !== id) },
    pinSession: async id => { calls.business.push(['pin', id]); workspace.pinnedSessionIds = [...workspace.pinnedSessionIds, id] },
    unpinSession: async id => { calls.business.push(['unpin', id]); workspace.pinnedSessionIds = workspace.pinnedSessionIds.filter(value => value !== id) },
    archiveSession: async (id, options) => { calls.business.push(['archive', id, options]); workspace.archivedSessionIds = [...workspace.archivedSessionIds, id]; workspace.pinnedSessionIds = workspace.pinnedSessionIds.filter(value => value !== id) },
    unarchiveSession: async id => { calls.business.push(['restore', id]); workspace.archivedSessionIds = workspace.archivedSessionIds.filter(value => value !== id) },
    navigatorBridge: api, t: (key, params) => params ? key + ':' + JSON.stringify(params) : key,
  }
  createRoot ||= desktopDependencies('react-dom/client').createRoot
  const renderer = createRoot(dom.window.document.querySelector('#root'))
  let layoutIntent = null
  const render = async () => { await act(async () => {
    const element = React.createElement(FixtureShell, { Browser: BetterBrowser, browserProps: props,
      onLayout: () => { if (layoutIntent) { const event = layoutIntent; layoutIntent = null; listener?.(event) } } })
    renderer.render(strictMode ? React.createElement(React.StrictMode, null, element) : element)
  }) }
  // Leave DOM/store fixtures alive so already-dispatched RPCs can settle after Main leaves.
  const unmountMain = async () => { await act(async () => { renderer.render(null) }) }
  const beforePublication = event => { layoutIntent = event }
  const emit = async event => { await act(async () => { listener?.(event) }) }
  const emitMany = async events => { await act(async () => { for (const event of events) listener?.(event) }) }
  const model = () => calls.publishes.at(-1) || calls.opens.at(-1)
  const rows = () => model().workspaces.flatMap(workspace => workspace.rows)
  const command = async (type, fields = {}) => {
    const current = model()
    await emit({ kind: 'command', command: { type, instance: current.instance, revision: current.revision, commandId: 'cmd-' + Math.random(), ...fields } })
  }
  const cleanup = async () => {
    await act(async () => { renderer.unmount() })
    dom.window.close()
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor)
      else delete globalThis[key]
    }
  }
  return { dom, calls, api, ui, navigatorOwner: () => dom.window.__navigatorOwnerForTest,
    render, emit, emitMany, command, model, rows, cleanup, navigationIcon, view, sessions, workspace, props, beforePublication, createSessionMoveProvider, buildTree, compressTree, materializeChain, unmountMain, locales: { zh, en } }
}

test('Main typography separates default containers/groups from sessions without masking explicit appearance', async () => {
  const f = createFixture()
  try {
    f.view.actions.setSessionGroupExpanded('w1|翻译', true)
    await f.render()
    const document = f.dom.window.document
    const styleOf = element => f.dom.window.getComputedStyle(element)
    for (const density of ['comfortable', 'compact', 'roomy']) {
      await act(async () => { f.view.actions.setPref('density', density) })
      for (const selector of ['.wn-container-row', '.wn-sgroup-row', '.wn-session-row']) {
        const rows = [...document.querySelectorAll(selector)]
        assert.ok(rows.length, `fixture must render ${selector}`)
        for (const row of rows) {
          assert.equal(styleOf(row).fontSize, selector === '.wn-session-row' ? '13px' : '14px', `${density} ${selector}`)
          assert.equal(styleOf(row).fontWeight, selector === '.wn-session-row' ? '400' : '600', `${density} ${selector}`)
        }
      }
    }
    const custom = { color: '#123abc', weight: 500, glow: 2, shadow: true, stroke: true, strokeWidth: 1, strokeColor: '#808080' }
    await act(async () => {
      f.view.actions.setStyling('sgroup:w1|翻译', custom)
      f.view.actions.setStyling('session:s1', { ...custom, weight: 700 })
    })
    const group = [...document.querySelectorAll('.wn-sgroup-row')].find(row => row.querySelector('.wn-row-label')?.textContent === '翻译')
    const session = document.querySelector('.wn-session-row[data-row-key="s1"]')
    assert.ok(group); assert.ok(session)
    assert.equal(styleOf(group).fontWeight, '500')
    assert.equal(styleOf(session).fontWeight, '700')
    for (const row of [group, session]) {
      assert.equal(styleOf(row).color, 'rgb(18, 58, 188)')
      assert.match(styleOf(row).textShadow, /0 0 2px #123abc/)
    }
    assert.equal(styleOf(group).fontSize, '14px')
    assert.equal(styleOf(session).fontSize, '13px')
    await act(async () => {
      f.view.actions.setStyling('sgroup:w1|翻译', null)
      f.view.actions.setStyling('session:s1', null)
    })
    assert.equal(styleOf(group).fontWeight, '600')
    assert.equal(styleOf(session).fontWeight, '400')
    assert.equal(group.style.textShadow, '')
    assert.equal(session.style.textShadow, '')
  } finally { await f.cleanup() }
})

test('first open and re-admission hold publication until Host opening, then flush the latest draft', async () => {
  const f = createFixture()
  let admitted = false, finishOpen
  f.api.open = model => {
    parseWorkspaceNavigatorModel(model)
    f.calls.opens.push(structuredClone(model))
    return new Promise(resolve => { finishOpen = resolve })
  }
  f.api.publish = async model => {
    if (!admitted) throw new Error('Host window has not been admitted: closed')
    parseWorkspaceNavigatorModel(model)
    f.calls.publishes.push(structuredClone(model))
  }
  try {
    await f.render()
    for (const title of ['翻译/冷启动期间的新标题', '翻译/重新准入期间的新标题']) {
      admitted = false
      const before = f.calls.publishes.length
      await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
      f.sessions.byId.s1.title = f.sessions.byId.s1.displayTitle = title
      await f.render()
      assert.equal(f.calls.publishes.length, before, 'local loading is not Host window admission')
      assert.equal(f.calls.closes, 0, 'an early publication must not cancel the pending open')
      assert.equal(f.dom.window.document.querySelector('.wn-tree').hidden, false)
      admitted = true
      await f.emit({ kind: 'state', state: 'opening' })
      assert.equal(f.calls.publishes.length, before + 1, 'Host admission flushes even an already-committed draft')
      assert.equal(f.rows().find(row => row.id === 'session:s1').title, title)
      await act(async () => { finishOpen() })
      await f.emit({ kind: 'state', state: 'detached' })
      assert.equal(f.dom.window.document.querySelector('.wn-tree').hidden, true)
      assert.equal(f.calls.starts, 0)
      await f.emit({ kind: 'state', state: 'closed' })
    }
    assert.equal(f.calls.opens.length, 2)
    assert.equal(f.calls.closes, 0)
  } finally { finishOpen?.(); await f.cleanup() }
})

test('retained opening retry flushes a changed draft on detached without a second opening event', async () => {
  const f = createFixture()
  const pending = []
  f.api.open = model => {
    parseWorkspaceNavigatorModel(model)
    f.calls.opens.push(structuredClone(model))
    return new Promise((resolve, reject) => { pending.push({ resolve, reject }) })
  }
  try {
    await f.render()
    await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
    await f.emit({ kind: 'state', state: 'opening' })
    await f.emit({ kind: 'state', state: 'error' })
    await act(async () => { pending[0].reject(new Error('retired events carrier')) })
    assert.equal(f.calls.closes, 0, 'transport failure preserves the original opening helper')
    await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
    const before = f.calls.publishes.length
    const title = '翻译/重试后完整草稿'
    f.sessions.byId.s1.title = f.sessions.byId.s1.displayTitle = title
    await f.render()
    assert.equal(f.calls.publishes.length, before)
    assert.equal(f.calls.opens.length, 2)
    assert.equal(f.dom.window.document.querySelector('.wn-tree').hidden, false)
    // The same Host is still opening: reopen joins it and does not emit opening again.
    await f.emit({ kind: 'state', state: 'detached' })
    await act(async () => { pending[1].resolve() })
    assert.equal(f.calls.publishes.length, before + 1)
    assert.equal(f.rows().find(row => row.id === 'session:s1').title, title)
    await f.command('activate', { id: 'session:s2' })
    assert.deepEqual(f.calls.selected, ['s2'], 'the fresh cut remains actionable after retry')
    assert.equal(f.calls.closes, 0)
    assert.equal(f.calls.starts, 0)
  } finally { for (const operation of pending) operation.resolve(); await f.cleanup() }
})

test('native model shares original tree grouping, action and close lifecycle', async () => {
  const f = createFixture()
  try {
    await f.render()
    const pop = f.dom.window.document.querySelector('[aria-label="navigator.open"]')
    assert.ok(pop, 'patched shell exposes pop-out control')
    await act(async () => { pop.click() })
    assert.equal(f.calls.opens.length, 1)
    const initial = f.model()
    assert.equal(initial.version, 3)
    assert.deepEqual(initial.workspaces.map(workspace => workspace.id), ['workspace:w2', 'workspace:w1'])
    assert.deepEqual(f.rows().map(row => row.kind), ['session', 'session', 'group', 'session'])
    assert.equal(f.rows().find(row => row.id === 'session:s2').status, 'ongoing')
    assert.equal(f.rows().find(row => row.id === 'session:s2').title, '代码审核')
    assert.ok(initial.workspaces.find(workspace => workspace.id === 'workspace:w1').icon.startsWith('<svg'))
    assert.equal(f.rows().find(row => row.id === 'session:s1').selected, true)
    assert.equal(initial.connected, true)
    assert.equal(f.dom.window.document.querySelector('.wn-tree').hidden, false, 'keep original available until ready')
    await f.emit({ kind: 'state', state: 'detached' })
    assert.equal(f.dom.window.document.querySelector('.wn-tree').hidden, true)
    await f.command('activate', { id: 'session:s2' })
    assert.deepEqual(f.calls.selected, ['s2'])
    assert.equal(f.calls.starts, 0)
    await f.command('search', { query: '代码' })
    assert.equal(f.model().query, '代码')
    assert.deepEqual(f.rows().filter(row => row.kind === 'session' && row.matches).map(row => row.id), ['session:s2'])
    assert.equal(f.model().layout.focusedWorkspaceId, 'workspace:w1')
    await f.command('search', { query: '' })
    assert.equal(f.rows().length, initial.workspaces.flatMap(workspace => workspace.rows).length)
    await f.emit({ kind: 'state', state: 'closed' })
    assert.equal(f.dom.window.document.querySelector('.wn-tree').hidden, false)
  } finally { await f.cleanup() }
})

test('native actions reject stale revisions, duplicates, archived ids and unknown commands', async () => {
  const f = createFixture()
  try {
    await f.render()
    await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
    await f.emit({ kind: 'state', state: 'detached' })
    const m = f.model()
    const cmd = { type: 'activate', id: 'session:s2', instance: m.instance, revision: m.revision, commandId: 'exactly-once' }
    await f.emit({ kind: 'command', command: { ...cmd, revision: m.revision - 1 } })
    await f.emit({ kind: 'command', command: { ...cmd, instance: 'other' } })
    await f.emit({ kind: 'command', command: { ...cmd, type: 'delete' } })
    assert.equal(f.calls.selected.length, 0)
    assert.equal(f.dom.window.document.querySelector('.wn-tree').hidden, true, 'stale intent does not close the admitted navigator')
    assert.equal(f.calls.closes, 0)
    await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
    await f.emit({ kind: 'state', state: 'detached' })
    const valid = { ...cmd, revision: f.model().revision, commandId: 'valid' }
    await f.emit({ kind: 'command', command: valid })
    await f.emit({ kind: 'command', command: valid })
    assert.deepEqual(f.calls.selected, ['s2'])
    await f.command('activate', { id: 'session:missing' })
    assert.deepEqual(f.calls.selected, ['s2'])
  } finally { await f.cleanup() }
})

test('workspace/session folds, search restoration, styles and archive disabling use the original owners', async () => {
  const f = createFixture()
  try {
    f.view.actions.setStyling('session:s2', { color: '#aabbcc', weight: 700, glow: 2, shadow: true, stroke: true, strokeWidth: 1, strokeColor: '#808080' })
    f.view.actions.setStyling('session:s1', { stroke: true, strokeColor: 'auto' })
    f.view.actions.setArchivedFilter('show')
    f.workspace.archivedSessionIds = ['s3']
    await f.render()
    await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
    await f.emit({ kind: 'state', state: 'detached' })
    assert.equal(f.rows().find(row => row.id === 'session:s3').disabled, true)
    await f.command('activate', { id: 'session:s3' })
    assert.equal(f.calls.selected.length, 0)
    await f.command('drop', { id: 'session:s3', targetId: 'workspace:w2', position: 'inside' })
    assert.equal(f.model().operation.status, 'error', 'archived rows remain non-draggable even for forged admitted intent')
    assert.equal(f.calls.business.length, 0)
    assert.match(f.rows().find(row => row.id === 'session:s1').style.WebkitTextStrokeColor, /^#[0-9a-f]{6}$/i)
    const style = f.rows().find(row => row.id === 'session:s2').style
    assert.equal(style.color, '#aabbcc')
    assert.equal(style.fontWeight, 700)
    assert.equal(style.WebkitTextStrokeWidth, '2px')
    assert.match(style.textShadow, /rgba/)
    const before = f.dom.window.document.querySelector('.wn-tree').textContent
    await f.command('layout', { layout: { ...f.model().layout, focusedWorkspaceId: 'workspace:w1', collapsedGroups: ['sgroup:w1|翻译'] } })
    assert.equal(f.calls.selected.length, 0, 'focusing a card does not open any conversation')
    assert.equal(f.model().layout.focusedWorkspaceId, 'workspace:w1')
    assert.equal(f.rows().find(row => row.id === 'sgroup:w1|翻译').expanded, false)
    assert.equal(f.rows().some(row => row.id === 'session:s1'), true, 'complete projection retains collapsed descendants')
    await f.command('search', { query: '代码' })
    assert.equal(f.rows().find(row => row.id === 'session:s2').matches, true)
    assert.equal(f.rows().find(row => row.id === 'session:s1').matches, false)
    await f.command('search', { query: '' })
    assert.equal(f.rows().find(row => row.id === 'sgroup:w1|翻译').expanded, false, 'clear preserves navigator collapse')
    assert.equal(f.view.getSnapshot().sessionGroups['w1|翻译'], undefined, 'navigator folds do not write main sidebar folds')
    assert.equal(f.dom.window.document.querySelector('.wn-tree').textContent, before, 'navigator filtering does not change the hidden sidebar')
  } finally { await f.cleanup() }
})

test('native lifetime keeps hooks stable across rail mode and recovers failed open and disconnect', async () => {
  const f = createFixture()
  try {
    await f.render()
    f.api.open = async () => { throw new Error('load failed') }
    await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
    assert.equal(f.dom.window.document.querySelector('.wn-tree').hidden, false)
    assert.ok(f.dom.window.document.querySelector('[role="alert"]'))
    f.api.open = async value => { parseWorkspaceNavigatorModel(value); f.calls.opens.push(structuredClone(value)) }
    await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
    await f.emit({ kind: 'state', state: 'detached' })
    f.props.wide = false
    await f.render()
    f.props.wide = true
    await f.render()
    assert.equal(f.dom.window.document.querySelector('.wn-tree').hidden, true)
    const rows = f.rows()
    f.workspace.state = 'loading'
    await f.render()
    assert.equal(f.model().connected, false)
    assert.deepEqual(f.rows(), rows)
    await f.command('activate', { id: 'session:s2' })
    assert.equal(f.calls.selected.length, 0)
    assert.equal(f.dom.window.document.querySelector('.wn-tree').hidden, true)
    f.workspace.state = 'idle'
    await f.render()
    assert.equal(f.model().connected, true)
    await f.command('activate', { id: 'session:s2' })
    assert.deepEqual(f.calls.selected, ['s2'])
    await f.command('return')
    assert.equal(f.dom.window.document.querySelector('.wn-tree').hidden, false)
    assert.ok(f.calls.closes > 0)
  } finally { await f.cleanup() }
})

test('R5 close intent revokes publication until terminal closure, then reopens the latest draft', async t => {
  for (const origin of ['native-return', 'Main-return']) for (const terminal of ['close-rpc', 'closed-event']) {
    await t.test(`${origin}; ${terminal}`, async () => {
      const f = createFixture(), pending = Promise.withResolvers(), publications = []
      let closing = false
      const publish = f.api.publish
      f.api.close = () => { f.calls.closes++; closing = true; return pending.promise }
      f.api.publish = async model => {
        publications.push(model)
        if (closing) throw Object.assign(new Error('Host is closing'), { code: 'workspace-navigator/closed' })
        return publish(model)
      }
      try {
        await detach(f)
        const cut = f.model(), before = publications.length, storedLayout = structuredClone(f.view.getSnapshot().navigatorLayout)
        const command = (type, fields = {}) => ({ kind: 'command', command: { type, instance: cut.instance, revision: cut.revision, commandId: 'closing-' + type, ...fields } })
        if (origin === 'native-return') await f.emitMany([command('return'), command('return', { commandId: 'repeat-return' })])
        else {
          const button = [...f.dom.window.document.querySelectorAll('.wn-navigation-controls button')].find(node => node.textContent === 'navigator.return')
          await act(async () => { button.click(); button.click() })
        }
        assert.equal(f.calls.closes, 1, 'same-batch returns issue only one close RPC')
        assert.equal(f.dom.window.document.querySelector('.wn-tree').hidden, false, 'Main tree returns before physical closure')
        assert.equal(f.dom.window.document.querySelector('.wn-header').hidden, false)
        assert.equal(f.dom.window.document.querySelector('[aria-label="navigator.open"]').disabled, true, 'closing is not yet closed or eligible to reopen')
        assert.equal(f.dom.window.document.querySelector('.wn-navigation-controls [role="status"]').textContent, 'navigator.pending')
        assert.equal(f.dom.window.document.querySelector('[aria-label="navigator.focus"]'), null)
        assert.equal(f.dom.window.document.querySelector('[role="alert"]'), null)
        await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
        assert.equal(f.calls.opens.length, 1, 'disabled closing control cannot enqueue another open')
        await f.emitMany([{ kind: 'state', state: 'opening' }, { kind: 'state', state: 'detached' },
          command('layout', { layout: { ...cut.layout, focusedWorkspaceId: 'workspace:w1' } }),
          command('search', { query: 'ignored while closing' }), command('activate', { id: 'session:s2' }),
          command('return', { commandId: 'late-return' })])
        assert.equal(f.dom.window.document.querySelector('.wn-tree').hidden, false, 'late admission must not hide the recovered Main tree')
        assert.deepEqual(f.view.getSnapshot().navigatorLayout, storedLayout, 'late Native layout intent has no admission')
        assert.deepEqual(f.calls.selected, [])
        assert.equal(f.calls.closes, 1)
        f.workspace.state = 'loading'
        await f.render()
        assert.equal(publications.length, before, 'a loading draft cannot publish into Host closing')
        f.workspace.state = 'idle'
        f.workspace.items = f.workspace.items.map(row => row.workspaceId === 'w1' ? { ...row, title: '工作/收回期间的新工作区' } : row)
        f.sessions.byId.s2 = { ...f.sessions.byId.s2, title: '收回期间的新会话', displayTitle: '收回期间的新会话' }
        const layout = { focusedWorkspaceId: 'workspace:w1', collapsedGroups: ['sgroup:w1|翻译'], scrolls: [{ id: 'overview', top: 73 }] }
        await act(async () => { f.view.actions.setNavigatorLayout(layout) })
        await f.render()
        assert.equal(publications.length, before, 'workspace, session and Main layout drafts stay local throughout closing')
        assert.equal(f.calls.closes, 1, 'no rejected closing publish may trigger a second cleanup')
        assert.equal(f.dom.window.document.querySelector('[aria-label="navigator.open"]').disabled, true)
        assert.equal(f.dom.window.document.querySelector('[role="alert"]'), null)
        closing = false
        if (terminal === 'closed-event') await f.emit({ kind: 'state', state: 'closed' })
        else await act(async () => { pending.resolve() })
        assert.equal(f.dom.window.document.querySelector('[aria-label="navigator.open"]').disabled, false, 'a true terminal outcome permits reopen')
        assert.equal(f.dom.window.document.querySelector('.wn-navigation-controls [role="status"]'), null)
        await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
        const reopened = f.calls.opens.at(-1)
        assert.equal(reopened.workspaces.find(card => card.id === 'workspace:w1').label, '工作/收回期间的新工作区')
        assert.equal(reopened.workspaces.flatMap(card => card.rows).find(row => row.id === 'session:s2').title, '收回期间的新会话')
        assert.equal(reopened.query, '', 'ignored late search cannot alter the reopened model')
        assert.equal(reopened.connected, true)
        assert.deepEqual(reopened.layout, layout)
        assert.equal(publications.length, before + 1, 're-admission flushes the latest local model normally')
        await f.emit({ kind: 'state', state: 'detached' })
        await act(async () => { pending.resolve() })
        assert.equal(f.dom.window.document.querySelector('.wn-tree').hidden, true, 'late old close settlement cannot undo reopen')
        f.sessions.byId.s2 = { ...f.sessions.byId.s2, title: '重新打开后正常发布', displayTitle: '重新打开后正常发布' }
        await f.render()
        assert.equal(publications.length, before + 2)
        assert.equal(f.rows().find(row => row.id === 'session:s2').title, '重新打开后正常发布')
        assert.equal(f.dom.window.document.querySelector('[role="alert"]'), null)
      } finally { await act(async () => { pending.resolve() }); await f.cleanup() }
    })
  }
})

test('R5 immediate Main and Native return remain idempotent and allow normal reopen', async t => {
  for (const origin of ['native-return', 'Main-return']) await t.test(origin, async () => {
    const f = createFixture()
    try {
      await detach(f)
      if (origin === 'native-return') {
        const cut = f.model()
        await f.emitMany(['first-return', 'second-return'].map(commandId => ({ kind: 'command', command: {
          type: 'return', instance: cut.instance, revision: cut.revision, commandId,
        } })))
      } else {
        const button = [...f.dom.window.document.querySelectorAll('.wn-navigation-controls button')].find(node => node.textContent === 'navigator.return')
        await act(async () => { button.click(); button.click() })
      }
      assert.equal(f.calls.closes, 1)
      assert.equal(f.dom.window.document.querySelector('.wn-tree').hidden, false)
      assert.equal(f.dom.window.document.querySelector('[aria-label="navigator.open"]').disabled, false)
      assert.equal(f.dom.window.document.querySelector('[role="alert"]'), null)
      await detach(f)
      assert.equal(f.calls.opens.length, 2)
      assert.equal(f.dom.window.document.querySelector('.wn-tree').hidden, true)
    } finally { await f.cleanup() }
  })
})

test('R5 close RPC rejection and Host error remain truthful failures', async t => {
  for (const failure of ['rpc-closed', 'rpc-cleanup', 'host-error']) await t.test(failure, async () => {
    const f = createFixture(), pending = Promise.withResolvers()
    f.api.close = () => { f.calls.closes++; return f.calls.closes === 1 ? pending.promise : Promise.resolve() }
    try {
      await detach(f)
      await f.command('return')
      assert.equal(f.dom.window.document.querySelector('[aria-label="navigator.open"]').disabled, true)
      if (failure === 'host-error') {
        await f.emit({ kind: 'state', state: 'error', code: 'workspace-navigator/helper-error' })
        await act(async () => { pending.resolve() })
      } else await act(async () => {
        pending.reject(Object.assign(new Error('close failed'), { code: failure === 'rpc-closed' ? 'workspace-navigator/closed' : 'workspace-navigator/cleanup-failed' }))
      })
      assert.equal(f.dom.window.document.querySelector('[role="alert"]').textContent, 'navigator.error', 'even a genuine close RPC closed-code rejection is not globally suppressed')
      assert.equal(f.dom.window.document.querySelector('.wn-tree').hidden, false)
      await f.emit({ kind: 'state', state: 'closed' })
      f.workspace.state = 'loading'
      await f.render()
      assert.equal(f.dom.window.document.querySelector('[role="alert"]').textContent, 'navigator.error', 'closed or a later draft must not erase a genuine error')
      f.workspace.state = 'idle'
      await f.render()
      await detach(f)
      assert.equal(f.dom.window.document.querySelector('[role="alert"]'), null, 'only an explicit new open resets the displayed error')
    } finally { await act(async () => { pending.resolve() }); await f.cleanup() }
  })
})

test('R5 a refresh from Main business settlement stays local during deferred return', async t => {
  for (const rejected of [false, true]) await t.test(`rejected=${rejected}`, async () => {
    const f = createFixture(), close = Promise.withResolvers(), business = Promise.withResolvers(), publications = []
    let closing = false
    const publish = f.api.publish
    f.api.close = () => { f.calls.closes++; closing = true; return close.promise }
    f.api.publish = async model => {
      publications.push(model)
      if (closing) throw Object.assign(new Error('Host is closing'), { code: 'workspace-navigator/closed' })
      return publish(model)
    }
    f.props.forkSession = id => { f.calls.business.push(['fork', id]); return business.promise }
    try {
      await detach(f)
      await menuAction(f, 'session:s1', 'fork')
      const operation = f.model().operation, before = publications.length
      assert.equal(operation.status, 'pending')
      await f.command('return')
      await act(async () => { if (rejected) business.reject(new Error('deferred fork refused')); else business.resolve() })
      assert.equal(publications.length, before, 'known business completion requests refresh without publishing during closing')
      assert.equal(f.calls.closes, 1)
      assert.equal(f.dom.window.document.querySelector('[aria-label="navigator.open"]').disabled, true)
      assert.equal(f.dom.window.document.querySelector('[role="alert"]'), null, 'business refusal is not a Native transport error')
      closing = false
      await act(async () => { close.resolve() })
      await detach(f)
      assert.equal(f.model().operation.id, operation.id)
      assert.equal(f.model().operation.status, rejected ? 'error' : 'success', 'Main business promises still settle independently of the Native epoch')
      if (rejected) assert.match(f.model().operation.message, /deferred fork refused/)
      assert.deepEqual(f.calls.business, [['fork', 's1']], 'return/reopen never replays the issued operation')
    } finally { await act(async () => { business.resolve(); close.resolve() }); await f.cleanup() }
  })
})

test('admitted same-instance search settles safely across a newer unpublished projection', async () => {
  const f = createFixture()
  try {
    await f.render()
    await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
    await f.emit({ kind: 'state', state: 'detached' })
    const m = f.model()
    f.workspace.items = f.workspace.items.map(row => row.workspaceId === 'w1' ? { ...row, title: '工作/新名字' } : row)
    f.beforePublication({ kind: 'command', command: { type: 'search', query: '代码', instance: m.instance, revision: m.revision, commandId: 'search-in-flight' } })
    await f.render()
    assert.equal(f.model().query, '代码')
    assert.equal(f.rows().filter(row => row.kind === 'session' && row.matches).length, 1)
  } finally { await f.cleanup() }
})

test('latest rendered archive state blocks old intent before passive publication', async () => {
  const f = createFixture()
  try {
    await f.render()
    await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
    await f.emit({ kind: 'state', state: 'detached' })
    const m = f.model()
    f.workspace.archivedSessionIds = ['s2']
    f.beforePublication({ kind: 'command', command: { type: 'activate', id: 'session:s2', instance: m.instance, revision: m.revision, commandId: 'between-render-and-effect' } })
    await f.render()
    assert.equal(f.calls.selected.length, 0)
    assert.equal(f.calls.closes, 0)
    assert.equal(f.dom.window.document.querySelector('.wn-tree').hidden, true)
    assert.equal(f.model().operation.status, 'error')
    assert.match(f.model().operation.message, /stale-revision/)
  } finally { await f.cleanup() }
})

test('rejected publication closes the stale native window and disables late intent while restoring sidebar', async () => {
  const f = createFixture()
  try {
    await f.render()
    await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
    await f.emit({ kind: 'state', state: 'detached' })
    let rejected
    f.api.publish = async value => { rejected = value; throw new Error('oversize publication') }
    await act(async () => { f.view.actions.setStyling('session:s2', { color: '#aabbcc' }) })
    assert.ok(f.calls.closes > 0)
    assert.equal(f.dom.window.document.querySelector('.wn-tree').hidden, false)
    await f.emit({ kind: 'command', command: { type: 'activate', id: 'session:s2', instance: rejected.instance, revision: rejected.revision, commandId: 'late' } })
    assert.equal(f.calls.selected.length, 0)
  } finally { await f.cleanup() }
})

test('late old publication failure cannot close a newly detached window', async () => {
  const f = createFixture()
  try {
    await f.render()
    await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
    await f.emit({ kind: 'state', state: 'detached' })
    const old = Promise.withResolvers()
    f.api.publish = () => old.promise
    await act(async () => { f.view.actions.setStyling('session:s2', { color: '#aabbcc' }) })
    await f.emit({ kind: 'state', state: 'closed' })
    f.api.publish = async value => { parseWorkspaceNavigatorModel(value); f.calls.publishes.push(structuredClone(value)) }
    await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
    await f.emit({ kind: 'state', state: 'detached' })
    const closes = f.calls.closes
    await act(async () => { old.reject(new Error('previous lifecycle failed')) })
    assert.equal(f.calls.closes, closes)
    assert.equal(f.dom.window.document.querySelector('.wn-tree').hidden, true)
  } finally { await f.cleanup() }
})

test('native state stays current after title and status changes without allocating sessions', async () => {
  const f = createFixture()
  try {
    await f.render()
    await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
    const before = f.model().revision
    f.sessions.byId = { ...f.sessions.byId, s2: { ...f.sessions.byId.s2, title: '修订后的标题', displayTitle: '修订后的标题' } }
    await f.render()
    assert.ok(f.model().revision > before)
    assert.equal(f.rows().find(row => row.id === 'session:s2').label, '修订后的标题')
    assert.equal(f.calls.starts, 0)
  } finally { await f.cleanup() }
})

test('navigator keeps complete plugin grouping independently of sidebar grouping and manual ordering', async () => {
  const f = createFixture()
  try {
    f.view.actions.setGroupBy('flat')
    await f.render()
    await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
    const cards = structuredClone(f.model().workspaces)
    assert.equal(f.model().workspaces.length, 2)
    assert.ok(f.rows().some(row => row.id === 'sgroup:w1|翻译'))
    await act(async () => { f.view.actions.setGroupBy('workspace') })
    assert.deepEqual(f.model().workspaces, cards)
    assert.equal(new Set(f.rows().map(row => row.id)).size, f.rows().length)
    await act(async () => { f.view.actions.setSessionTitleSlash(false) })
    assert.equal(f.rows().some(row => row.kind === 'group'), false)
    assert.equal(f.rows().find(row => row.id === 'session:s1').label, '翻译/首章')
  } finally { await f.cleanup() }
})

test('source density/count/language and hook-bearing mask artwork project without breaking the original browser', async () => {
  const f = createFixture()
  try {
    f.view.actions.setStyling('workspace:w1', { icon: 'IconArchiveOffOutlineRegular' })
    f.view.actions.setPref('density', 'compact')
    f.dom.window.document.documentElement.lang = 'ar'
    f.dom.window.document.documentElement.style.direction = 'rtl'
    await f.render()
    await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
    assert.ok(f.dom.window.document.querySelector('.wn-tree'))
    assert.equal(f.model().density, 'compact')
    assert.equal(f.model().lang, 'ar')
    assert.equal(f.model().direction, 'rtl')
    assert.equal(f.rows().some(row => Object.hasOwn(row, 'count')), false)
    assert.match(f.model().workspaces.find(workspace => workspace.id === 'workspace:w1').icon, /<mask /)
    await act(async () => { f.view.actions.setPref('showCount', true); f.view.actions.setStyling('workspace:w1', { icon: 'solid' }) })
    assert.ok(f.rows().find(row => row.kind === 'group').count > 0)
    assert.ok(f.model().workspaces.find(workspace => workspace.id === 'workspace:w1').icon)
  } finally { await f.cleanup() }
})

test('complete navigator trees bypass sidebar collapse and quota without changing its preferences', async () => {
  const f = createFixture()
  try {
    f.view.actions.setPref('sessionLimit', 5)
    f.view.actions.setSessionsExpanded('w1', false)
    f.view.actions.setSessionGroupExpanded('w1|部门', false)
    f.view.actions.addFolder('session', 'w1', '空/子组')
    const extra = Array.from({ length: 24 }, (_, index) => 'extra-' + index)
    f.workspace.items = f.workspace.items.map(workspace => workspace.workspaceId === 'w1'
      ? { ...workspace, sessionIds: [...workspace.sessionIds, ...extra] } : workspace)
    f.sessions.ids.push(...extra)
    for (const [index, id] of extra.entries()) f.sessions.byId[id] = { id, title: '部门/组' + index % 3 + '/会话' + index,
      displayTitle: id, updatedAt: 0, projectionValues: { workspaceNavigatorActivity: { lastContentAt: 100 + index } } }
    await f.render()
    await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
    const card = f.model().workspaces.find(workspace => workspace.id === 'workspace:w1')
    assert.equal(card.rows.filter(row => row.kind === 'session').length, 26)
    assert.equal(card.rows.find(row => row.id === 'sgroup:w1|部门').expanded, false)
    assert.ok(card.rows.some(row => row.id === 'sgroup:w1|空/子组'), 'declared empty nested groups survive')
    assert.equal(card.activityAt, 123)
    assert.equal(card.rows.some(row => row.kind === 'more'), false)
    assert.equal(f.view.getSnapshot().prefs.sessionLimit, 5)
    assert.equal(f.view.getSnapshot().sessionsExpanded.w1, false)
    assert.equal(f.view.getSnapshot().sessionGroups['w1|部门'], false)
    await f.emit({ kind: 'state', state: 'detached' })
    await f.command('activate', { id: 'session:extra-23' })
    assert.deepEqual(f.calls.selected, ['extra-23'], 'quota-hidden and collapsed descendants keep their canonical action')
    assert.equal(f.calls.starts, 0)
  } finally { await f.cleanup() }
})

test('content activity mixes groups with leaves, ignores pin priority, and accepts reply-only activity', async () => {
  const f = createFixture()
  try {
    f.sessions.byId.s1.title = '旧组/旧会话'
    f.sessions.byId.s2.projectionValues = { workspaceNavigatorActivity: { lastContentAt: 100 } }
    f.workspace.pinnedSessionIds = ['s1']
    const registryOrder = f.workspace.items.map(workspace => [...workspace.sessionIds])
    await f.render()
    await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
    let card = f.model().workspaces.find(workspace => workspace.id === 'workspace:w1')
    assert.equal(card.rows[0].id, 'session:s2', 'new direct leaf precedes an older group')
    assert.equal(card.rows.find(row => row.id === 'session:s1').pinned, true)
    const oldPromptTime = f.sessions.byId.s1.updatedAt
    f.sessions.byId.s1.projectionValues = { workspaceNavigatorActivity: { lastContentAt: 200 } }
    await f.render()
    card = f.model().workspaces[0]
    assert.equal(card.id, 'workspace:w1')
    assert.equal(card.rows[0].id, 'sgroup:w1|旧组')
    assert.equal(card.rows[0].activityAt, 200)
    assert.equal(card.activityAt, 200)
    assert.equal(f.sessions.byId.s1.updatedAt, oldPromptTime, 'new reply projection does not alter legacy prompt recency')
    assert.deepEqual(f.workspace.items.map(workspace => workspace.sessionIds), registryOrder)
    assert.equal(f.view.getSnapshot().orderBy, 'manual')
  } finally { await f.cleanup() }
})

test('missing historical content is explicit unknown while projected empty content is known null', async () => {
  const f = createFixture()
  try {
    delete f.sessions.byId.s2.projectionValues
    f.sessions.byId.s2.updatedAt = 9999999999
    f.sessions.byId.s3.projectionValues = { workspaceNavigatorActivity: { lastContentAt: null } }
    await f.render()
    await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
    const unknown = f.rows().find(row => row.id === 'session:s2')
    const empty = f.rows().find(row => row.id === 'session:s3')
    assert.equal(unknown.activityAt, null)
    assert.equal(unknown.activityKnown, false)
    assert.equal(empty.activityAt, null)
    assert.equal(empty.activityKnown, true)
    assert.equal(f.model().workspaces.find(workspace => workspace.id === 'workspace:w1').activityAt, 10)
    assert.equal(f.model().workspaces.find(workspace => workspace.id === 'workspace:w1').activityKnown, false)
    assert.ok(f.model().labels.activityUnavailable)
  } finally { await f.cleanup() }
})

test('disk-nested workspaces share a branch but keep real identities and the plugin title parser', async () => {
  const f = createFixture()
  try {
    f.view.actions.setWorkspaceGroupMode('disk')
    f.workspace.items = f.workspace.items.map(workspace => workspace.workspaceId === 'w2' ? { ...workspace, path: 'F:/fixture/one/child' } : workspace)
    f.sessions.byId.s1.title = '资料/“路径/保留”'
    f.sessions.byId.s2.title = '资料/https://example.test/a/b'
    await f.render()
    await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
    const parent = f.model().workspaces.find(workspace => workspace.id === 'workspace:w1')
    const child = parent.rows.find(row => row.id === 'workspace:w2')
    assert.equal(f.model().workspaces.length, 1)
    assert.equal(child.kind, 'workspace')
    assert.equal(parent.rows.find(row => row.id === 'session:s3').workspaceId, 'w2')
    assert.equal(parent.rows.find(row => row.id === 'session:s3').depth, child.depth + 1)
    assert.deepEqual(f.workspace.items.find(workspace => workspace.workspaceId === 'w1').sessionIds, ['s1', 's2'])
    assert.deepEqual(parent.rows.filter(row => row.kind === 'group').map(row => row.title), ['资料'])
    assert.equal(parent.rows.find(row => row.id === 'session:s1').label, '“路径/保留”')
    assert.equal(parent.rows.find(row => row.id === 'session:s2').label, 'https://example.test/a/b')
  } finally { await f.cleanup() }
})

test('navigator preferences survive reopen and an absent focused workspace projects the overview', async () => {
  const f = createFixture()
  try {
    await f.render()
    await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
    await f.emit({ kind: 'state', state: 'detached' })
    const layout = { focusedWorkspaceId: 'workspace:w1', collapsedGroups: ['sgroup:w1|翻译'],
      scrolls: [{ id: 'overview', top: 45 }, { id: 'workspace:w1', top: 100 }, { id: 'strip', top: 20 }] }
    await f.command('layout', { layout })
    assert.deepEqual(f.view.getSnapshot().navigatorLayout, layout)
    await f.emit({ kind: 'state', state: 'closed' })
    await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
    assert.deepEqual(f.calls.opens.at(-1).layout, layout)
    f.workspace.items = f.workspace.items.filter(workspace => workspace.workspaceId !== 'w1')
    await f.render()
    assert.equal(f.model().layout.focusedWorkspaceId, null)
    assert.deepEqual(f.model().layout.collapsedGroups, [])
    assert.equal(f.model().layout.scrolls.some(scroll => scroll.id === 'workspace:w1'), false)
  } finally { await f.cleanup() }
})



test('previously admitted layout cannot replace newer session focus after publication', async () => {
  const f = createFixture()
  try {
    await f.render()
    await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
    await f.emit({ kind: 'state', state: 'detached' })
    const old = structuredClone(f.model())
    await f.command('activate', { id: 'session:s2' })
    const current = structuredClone(f.model().layout)
    const closes = f.calls.closes
    await f.emit({ kind: 'command', command: { type: 'layout', instance: old.instance, revision: old.revision, commandId: 'late-layout', layout: old.layout } })
    assert.deepEqual(f.view.getSnapshot().navigatorLayout, current)
    assert.deepEqual(f.model().layout, current)
    assert.equal(f.model().layout.focusedWorkspaceId, 'workspace:w1')
    assert.equal(f.calls.closes, closes, 'preference resynchronization does not close the navigator')
  } finally { await f.cleanup() }
})

test('same-cut activate and layout notifications cannot undo focus before React publishes the next cut', async () => {
  const f = createFixture()
  try {
    await f.render()
    await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
    await f.emit({ kind: 'state', state: 'detached' })
    const old = structuredClone(f.model())
    await f.emitMany([
      { kind: 'command', command: { type: 'activate', instance: old.instance, revision: old.revision, commandId: 'batch-select', id: 'session:s2' } },
      { kind: 'command', command: { type: 'layout', instance: old.instance, revision: old.revision, commandId: 'batch-old-scroll', layout: old.layout } },
    ])
    assert.deepEqual(f.calls.selected, ['s2'])
    assert.equal(f.view.getSnapshot().navigatorLayout.focusedWorkspaceId, 'workspace:w1')
    assert.equal(f.model().layout.focusedWorkspaceId, 'workspace:w1')
    assert.ok(f.model().revision > old.revision)
    await f.command('layout', { layout: { ...f.model().layout, focusedWorkspaceId: 'workspace:w2' } })
    assert.equal(f.view.getSnapshot().navigatorLayout.focusedWorkspaceId, 'workspace:w2', 'fresh layout remains usable after the fence advances')
  } finally { await f.cleanup() }
})

test('activation changes only latest focus after both batched and published layout updates', async () => {
  for (const batched of [true, false]) {
    const f = createFixture()
    try {
      await f.render()
      await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
      await f.emit({ kind: 'state', state: 'detached' })
      const old = structuredClone(f.model())
      const layout = { ...old.layout, collapsedGroups: ['sgroup:w1|翻译'], scrolls: [{ id: 'strip', top: 53 }, { id: 'workspace:w1', top: 94 }] }
      if (batched) await f.emitMany([
        { kind: 'command', command: { type: 'layout', instance: old.instance, revision: old.revision, commandId: 'batch-layout-first', layout } },
        { kind: 'command', command: { type: 'activate', instance: old.instance, revision: old.revision, commandId: 'batch-activate-last', id: 'session:s2' } },
      ])
      else { await f.command('layout', { layout }); await f.command('activate', { id: 'session:s2' }) }
      assert.deepEqual(f.view.getSnapshot().navigatorLayout, { ...layout, focusedWorkspaceId: 'workspace:w1' })
      assert.deepEqual(f.calls.selected, ['s2'])
    } finally { await f.cleanup() }
  }
})

test('a new store hydrates the saved navigator layout and legacy whole-value snapshots safely omit it', async () => {
  const layout = { focusedWorkspaceId: 'workspace:w2', collapsedGroups: ['sgroup:w1|翻译'], scrolls: [{ id: 'strip', top: 52 }] }
  let saved
  const first = createFixture()
  try {
    await first.render()
    await act(async () => { first.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
    await first.emit({ kind: 'state', state: 'detached' })
    await first.command('layout', { layout })
    saved = JSON.parse(first.dom.window.localStorage.getItem('dsh.workspaceNavigator.view.v1'))
    assert.deepEqual(saved.navigatorLayout, layout, 'real store persistence writes the existing key')
  } finally { await first.cleanup() }
  const restored = createFixture({ persistedView: saved })
  try {
    assert.deepEqual(restored.view.getSnapshot().navigatorLayout, layout)
    await restored.render()
    await act(async () => { restored.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
    assert.deepEqual(restored.model().layout, layout)
  } finally { await restored.cleanup() }
  delete saved.navigatorLayout
  const legacy = createFixture({ persistedView: saved })
  try {
    assert.equal(legacy.view.getSnapshot().navigatorLayout, undefined, 'hydration replaces rather than merges init')
    await legacy.render()
    await act(async () => { legacy.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
    await legacy.emit({ kind: 'state', state: 'detached' })
    assert.equal(legacy.model().layout.focusedWorkspaceId, null)
    await legacy.command('layout', { layout })
    assert.deepEqual(legacy.view.getSnapshot().navigatorLayout, layout, 'actions and selectors tolerate the missing legacy field')
  } finally { await legacy.cleanup() }
})

test('identical display names preserve workspace-scoped group identities and original session targets', async () => {
  const f = createFixture()
  try {
    f.workspace.items = f.workspace.items.map(workspace => ({ ...workspace, title: '同名工作区' }))
    f.sessions.byId.s1.title = f.sessions.byId.s3.title = '共同/同名会话'
    await f.render()
    await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
    await f.emit({ kind: 'state', state: 'detached' })
    assert.equal(f.model().workspaces.length, 2)
    await f.command('layout', { layout: { ...f.model().layout, collapsedGroups: ['sgroup:w1|共同'] } })
    assert.equal(f.rows().find(row => row.id === 'sgroup:w1|共同').expanded, false)
    assert.equal(f.rows().find(row => row.id === 'sgroup:w2|共同').expanded, true)
    await f.command('activate', { id: 'session:s3' })
    assert.deepEqual(f.calls.selected, ['s3'])
    assert.equal(f.model().layout.focusedWorkspaceId, 'workspace:w2')
  } finally { await f.cleanup() }
})

test('archive modes and blank/subagent visibility remain the original plugin rules', async () => {
  const f = createFixture()
  try {
    delete f.sessions.byId.s1.retainedBy
    const added = ['current-blank', 'other-blank', 'child-agent']
    f.sessions.ids.push(...added)
    Object.assign(f.sessions.byId, {
      'current-blank': { id: 'current-blank', title: '', displayTitle: 'new', blank: true, retainedBy: { mainView: 1 } },
      'other-blank': { id: 'other-blank', title: '', displayTitle: 'new', blank: true },
      'child-agent': { id: 'child-agent', title: '不显示/子代理', displayTitle: 'child', origin: 'subagent' },
    })
    f.workspace.items = f.workspace.items.map(workspace => workspace.workspaceId === 'w1'
      ? { ...workspace, sessionIds: [...workspace.sessionIds, ...added] } : workspace)
    f.workspace.archivedSessionIds = ['s1', 'child-agent']
    await f.render()
    await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
    for (const [filter, expected] of [
      ['default', ['current-blank', 's2', 's3']], ['show', ['current-blank', 's1', 's2', 's3']], ['only', ['s1']],
    ]) {
      await act(async () => { f.view.actions.setArchivedFilter(filter) })
      assert.deepEqual(f.rows().filter(row => row.kind === 'session').map(row => row.id.slice('session:'.length)).sort(), expected)
      if (filter !== 'default') assert.equal(f.rows().find(row => row.id === 'session:s1').disabled, true)
      if (filter === 'only') assert.deepEqual(f.model().workspaces.map(workspace => workspace.id), ['workspace:w1'])
    }
  } finally { await f.cleanup() }
})

test('unassigned conversations retain their original main-window entry without a fabricated workspace card', async () => {
  const f = createFixture()
  try {
    f.sessions.ids.push('loose')
    f.sessions.byId.loose = { id: 'loose', title: '未归属会话', displayTitle: '未归属会话', updatedAt: 1,
      projectionValues: { workspaceNavigatorActivity: { lastContentAt: 1 } } }
    await f.render()
    const tree = f.dom.window.document.querySelector('.wn-tree')
    const loose = tree.querySelector('[data-row-key="loose"]')
    const assigned = tree.querySelector('[data-row-key="s2"]')
    assert.ok(loose)
    assert.ok(assigned)
    await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
    await f.emit({ kind: 'state', state: 'detached' })
    assert.equal(tree.hidden, false)
    assert.equal(tree.querySelector('[data-row-key="loose"]'), loose, 'original rows remain mounted')
    assert.equal(loose.hasAttribute('data-wn-unassigned'), true)
    assert.notEqual(f.dom.window.getComputedStyle(loose).display, 'none')
    assert.equal(f.dom.window.getComputedStyle(assigned).display, 'none')
    assert.equal(f.model().workspaces.length, 2)
    assert.equal(f.rows().some(row => row.id === 'session:loose'), false)
    await act(async () => { loose.click() })
    assert.deepEqual(f.calls.selected, ['loose'])
    assert.equal(f.calls.starts, 0)
    await f.emit({ kind: 'state', state: 'closed' })
    assert.notEqual(f.dom.window.getComputedStyle(assigned).display, 'none')
    assert.equal(tree.hasAttribute('data-wn-native-detached'), false)
  } finally { await f.cleanup() }
})



async function detach(f) {
  await f.render()
  await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.open"]').click() })
  await f.emit({ kind: 'state', state: 'detached' })
}
async function menuAction(f, targetId, action) {
  await f.command('context', { id: targetId })
  assert.equal(f.model().contextMenu?.targetId, targetId)
  await f.command('action', { id: f.model().contextMenu.id, action })
}
async function submitNativeDialog(f, fields = {}) {
  assert.ok(f.model().dialog)
  await f.command('dialog', { id: f.model().dialog.id, ...fields })
}

const mainInput = f => f.dom.window.document.querySelector('[role="dialog"] input.wn-input')
async function mainRename(f, id = 's2') {
  const row = f.dom.window.document.querySelector(`[data-row-key="${id}"]`)
  assert.ok(row, `Main row ${id} exists`)
  await act(async () => { row.dispatchEvent(new f.dom.window.MouseEvent('dblclick', { bubbles: true })) })
  assert.ok(mainInput(f), 'real Main TextDialog controls render')
}
async function mainMenuAction(f, rowKey, label) {
  const row = f.dom.window.document.querySelector(`[data-row-key="${rowKey}"]`)
  assert.ok(row, `Main row ${rowKey} exists`)
  await act(async () => { row.dispatchEvent(new f.dom.window.MouseEvent('contextmenu', { bubbles: true })) })
  const action = [...f.dom.window.document.querySelectorAll('.wn-ctx-item')].find(node => node.textContent === label)
  assert.ok(action, `Main action ${label} exists`)
  await act(async () => { action.click() })
}
async function typeMain(f, value) {
  const input = mainInput(f)
  await act(async () => {
    Object.getOwnPropertyDescriptor(f.dom.window.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new f.dom.window.Event('input', { bubbles: true }))
  })
  assert.equal(mainInput(f).value, value)
}
async function submitMain(f) {
  const dialog = mainInput(f)?.closest('[role="dialog"]') || f.dom.window.document.querySelector('[role="dialog"]')
  const button = [...dialog.querySelectorAll('.wn-modal-actions button')].find(node => node.textContent === 'confirm')
  assert.ok(button)
  await act(async () => { button.click() })
}

// The Modal primitive is mocked, not TextDialog/ConfirmDialog or Main's handlers.
test('R5 Native business completion cannot dismiss a later Main rename draft after return', async t => {
  for (const kind of ['session', 'workspace', 'delete-workspace', 'move-session', 'session-group', 'workspace-group']) {
    await t.test(kind, async () => {
      const f = createFixture(), pending = Promise.withResolvers()
      try {
        const workspaceKind = ['workspace', 'delete-workspace', 'workspace-group'].includes(kind)
        if (kind === 'workspace-group') f.view.actions.setWorkspaceGroupMode('disk-slash')
        const prop = kind === 'delete-workspace' ? 'deleteWorkspace' : workspaceKind ? 'renameWorkspace' : 'renameSession'
        const original = f.props[prop]
        f.props[prop] = async (...args) => { await pending.promise; return original(...args) }
        await detach(f)
        const [id, action, value] = kind === 'session' ? ['session:s1', 'rename', '翻译/修订']
          : kind === 'workspace' ? ['workspace:w2', 'rename', '生活/修订']
            : kind === 'delete-workspace' ? ['workspace:w2', 'delete', undefined]
              : kind === 'move-session' ? ['session:s1', 'move-group', '新组']
                : kind === 'session-group' ? ['sgroup:w1|翻译', 'rename-sgroup', '新组']
                  : ['folder:工作', 'rename-folder', '新组']
        await menuAction(f, id, action)
        await submitNativeDialog(f, value === undefined ? {} : { value })
        assert.equal(f.model().operation.status, 'pending')
        await f.command('return')
        await mainRename(f)
        await typeMain(f, 'Main未提交草稿')
        const input = mainInput(f)
        await act(async () => { pending.resolve() })
        assert.equal(mainInput(f), input, 'settling a Native promise must not touch Main presentation')
        assert.equal(input.value, 'Main未提交草稿')
        await detach(f)
        assert.equal(f.model().operation.status, 'success')
        assert.equal(f.model().dialog, undefined, 'Native still closes its own successful editor')
      } finally { pending.resolve(); await f.cleanup() }
    })
  }
})

test('R5 Native no-change workspace group relocation does not clear an existing Main editor', async () => {
  const f = createFixture()
  try {
    f.view.actions.setWorkspaceGroupMode('disk-slash')
    await f.render()
    await mainRename(f)
    await typeMain(f, '保留草稿')
    const input = mainInput(f)
    await detach(f)
    await menuAction(f, 'folder:工作', 'move-group')
    await submitNativeDialog(f, { value: '' })
    assert.equal(f.model().operation.status, 'success')
    assert.equal(f.model().dialog, undefined)
    assert.equal(mainInput(f), input)
    assert.equal(input.value, '保留草稿')
    assert.deepEqual(f.calls.business, [])
  } finally { await f.cleanup() }
})

test('R5 Main submit closes only its captured editor, and rejection preserves its draft for retry', async t => {
  for (const outcome of ['success', 'reject', 'later-dialog']) await t.test(outcome, async () => {
    const f = createFixture(), pending = Promise.withResolvers()
    try {
      const rename = f.props.renameSession
      f.props.renameSession = async (...args) => { await pending.promise; return rename(...args) }
      await f.render()
      await mainRename(f)
      await typeMain(f, 'Main修订')
      await submitMain(f)
      const original = mainInput(f)
      assert.ok(original, 'pending submit does not discard input')
      if (outcome === 'later-dialog') {
        await act(async () => { original.closest('[role="dialog"]').querySelector('.wn-modal-actions button').click() })
        await mainRename(f, 's1')
        await typeMain(f, '下一个Main草稿')
      }
      const current = mainInput(f)
      await act(async () => { if (outcome === 'reject') pending.reject(new Error('fixture rename refused')); else pending.resolve() })
      if (outcome === 'success') assert.equal(mainInput(f), null, 'original successful Main dialog closes')
      else {
        assert.equal(mainInput(f), current)
        assert.equal(current.value, outcome === 'reject' ? 'Main修订' : '下一个Main草稿')
      }
      if (outcome === 'reject') {
        assert.match(f.dom.window.document.querySelector('[role="alert"]').textContent, /fixture rename refused/)
        assert.equal(f.sessions.byId.s2.title, '代码审核')
      } else assert.equal(f.sessions.byId.s2.title, 'Main修订')
    } finally { pending.resolve(); await f.cleanup() }
  })
})

test('R5 Main workspace and group dialog callers still close their own successful editors', async t => {
  for (const kind of ['workspace', 'delete-workspace', 'session-group', 'workspace-group', 'move-session', 'delete-session-group', 'delete-workspace-group']) await t.test(kind, async () => {
    const f = createFixture()
    try {
      f.view.actions.setWorkspaceGroupMode('disk-slash')
      f.view.actions.addFolder('session', 'w1', '空组')
      f.view.actions.addFolder('workspace', '', '空组')
      await f.render()
      const [rowKey, action, value] = kind === 'workspace' ? ['ws-w2', 'menu.rename', '生活/新名']
        : kind === 'delete-workspace' ? ['ws-w2', 'menu.delete', undefined]
          : kind === 'session-group' ? ['sg-w1|翻译', 'menu.renameSgroup', '新组']
            : kind === 'workspace-group' ? ['f-工作', 'menu.renameFolder', '新组']
              : kind === 'move-session' ? ['s1', 'menu.moveToGroup', '新组']
                : kind === 'delete-session-group' ? ['sg-w1|空组', 'menu.deleteGroup', undefined]
                  : ['f-空组', 'menu.deleteGroup', undefined]
      await mainMenuAction(f, rowKey, action)
      assert.ok(f.dom.window.document.querySelector('[role="dialog"]'))
      if (value !== undefined) await typeMain(f, value)
      await submitMain(f)
      assert.equal(f.dom.window.document.querySelector('[role="dialog"]'), null)
      if (kind === 'workspace') assert.equal(f.workspace.items.find(row => row.workspaceId === 'w2').title, '生活/新名')
      if (kind === 'delete-workspace') assert.equal(f.workspace.items.some(row => row.workspaceId === 'w2'), false)
      if (kind === 'session-group' || kind === 'move-session') assert.equal(f.sessions.byId.s1.title, '新组/首章')
      if (kind === 'workspace-group') assert.equal(f.workspace.items.find(row => row.workspaceId === 'w1').title, '新组/项目一')
      if (kind === 'delete-session-group') assert.equal(f.view.getSnapshot().folders.sess.w1, undefined)
      if (kind === 'delete-workspace-group') assert.equal(f.view.getSnapshot().folders.ws[''], undefined)
    } finally { await f.cleanup() }
  })
})

test('R5 session group rewrite rechecks every unwritten member and leaves partial edits recoverable', async t => {
  for (const compactChains of [false, true]) for (const change of ['title', 'membership', 'deleted', 'mode', 'new-member']) await t.test(`compactChains=${compactChains}; ${change}`, async () => {
    const f = createFixture({ compactChains }), pending = Promise.withResolvers()
    try {
      f.view.actions.setWorkspaceGroupMode('disk-slash')
      f.sessions.byId.s1.title = f.sessions.byId.s1.displayTitle = 'G/1'
      f.sessions.byId.s2.title = f.sessions.byId.s2.displayTitle = 'G/2'
      f.view.actions.addFolder('session', 'w1', 'G/空')
      f.view.actions.setStyling('sgroup:w1|G', { color: '#ff0000' })
      f.view.actions.setFolderOrder('workspace:w1', ['G'])
      const rename = f.props.renameSession
      f.props.renameSession = async (id, title) => {
        f.calls.business.push(['dispatch-session', id, title])
        if (id === 's1') await pending.promise
        return rename(id, title)
      }
      await detach(f)
      await menuAction(f, 'sgroup:w1|G', 'rename-sgroup')
      const editor = f.model().dialog.id
      const before = structuredClone(f.view.getSnapshot())
      await submitNativeDialog(f, { value: 'X' })
      assert.equal(f.model().operation.status, 'pending')
      if (change === 'title') f.sessions.byId = { ...f.sessions.byId, s2: { ...f.sessions.byId.s2, title: 'Other/new', displayTitle: 'Other/new' } }
      if (change === 'membership') f.workspace.items = f.workspace.items.map(row => ({ ...row,
        sessionIds: row.workspaceId === 'w1' ? row.sessionIds.filter(id => id !== 's2') : [...row.sessionIds, 's2'] }))
      if (change === 'deleted') { f.sessions.byId = { ...f.sessions.byId }; delete f.sessions.byId.s2 }
      if (change === 'mode') await act(async () => { f.view.actions.setSessionTitleSlash(false) })
      if (change === 'new-member') {
        f.sessions.byId.s3.title = f.sessions.byId.s3.displayTitle = 'G/3'
        f.workspace.items = f.workspace.items.map(row => ({ ...row, sessionIds: row.workspaceId === 'w1' ? [...row.sessionIds, 's3'] : [] }))
      }
      await f.render()
      await act(async () => { pending.resolve() })
      assert.deepEqual(f.calls.business.filter(call => call[0] === 'dispatch-session'), [['dispatch-session', 's1', 'X/1']])
      assert.equal(f.sessions.byId.s1.title, 'X/1', 'completed work is not blindly rolled back')
      if (change === 'title') assert.equal(f.sessions.byId.s2.title, 'Other/new')
      if (change === 'membership') assert.ok(f.workspace.items.find(row => row.workspaceId === 'w2').sessionIds.includes('s2'))
      assert.equal(f.model().operation.status, 'error')
      assert.match(f.model().operation.message, /navigator.groupPartial.*"completed":1.*"total":2/)
      assert.equal(f.model().dialog.id, editor, 'failure keeps the same Native draft identity')
      for (const key of ['folders', 'styling', 'folderOrder', 'navigatorOrder']) assert.deepEqual(f.view.getSnapshot()[key], before[key], `${key} is not falsely committed`)
      await f.command('cancel-dialog', { id: editor })
      await f.command('context', { id: 'session:s1' })
      assert.ok(f.model().contextMenu, 'partial result does not leave the owner permanently busy')
    } finally { pending.resolve(); await f.cleanup() }
  })
})

test('R5 unchanged multi-member session group rewrite has compressed/uncompressed exact-scope parity', async t => {
  for (const compactChains of [false, true]) await t.test(`compactChains=${compactChains}`, async () => {
    const f = createFixture({ compactChains })
    try {
      f.view.actions.setWorkspaceGroupMode('disk-slash')
      f.sessions.byId.s1.title = f.sessions.byId.s1.displayTitle = 'G/1'
      f.sessions.byId.s2.title = f.sessions.byId.s2.displayTitle = 'G/2'
      f.sessions.byId.s3.title = f.sessions.byId.s3.displayTitle = 'G/other'
      f.view.actions.addFolder('session', 'w1', 'G/空')
      f.view.actions.addFolder('session', 'w2', 'G/空')
      f.view.actions.setStyling('sgroup:w1|G', { color: '#ff0000' })
      await detach(f)
      await menuAction(f, 'sgroup:w1|G', 'rename-sgroup')
      await submitNativeDialog(f, { value: 'X' })
      assert.deepEqual(f.calls.business, [['rename-session', 's1', 'X/1'], ['rename-session', 's2', 'X/2']])
      assert.equal(f.sessions.byId.s3.title, 'G/other')
      assert.deepEqual(f.view.getSnapshot().folders.sess, { w1: ['X/空'], w2: ['G/空'] })
      assert.deepEqual(f.view.getSnapshot().styling['sgroup:w1|X'], { color: '#ff0000' })
      assert.equal(f.view.getSnapshot().styling['sgroup:w1|G'], undefined)
      assert.equal(f.model().operation.status, 'success')
      assert.equal(f.model().dialog, undefined)
    } finally { await f.cleanup() }
  })
})

function workspaceGroupFixture(f) {
  f.view.actions.setWorkspaceGroupMode('disk-slash')
  f.workspace.items = [
    { workspaceId: 'w1', title: '来源', path: 'F:/fixture/one', sessionIds: [] },
    { workspaceId: 'w2', title: '目标', path: 'F:/fixture/two', sessionIds: [] },
    { workspaceId: 'c1', title: 'G/1', path: 'F:/fixture/one/a', sessionIds: ['s1'] },
    { workspaceId: 'c2', title: 'G/2', path: 'F:/fixture/one/b', sessionIds: ['s2'] },
    { workspaceId: 'other', title: 'G/other', path: 'F:/fixture/two/a', sessionIds: ['s3'] },
  ]
  f.view.actions.addFolder('workspace', 'w1', 'G/空')
  f.view.actions.addFolder('workspace', 'w2', 'G/空')
  f.view.actions.setStyling('folder:w1//G', { color: '#ff0000' })
  f.view.actions.setFolderOrder('workspace:w1', ['G'])
}

test('R5 unchanged multi-member workspace group rename and cross-scope move have compression parity', async t => {
  for (const compactChains of [false, true]) for (const crossScope of [false, true]) await t.test(`compactChains=${compactChains}; crossScope=${crossScope}`, async () => {
    const f = createFixture({ compactChains })
    try {
      workspaceGroupFixture(f)
      // Both disk owners are singleton name folders that compression materializes as kind:'ws'.
      f.workspace.items = f.workspace.items.map(row => row.workspaceId === 'w1' ? { ...row, title: 'P/Parent' }
        : row.workspaceId === 'w2' ? { ...row, title: 'Q/Target' } : row)
      const actual = f.workspace.items.map(row => [row.workspaceId, row.path, [...row.sessionIds]])
      await detach(f)
      if (crossScope) await f.command('drop', { id: 'folder:w1//G', targetId: 'folder:w2//G', position: 'inside' })
      else { await menuAction(f, 'folder:w1//G', 'rename-folder'); await submitNativeDialog(f, { value: 'X' }) }
      const prefix = crossScope ? 'G/G' : 'X'
      assert.deepEqual(f.calls.business, [['rename-workspace', 'c1', prefix + '/1'], ['rename-workspace', 'c2', prefix + '/2']])
      assert.deepEqual(f.workspace.items.map(row => [row.workspaceId, row.path, [...row.sessionIds]]), actual)
      assert.equal(f.workspace.items.find(row => row.workspaceId === 'other').title, 'G/other')
      const state = f.view.getSnapshot()
      if (crossScope) {
        assert.equal(state.workspaceParents.c1, 'w2')
        assert.equal(state.workspaceParents.c2, 'w2')
        assert.equal(state.folders.ws.w1, undefined)
        assert.deepEqual(state.folders.ws.w2, ['G/空', 'G/G/空'])
        assert.deepEqual(state.styling['folder:w2//G/G'], { color: '#ff0000' })
      } else {
        assert.deepEqual(state.folders.ws, { w1: ['X/空'], w2: ['G/空'] })
        assert.deepEqual(state.styling['folder:w1//X'], { color: '#ff0000' })
      }
      assert.equal(state.styling['folder:w1//G'], undefined)
      assert.equal(f.model().operation.status, 'success')
      assert.equal(f.model().dialog, undefined)
    } finally { await f.cleanup() }
  })
})

test('R5 workspace group rewrite rechecks latest title, path, scope, deletion and grouping mode', async t => {
  for (const compactChains of [false, true]) for (const change of ['title', 'scope', 'path', 'deleted', 'mode', 'destination-scope', 'new-member']) await t.test(`compactChains=${compactChains}; ${change}`, async () => {
    const f = createFixture({ compactChains }), pending = Promise.withResolvers()
    try {
      workspaceGroupFixture(f)
      f.workspace.items = f.workspace.items.map(row => row.workspaceId === 'w1' ? { ...row, title: 'P/Parent' } : row)
      const rename = f.props.renameWorkspace
      f.props.renameWorkspace = async (id, title) => {
        f.calls.business.push(['dispatch-workspace', id, title])
        if (id === 'c1') await pending.promise
        return rename(id, title)
      }
      await detach(f)
      await menuAction(f, 'folder:w1//G', 'rename-folder')
      const editor = f.model().dialog.id
      await submitNativeDialog(f, { value: 'X' })
      assert.equal(f.model().operation.status, 'pending')
      if (change === 'title') f.workspace.items = f.workspace.items.map(row => row.workspaceId === 'c2' ? { ...row, title: 'Other/new' } : row)
      if (change === 'scope') await act(async () => { f.view.actions.setWorkspaceParent(f.workspace.items, 'c2', 'w2', true) })
      if (change === 'path') f.workspace.items = f.workspace.items.map(row => row.workspaceId === 'c2' ? { ...row, path: 'F:/fixture/one/changed' } : row)
      if (change === 'deleted') f.workspace.items = f.workspace.items.filter(row => row.workspaceId !== 'c2')
      if (change === 'mode') await act(async () => { f.view.actions.setWorkspaceGroupMode('slash') })
      if (change === 'destination-scope') f.workspace.items = f.workspace.items.map(row => row.workspaceId === 'w1' ? { ...row, path: 'F:/fixture/changed' } : row)
      if (change === 'new-member') f.workspace.items = [...f.workspace.items, { workspaceId: 'c3', title: 'G/3', path: 'F:/fixture/one/c', sessionIds: [] }]
      await f.render()
      const before = structuredClone(f.view.getSnapshot())
      await act(async () => { pending.resolve() })
      assert.deepEqual(f.calls.business.filter(call => call[0] === 'dispatch-workspace'), [['dispatch-workspace', 'c1', 'X/1']])
      assert.equal(f.workspace.items.find(row => row.workspaceId === 'c1').title, 'X/1')
      if (change === 'title') assert.equal(f.workspace.items.find(row => row.workspaceId === 'c2').title, 'Other/new')
      assert.equal(f.workspace.items.find(row => row.workspaceId === 'other').title, 'G/other')
      assert.equal(f.model().operation.status, 'error')
      assert.match(f.model().operation.message, /navigator.groupPartial.*"completed":1.*"total":2/)
      assert.equal(f.model().dialog.id, editor)
      for (const key of ['folders', 'styling', 'folderOrder', 'navigatorOrder', 'workspaceParents']) assert.deepEqual(f.view.getSnapshot()[key], before[key], `${key} is not falsely committed`)
    } finally { pending.resolve(); await f.cleanup() }
  })
})

test('R5 cross-scope workspace group move refuses a destination that changed during member writes', async () => {
  const f = createFixture(), pending = Promise.withResolvers()
  try {
    workspaceGroupFixture(f)
    const rename = f.props.renameWorkspace
    f.props.renameWorkspace = async (id, title) => { if (id === 'c1') await pending.promise; return rename(id, title) }
    await detach(f)
    await f.command('drop', { id: 'folder:w1//G', targetId: 'folder:w2//G', position: 'inside' })
    assert.equal(f.model().operation.status, 'pending')
    f.workspace.items = f.workspace.items.map(row => row.workspaceId === 'w2' ? { ...row, path: 'F:/fixture/changed-target' } : row)
    await f.render()
    const before = structuredClone(f.view.getSnapshot())
    await act(async () => { pending.resolve() })
    assert.deepEqual(f.calls.business, [['rename-workspace', 'c1', 'G/G/1']])
    assert.equal(f.workspace.items.find(row => row.workspaceId === 'c2').title, 'G/2')
    assert.equal(f.model().operation.status, 'error')
    assert.match(f.model().operation.message, /navigator.groupPartial/)
    for (const key of ['folders', 'styling', 'folderOrder', 'navigatorOrder', 'workspaceParents']) assert.deepEqual(f.view.getSnapshot()[key], before[key])
  } finally { pending.resolve(); await f.cleanup() }
})

test('R5 rejected member writes report explicit partial results without remapping or rollback', async t => {
  for (const kind of ['session', 'workspace']) await t.test(kind, async () => {
    const f = createFixture()
    try {
      if (kind === 'workspace') workspaceGroupFixture(f)
      else {
        f.sessions.byId.s1.title = f.sessions.byId.s1.displayTitle = 'G/1'
        f.sessions.byId.s2.title = f.sessions.byId.s2.displayTitle = 'G/2'
        f.view.actions.addFolder('session', 'w1', 'G/空')
      }
      const prop = kind === 'workspace' ? 'renameWorkspace' : 'renameSession'
      const original = f.props[prop]
      f.props[prop] = async (id, title) => {
        if (id === (kind === 'workspace' ? 'c2' : 's2')) throw new Error('fixture second member refused')
        return original(id, title)
      }
      await detach(f)
      await menuAction(f, kind === 'workspace' ? 'folder:w1//G' : 'sgroup:w1|G', kind === 'workspace' ? 'rename-folder' : 'rename-sgroup')
      const editor = f.model().dialog.id, before = structuredClone(f.view.getSnapshot())
      await submitNativeDialog(f, { value: 'X' })
      assert.equal(f.model().operation.status, 'error')
      assert.match(f.model().operation.message, /navigator.groupPartial.*"completed":1.*"total":2.*fixture second member refused/)
      assert.equal(f.model().dialog.id, editor)
      assert.deepEqual(f.calls.business, [[kind === 'workspace' ? 'rename-workspace' : 'rename-session', kind === 'workspace' ? 'c1' : 's1', 'X/1']])
      for (const key of ['folders', 'styling', 'folderOrder', 'navigatorOrder', 'workspaceParents']) assert.deepEqual(f.view.getSnapshot()[key], before[key])
    } finally { await f.cleanup() }
  })
})

test('R5 final group metadata commit accepts projection echoes but refuses newer completed-member changes', async t => {
  for (const kind of ['session', 'workspace']) for (const changed of [false, true]) await t.test(`${kind}; changed=${changed}`, async () => {
    const f = createFixture(), pending = Promise.withResolvers()
    try {
      if (kind === 'workspace') workspaceGroupFixture(f)
      else {
        f.sessions.byId.s1.title = f.sessions.byId.s1.displayTitle = 'G/1'
        f.sessions.byId.s2.title = f.sessions.byId.s2.displayTitle = 'G/2'
        f.view.actions.addFolder('session', 'w1', 'G/空')
      }
      const prop = kind === 'workspace' ? 'renameWorkspace' : 'renameSession'
      const first = kind === 'workspace' ? 'c1' : 's1', second = kind === 'workspace' ? 'c2' : 's2'
      const original = f.props[prop]
      f.props[prop] = async (id, title) => { if (id === second) await pending.promise; return original(id, title) }
      await detach(f)
      await menuAction(f, kind === 'workspace' ? 'folder:w1//G' : 'sgroup:w1|G', kind === 'workspace' ? 'rename-folder' : 'rename-sgroup')
      const editor = f.model().dialog.id, before = structuredClone(f.view.getSnapshot())
      await submitNativeDialog(f, { value: 'X' })
      assert.equal(f.model().operation.status, 'pending')
      assert.equal(f.calls.business[0][1], first)
      if (changed) {
        if (kind === 'workspace') f.workspace.items = f.workspace.items.map(row => row.workspaceId === first ? { ...row, title: 'Other/new' } : row)
        else f.sessions.byId = { ...f.sessions.byId, [first]: { ...f.sessions.byId[first], title: 'Other/new', displayTitle: 'Other/new' } }
      }
      await f.render() // first member's successful rename is now a canonical projection echo
      await act(async () => { pending.resolve() })
      if (changed) {
        assert.equal(f.model().operation.status, 'error')
        assert.match(f.model().operation.message, /navigator.groupPartial.*"completed":2.*"total":2/)
        assert.equal(f.model().dialog.id, editor)
        const title = kind === 'workspace' ? f.workspace.items.find(row => row.workspaceId === first).title : f.sessions.byId[first].title
        assert.equal(title, 'Other/new', 'no rollback over newer user changes')
        for (const key of ['folders', 'styling', 'folderOrder', 'navigatorOrder', 'workspaceParents']) assert.deepEqual(f.view.getSnapshot()[key], before[key])
      } else {
        assert.equal(f.model().operation.status, 'success')
        assert.equal(f.model().dialog, undefined)
        assert.deepEqual(f.view.getSnapshot().folders[kind === 'workspace' ? 'ws' : 'sess'].w1, ['X/空'])
      }
      assert.equal(f.calls.business.length, 2, 'no replay or rollback writes')
    } finally { pending.resolve(); await f.cleanup() }
  })
})

test('R5 Main partial group rename keeps its editor draft and displays the partial result', async () => {
  const f = createFixture(), pending = Promise.withResolvers()
  try {
    workspaceGroupFixture(f)
    const rename = f.props.renameWorkspace
    f.props.renameWorkspace = async (id, title) => { if (id === 'c1') await pending.promise; return rename(id, title) }
    await f.render()
    await mainMenuAction(f, 'f-w1//G', 'menu.renameFolder')
    await typeMain(f, 'X')
    await submitMain(f)
    const input = mainInput(f)
    f.workspace.items = f.workspace.items.map(row => row.workspaceId === 'c2' ? { ...row, title: 'Other/new' } : row)
    await f.render()
    await act(async () => { pending.resolve() })
    assert.equal(mainInput(f), input)
    assert.equal(input.value, 'X')
    assert.match(f.dom.window.document.querySelector('[role="alert"]').textContent, /navigator.groupPartial/)
    assert.deepEqual(f.calls.business, [['rename-workspace', 'c1', 'X/1']])
    assert.deepEqual(f.view.getSnapshot().folders.ws.w1, ['G/空'])
  } finally { pending.resolve(); await f.cleanup() }
})

test('R5 canonical workspace search and Main menus retain compressed owners and deep disk descendants', async () => {
  const f = createFixture({ compactChains: true })
  try {
    f.view.actions.setWorkspaceGroupMode('disk-slash')
    f.workspace.items = [
      { workspaceId: 'w1', title: 'P/Parent', path: 'F:/fixture/one', sessionIds: ['s1'] },
      { workspaceId: 'w2', title: 'C/Child', path: 'F:/fixture/one/child', sessionIds: ['s2'] },
      { workspaceId: 'deep', title: 'D/Deep', path: 'F:/fixture/one/child/deep', sessionIds: ['s3'] },
    ]
    const actual = f.workspace.items.map(row => [row.workspaceId, row.path, row.sessionIds])
    f.view.actions.setSessionsExpanded('w1', false)
    f.view.actions.setSessionsExpanded('w2', false)
    await f.render()
    assert.ok(f.dom.window.document.querySelector('[data-row-key="ws-w1"]'))
    assert.equal(f.dom.window.document.querySelector('[data-row-key="ws-deep"]'), null, 'disk descendants are folded in Main, not absent')
    await act(async () => { f.dom.window.document.querySelector('[aria-label^="search.placeholder"]').click() })
    const input = f.dom.window.document.querySelector('input[placeholder="search.placeholder"]')
    assert.ok(input)
    for (const query of ['Deep', '买菜']) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(f.dom.window.HTMLInputElement.prototype, 'value').set.call(input, query)
        input.dispatchEvent(new f.dom.window.Event('input', { bubbles: true }))
      })
      assert.ok(f.dom.window.document.querySelector('[data-row-key="ws-deep"]'), 'canonical descendants remain searchable')
      if (query === '买菜') assert.ok(f.dom.window.document.querySelector('[data-row-key="s3"]'))
      assert.equal(f.view.getSnapshot().sessionsExpanded.w1, false, 'search does not rewrite collapse state')
    }
    await act(async () => { input.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    await act(async () => { f.view.actions.setSessionsExpanded('w1', true); f.view.actions.setSessionsExpanded('w2', true) })
    for (const [id, title] of [['w1', 'P/Parent'], ['deep', 'D/Deep']]) {
      await mainMenuAction(f, 'ws-' + id, 'menu.rename')
      assert.equal(mainInput(f).value, title, 'menus use full canonical titles, not a compressed label')
      await typeMain(f, title + '-new')
      await submitMain(f)
      assert.equal(mainInput(f), null)
    }
    assert.deepEqual(f.calls.business, [['rename-workspace', 'w1', 'P/Parent-new'], ['rename-workspace', 'deep', 'D/Deep-new']])
    assert.deepEqual(f.workspace.items.map(row => [row.workspaceId, row.path, row.sessionIds]), actual)
    assert.deepEqual(f.view.getSnapshot().workspaceParents, {}, 'cosmetic compression does not invent logical parents')
  } finally { await f.cleanup() }
})

test('R5 group reader readiness follows Main lifetime, survives Native return and re-establishes under StrictMode', async t => {
  for (const kind of ['session', 'workspace']) for (const delayedMember of [1, 2]) for (const exit of ['main-unmount', 'main-unmount-new-title', 'native-return']) {
    await t.test(`${kind}; delayedMember=${delayedMember}; ${exit}`, async () => {
      const f = createFixture({ strictMode: true }), pending = Promise.withResolvers(), dispatched = []
      try {
        if (kind === 'workspace') workspaceGroupFixture(f)
        else {
          f.sessions.byId.s1.title = f.sessions.byId.s1.displayTitle = 'G/1'
          f.sessions.byId.s2.title = f.sessions.byId.s2.displayTitle = 'G/2'
          f.view.actions.addFolder('session', 'w1', 'G/空')
        }
        const ids = kind === 'workspace' ? ['c1', 'c2'] : ['s1', 's2']
        const prop = kind === 'workspace' ? 'renameWorkspace' : 'renameSession'
        const rename = f.props[prop]
        f.props[prop] = async (id, title) => {
          dispatched.push([id, title])
          if (id === ids[delayedMember - 1]) await pending.promise
          return rename(id, title)
        }
        await detach(f)
        await menuAction(f, kind === 'workspace' ? 'folder:w1//G' : 'sgroup:w1|G', kind === 'workspace' ? 'rename-folder' : 'rename-sgroup')
        await submitNativeDialog(f, { value: 'X' })
        assert.equal(f.model().operation.status, 'pending')
        assert.deepEqual(dispatched, ids.slice(0, delayedMember).map((id, i) => [id, 'X/' + (i + 1)]), 'StrictMode cleanup must not leave the live reader revoked')
        const before = structuredClone(f.view.getSnapshot()), publications = f.calls.publishes.length
        if (exit === 'native-return') await f.command('return')
        else {
          await f.unmountMain()
          assert.equal(f.dom.window.document.querySelector('#root').childElementCount, 0)
          if (exit === 'main-unmount-new-title') {
            if (kind === 'workspace') f.workspace.items = f.workspace.items.map(row => row.workspaceId === ids[1] ? { ...row, title: 'Other/new' } : row)
            else f.sessions.byId = { ...f.sessions.byId, [ids[1]]: { ...f.sessions.byId[ids[1]], title: 'Other/new', displayTitle: 'Other/new' } }
          }
        }
        await act(async () => { pending.resolve() })
        if (exit === 'native-return') {
          assert.deepEqual(dispatched, ids.map((id, i) => [id, 'X/' + (i + 1)]), 'returning only Native must continue known Main work')
          assert.deepEqual(f.view.getSnapshot().folders[kind === 'workspace' ? 'ws' : 'sess'].w1, ['X/空'])
          await detach(f)
          assert.equal(f.model().operation.status, 'success')
          assert.equal(f.model().dialog, undefined)
        } else {
          assert.deepEqual(dispatched, ids.slice(0, delayedMember).map((id, i) => [id, 'X/' + (i + 1)]), 'Main destruction revokes all remaining unsent writes')
          assert.equal(f.calls.business.length, delayedMember, 'already-dispatched RPCs may finish, without rollback or replay')
          assert.equal(f.calls.publishes.length, publications, 'no result is published by a destroyed owner')
          for (const key of ['folders', 'styling', 'folderOrder', 'navigatorOrder', 'workspaceParents', 'expanded', 'sessionGroups']) {
            assert.deepEqual(f.view.getSnapshot()[key], before[key], `${key} cannot commit after Main destruction, even after the last RPC`)
          }
          if (delayedMember === 1) {
            const title = kind === 'workspace' ? f.workspace.items.find(row => row.workspaceId === ids[1]).title : f.sessions.byId[ids[1]].title
            assert.equal(title, exit === 'main-unmount-new-title' ? 'Other/new' : 'G/2')
          }
        }
      } finally { pending.resolve(); await f.cleanup() }
    })
  }
})

test('R5 top-level cards preserve complete disk/name branches, empty scopes and real session origins', async () => {
  const f = createFixture()
  try {
    f.view.actions.setWorkspaceGroupMode('disk-slash')
    f.workspace.items = [
      { workspaceId: 'steam', title: 'SteamLibrary', path: 'F:/fixture/steam', sessionIds: [] },
      { workspaceId: 'han', title: '工具/汉化', path: 'F:/fixture/steam/han', sessionIds: ['s1'] },
      { workspaceId: 'mod', title: '工具/游戏修改器', path: 'F:/fixture/steam/mod', sessionIds: ['s2'] },
      { workspaceId: 'deep', title: '工具/三级', path: 'F:/fixture/steam/han/deep', sessionIds: ['s3'] },
    ]
    f.view.actions.addFolder('workspace', '', '显式空组')
    f.view.actions.addFolder('workspace', 'steam//han', '工具/空组')
    await detach(f)
    assert.deepEqual(f.model().workspaces.map(card => card.id), ['workspace:steam', 'folder:显式空组'])
    const rows = f.rows()
    for (const [id, owner] of [['s1', 'han'], ['s2', 'mod'], ['s3', 'deep']]) assert.equal(rows.find(row => row.id === 'session:' + id).workspaceId, owner)
    assert.ok(rows.some(row => row.id === 'folder:steam//工具'))
    assert.ok(rows.some(row => row.id === 'folder:steam//han//工具/空组'))
    const deep = rows.find(row => row.id === 'workspace:deep')
    const child = rows.find(row => row.id === 'workspace:han')
    assert.ok(deep.depth > child.depth)
    assert.equal(new Set(rows.map(row => row.id)).size, rows.length)
    await f.command('activate', { id: 'session:s3' })
    assert.deepEqual(f.calls.selected, ['s3'])
    assert.equal(f.model().layout.focusedWorkspaceId, 'workspace:steam')
    assert.equal(f.calls.starts, 0)
  } finally { await f.cleanup() }
})

test('R5 logical parent overrides reject self/cycles, lift/reset and survive hydrated scope changes', async () => {
  const f = createFixture()
  let saved
  try {
    f.workspace.items = f.workspace.items.map(row => row.workspaceId === 'w2' ? { ...row, path: 'F:/fixture/one/child' } : row)
    f.view.actions.addFolder('workspace', 'w1//w2', '空组')
    await detach(f)
    assert.equal(f.model().workspaces.length, 1)
    const paths = f.workspace.items.map(row => row.path)
    await f.command('drop', { id: 'workspace:w1', targetId: 'workspace:w2', position: 'inside' })
    assert.equal(f.model().operation.status, 'error')
    assert.equal(f.view.getSnapshot().workspaceParents.w1, undefined)
    await f.command('drop', { id: 'workspace:w2', targetId: null, position: 'inside' })
    assert.equal(f.view.getSnapshot().workspaceParents.w2, null)
    assert.equal(f.model().workspaces.length, 2)
    assert.deepEqual(f.view.getSnapshot().folders.ws.w2, ['空组'], 'empty groups follow their exact owning workspace scope')
    assert.equal(f.view.getSnapshot().folders.ws['w1//w2'], undefined)
    assert.throws(() => f.view.actions.setWorkspaceParent(f.workspace.items, 'w2', 'w2', true), /parent/)
    assert.throws(() => f.view.actions.setWorkspaceParent(f.workspace.items, 'w2', 'missing', true), /parent/)
    await menuAction(f, 'workspace:w2', 'workspace-parent-reset')
    assert.equal(f.model().workspaces.length, 1)
    assert.deepEqual(f.view.getSnapshot().folders.ws['w1//w2'], ['空组'])
    await menuAction(f, 'workspace:w2', 'workspace-root')
    saved = JSON.parse(f.dom.window.localStorage.getItem('dsh.workspaceNavigator.view.v1'))
    assert.deepEqual(f.workspace.items.map(row => row.path), paths)
    assert.deepEqual(f.workspace.items.map(row => row.sessionIds), [['s1', 's2'], ['s3']])
    assert.equal(f.calls.closes, 0)
  } finally { await f.cleanup() }
  const restored = createFixture({ persistedView: saved })
  try {
    restored.workspace.items = restored.workspace.items.map(row => row.workspaceId === 'w2' ? { ...row, path: 'F:/fixture/one/child' } : row)
    await detach(restored)
    assert.equal(restored.model().workspaces.length, 2)
    assert.equal(restored.view.getSnapshot().workspaceParents.w2, null)
    assert.deepEqual(restored.view.getSnapshot().folders.ws.w2, ['空组'])
  } finally { await restored.cleanup() }
})

test('R5 logical reparent retains Main collapsed groups across descendant scope changes and hydration', async () => {
  const configure = f => {
    f.workspace.items = f.workspace.items.map(row => row.workspaceId === 'w2' ? { ...row, path: 'F:/fixture/one/child' } : row)
    f.workspace.items.push({ workspaceId: 'w3', title: '深层', path: 'F:/fixture/one/child/deep', sessionIds: [] })
  }
  const f = createFixture()
  let saved
  try {
    configure(f)
    f.view.actions.addFolder('workspace', 'w1//w2', 'Keep/Nested')
    f.view.actions.addFolder('workspace', 'w1//w2//w3', 'Deep')
    f.view.actions.setExpanded('folder:w1//w2//Keep', false)
    f.view.actions.setExpanded('folder:w1//w2//Keep/Nested', false)
    f.view.actions.setExpanded('folder:w1//w2//w3//Deep', false)
    f.view.actions.setExpanded('folder:w1//Unrelated', false)
    await detach(f)
    await f.command('drop', { id: 'workspace:w2', targetId: null, position: 'inside' })
    const state = f.view.getSnapshot()
    for (const key of ['w2//Keep', 'w2//Keep/Nested', 'w2//w3//Deep', 'w1//Unrelated']) assert.equal(state.expanded['folder:' + key], false)
    assert.equal(state.expanded['folder:w1//w2//Keep'], undefined)
    assert.equal(state.expanded['folder:w1//w2//w3//Deep'], undefined)
    assert.deepEqual(state.folders.ws.w2, ['Keep/Nested'])
    assert.deepEqual(state.folders.ws['w2//w3'], ['Deep'])
    saved = JSON.parse(f.dom.window.localStorage.getItem('dsh.workspaceNavigator.view.v1'))
  } finally { await f.cleanup() }
  const restored = createFixture({ persistedView: saved })
  try {
    configure(restored)
    await detach(restored)
    for (const key of ['w2//Keep', 'w2//Keep/Nested', 'w2//w3//Deep']) assert.equal(restored.view.getSnapshot().expanded['folder:' + key], false)
    assert.equal(restored.view.getSnapshot().expanded['folder:w1//w2//Keep'], undefined)
  } finally { await restored.cleanup() }
})

test('R5 Native menu uses shared business promises, edits in Native, and awaits real fork completion', async () => {
  const f = createFixture()
  try {
    await detach(f)
    await f.command('context', { id: 'session:s1' })
    assert.deepEqual(f.model().contextMenu.entries.filter(entry => !entry.separator).map(entry => entry.id),
      ['pin', 'rename', 'fork', 'archive', 'copy-id', 'move-out', 'move-group', 'move-workspace', 'customize', 'cancel'])
    assert.equal(f.model().contextMenu.entries.find(entry => entry.id === 'move-workspace').disabled, true)
    await f.command('action', { id: f.model().contextMenu.id, action: 'pin' })
    assert.ok(f.workspace.pinnedSessionIds.includes('s1'))
    assert.equal(f.model().operation.status, 'success')
    await menuAction(f, 'session:s1', 'unpin')
    assert.equal(f.workspace.pinnedSessionIds.includes('s1'), false)
    await menuAction(f, 'session:s1', 'rename')
    assert.equal(f.model().dialog.kind, 'text')
    const dialogId = f.model().dialog.id
    f.sessions.byId.s3 = { ...f.sessions.byId.s3, projectionValues: { workspaceNavigatorActivity: { lastContentAt: 999 } } }
    await f.render()
    assert.equal(f.model().dialog.id, dialogId, 'background publication preserves the editor identity')
    await submitNativeDialog(f, { value: '翻译/Native修订' })
    assert.equal(f.sessions.byId.s1.title, '翻译/Native修订')
    assert.equal(f.model().dialog, undefined)
    await menuAction(f, 'session:s1', 'move-out')
    assert.equal(f.sessions.byId.s1.title, 'Native修订')
    await menuAction(f, 'session:s1', 'move-group')
    await submitNativeDialog(f, { value: '新组/子组' })
    assert.equal(f.sessions.byId.s1.title, '新组/子组/Native修订')
    await menuAction(f, 'session:s1', 'copy-id')
    const offer = f.model().clipboard
    assert.equal(offer.text, 's1', 'the shared Main dispatcher selects the actual payload ID')
    assert.deepEqual(f.calls.clipboard, [], 'Native copy must not invoke the background Main helper')
    assert.equal(f.model().operation.status, 'pending')
    await f.command('clipboard-result', { id: offer.id, outcome: 'copied' })
    assert.equal(f.model().operation.status, 'success')
    const pending = Promise.withResolvers()
    f.props.forkSession = () => pending.promise
    await f.render()
    await menuAction(f, 'session:s1', 'fork')
    assert.equal(f.model().operation.status, 'pending', 'transport acceptance is not business success')
    await act(async () => { pending.resolve() })
    assert.equal(f.model().operation.status, 'success')
    assert.equal(f.calls.closes, 0)
    assert.equal(f.calls.starts, 0)
  } finally { await f.cleanup() }
})

test('R5 Native copy uses canonical action-time ID and awaits its matching finite receipt without Main helper I/O', async t => {
  for (const outcome of ['copied', 'unavailable', 'denied', 'failed']) await t.test(outcome, async () => {
    const f = createFixture()
    try {
      f.sessions.byId.s1.title = f.sessions.byId.s1.displayTitle = '标题含 session:wrong-id；不是 Session ID'
      await detach(f)
      await menuAction(f, 'session:s1', 'copy-id')
      const cut = f.model(), offer = cut.clipboard, operationId = cut.operation.id
      assert.equal(offer.text, 's1')
      assert.notEqual(offer.id, operationId, 'effect identity is not guessed from display/target or business operation ID')
      assert.deepEqual(f.calls.clipboard, [])
      assert.deepEqual(f.calls.business, [])
      assert.equal(cut.operation.status, 'pending')
      const pending = f.navigatorOwner().clipboard
      assert.equal(pending.parentCommandId, operationId)
      let settled = false
      void pending.promise.then(() => { settled = true }, () => { settled = true })
      await f.render()
      assert.equal(settled, false, 'preparation/publication is not actual clipboard completion')
      const good = { kind: 'command', command: { type: 'clipboard-result', instance: cut.instance, revision: cut.revision,
        commandId: 'copy-receipt', id: offer.id, outcome } }
      for (const fields of [{ id: operationId }, { id: 'session:s1' }, { id: 'unknown' }, { instance: 'wrong-main' },
        { revision: cut.revision + 100 }, { revision: cut.revision - 1 }, { outcome: 'accepted' }, { text: 'arbitrary' }]) {
        await f.emit({ kind: 'command', command: { ...good.command, commandId: 'invalid-' + Math.random(), ...fields } })
        assert.equal(f.model().operation.id, operationId)
        assert.equal(f.model().operation.status, 'pending')
        assert.equal(settled, false)
      }
      await f.emit(good)
      assert.equal(settled, true)
      assert.equal(f.model().operation.id, operationId, 'receipt settles the parent operation instead of starting another')
      assert.equal(f.model().operation.status, outcome === 'copied' ? 'success' : 'error')
      if (outcome !== 'copied') assert.match(f.model().operation.message, new RegExp('clipboard-' + outcome))
      assert.equal(f.model().clipboard, undefined)
      assert.equal(f.navigatorOwner().clipboard, null)
      const completed = structuredClone(f.model().operation)
      await f.emit(good)
      await f.emit({ kind: 'command', command: { ...good.command, commandId: 'duplicate-new-command' } })
      assert.deepEqual(f.model().operation, completed, 'duplicate and late receipts cannot create a second operation')
      assert.deepEqual(f.calls.clipboard, [])
    } finally { await f.cleanup() }
  })
})

test('R5 real Main offer and actual fixed Native document receipt complete one canonical copy together', async t => {
  for (const denied of [false, true]) await t.test(denied ? 'Web API denied' : 'Web API resolved', async () => {
    const f = createFixture(), io = Promise.withResolvers(), writes = []
    let native
    try {
      await detach(f)
      await menuAction(f, 'session:s2', 'copy-id')
      const cut = f.model(), parentId = cut.operation.id
      native = await rendererFixture(cut, { clipboard: { writeText(text) { writes.push(text); return io.promise } } })
      assert.deepEqual(writes, ['s2'])
      assert.equal(native.commands.filter(command => command.type === 'clipboard-result').length, 0)
      assert.equal(f.model().operation.status, 'pending')
      if (denied) io.reject(Object.assign(new Error('private Web API detail'), { name: 'NotAllowedError' }))
      else io.resolve()
      await native.settle()
      const receipt = native.commands.find(command => command.type === 'clipboard-result')
      assert.equal(receipt.id, cut.clipboard.id)
      assert.equal(receipt.instance, cut.instance)
      assert.equal(receipt.outcome, denied ? 'denied' : 'copied')
      assert.equal(f.model().operation.status, 'pending', 'Native transport accepted alone cannot complete Main')
      await f.emit({ kind: 'command', command: receipt })
      assert.equal(f.model().operation.id, parentId)
      assert.equal(f.model().operation.status, denied ? 'error' : 'success')
      assert.equal(f.model().clipboard, undefined)
      assert.deepEqual(f.calls.clipboard, [], 'actual fixed-document I/O replaces, never accompanies, the background helper')
      assert.deepEqual(f.calls.business, [])
    } finally { io.resolve(); native?.close(); await f.cleanup() }
  })
})

test('R5 real Main and fixed Native copy survives actual NativeSession stale Return refresh in both completion orderings', async t => {
  for (const order of ['no-return-control', 'write-after-return-reply', 'write-before-return-reply']) await t.test(order, async () => {
    const f = createFixture(), io = Promise.withResolvers(), returnReply = Promise.withResolvers(), writes = [], forwarded = [], replies = []
    let native, staleReturn
    try {
      await detach(f)
      await menuAction(f, 'session:s2', 'copy-id')
      const cut = f.model(), parentId = cut.operation.id, pending = f.navigatorOwner().clipboard
      let settled = false
      void pending.promise.then(() => { settled = true }, () => { settled = true })
      // Node-only admission fixture: actual command/publish implementation, never start a Host, pipe, native process or window.
      const admission = new NativeSession({ spawn() { assert.fail('no native process in this fixture') } }, {}, 'fixture-native', cut,
        event => { forwarded.push(event); return true }, error => { assert.fail(String(error)) })
      admission.phase = 'detached'
      const publish = f.api.publish
      f.api.publish = async value => { await publish(value); await admission.publish(structuredClone(value)) }
      const delivered = []
      native = await rendererFixture(cut, { clipboard: { writeText(text) { writes.push(text); return io.promise } },
        command: async intent => {
          const result = admission.command(intent)
          replies.push({ intent, kind: result.kind })
          for (const event of forwarded.splice(0)) { delivered.push(event.command); await f.emit(event) }
          if (intent.type === 'return') {
            staleReturn = result
            if (order === 'write-before-return-reply') return returnReply.promise
          }
          return result
        } })
      assert.deepEqual(writes, ['s2'], 'the Web API is explicitly mocked; only Main selected this actual payload ID')
      f.sessions.byId.s3.projectionValues.workspaceNavigatorActivity.lastContentAt = 999
      await f.render()
      const unrelated = f.model()
      assert.ok(unrelated.revision > cut.revision)
      assert.deepEqual(admission.model.clipboard, cut.clipboard)
      assert.equal(admission.model.revision, unrelated.revision)
      assert.equal(native.rendered.at(-1).revision, cut.revision, 'Native deliberately has not seen the unrelated publication yet')
      if (order !== 'no-return-control') {
        native.document.querySelector('#return').click()
        assert.equal(native.commands.filter(command => command.type === 'return').length, 1, 'Return is not queued behind unresolved copy/layout')
        await native.settle()
        const attempt = replies.find(item => item.intent.type === 'return')
        assert.equal(attempt.intent.revision, cut.revision)
        assert.equal(attempt.kind, 'refresh', 'the real exact-revision Return gate must remain unchanged')
        assert.equal(delivered.some(command => command.type === 'return'), false, 'Host did not admit any Main Return command')
      }
      assert.equal(admission.phase, 'detached')
      assert.equal(f.navigatorOwner().state, 'detached')
      assert.equal(f.navigatorOwner().clipboard, pending)
      assert.equal(settled, false)
      assert.equal(f.model().operation.status, 'pending')
      io.resolve(); await native.settle()
      const receipts = native.commands.filter(command => command.type === 'clipboard-result')
      assert.equal(receipts.length, 1, 'the original write must retain one valid completion after a non-admitted Return')
      assert.equal(receipts[0].id, cut.clipboard.id)
      assert.equal(receipts[0].instance, cut.instance)
      assert.equal(receipts[0].outcome, 'copied')
      assert.equal(receipts[0].revision, order === 'write-after-return-reply' ? unrelated.revision : cut.revision,
        'a pending Return reply leaves Native on its original authorized cut; the real receipt gate may bridge to current')
      assert.equal(replies.filter(item => item.intent.type === 'clipboard-result' && item.kind === 'accepted').length, 1)
      assert.equal(delivered.filter(command => command.type === 'clipboard-result').length, 1)
      assert.equal(settled, true, 'actual Main await settles, not merely the Native transport')
      assert.equal(f.navigatorOwner().clipboard, null)
      assert.equal(f.model().operation.id, parentId)
      assert.equal(f.model().operation.status, 'success')
      assert.equal(f.model().clipboard, undefined)
      await native.publish(f.model())
      if (order === 'write-before-return-reply') { returnReply.resolve(staleReturn); await native.settle() }
      await native.publish(f.model())
      assert.deepEqual(writes, ['s2'], 'old Return reply/publication cannot replay the write')
      assert.equal(native.commands.filter(command => command.type === 'clipboard-result').length, 1)
      assert.equal(native.commands.filter(command => command.type === 'return').length, order === 'no-return-control' ? 0 : 1)
      assert.equal(f.calls.closes, 0)
      assert.deepEqual(f.calls.clipboard, [], 'the background Main helper must not also write')
      assert.deepEqual(f.calls.business, [])
    } finally { io.resolve(); returnReply.resolve(staleReturn ?? { kind: 'accepted' }); native?.close(); await f.cleanup() }
  })
})

test('R5 still-offered clipboard receipt survives an unrelated revision and workspace-loading disconnect only', async () => {
  const f = createFixture()
  try {
    await detach(f)
    await menuAction(f, 'session:s1', 'copy-id')
    const cut = f.model()
    f.workspace.state = 'loading'
    await f.render()
    assert.equal(f.model().connected, false)
    assert.ok(f.model().revision > cut.revision)
    assert.deepEqual(f.model().clipboard, cut.clipboard)
    await f.command('context', { id: 'session:s2' })
    assert.equal(f.model().operation.id, cut.operation.id)
    assert.equal(f.model().operation.status, 'pending')
    await f.emit({ kind: 'command', command: { type: 'clipboard-result', instance: cut.instance, revision: cut.revision,
      commandId: 'loading-receipt', id: cut.clipboard.id, outcome: 'copied' } })
    assert.equal(f.model().operation.id, cut.operation.id)
    assert.equal(f.model().operation.status, 'success')
    assert.equal(f.model().clipboard, undefined)
    await f.command('context', { id: 'session:s2' })
    assert.equal(f.model().contextMenu, undefined, 'completion exception never admits new disconnected business')
    f.workspace.state = 'idle'; await f.render()
    await f.command('context', { id: 'session:s2' })
    assert.equal(f.model().contextMenu.targetId, 'session:s2', 'the completed copy cannot leave the owner busy')
    assert.deepEqual(f.calls.clipboard, [])
  } finally { await f.cleanup() }
})

test('R5 copy retries get a fresh offer and cannot be completed by old IDs or captured callbacks', async () => {
  const f = createFixture()
  try {
    await detach(f)
    await menuAction(f, 'session:s1', 'copy-id')
    const first = f.model(), old = f.navigatorOwner().clipboard
    await f.command('clipboard-result', { id: first.clipboard.id, outcome: 'denied' })
    await menuAction(f, 'session:s2', 'copy-id')
    const next = f.model()
    assert.notEqual(next.clipboard.id, first.clipboard.id)
    assert.equal(next.clipboard.text, 's2')
    await act(async () => { old.resolve(true); old.reject(new Error('late old callback')) })
    await f.command('clipboard-result', { id: first.clipboard.id, outcome: 'copied' })
    assert.equal(f.model().operation.id, next.operation.id)
    assert.equal(f.model().operation.status, 'pending')
    await f.command('clipboard-result', { id: next.clipboard.id, outcome: 'copied' })
    assert.equal(f.model().operation.id, next.operation.id)
    assert.equal(f.model().operation.status, 'success')
    assert.deepEqual(f.calls.clipboard, [])
  } finally { await f.cleanup() }
})

test('R5 copy action revalidates the real target/menu/context before preparing any offer', async t => {
  for (const change of ['title', 'removed', 'helper-removed']) await t.test(change, async () => {
    const f = createFixture()
    try {
      await detach(f)
      await f.command('context', { id: 'session:s1' })
      const cut = f.model()
      if (change === 'title') f.sessions.byId.s1.title = f.sessions.byId.s1.displayTitle = '另一个上下文'
      if (change === 'removed') f.workspace.items = f.workspace.items.map(item => ({ ...item, sessionIds: item.sessionIds.filter(id => id !== 's1') }))
      if (change === 'helper-removed') f.ui.writeClipboard = undefined
      f.beforePublication({ kind: 'command', command: { type: 'action', id: cut.contextMenu.id, action: 'copy-id',
        instance: cut.instance, revision: cut.revision, commandId: 'stale-copy-action' } })
      await f.render()
      assert.equal(f.model().clipboard, undefined)
      assert.equal(f.navigatorOwner().clipboard, null)
      assert.deepEqual(f.calls.clipboard, [])
      assert.equal(f.model().operation.status, 'error')
    } finally { await f.cleanup() }
  })
})

test('R5 return/true-close/failure/Main unmount retire only their own clipboard await promptly', async t => {
  for (const exit of ['native-return', 'Main-return', 'closed', 'error', 'publish-failure', 'focus-failure', 'unmount']) await t.test(exit, async () => {
    const f = createFixture({ strictMode: true })
    try {
      await detach(f)
      await menuAction(f, 'session:s1', 'copy-id')
      const cut = f.model(), owner = f.navigatorOwner(), pending = owner.clipboard
      const cancelled = assert.rejects(pending.promise, error => error.code === 'clipboard-cancelled')
      const publish = f.api.publish, focus = f.api.focus
      if (exit === 'native-return') await f.command('return')
      else if (exit === 'Main-return') await act(async () => { [...f.dom.window.document.querySelectorAll('.wn-navigation-controls button')].find(node => node.textContent === 'navigator.return').click() })
      else if (exit === 'unmount') await f.unmountMain()
      else if (exit === 'publish-failure') {
        f.api.publish = async model => { await publish(model); throw new Error('real publish failure') }
        f.sessions.byId.s3.projectionValues.workspaceNavigatorActivity.lastContentAt = 999
        await f.render()
      } else if (exit === 'focus-failure') {
        f.api.focus = async () => { throw new Error('real focus failure') }
        await act(async () => { f.dom.window.document.querySelector('[aria-label="navigator.focus"]').click() })
      } else await f.emit({ kind: 'state', state: exit })
      await cancelled
      assert.equal(owner.clipboard, null)
      assert.deepEqual(f.calls.clipboard, [])
      f.api.publish = publish; f.api.focus = focus
      if (exit !== 'unmount') {
        await detach(f)
        assert.equal(f.model().clipboard, undefined)
        assert.equal(f.model().operation.id, cut.operation.id)
        assert.equal(f.model().operation.status, 'error')
        await menuAction(f, 'session:s2', 'copy-id')
        const next = f.model()
        assert.notEqual(next.clipboard.id, cut.clipboard.id)
        await act(async () => { pending.resolve(true) })
        await f.command('clipboard-result', { id: cut.clipboard.id, outcome: 'copied' })
        assert.equal(f.model().operation.id, next.operation.id)
        assert.equal(f.model().operation.status, 'pending')
        await f.command('clipboard-result', { id: next.clipboard.id, outcome: 'copied' })
        assert.equal(f.model().operation.status, 'success')
      }
    } finally { await f.cleanup() }
  })
})

test('R5 ordinary Main copy retains the original public helper true/false behavior with no Native offer', async t => {
  for (const copied of [true, false]) await t.test(String(copied), async () => {
    const f = createFixture()
    f.ui.writeClipboard = async text => { f.calls.clipboard.push(text); return copied }
    try {
      await f.render()
      await mainMenuAction(f, 's1', 'menu.sessionId')
      assert.deepEqual(f.calls.clipboard, ['s1'])
      assert.equal(f.navigatorOwner().clipboard, null)
      assert.equal(f.navigatorOwner().operation, null)
      assert.ok(f.dom.window.document.body.textContent.includes(copied ? 'toast.sessionIdCopied' : 'toast.sessionIdCopyFailed'))
      assert.equal(f.calls.opens.length, 0)
    } finally { await f.cleanup() }
  })
})

test('R5 a known business result settles across return/closed/error and reopen without replaying it', async t => {
  for (const lifecycle of ['return', 'closed', 'error']) for (const rejected of [false, true]) for (const reopenFirst of [false, true]) {
    await t.test(`${lifecycle}; rejected=${rejected}; reopenFirst=${reopenFirst}`, async () => {
      const f = createFixture(), pending = Promise.withResolvers()
      try {
        f.props.forkSession = id => { f.calls.business.push(['fork', id]); return pending.promise }
        await detach(f)
        await menuAction(f, 'session:s1', 'fork')
        const operationId = f.model().operation.id
        assert.equal(f.model().operation.status, 'pending')
        const cut = f.model()
        await f.emit({ kind: 'command', command: { type: 'context', id: 'session:s2', instance: cut.instance,
          revision: cut.revision - 1, commandId: 'stale-during-pending' } })
        assert.equal(f.model().operation.status, 'pending', 'an unrelated refusal cannot abandon the running business result')
        if (lifecycle === 'return') await f.command('return')
        else await f.emit({ kind: 'state', state: lifecycle })
        if (reopenFirst) await detach(f)
        await act(async () => { if (rejected) pending.reject(new Error('fixture fork refused')); else pending.resolve() })
        if (!reopenFirst) await detach(f)
        assert.equal(f.model().operation.id, operationId)
        assert.equal(f.model().operation.status, rejected ? 'error' : 'success')
        if (rejected) assert.match(f.model().operation.message, /fixture fork refused/)
        await f.command('context', { id: 'session:s2' })
        assert.equal(f.model().contextMenu?.targetId, 'session:s2', 'reopening cannot remain permanently busy')
        assert.deepEqual(f.calls.business.filter(call => call[0] === 'fork'), [['fork', 's1']])
      } finally { pending.resolve(); await f.cleanup() }
    })
  }
})

test('R5 active archive refusal raises Native confirmation; errors never fake success or close', async () => {
  const f = createFixture()
  try {
    f.view.actions.setArchivedFilter('show')
    const original = f.props.archiveSession
    f.props.archiveSession = async (id, options) => {
      if (!options?.stopActivity) { const error = new Error('active'); error.name = 'WorkspaceArchiveError'; throw error }
      return original(id, options)
    }
    await detach(f)
    await menuAction(f, 'session:s2', 'archive')
    assert.equal(f.model().dialog.kind, 'confirm')
    assert.notEqual(f.model().operation?.status, 'success')
    assert.equal(f.workspace.archivedSessionIds.includes('s2'), false)
    await f.command('cancel-dialog', { id: f.model().dialog.id })
    assert.equal(f.workspace.archivedSessionIds.includes('s2'), false)
    await menuAction(f, 'session:s2', 'archive')
    await submitNativeDialog(f)
    assert.ok(f.workspace.archivedSessionIds.includes('s2'))
    assert.deepEqual(f.calls.business.find(call => call[0] === 'archive'), ['archive', 's2', { stopActivity: true }])
    await menuAction(f, 'session:s2', 'unarchive')
    assert.equal(f.workspace.archivedSessionIds.includes('s2'), false)
    f.props.renameSession = async () => { throw new Error('fixture rename refused') }
    await f.render()
    await menuAction(f, 'session:s1', 'rename')
    const id = f.model().dialog.id
    await submitNativeDialog(f, { value: '失败' })
    assert.equal(f.model().operation.status, 'error')
    assert.match(f.model().operation.message, /fixture rename refused/)
    assert.equal(f.model().dialog.id, id)
    assert.equal(f.calls.closes, 0)
  } finally { await f.cleanup() }
})

test('R5 stale menu/dialog/activation targets refuse and refresh without closing or wrong-item execution', async () => {
  const f = createFixture()
  try {
    await detach(f)
    await menuAction(f, 'session:s1', 'rename')
    const dialogId = f.model().dialog.id
    f.sessions.byId = { ...f.sessions.byId, s1: { ...f.sessions.byId.s1, title: '后台/已变更' } }
    await f.render()
    await f.command('dialog', { id: dialogId, value: '不可覆盖' })
    assert.equal(f.model().operation.status, 'error')
    assert.equal(f.sessions.byId.s1.title, '后台/已变更')
    await f.command('cancel-dialog', { id: dialogId })
    await f.command('context', { id: 'session:s1' })
    const menuId = f.model().contextMenu.id
    f.workspace.items = f.workspace.items.map(row => row.workspaceId === 'w1' ? { ...row, sessionIds: ['s2'] } : row)
    await f.render()
    await f.command('action', { id: menuId, action: 'fork' })
    assert.equal(f.model().operation.status, 'error')
    assert.equal(f.calls.business.some(call => call[0] === 'fork'), false)
    await f.command('activate', { id: 'session:s1' })
    assert.deepEqual(f.calls.selected, [])
    assert.equal(f.calls.closes, 0)
  } finally { await f.cleanup() }
})

test('R5 appearance dialogs validate finite fields and use the shared style owner', async () => {
  const f = createFixture()
  try {
    await detach(f)
    await menuAction(f, 'session:s1', 'customize')
    assert.equal(f.model().dialog.kind, 'appearance')
    const id = f.model().dialog.id
    await submitNativeDialog(f, { appearance: { color: '#aabbcc', glow: 3, weight: 600, shadow: true, stroke: false, strokeWidth: 1, strokeColor: '#808080' } })
    assert.equal(f.view.getSnapshot().styling['session:s1'].color, '#aabbcc')
    assert.equal(f.rows().find(row => row.id === 'session:s1').style.fontWeight, 600)
    await menuAction(f, 'session:s1', 'customize')
    await submitNativeDialog(f, { appearance: { position: 'fixed' } })
    assert.equal(f.model().operation.status, 'error')
    assert.notEqual(f.model().dialog.id, id)
    assert.equal(f.view.getSnapshot().styling['session:s1'].position, undefined)
    assert.equal(f.calls.closes, 0)
  } finally { await f.cleanup() }
})

test('R5 optional provider is disabled when absent, reports refusal, and moves only after Native cwd confirmation', async () => {
  const f = createFixture()
  try {
    const requests = []
    let reject = true
    f.props.sessionMoveProvider = { available: async () => true, move: async (sessionId, targetWorkspaceId) => {
      requests.push({ sessionId, targetWorkspaceId })
      if (reject) throw new Error('provider fixture refusal')
      f.workspace.items = f.workspace.items.map(workspace => ({ ...workspace, sessionIds: workspace.workspaceId === targetWorkspaceId ? [...workspace.sessionIds, sessionId] : workspace.sessionIds.filter(id => id !== sessionId) }))
    } }
    await detach(f)
    await menuAction(f, 'session:s1', 'move-workspace')
    assert.equal(f.model().dialog.kind, 'select')
    assert.deepEqual(f.model().dialog.options.map(option => option.id), ['w2'])
    await submitNativeDialog(f, { value: 'missing' })
    assert.equal(f.model().operation.status, 'error')
    assert.equal(requests.length, 0)
    await submitNativeDialog(f, { value: 'w2' })
    assert.equal(f.model().dialog.kind, 'confirm')
    assert.equal(requests.length, 0)
    await submitNativeDialog(f)
    assert.equal(f.model().operation.status, 'error')
    assert.match(f.model().operation.message, /provider fixture refusal/)
    reject = false
    await submitNativeDialog(f)
    assert.deepEqual(requests, [{ sessionId: 's1', targetWorkspaceId: 'w2' }, { sessionId: 's1', targetWorkspaceId: 'w2' }])
    assert.equal(f.rows().find(row => row.id === 'session:s1').workspaceId, 'w2')
    assert.equal(f.model().operation.status, 'success')
    assert.equal(f.calls.closes, 0)
    assert.equal(f.calls.starts, 0)
  } finally { await f.cleanup() }
})

test('R5 managed move continuation revalidates Main and canonical intent after the issued provider request', async t => {
  const changes = ['unchanged', 'native-return', 'main-unmount', 'main-unmount-new-title', 'title', 'not-ready', 'source-cwd', 'destination-cwd',
    'source-parent', 'destination-parent', 'third-owner', 'archived', 'blank', 'group-mode', 'sort-mode', 'anchor-deleted', 'anchor-title']
  for (const change of changes) await t.test(change, async () => {
    const f = createFixture({ strictMode: true }), pending = Promise.withResolvers()
    const parent = 'sgroup:w2|目标'
    try {
      f.sessions.byId.s3.title = f.sessions.byId.s3.displayTitle = '目标/锚点'
      f.props.sessionMoveProvider = { available: async () => true, move: async (id, target) => {
        f.calls.business.push(['provider-move', id, target])
        await pending.promise
        f.workspace.items = f.workspace.items.map(row => ({ ...row, sessionIds: row.workspaceId === target ? [...row.sessionIds.filter(value => value !== id), id] : row.sessionIds.filter(value => value !== id) }))
      } }
      await detach(f)
      await f.command('sort', { mode: 'manual' })
      await f.command('drop', { id: 'session:s1', targetId: 'session:s3', position: 'before' })
      const editor = f.model().dialog.id
      await submitNativeDialog(f)
      assert.equal(f.model().operation.status, 'pending')
      assert.deepEqual(f.calls.business, [['provider-move', 's1', 'w2']])
      const publications = f.calls.publishes.length
      const unmounted = change.startsWith('main-unmount')
      if (unmounted) await f.unmountMain()
      if (change === 'native-return') await f.command('return')
      if (change === 'title' || change === 'main-unmount-new-title') f.sessions.byId = { ...f.sessions.byId, s1: { ...f.sessions.byId.s1, title: 'Other/new', displayTitle: 'Other/new' } }
      if (change === 'not-ready') f.sessions.phase = 'pending'
      if (change === 'source-cwd' || change === 'destination-cwd') f.workspace.items = f.workspace.items.map(row => row.workspaceId === (change === 'source-cwd' ? 'w1' : 'w2') ? { ...row, path: 'F:/fixture/changed' } : row)
      if (change === 'source-parent' || change === 'destination-parent') await act(async () => { f.view.actions.setWorkspaceParent(f.workspace.items, change === 'source-parent' ? 'w1' : 'w2', change === 'source-parent' ? 'w2' : 'w1', true) })
      if (change === 'third-owner') f.workspace.items = [...f.workspace.items.map(row => ({ ...row, sessionIds: row.sessionIds.filter(id => id !== 's1') })), { workspaceId: 'w3', title: '第三方', path: 'F:/fixture/three', sessionIds: ['s1'] }]
      if (change === 'archived') f.workspace.archivedSessionIds = ['s1']
      if (change === 'blank') f.sessions.byId = { ...f.sessions.byId, s1: { ...f.sessions.byId.s1, blank: true } }
      if (change === 'group-mode') await act(async () => { f.view.actions.setSessionTitleSlash(false) })
      if (change === 'sort-mode') await act(async () => { f.view.actions.setNavigatorSortMode('activity') })
      if (change === 'anchor-deleted') f.workspace.items = f.workspace.items.map(row => ({ ...row, sessionIds: row.sessionIds.filter(id => id !== 's3') }))
      if (change === 'anchor-title') f.sessions.byId = { ...f.sessions.byId, s3: { ...f.sessions.byId.s3, title: '目标/新锚点', displayTitle: '目标/新锚点' } }
      if (!unmounted) {
        await f.render()
        if (change === 'title') assert.equal(f.rows().find(row => row.id === 'session:s1').title, 'Other/new', 'the changed title is already published, not an in-flight rename race')
      }
      const before = structuredClone(f.view.getSnapshot().navigatorOrder)
      await act(async () => { pending.resolve() })
      assert.ok(f.workspace.items.find(row => row.workspaceId === 'w2').sessionIds.includes('s1'), 'the already-issued move may complete; no rollback')
      if (change === 'unchanged' || change === 'native-return') {
        assert.deepEqual(f.calls.business, [['provider-move', 's1', 'w2'], ['rename-session', 's1', '目标/首章']])
        assert.deepEqual(f.view.getSnapshot().navigatorOrder[parent], ['session:s1', 'session:s3'])
        if (change === 'native-return') await detach(f)
        assert.equal(f.model().operation.status, 'success')
        assert.equal(f.model().dialog, undefined)
      } else {
        assert.deepEqual(f.calls.business, [['provider-move', 's1', 'w2']], 'no new grouping RPC may use a pre-await payload')
        assert.deepEqual(f.view.getSnapshot().navigatorOrder, before, 'no stale placement metadata is committed')
        if (change === 'title' || change === 'main-unmount-new-title') assert.equal(f.sessions.byId.s1.title, 'Other/new')
        if (unmounted) assert.equal(f.calls.publishes.length, publications, 'destroyed Main publishes no result')
        else {
          assert.equal(f.model().operation.status, 'error')
          assert.match(f.model().operation.message, /navigator.moveGroupFailed.*move-group-failed/)
          assert.equal(f.model().dialog.id, editor)
        }
      }
    } finally { pending.resolve(); await f.cleanup() }
  })
})

test('R5 managed move revalidates again after grouping before committing manual placement', async t => {
  for (const change of ['original-echo', 'submitted-echo', 'native-return', 'main-unmount', 'third-title', 'sort-mode', 'anchor-title', 'destination-cwd', 'not-ready']) await t.test(change, async () => {
    const f = createFixture(), pending = Promise.withResolvers()
    try {
      f.props.sessionMoveProvider = { available: async () => true, move: async (id, target) => {
        f.calls.business.push(['provider-move', id, target])
        f.workspace.items = f.workspace.items.map(row => ({ ...row, sessionIds: row.workspaceId === target ? [...row.sessionIds, id] : row.sessionIds.filter(value => value !== id) }))
      } }
      f.props.renameSession = async (id, title) => {
        f.calls.business.push(['rename-session', id, title])
        if (change !== 'original-echo') f.sessions.byId = { ...f.sessions.byId, [id]: { ...f.sessions.byId[id], title, displayTitle: title } }
        await pending.promise
      }
      await detach(f)
      await f.command('sort', { mode: 'manual' })
      await f.command('drop', { id: 'session:s1', targetId: 'session:s3', position: 'before' })
      await submitNativeDialog(f)
      assert.deepEqual(f.calls.business, [['provider-move', 's1', 'w2'], ['rename-session', 's1', '首章']])
      assert.equal(f.model().operation.status, 'pending')
      if (change === 'main-unmount') await f.unmountMain()
      if (change === 'native-return') await f.command('return')
      if (change === 'third-title') f.sessions.byId = { ...f.sessions.byId, s1: { ...f.sessions.byId.s1, title: 'Other/new', displayTitle: 'Other/new' } }
      if (change === 'sort-mode') await act(async () => { f.view.actions.setNavigatorSortMode('activity') })
      if (change === 'anchor-title') f.sessions.byId = { ...f.sessions.byId, s3: { ...f.sessions.byId.s3, title: '新锚点', displayTitle: '新锚点' } }
      if (change === 'destination-cwd') f.workspace.items = f.workspace.items.map(row => row.workspaceId === 'w2' ? { ...row, path: 'F:/fixture/changed' } : row)
      if (change === 'not-ready') f.workspace.state = 'loading'
      if (change !== 'main-unmount') await f.render()
      const before = structuredClone(f.view.getSnapshot().navigatorOrder)
      await act(async () => { pending.resolve() })
      if (['original-echo', 'submitted-echo', 'native-return'].includes(change)) {
        assert.deepEqual(f.view.getSnapshot().navigatorOrder['workspace:w2'], ['session:s1', 'session:s3', ...(change === 'original-echo' ? ['sgroup:w2|翻译'] : [])], 'latest siblings are preserved even before the rename projection echo')
        if (change === 'original-echo') {
          f.sessions.byId = { ...f.sessions.byId, s1: { ...f.sessions.byId.s1, title: '首章', displayTitle: '首章' } }
          await f.render()
          assert.deepEqual(f.rows().filter(row => row.kind === 'session' && row.workspaceId === 'w2').map(row => row.id), ['session:s1', 'session:s3'])
        }
        if (change === 'native-return') await detach(f)
        assert.equal(f.model().operation.status, 'success')
      } else {
        assert.deepEqual(f.view.getSnapshot().navigatorOrder, before)
        if (change !== 'main-unmount') {
          assert.equal(f.model().operation.status, 'error')
          assert.match(f.model().operation.message, /navigator.moveGroupFailed/)
        }
        if (change === 'third-title') assert.equal(f.sessions.byId.s1.title, 'Other/new')
      }
      assert.equal(f.calls.business.length, 2, 'issued move/rename are never replayed or rolled back')
    } finally { pending.resolve(); await f.cleanup() }
  })
})

test('R5 confirmed manual cross-workspace before/after placement persists at root and in a group', async t => {
  for (const grouped of [false, true]) for (const position of ['before', 'after']) await t.test(`${grouped ? 'group' : 'root'} ${position}`, async () => {
    const f = createFixture(), requests = []
    let saved, movedWorkspaces, movedSessions
    const parent = grouped ? 'sgroup:w2|目标' : 'workspace:w2'
    const expected = position === 'before' ? ['session:s1', 'session:s3'] : ['session:s3', 'session:s1']
    try {
      if (grouped) f.sessions.byId.s3.title = f.sessions.byId.s3.displayTitle = '目标/锚点'
      f.props.sessionMoveProvider = { available: async () => true, move: async (id, target) => {
        requests.push([id, target])
        f.workspace.items = f.workspace.items.map(row => ({ ...row, sessionIds: row.workspaceId === target ? [...row.sessionIds, id] : row.sessionIds.filter(value => value !== id) }))
      } }
      f.view.actions.setNavigatorOrder(parent, ['session:s3'])
      await detach(f)
      await f.command('sort', { mode: 'manual' })
      await f.command('drop', { id: 'session:s1', targetId: 'session:s3', position })
      assert.equal(f.model().dialog.kind, 'confirm')
      assert.equal(requests.length, 0)
      await submitNativeDialog(f)
      assert.deepEqual(requests, [['s1', 'w2']])
      assert.equal(f.model().operation.status, 'success')
      assert.deepEqual(f.view.getSnapshot().navigatorOrder[parent], expected)
      assert.deepEqual(f.rows().filter(row => row.kind === 'session' && row.workspaceId === 'w2').map(row => row.id), expected)
      assert.equal(f.sessions.byId.s1.title, grouped ? '目标/首章' : '首章')
      await f.command('return')
      await detach(f)
      assert.deepEqual(f.rows().filter(row => row.kind === 'session' && row.workspaceId === 'w2').map(row => row.id), expected)
      saved = JSON.parse(f.dom.window.localStorage.getItem('dsh.workspaceNavigator.view.v1'))
      movedWorkspaces = structuredClone(f.workspace.items)
      movedSessions = structuredClone(f.sessions.byId)
    } finally { await f.cleanup() }
    const restored = createFixture({ persistedView: saved })
    try {
      restored.workspace.items = movedWorkspaces
      restored.sessions.byId = movedSessions
      await detach(restored)
      assert.equal(restored.model().sortMode, 'manual')
      assert.deepEqual(restored.rows().filter(row => row.kind === 'session' && row.workspaceId === 'w2').map(row => row.id), expected)
    } finally { await restored.cleanup() }
  })
})

test('R5 confirmation revalidates a manual placement anchor before invoking the move provider', async t => {
  for (const change of ['deleted', 'regrouped', 'archived', 'mode-changed', 'group-mode-changed']) await t.test(change, async () => {
    const f = createFixture(), requests = []
    try {
      f.props.sessionMoveProvider = { available: async () => true, move: async (...args) => { requests.push(args) } }
      await detach(f)
      await f.command('sort', { mode: 'manual' })
      const manual = structuredClone(f.view.getSnapshot().navigatorOrder)
      await f.command('drop', { id: 'session:s1', targetId: 'session:s3', position: 'before' })
      const dialogId = f.model().dialog.id
      if (change === 'deleted') f.workspace.items = f.workspace.items.map(row => row.workspaceId === 'w2' ? { ...row, sessionIds: [] } : row)
      if (change === 'regrouped') f.sessions.byId.s3.title = f.sessions.byId.s3.displayTitle = '其他/锚点'
      if (change === 'archived') f.workspace.archivedSessionIds = ['s3']
      if (change === 'mode-changed') await f.command('sort', { mode: 'activity' })
      if (change === 'group-mode-changed') f.view.actions.setSessionTitleSlash(false)
      await f.render()
      await f.command('dialog', { id: dialogId })
      assert.equal(f.model().operation.status, 'error')
      assert.equal(requests.length, 0)
      assert.equal(f.workspace.items.find(row => row.workspaceId === 'w1').sessionIds.includes('s1'), true)
      assert.deepEqual(f.view.getSnapshot().navigatorOrder, manual)
      assert.equal(f.calls.closes, 0)
    } finally { await f.cleanup() }
  })
})

test('R5 a refused migration or partial grouping failure never commits manual placement', async t => {
  for (const failure of ['provider', 'group']) await t.test(failure, async () => {
    const f = createFixture()
    try {
      f.props.sessionMoveProvider = { available: async () => true, move: async (id, target) => {
        if (failure === 'provider') throw new Error('fixture move refusal')
        f.workspace.items = f.workspace.items.map(row => ({ ...row, sessionIds: row.workspaceId === target ? [...row.sessionIds, id] : row.sessionIds.filter(value => value !== id) }))
      } }
      if (failure === 'group') f.props.renameSession = async () => { throw new Error('fixture rename refusal') }
      f.view.actions.setNavigatorOrder('workspace:w2', ['session:s3'])
      await detach(f)
      await f.command('sort', { mode: 'manual' })
      await f.command('drop', { id: 'session:s1', targetId: 'session:s3', position: 'before' })
      await submitNativeDialog(f)
      assert.equal(f.model().operation.status, 'error')
      assert.deepEqual(f.view.getSnapshot().navigatorOrder['workspace:w2'], ['session:s3'])
      if (failure === 'group') assert.match(f.model().operation.message, /move-group-failed/)
    } finally { await f.cleanup() }
  })
})

test('R5 same-area Native drops revalidate after a fulfilled rename before placement or logical parenting', async t => {
  const changes = ['original-echo', 'submitted-echo', 'native-return', 'native-closed', 'native-error', 'main-unmount',
    'source-title', 'source-deleted', 'source-owner-or-parent', 'anchor-title', 'anchor-deleted', 'anchor-owner-or-parent',
    'not-ready', 'group-mode', 'sort-mode', 'source-cwd', 'anchor-cwd', 'archived', 'blank']
  for (const kind of ['session', 'workspace']) for (const change of changes) {
    if ((change.endsWith('-cwd') && kind !== 'workspace') || (['archived', 'blank'].includes(change) && kind !== 'session')) continue
    await t.test(`${kind}; ${change}`, async () => {
      const f = createFixture({ strictMode: true }), pending = Promise.withResolvers()
      const workspaceKind = kind === 'workspace', sourceId = workspaceKind ? 'workspace:w1' : 'session:s1'
      const anchorId = workspaceKind ? 'workspace:w2' : 'session:s2', parentId = workspaceKind ? anchorId : 'workspace:w1'
      const prop = workspaceKind ? 'renameWorkspace' : 'renameSession', title = workspaceKind ? '项目一' : '首章'
      const setTitle = (id, value) => {
        if (workspaceKind) f.workspace.items = f.workspace.items.map(row => row.workspaceId === id ? { ...row, title: value } : row)
        else f.sessions.byId = { ...f.sessions.byId, [id]: { ...f.sessions.byId[id], title: value, displayTitle: value } }
      }
      try {
        if (workspaceKind) f.view.actions.setWorkspaceGroupMode('disk-slash')
        f.props[prop] = async (id, value) => {
          f.calls.business.push([workspaceKind ? 'rename-workspace' : 'rename-session', id, value])
          if (change !== 'original-echo') setTitle(id, value)
          await pending.promise
        }
        await detach(f)
        await f.command('sort', { mode: 'manual' })
        await f.command('drop', { id: sourceId, targetId: anchorId, position: workspaceKind ? 'inside' : 'before' })
        assert.deepEqual(f.calls.business, [[workspaceKind ? 'rename-workspace' : 'rename-session', workspaceKind ? 'w1' : 's1', title]])
        assert.equal(f.model().operation.status, 'pending')
        const publications = f.calls.publishes.length
        if (change === 'main-unmount') await f.unmountMain()
        if (change === 'native-return') await f.command('return')
        if (change === 'native-closed' || change === 'native-error') await f.emit({ kind: 'state', state: change.slice(7) })
        if (change === 'source-title' || change === 'anchor-title') setTitle(change === 'source-title' ? workspaceKind ? 'w1' : 's1' : workspaceKind ? 'w2' : 's2', 'Other/new')
        if (change === 'source-deleted' || change === 'anchor-deleted') {
          const id = change === 'source-deleted' ? workspaceKind ? 'w1' : 's1' : workspaceKind ? 'w2' : 's2'
          f.workspace.items = workspaceKind ? f.workspace.items.filter(row => row.workspaceId !== id)
            : f.workspace.items.map(row => ({ ...row, sessionIds: row.sessionIds.filter(value => value !== id) }))
        }
        if (change === 'source-owner-or-parent' || change === 'anchor-owner-or-parent') {
          if (workspaceKind) await act(async () => { f.view.actions.setWorkspaceParent(f.workspace.items, change === 'source-owner-or-parent' ? 'w1' : 'w2', change === 'source-owner-or-parent' ? 'w2' : 'w1', true) })
          else {
            const id = change === 'source-owner-or-parent' ? 's1' : 's2'
            f.workspace.items = f.workspace.items.map(row => ({ ...row, sessionIds: row.workspaceId === 'w2' ? [...row.sessionIds, id] : row.sessionIds.filter(value => value !== id) }))
          }
        }
        if (change.endsWith('-cwd')) f.workspace.items = f.workspace.items.map(row => row.workspaceId === (change === 'source-cwd' ? 'w1' : 'w2') ? { ...row, path: 'F:/fixture/changed' } : row)
        if (change === 'archived') f.workspace.archivedSessionIds = ['s1']
        if (change === 'blank') f.sessions.byId = { ...f.sessions.byId, s1: { ...f.sessions.byId.s1, blank: true } }
        if (change === 'not-ready') f.workspace.state = 'loading'
        if (change === 'group-mode') await act(async () => { workspaceKind ? f.view.actions.setWorkspaceGroupMode('disk') : f.view.actions.setSessionTitleSlash(false) })
        if (change === 'sort-mode') await act(async () => { f.view.actions.setNavigatorSortMode('activity') })
        if (change !== 'main-unmount') await f.render()
        const before = structuredClone(f.view.getSnapshot()), closes = f.calls.closes
        await act(async () => { pending.resolve() })
        assert.equal(f.calls.business.length, 1, 'the issued rename is not cancelled, replayed, or rolled back')
        if (['original-echo', 'submitted-echo', 'native-return', 'native-closed', 'native-error'].includes(change)) {
          const order = f.view.getSnapshot().navigatorOrder[parentId]
          if (workspaceKind) {
            assert.equal(f.view.getSnapshot().workspaceParents.w1, 'w2')
            assert.deepEqual(order, ['session:s3', sourceId])
          } else assert.ok(order.indexOf(sourceId) !== -1 && order.indexOf(sourceId) < order.indexOf(anchorId))
          if (change.startsWith('native-')) await detach(f)
          assert.equal(f.model().operation.status, 'success', 'Native exit does not revoke the still-mounted Main')
          if (change === 'original-echo') { setTitle(workspaceKind ? 'w1' : 's1', title); await f.render() }
          if (!workspaceKind) assert.deepEqual(f.rows().filter(row => row.kind === 'session' && row.workspaceId === 'w1').map(row => row.id), ['session:s1', 'session:s2'])
        } else {
          assert.deepEqual(f.view.getSnapshot().navigatorOrder, before.navigatorOrder, 'no stale manual placement is committed')
          assert.deepEqual(f.view.getSnapshot().workspaceParents, before.workspaceParents, 'no stale logical parent is committed')
          if (change === 'main-unmount') assert.equal(f.calls.publishes.length, publications, 'disposed Main publishes no late result')
          else {
            assert.equal(f.model().operation.status, 'error')
            assert.match(f.model().operation.message, /navigator.continuationPartial.*continuation-partial/, 'a fulfilled write followed by refusal is partial, not cancellation or full success')
          }
          if (change === 'source-title') assert.equal(workspaceKind ? f.workspace.items.find(row => row.workspaceId === 'w1').title : f.sessions.byId.s1.title, 'Other/new')
        }
        assert.equal(f.calls.closes, closes, 'continuation refusal never closes Native')
      } finally { pending.resolve(); await f.cleanup() }
    })
  }
})

test('R5 Native group drops retain completed group edits but refuse obsolete post-await placement', async t => {
  for (const kind of ['sgroup', 'folder']) for (const change of ['original-echo', 'submitted-echo', 'native-return', 'main-unmount', 'anchor-title', 'sort-mode', 'not-ready', 'source-title']) await t.test(`${kind}; ${change}`, async () => {
    const f = createFixture(), pending = Promise.withResolvers(), workspaceKind = kind === 'folder'
    const sourceId = workspaceKind ? 'folder:G' : 'sgroup:w1|G', nextId = workspaceKind ? 'folder:Target/G' : 'sgroup:w1|Target/G'
    const anchorId = workspaceKind ? 'workspace:w2' : 'session:s2', parentId = workspaceKind ? 'folder:Target' : 'sgroup:w1|Target'
    const setTitle = (id, title) => {
      if (workspaceKind) f.workspace.items = f.workspace.items.map(row => row.workspaceId === id ? { ...row, title } : row)
      else f.sessions.byId = { ...f.sessions.byId, [id]: { ...f.sessions.byId[id], title, displayTitle: title } }
    }
    try {
      if (workspaceKind) f.view.actions.setWorkspaceGroupMode('disk-slash')
      setTitle(workspaceKind ? 'w1' : 's1', 'G/One')
      setTitle(workspaceKind ? 'w2' : 's2', 'Target/Anchor')
      f.view.actions.addFolder(workspaceKind ? 'workspace' : 'session', workspaceKind ? '' : 'w1', 'G/Empty')
      f.view.actions.addFolder(workspaceKind ? 'workspace' : 'session', workspaceKind ? '' : 'w1', 'Target')
      f.view.actions.setNavigatorOrder(parentId, [anchorId])
      const beforeFolders = structuredClone(f.view.getSnapshot().folders)
      f.props[workspaceKind ? 'renameWorkspace' : 'renameSession'] = async (id, title) => {
        f.calls.business.push([workspaceKind ? 'rename-workspace' : 'rename-session', id, title])
        if (change !== 'original-echo') setTitle(id, title)
        await pending.promise
      }
      await detach(f)
      await f.command('sort', { mode: 'manual' })
      await f.command('drop', { id: sourceId, targetId: anchorId, position: 'before' })
      assert.equal(f.model().operation.status, 'pending')
      assert.deepEqual(f.calls.business, [[workspaceKind ? 'rename-workspace' : 'rename-session', workspaceKind ? 'w1' : 's1', 'Target/G/One']])
      const publications = f.calls.publishes.length
      if (change === 'main-unmount') await f.unmountMain()
      if (change === 'native-return') await f.command('return')
      if (change === 'anchor-title') setTitle(workspaceKind ? 'w2' : 's2', 'Else/Anchor')
      if (change === 'source-title') setTitle(workspaceKind ? 'w1' : 's1', 'Other/new')
      if (change === 'sort-mode') await act(async () => { f.view.actions.setNavigatorSortMode('activity') })
      if (change === 'not-ready') f.sessions.phase = 'pending'
      if (change !== 'main-unmount') await f.render()
      await act(async () => { pending.resolve() })
      assert.equal(f.calls.business.length, 1, 'completed member rename is never replayed or rolled back')
      const state = f.view.getSnapshot()
      if (['main-unmount', 'not-ready', 'source-title'].includes(change)) {
        assert.deepEqual(state.folders, beforeFolders, 'the existing batch owner refuses its own invalid metadata commit')
        if (change === 'main-unmount') assert.equal(f.calls.publishes.length, publications)
        else {
          assert.equal(f.model().operation.status, 'error')
          assert.match(f.model().operation.message, /navigator.groupPartial/)
        }
        if (change === 'source-title') assert.equal(workspaceKind ? f.workspace.items.find(row => row.workspaceId === 'w1').title : f.sessions.byId.s1.title, 'Other/new')
      } else {
        assert.ok(state.folders[workspaceKind ? 'ws' : 'sess'][workspaceKind ? '' : 'w1'].includes('Target/G/Empty'), 'a completed group remap is retained even if the separate placement is refused')
        if (change === 'anchor-title' || change === 'sort-mode') {
          assert.equal(f.model().operation.status, 'error')
          assert.match(f.model().operation.message, /navigator.continuationPartial.*continuation-partial/)
        } else {
          assert.deepEqual(state.navigatorOrder[parentId], [nextId, anchorId])
          if (change === 'native-return') await detach(f)
          assert.equal(f.model().operation.status, 'success')
          if (change === 'original-echo') { setTitle(workspaceKind ? 'w1' : 's1', 'Target/G/One'); await f.render() }
        }
      }
      if (!['original-echo', 'submitted-echo', 'native-return'].includes(change)) assert.deepEqual(state.navigatorOrder[parentId], [anchorId], 'no obsolete placement follows the awaited group edit')
    } finally { pending.resolve(); await f.cleanup() }
  })
})

test('R5 fulfilled-drop partial feedback uses the existing Chinese and English dictionaries', async t => {
  for (const lang of ['zh', 'en']) await t.test(lang, async () => {
    const f = createFixture(), pending = Promise.withResolvers()
    try {
      const rename = f.props.renameSession
      f.props.renameSession = async (...args) => { await rename(...args); await pending.promise }
      await detach(f)
      f.props.t = key => f.locales[lang][key] || key
      await f.render()
      await f.command('sort', { mode: 'manual' })
      await f.command('drop', { id: 'session:s1', targetId: 'session:s2', position: 'before' })
      f.sessions.byId = { ...f.sessions.byId, s2: { ...f.sessions.byId.s2, title: 'Other/new', displayTitle: 'Other/new' } }
      await f.render()
      await act(async () => { pending.resolve() })
      assert.equal(f.model().operation.status, 'error')
      const text = f.locales[lang]['navigator.continuationPartial']
      assert.ok(text && f.model().operation.message.startsWith(text))
      assert.doesNotMatch(f.model().operation.message, /navigator\./, 'no untranslated dictionary key is exposed')
      assert.match(text, lang === 'zh' ? /已完成.*未回滚.*重试剩余操作/ : /step completed.*not rolled back.*remaining steps/)
      assert.equal(f.calls.business.length, 1)
      assert.equal(f.sessions.byId.s1.title, '首章', 'the fulfilled rename remains completed')
    } finally { pending.resolve(); await f.cleanup() }
  })
})

test('R5 disabled slash grouping preserves literal titles during same-area reorder and confirmed migration', async () => {
  const f = createFixture()
  try {
    f.view.actions.setSessionTitleSlash(false)
    f.sessions.byId.s3.title = f.sessions.byId.s3.displayTitle = '生活/清单'
    f.props.sessionMoveProvider = { available: async () => true, move: async (id, target) => {
      f.workspace.items = f.workspace.items.map(row => ({ ...row, sessionIds: row.workspaceId === target ? [...row.sessionIds, id] : row.sessionIds.filter(value => value !== id) }))
    } }
    await detach(f)
    await f.command('sort', { mode: 'manual' })
    await f.command('drop', { id: 'session:s1', targetId: 'session:s2', position: 'before' })
    assert.equal(f.sessions.byId.s1.title, '翻译/首章')
    await f.command('drop', { id: 'session:s1', targetId: 'session:s3', position: 'before' })
    await submitNativeDialog(f)
    assert.equal(f.model().operation.status, 'success')
    assert.equal(f.sessions.byId.s1.title, '翻译/首章')
    assert.equal(f.sessions.byId.s3.title, '生活/清单')
    assert.deepEqual(f.view.getSnapshot().navigatorOrder['workspace:w2'], ['session:s1', 'session:s3'])
    assert.equal(f.calls.business.some(call => call[0] === 'rename-session'), false)
  } finally { await f.cleanup() }
})

test('R5 appearance control captions are projected from the existing Main locale owner', async () => {
  const f = createFixture()
  try {
    await detach(f)
    for (const key of ['color', 'glow', 'weight', 'shadow', 'stroke', 'strokeWidth', 'strokeColor', 'icon', 'reset', 'auto', 'iconSolid', 'iconOutline', 'iconNone']) {
      assert.equal(typeof f.model().labels[key], 'string')
      assert.match(f.model().labels[key], /^custom\./)
    }
    parseWorkspaceNavigatorModel(f.model())
  } finally { await f.cleanup() }
})

test('R5 provider adapter uses authenticated same-origin HTTP only and treats non-ok JSON as failure', async () => {
  const f = createFixture()
  try {
    const requests = []
    let refusal = false
    const provider = f.createSessionMoveProvider(async (url, init) => {
      requests.push([url, init])
      return { ok: !refusal, status: refusal ? 403 : 200, json: async () => refusal ? { ok: false, code: 'forbidden', error: 'owner required' }
        : { ok: true, result: url.endsWith('/workspace-archives') ? { archives: {} } : { sessionId: 'isolated' } } }
    })
    assert.equal(await provider.available(), true)
    await provider.move('isolated', 'target')
    assert.equal(requests[1][0], '/session-manager/api/move')
    assert.equal(requests[1][1].credentials, 'same-origin')
    assert.deepEqual(JSON.parse(requests[1][1].body), { sessionId: 'isolated', targetWorkspaceId: 'target' })
    refusal = true
    await assert.rejects(provider.move('isolated', 'target'), error => error.code === 'forbidden')
    assert.equal(await provider.available(), false)
  } finally { await f.cleanup() }
})

test('R5 automatic drops change group/parent only and manual sibling positions survive toggling and reopen', async () => {
  const f = createFixture()
  try {
    f.view.actions.addFolder('session', 'w1', '空组')
    await detach(f)
    assert.equal(f.model().sortMode, 'activity')
    await f.command('drop', { id: 'session:s2', targetId: 'sgroup:w1|翻译', position: 'inside' })
    assert.equal(f.sessions.byId.s2.title, '翻译/代码审核')
    assert.deepEqual(f.view.getSnapshot().navigatorOrder, {}, 'automatic drops never write fake manual positions')
    await f.command('sort', { mode: 'manual' })
    await f.command('drop', { id: 'session:s2', targetId: 'session:s1', position: 'before' })
    let sessions = f.rows().filter(row => row.kind === 'session' && row.workspaceId === 'w1').map(row => row.id)
    assert.deepEqual(sessions, ['session:s2', 'session:s1'])
    const manual = structuredClone(f.view.getSnapshot().navigatorOrder)
    await f.command('sort', { mode: 'activity' })
    f.sessions.byId.s1 = { ...f.sessions.byId.s1, projectionValues: { workspaceNavigatorActivity: { lastContentAt: 9999 } } }
    await f.render()
    assert.equal(f.rows().filter(row => row.kind === 'session' && row.workspaceId === 'w1')[0].id, 'session:s1')
    await f.command('sort', { mode: 'manual' })
    assert.deepEqual(f.rows().filter(row => row.kind === 'session' && row.workspaceId === 'w1').map(row => row.id), sessions)
    assert.deepEqual(f.view.getSnapshot().navigatorOrder, manual)
    await f.emit({ kind: 'state', state: 'closed' })
    await detach(f)
    assert.equal(f.model().sortMode, 'manual')
    assert.deepEqual(f.rows().filter(row => row.kind === 'session' && row.workspaceId === 'w1').map(row => row.id), sessions)
    assert.equal(f.calls.starts, 0)
  } finally { await f.cleanup() }
})

test('R5 Native workspace/group management preserves exact same-name scopes and declared empty groups', async () => {
  const f = createFixture()
  try {
    f.view.actions.setWorkspaceGroupMode('disk-slash')
    f.workspace.items = [
      { workspaceId: 'w1', title: '父一', path: 'F:/fixture/one', sessionIds: [] },
      { workspaceId: 'w2', title: '父二', path: 'F:/fixture/two', sessionIds: [] },
      { workspaceId: 'c1', title: '共同/子一', path: 'F:/fixture/one/child', sessionIds: ['s1'] },
      { workspaceId: 'c2', title: '共同/子二', path: 'F:/fixture/two/child', sessionIds: ['s2', 's3'] },
    ]
    f.view.actions.addFolder('workspace', 'w1', '共同/空')
    f.view.actions.addFolder('workspace', 'w2', '共同/空')
    f.view.actions.addFolder('session', 'c1', '空会话组')
    f.sessions.byId.s2.title = '翻译/另一会话'
    await detach(f)
    await menuAction(f, 'folder:w1//共同', 'rename-folder')
    await submitNativeDialog(f, { value: '单独' })
    assert.equal(f.workspace.items.find(row => row.workspaceId === 'c1').title, '单独/子一')
    assert.equal(f.workspace.items.find(row => row.workspaceId === 'c2').title, '共同/子二')
    assert.deepEqual(f.view.getSnapshot().folders.ws.w1, ['单独/空'])
    assert.deepEqual(f.view.getSnapshot().folders.ws.w2, ['共同/空'])
    await menuAction(f, 'folder:w1//单独/空', 'delete-folder')
    assert.equal(f.model().dialog.kind, 'confirm')
    await submitNativeDialog(f)
    assert.equal(f.view.getSnapshot().folders.ws.w1, undefined)
    assert.deepEqual(f.view.getSnapshot().folders.ws.w2, ['共同/空'])
    await menuAction(f, 'sgroup:c1|翻译', 'rename-sgroup')
    await submitNativeDialog(f, { value: '本区' })
    assert.equal(f.sessions.byId.s1.title, '本区/首章')
    assert.equal(f.sessions.byId.s2.title, '翻译/另一会话')
    await menuAction(f, 'sgroup:c1|空会话组', 'rename-sgroup')
    await submitNativeDialog(f, { value: '已改空组' })
    assert.deepEqual(f.view.getSnapshot().folders.sess.c1, ['已改空组'])
    await menuAction(f, 'sgroup:c1|已改空组', 'delete-sgroup')
    await submitNativeDialog(f)
    assert.equal(f.view.getSnapshot().folders.sess.c1, undefined)
    await menuAction(f, 'workspace:c1', 'rename')
    await submitNativeDialog(f, { value: '单独/重命名子一' })
    assert.equal(f.workspace.items.find(row => row.workspaceId === 'c1').title, '单独/重命名子一')
    await menuAction(f, 'workspace:c2', 'delete')
    await f.command('cancel-dialog', { id: f.model().dialog.id })
    assert.ok(f.workspace.items.some(row => row.workspaceId === 'c2'))
    await menuAction(f, 'workspace:c2', 'delete')
    await submitNativeDialog(f)
    assert.equal(f.workspace.items.some(row => row.workspaceId === 'c2'), false)
    assert.equal(f.calls.closes, 0)
  } finally { await f.cleanup() }
})

test('R5 group-block drops can change logical owner without moving paths or absorbing real sessions', async () => {
  const f = createFixture()
  try {
    f.view.actions.setWorkspaceGroupMode('disk-slash')
    f.workspace.items = [
      { workspaceId: 'w1', title: '父一', path: 'F:/fixture/one', sessionIds: [] },
      { workspaceId: 'w2', title: '父二', path: 'F:/fixture/two', sessionIds: ['s3'] },
      { workspaceId: 'c1', title: '分组/子一', path: 'F:/fixture/one/child', sessionIds: ['s1'] },
      { workspaceId: 'c2', title: '分组/子二', path: 'F:/fixture/one/child2', sessionIds: ['s2'] },
    ]
    f.view.actions.addFolder('workspace', 'w1', '分组/空')
    f.view.actions.addFolder('workspace', '', '空顶')
    const real = f.workspace.items.map(row => [row.workspaceId, row.path, [...row.sessionIds]])
    await detach(f)
    await f.command('drop', { id: 'folder:w1//分组', targetId: 'workspace:c1', position: 'inside' })
    assert.equal(f.model().operation.status, 'error', 'group cannot become the parent of its own workspace member')
    await f.command('drop', { id: 'folder:w1//分组', targetId: 'workspace:w2', position: 'inside' })
    assert.equal(f.model().operation.status, 'success')
    assert.equal(f.view.getSnapshot().workspaceParents.c1, 'w2')
    assert.equal(f.view.getSnapshot().workspaceParents.c2, 'w2')
    assert.ok(f.rows().some(row => row.id === 'folder:w2//分组/空'))
    assert.equal(f.rows().some(row => row.id === 'folder:w1//分组'), false)
    await f.command('drop', { id: 'folder:空顶', targetId: 'workspace:w1', position: 'inside' })
    assert.ok(f.rows().some(row => row.id === 'folder:w1//空顶'))
    assert.equal(f.view.getSnapshot().folders.ws[''], undefined)
    assert.deepEqual(f.workspace.items.map(row => [row.workspaceId, row.path, [...row.sessionIds]]), real)
    assert.equal(f.rows().find(row => row.id === 'session:s1').workspaceId, 'c1')
    assert.equal(f.rows().find(row => row.id === 'session:s2').workspaceId, 'c2')
    assert.equal(f.calls.closes, 0)
  } finally { await f.cleanup() }
})

test('R5 menu/editor order holds through activity changes and explicit cancel releases automatic ordering', async () => {
  const f = createFixture()
  try {
    await detach(f)
    const initial = f.model().workspaces.map(card => card.id)
    await f.command('context', { id: 'session:s1' })
    const menuId = f.model().contextMenu.id
    f.sessions.byId.s1 = { ...f.sessions.byId.s1, projectionValues: { workspaceNavigatorActivity: { lastContentAt: 900 } } }
    await f.render()
    assert.deepEqual(f.model().workspaces.map(card => card.id), initial, 'menu reads fresh status without activity shuffle')
    assert.equal(f.model().contextMenu.id, menuId)
    await f.command('action', { id: menuId, action: 'cancel' })
    assert.equal(f.model().contextMenu, undefined)
    assert.deepEqual(f.model().workspaces.map(card => card.id), ['workspace:w1', 'workspace:w2'])
    assert.deepEqual(f.view.getSnapshot().navigatorOrder, {}, 'temporary interaction hold is not a persisted manual order')
  } finally { await f.cleanup() }
})

test('R5 cross-workspace drops require confirmation and apply destination grouping using the same title helper', async () => {
  const f = createFixture()
  try {
    f.sessions.byId.s3.title = '目标组/会话'
    f.props.sessionMoveProvider = { available: async () => true, move: async (id, target) => {
      f.calls.business.push(['provider-move', id, target])
      f.workspace.items = f.workspace.items.map(row => ({ ...row, sessionIds: row.workspaceId === target ? [...row.sessionIds, id] : row.sessionIds.filter(value => value !== id) }))
    } }
    await detach(f)
    await f.command('drop', { id: 'session:s1', targetId: 'sgroup:w2|目标组', position: 'inside' })
    assert.equal(f.model().dialog.kind, 'confirm')
    assert.equal(f.calls.business.some(call => call[0] === 'provider-move'), false)
    await submitNativeDialog(f)
    assert.equal(f.sessions.byId.s1.title, '目标组/首章')
    assert.equal(f.rows().find(row => row.id === 'session:s1').workspaceId, 'w2')
    assert.deepEqual(f.calls.business.slice(-2), [['provider-move', 's1', 'w2'], ['rename-session', 's1', '目标组/首章']])
    assert.equal(f.calls.closes, 0)
  } finally { await f.cleanup() }
})

test('R5 workspace preset dialog loads in Native, validates latest roster, and allocates nothing before explicit submit', async () => {
  const f = createFixture()
  try {
    f.props.presetFaceOf = () => ({ list: async () => ({ ok: true, presets: [{ id: 'valid', name: '有效预设' }, { id: 'broken', broken: true }] }), select: async () => ({ ok: true }) })
    f.props.createPresetSession = async input => { f.calls.business.push(['preset-create', input]) }
    await detach(f)
    await menuAction(f, 'workspace:w1', 'ws-preset')
    assert.equal(f.model().dialog.kind, 'select')
    assert.deepEqual(f.model().dialog.options.map(option => option.id), ['valid'])
    assert.equal(f.calls.business.length, 0)
    await submitNativeDialog(f, { value: 'broken' })
    assert.equal(f.model().operation.status, 'error')
    assert.equal(f.calls.business.length, 0)
    await submitNativeDialog(f, { value: 'valid' })
    assert.deepEqual(f.calls.business, [['preset-create', { cwd: 'F:/fixture/one', agentPreset: 'valid' }]])
    assert.equal(f.model().dialog, undefined)
    assert.equal(f.calls.starts, 0)
  } finally { await f.cleanup() }
})

test('R5 preset preparation cannot create or select from an obsolete Main workspace or blank binding', async t => {
  for (const hasBlank of [false, true]) for (const change of ['unchanged', 'native-return', 'main-unmount', 'not-ready', 'title', 'cwd', 'parent', 'deleted', 'blank-binding', 'preset-binding']) {
    if (!hasBlank && change === 'preset-binding') continue
    await t.test(`blank=${hasBlank}; ${change}`, async () => {
      const f = createFixture({ strictMode: true }), pending = Promise.withResolvers()
      let listCalls = 0
      const roster = { ok: true, presets: [{ id: 'valid', name: '有效预设' }] }
      try {
        if (hasBlank) f.sessions.byId = { ...f.sessions.byId, s2: { ...f.sessions.byId.s2, blank: true, cwd: 'F:/fixture/one', projectionValues: { agentPreset: 'original' } } }
        const face = {
          list: async () => ++listCalls === 2 ? pending.promise : roster,
          select: async (id, preset) => { f.calls.business.push(['preset-select', id, preset]); return { ok: true } },
        }
        f.props.presetFaceOf = () => face
        f.props.createPresetSession = async input => { f.calls.business.push(['preset-create', input]); return 'new-id' } // actual Promise<SessionId>, not {ok:false}
        await detach(f)
        await menuAction(f, 'workspace:w1', 'ws-preset')
        assert.deepEqual(f.model().dialog.options.map(row => row.id), ['valid'])
        const editor = f.model().dialog.id
        await submitNativeDialog(f, { value: 'valid' })
        assert.equal(listCalls, 2)
        assert.equal(f.model().operation.status, 'pending')
        assert.deepEqual(f.calls.business, [])
        const publications = f.calls.publishes.length
        if (change === 'main-unmount') await f.unmountMain()
        if (change === 'native-return') await f.command('return')
        if (change === 'not-ready') f.sessions.phase = 'pending'
        if (change === 'title' || change === 'cwd') f.workspace.items = f.workspace.items.map(row => row.workspaceId === 'w1' ? { ...row, ...(change === 'title' ? { title: 'Other/new' } : { path: 'F:/fixture/changed' }) } : row)
        if (change === 'parent') await act(async () => { f.view.actions.setWorkspaceParent(f.workspace.items, 'w1', 'w2', true) })
        if (change === 'deleted') f.workspace.items = f.workspace.items.filter(row => row.workspaceId !== 'w1')
        if (change === 'blank-binding') f.sessions.byId = { ...f.sessions.byId, s2: { ...f.sessions.byId.s2, blank: !hasBlank, cwd: 'F:/fixture/one' } }
        if (change === 'preset-binding') f.sessions.byId = { ...f.sessions.byId, s2: { ...f.sessions.byId.s2, projectionValues: { agentPreset: 'external' } } }
        if (change !== 'main-unmount') await f.render()
        await act(async () => { pending.resolve(roster) })
        if (change === 'unchanged' || change === 'native-return') {
          assert.deepEqual(f.calls.business, hasBlank ? [['preset-select', 's2', 'valid']] : [['preset-create', { cwd: 'F:/fixture/one', agentPreset: 'valid' }]])
          if (change === 'native-return') await detach(f)
          assert.equal(f.model().operation.status, 'success')
          assert.equal(f.model().dialog, undefined)
        } else {
          assert.deepEqual(f.calls.business, [], 'a successful roster response does not authorize a new write from an obsolete owner/selection')
          if (change === 'main-unmount') assert.equal(f.calls.publishes.length, publications)
          else {
            assert.equal(f.model().operation.status, 'error')
            assert.equal(f.model().dialog.id, editor, 'the refused editor remains recoverable')
          }
        }
        assert.equal(f.calls.starts, 0)
      } finally { pending.resolve(roster); await f.cleanup() }
    })
  }
})

test('R5 automatic tokens and child-workspace icons remain valid finite Native appearance data', async () => {
  const f = createFixture()
  try {
    f.workspace.items = f.workspace.items.map(row => row.workspaceId === 'w2' ? { ...row, path: 'F:/fixture/one/child' } : row)
    f.view.actions.setStyling('workspace:w2', { color: 'auto:3', icon: 'IconArchiveOffOutlineRegular' })
    await detach(f)
    const child = f.rows().find(row => row.id === 'workspace:w2')
    assert.ok(child.icon)
    await menuAction(f, 'workspace:w2', 'customize')
    assert.equal(f.model().dialog.appearance.color, 'auto:3')
    await submitNativeDialog(f, { appearance: { ...f.model().dialog.appearance, glow: 4 } })
    assert.equal(f.view.getSnapshot().styling['workspace:w2'].color, 'auto:3')
    assert.equal(f.view.getSnapshot().styling['workspace:w2'].icon, 'IconArchiveOffOutlineRegular')
    assert.equal(f.calls.closes, 0)
  } finally { await f.cleanup() }
})

test('R5 client rejects unknown fields and remains actionable after invalid bounded input', async () => {
  const f = createFixture()
  try {
    await detach(f)
    await f.command('activate', { id: 'session:s1', workspaceId: 'w2' })
    assert.deepEqual(f.calls.selected, [])
    assert.equal(f.model().operation.status, 'error')
    assert.match(f.model().operation.message, /invalid-command/)
    await f.command('drop', { id: 'workspace:w1', targetId: 'workspace:w2', position: 'around' })
    assert.equal(f.model().operation.status, 'error')
    await f.command('activate', { id: 'session:s2' })
    assert.deepEqual(f.calls.selected, ['s2'])
    assert.equal(f.calls.closes, 0)
  } finally { await f.cleanup() }
})

test('R5 folder relocation maintains Main sibling-name tokens independently of full Native IDs', async t => {
  for (const change of ['root-rename', 'nested-rename', 'cross-parent', 'cross-scope', 'untracked', 'workspace-token', 'session-only']) await t.test(change, async () => {
    const f = createFixture()
    try {
      const oldScope = change === 'root-rename' || change === 'workspace-token' ? '' : 'w1'
      const scope = change === 'cross-scope' ? 'w2' : oldScope
      const oldPath = change === 'root-rename' ? 'A' : change === 'workspace-token' ? 'w:A' : 'P/A'
      const path = change === 'cross-parent' ? 'Q/X' : change === 'root-rename' || change === 'workspace-token' ? 'X' : 'P/X'
      const key = (owner, name) => (owner ? owner + '//' : '') + name
      const parent = (owner, name) => name.includes('/') ? 'folder:' + key(owner, name.slice(0, name.lastIndexOf('/'))) : owner ? 'workspace:' + owner : '@root'
      const oldKey = key(oldScope, oldPath), nextKey = key(scope, path)
      const oldParent = parent(oldScope, oldPath), nextParent = parent(scope, path)
      const oldName = oldPath.split('/').at(-1)
      const tracked = change !== 'untracked'
      const initial = [tracked ? oldName : 'Untracked', 'w:bare', 'B']
      f.view.actions.addFolder('workspace', oldScope, oldPath + '/Inner/Leaf')
      f.view.actions.addFolder('workspace', 'unrelated', 'P/A/Keep')
      f.view.actions.setFolderOrder(oldParent, initial)
      if (nextParent !== oldParent) f.view.actions.setFolderOrder(nextParent, ['Existing', 'w:other'])
      f.view.actions.setFolderOrder('folder:' + oldKey, ['Inner', 'w:child'])
      f.view.actions.setFolderOrder('folder:' + oldKey + '/Inner', ['Leaf'])
      f.view.actions.setFolderOrder('folder:unrelated//P', ['A', 'w:untouched'])
      f.view.actions.setStyling('folder:' + oldKey, { color: '#aabbcc' })
      f.view.actions.setExpanded('folder:' + oldKey, false)
      f.view.actions.setExpanded('folder:' + oldKey + '/Inner', false)
      f.view.actions.setExpanded('folder:unrelated//P/A', false)
      f.view.actions.setNavigatorOrder('@root', ['workspace:bare', 'folder:' + oldKey])
      const before = structuredClone(f.view.getSnapshot())
      if (change === 'session-only') {
        f.view.actions.addFolder('session', oldScope, oldPath)
        f.view.actions.renameFolder('session', oldScope, oldPath, path)
        assert.deepEqual(f.view.getSnapshot().folderOrder, before.folderOrder, 'session grouping cannot reinterpret workspace sibling tokens')
        return
      }
      if (scope === oldScope) f.view.actions.renameFolder('workspace', scope, oldPath, path)
      else f.view.actions.moveFolder('workspace', oldScope, oldPath, scope, path)
      const state = f.view.getSnapshot()
      if (oldParent === nextParent) assert.deepEqual(state.folderOrder[oldParent], tracked && change !== 'workspace-token' ? ['X', 'w:bare', 'B'] : initial)
      else {
        assert.deepEqual(state.folderOrder[oldParent], ['w:bare', 'B'])
        assert.deepEqual(state.folderOrder[nextParent], ['Existing', 'w:other', 'X'])
      }
      assert.deepEqual(state.folderOrder['folder:' + nextKey], ['Inner', 'w:child'])
      assert.deepEqual(state.folderOrder['folder:' + nextKey + '/Inner'], ['Leaf'])
      assert.equal(state.folderOrder['folder:' + oldKey], undefined)
      assert.deepEqual(state.folderOrder['folder:unrelated//P'], ['A', 'w:untouched'])
      assert.deepEqual(state.folders.ws[scope], [path + '/Inner/Leaf'])
      assert.deepEqual(state.folders.ws.unrelated, ['P/A/Keep'])
      assert.deepEqual(state.styling['folder:' + nextKey], { color: '#aabbcc' })
      assert.equal(state.expanded['folder:' + nextKey], false)
      assert.equal(state.expanded['folder:' + nextKey + '/Inner'], false)
      assert.equal(state.expanded['folder:unrelated//P/A'], false)
      assert.deepEqual(state.navigatorOrder['@root'], ['workspace:bare', 'folder:' + nextKey], 'Native full-ID remapping remains a separate representation')
      if (change === 'root-rename') {
        const tree = f.buildTree([{ workspaceId: 'one', title: 'X/one', path: 'F:/fixture/one' }, { workspaceId: 'two', title: 'B/two', path: 'F:/fixture/two' }, { workspaceId: 'bare', title: 'Plain', path: 'F:/fixture/plain' }], 'disk-slash', state.folders.ws, state.folderOrder)
        assert.deepEqual(tree.seq.map(item => item.kind === 'folder' ? item.node.name : 'w:' + item.entry.workspaceId), ['X', 'w:bare', 'B'])
      }
    } finally { await f.cleanup() }
  })
})

test('R5 Native shared folder edits preserve real Main original ordering for rename and cross-parent or scope moves', async t => {
  for (const compactChains of [false, true]) for (const change of ['root-rename', 'nested-rename', 'cross-parent', 'cross-scope']) await t.test(`compactChains=${compactChains}; ${change}`, async () => {
    const f = createFixture({ compactChains })
    try {
      const nested = change === 'nested-rename', crossing = change.startsWith('cross-')
      const oldPath = nested ? 'P/A' : 'A'
      const nextPath = nested ? 'P/X' : change === 'root-rename' ? 'X' : change === 'cross-parent' ? 'P/A' : 'A'
      const scope = change === 'cross-scope' ? 'parent' : ''
      const nextKey = (scope ? scope + '//' : '') + nextPath
      const bPath = nested || change === 'cross-parent' ? 'P/B' : 'B'
      f.workspace.items = [
        { workspaceId: 'w1', title: oldPath + '/one', path: 'F:/fixture/one', sessionIds: ['s1'] },
        { workspaceId: 'w2', title: bPath + '/two', path: change === 'cross-scope' ? 'F:/fixture/parent/two' : 'F:/fixture/two', sessionIds: ['s3'] },
        { workspaceId: 'bare', title: nested ? 'P/Plain' : 'Plain', path: 'F:/fixture/plain', sessionIds: ['s2'] },
        { workspaceId: 'parent', title: 'Parent', path: 'F:/fixture/parent', sessionIds: [] },
        ...(crossing ? [{ workspaceId: 'destBare', title: change === 'cross-parent' ? 'P/Other' : 'Other', path: change === 'cross-scope' ? 'F:/fixture/parent/other' : 'F:/fixture/other', sessionIds: [] }] : []),
      ]
      f.view.actions.setWorkspaceGroupMode('disk-slash')
      f.view.actions.addFolder('workspace', '', oldPath + '/Inner/Leaf')
      f.view.actions.setExpanded('folder:' + oldPath, false)
      f.view.actions.setFolderOrder(nested ? 'folder:P' : '@root', crossing ? ['A', 'w:bare', change === 'cross-parent' ? 'P' : 'w:parent'] : ['A', 'w:bare', 'B', ...(!nested ? ['w:parent'] : [])])
      f.view.actions.setFolderOrder('folder:' + oldPath, ['Inner', 'w:w1'])
      if (crossing) f.view.actions.setFolderOrder(change === 'cross-parent' ? 'folder:P' : 'workspace:parent', ['B', 'w:destBare'])
      f.view.actions.setNavigatorSortMode('manual')
      const nativeParent = nested ? 'folder:P' : '@root'
      const initialNative = ['folder:' + bPath, 'workspace:bare', 'folder:' + oldPath, ...(!nested ? ['workspace:parent'] : [])]
      f.view.actions.setNavigatorOrder(nativeParent, initialNative)
      await detach(f)
      if (crossing) await f.command('drop', { id: 'folder:' + oldPath, targetId: change === 'cross-parent' ? 'folder:P' : 'workspace:parent', position: 'inside' })
      else { await menuAction(f, 'folder:' + oldPath, 'rename-folder'); await submitNativeDialog(f, { value: nextPath }) }
      assert.equal(f.model().operation.status, 'success')
      const state = f.view.getSnapshot()
      assert.deepEqual(state.folderOrder['folder:' + nextKey], ['Inner', 'w:w1'])
      assert.equal(state.expanded['folder:' + nextKey], false)
      if (crossing) {
        assert.deepEqual(state.folderOrder[change === 'cross-parent' ? 'folder:P' : 'workspace:parent'], ['B', 'w:destBare', 'A'])
        assert.equal(state.folderOrder['@root'].includes('A'), false)
      } else {
        assert.deepEqual(state.folderOrder[nested ? 'folder:P' : '@root'], ['X', 'w:bare', 'B', ...(!nested ? ['w:parent'] : [])])
        assert.deepEqual(state.navigatorOrder[nativeParent], initialNative.map(id => id === 'folder:' + oldPath ? 'folder:' + nextKey : id), 'conflicting Native manual order stays independent')
      }
      const bRow = compactChains ? 'ws-w2' : 'f-' + (scope ? scope + '//' : '') + bPath
      const expected = crossing ? [bRow, 'ws-destBare', 'f-' + nextKey] : ['f-' + nextKey, 'ws-bare', bRow, ...(!nested ? ['ws-parent'] : [])]
      await f.command('return')
      const actual = [...f.dom.window.document.querySelectorAll('.wn-tree [data-row-key]')].map(row => row.getAttribute('data-row-key')).filter(key => expected.includes(key))
      assert.deepEqual(actual, expected, 'real Main rows keep the original sort intent, not renamed-group fallback order or Native ordering')
      assert.equal(f.workspace.items.find(row => row.workspaceId === 'w1').title, nextPath + '/one')
      assert.deepEqual(f.workspace.items.find(row => row.workspaceId === 'w1').sessionIds, ['s1'])
      if (change === 'cross-scope') assert.equal(state.workspaceParents.w1, 'parent')
    } finally { await f.cleanup() }
  })
})

test('R5 root group rename cannot consume a same-named unrelated workspace scope', async t => {
  for (const compactChains of [false, true]) await t.test(`compactChains=${compactChains}`, async () => {
    const f = createFixture({ compactChains })
    try {
      f.workspace.items = [
        { workspaceId: 'source', title: 'w1/one', path: 'F:/fixture/source', sessionIds: ['s1'] },
        { workspaceId: 'w1', title: 'Parent', path: 'F:/fixture/parent', sessionIds: [] },
        { workspaceId: 'child1', title: 'Keep/Zeta/one', path: 'F:/fixture/parent/c1', sessionIds: ['s2'] },
        { workspaceId: 'child2', title: 'Keep/Alpha/two', path: 'F:/fixture/parent/c2', sessionIds: ['s3'] },
      ]
      f.view.actions.setWorkspaceGroupMode('disk-slash')
      f.view.actions.addFolder('workspace', '', 'w1/Inner/Leaf')
      f.view.actions.addFolder('workspace', 'w1', 'Keep/Empty')
      f.view.actions.setFolderOrder('@root', ['w1', 'w:w1'])
      f.view.actions.setFolderOrder('folder:w1/Inner', ['Leaf'])
      f.view.actions.setFolderOrder('folder:w1//Keep', ['Zeta', 'Alpha', 'Empty'])
      for (const name of ['Keep', 'Keep/Zeta', 'Keep/Alpha']) f.view.actions.setExpanded('folder:w1//' + name, true)
      f.view.actions.setExpanded('folder:w1/Inner', false)
      f.view.actions.setExpanded('folder:w1//Keep/Empty', false)
      f.view.actions.setStyling('folder:w1/Inner', { color: '#aabbcc' })
      f.view.actions.setStyling('folder:w1//Keep', { color: '#112233' })
      f.view.actions.setNavigatorSortMode('manual')
      f.view.actions.setNavigatorOrder('@root', ['workspace:w1', 'folder:w1'])
      f.view.actions.setNavigatorOrder('folder:w1/Inner', ['folder:w1/Inner/Leaf'])
      f.view.actions.setNavigatorOrder('folder:w1//Keep', ['folder:w1//Keep/Alpha', 'folder:w1//Keep/Zeta'])
      const before = structuredClone(f.view.getSnapshot())
      await detach(f)
      await menuAction(f, 'folder:w1', 'rename-folder'); await submitNativeDialog(f, { value: 'X' })
      assert.equal(f.model().operation.status, 'success')
      const state = f.view.getSnapshot()
      for (const bag of ['folderOrder', 'expanded', 'styling', 'navigatorOrder']) {
        for (const [key, value] of Object.entries(before[bag])) if (key.includes('w1//')) assert.deepEqual(state[bag][key], value, bag + ' preserves exact unrelated scope')
        assert.equal(Object.keys(state[bag]).some(key => key.startsWith('X//') || key.startsWith('folder:X//')), false)
      }
      assert.deepEqual(state.folders.ws.w1, ['Keep/Empty'])
      assert.deepEqual(state.folders.ws[''], ['X/Inner/Leaf'])
      assert.deepEqual(state.folderOrder['@root'], ['X', 'w:w1'])
      assert.deepEqual(state.folderOrder['folder:X/Inner'], ['Leaf'])
      assert.equal(state.folderOrder['folder:w1/Inner'], undefined)
      assert.equal(state.expanded['folder:X/Inner'], false)
      assert.deepEqual(state.styling['folder:X/Inner'], { color: '#aabbcc' })
      assert.deepEqual(state.navigatorOrder['folder:X/Inner'], ['folder:X/Inner/Leaf'])
      assert.deepEqual(state.navigatorOrder['@root'], ['workspace:w1', 'folder:X'])
      const tree = f.buildTree(f.workspace.items, 'disk-slash', state.folders.ws, state.folderOrder)
      const keep = tree.workspaces.find(item => item.workspaceId === 'w1').sub.folders.find(item => item.name === 'Keep')
      assert.deepEqual(keep.seq.filter(item => item.kind === 'folder').map(item => item.node.name), ['Zeta', 'Alpha', 'Empty'])
      await f.command('return')
      const childRows = [...f.dom.window.document.querySelectorAll('.wn-tree [data-row-key]')].map(row => row.getAttribute('data-row-key')).filter(key => ['ws-child1', 'ws-child2'].includes(key))
      assert.deepEqual(childRows, ['ws-child1', 'ws-child2'], 'the unrelated real Main subtree retains its own manual order')
      assert.equal(f.workspace.items.find(item => item.workspaceId === 'source').title, 'X/one')
    } finally { await f.cleanup() }
  })
})

// These are real BetterBrowser/store/DOM fixtures, not a second tree or SDK.
function aliasItems(sourceName = 'w1') {
  return [
    { workspaceId: 'sourceZ', title: sourceName + '/Z/one', path: 'F:/fixture/source-z', sessionIds: ['s1'] },
    { workspaceId: 'sourceA', title: sourceName + '/A/two', path: 'F:/fixture/source-a', sessionIds: [] },
    { workspaceId: 'w1', title: 'Source scope', path: 'F:/fixture/source-scope', sessionIds: [] },
    { workspaceId: 'oldZ', title: 'Z/three', path: 'F:/fixture/source-scope/z', sessionIds: ['s2'] },
    { workspaceId: 'oldA', title: 'A/four', path: 'F:/fixture/source-scope/a', sessionIds: [] },
    { workspaceId: 'X', title: 'Target scope', path: 'F:/fixture/target-scope', sessionIds: [] },
    { workspaceId: 'targetZ', title: 'Z/five', path: 'F:/fixture/target-scope/z', sessionIds: ['s3'] },
    { workspaceId: 'targetA', title: 'A/six', path: 'F:/fixture/target-scope/a', sessionIds: [] },
  ]
}
const mainRowKeys = f => [...f.dom.window.document.querySelectorAll('.wn-tree [data-row-key]')].map(row => row.getAttribute('data-row-key'))

test('R5 private roles preserve source and target exact aliases with contrary Main and Native orders', async t => {
  for (const compactChains of [false, true]) for (const ingress of ['fresh', 'published-0.1']) for (const sourceName of ['w1', 'A']) await t.test(`compactChains=${compactChains}; ${ingress}; ${sourceName}→X`, async () => {
    const sourceRole = 'folder:' + sourceName
    const legacy = { folderOrder: { '': [sourceName, 'w:w1', 'w:X'], w1: ['Z', 'A'], X: ['A', 'Z'], [sourceName]: ['Z', 'A'] }, expanded: { [sourceName]: true, [sourceName + '/Z']: false } }
    const f = createFixture({ compactChains, ...(ingress === 'published-0.1' ? { persistedView: legacy } : {}) })
    try {
      f.workspace.items = aliasItems(sourceName)
      f.view.actions.setWorkspaceGroupMode('disk-slash')
      await f.render()
      if (ingress === 'published-0.1') {
        assert.deepEqual(f.view.getSnapshot().folderOrder[sourceRole], ['Z', 'A'])
        assert.deepEqual(f.view.getSnapshot().folderOrder['workspace:w1'], ['Z', 'A'], sourceName === 'w1' ? 'proven dual-role legacy entries inherit the SAME original value' : 'the separate actual scope binds independently')
        assert.deepEqual(f.view.getSnapshot().mainViewKeys.legacy, legacy, 'ingress keeps the published original read-only')
      }
      await act(async () => {
        f.view.actions.setFolderOrder('@root', [sourceName, 'w:w1', 'w:X'])
        f.view.actions.setFolderOrder(sourceRole, ['Z', 'A'])
        f.view.actions.setFolderOrder('workspace:w1', ['A', 'Z'])
        f.view.actions.setFolderOrder('workspace:X', ['A', 'Z'])
        f.view.actions.setExpanded(sourceRole, true)
        f.view.actions.setExpanded(sourceRole + '/Z', false)
        f.view.actions.setSessionsExpanded('w1', true)
        f.view.actions.setNavigatorSortMode('manual')
        f.view.actions.setNavigatorOrder(sourceRole, [sourceRole + '/A', sourceRole + '/Z'])
        f.view.actions.setNavigatorOrder('workspace:w1', ['folder:w1//Z', 'folder:w1//A'])
      })
      await detach(f)
      await menuAction(f, sourceRole, 'rename-folder')
      await submitNativeDialog(f, { value: 'X' })
      assert.equal(f.model().operation.status, 'success')
      const state = f.view.getSnapshot()
      assert.equal(state.mainViewKeys.encoding, 'roles-v1')
      assert.deepEqual(state.folderOrder['folder:X'], ['Z', 'A'], 'renamed name group retains its own child list')
      assert.deepEqual(state.folderOrder['workspace:w1'], ['A', 'Z'], 'source raw alias is not consumed')
      assert.deepEqual(state.folderOrder['workspace:X'], ['A', 'Z'], 'target raw alias cannot overwrite the independent folder list')
      assert.equal(state.folderOrder[sourceRole], undefined)
      assert.equal(state.expanded['folder:X/Z'], false)
      assert.equal(state.sessionsExpanded.w1, true)
      assert.deepEqual(state.navigatorOrder['folder:X'], ['folder:X/A', 'folder:X/Z'])
      assert.deepEqual(f.model().workspaces.find(card => card.id === 'folder:X').rows.filter(row => row.kind === 'workspace-group').map(row => row.id), ['folder:X/A', 'folder:X/Z'], 'Native deliberately keeps its contrary manual order')
      await f.command('return')
      const keys = mainRowKeys(f)
      const sourceRows = compactChains ? ['ws-sourceZ', 'ws-sourceA'] : ['f-X/Z', 'f-X/A']
      const oldScopeRows = compactChains ? ['ws-oldA', 'ws-oldZ'] : ['f-w1//A', 'f-w1//Z']
      const targetRows = compactChains ? ['ws-targetA', 'ws-targetZ'] : ['f-X//A', 'f-X//Z']
      for (const expected of [sourceRows, oldScopeRows, targetRows]) assert.deepEqual(keys.filter(key => expected.includes(key)), expected, 'shared Native submitter returns the independently ordered actual Main DOM')
      assert.equal(f.workspace.items.find(w => w.workspaceId === 'sourceZ').title, 'X/Z/one')
      assert.deepEqual(f.workspace.items.find(w => w.workspaceId === 'sourceZ').sessionIds, ['s1'])
    } finally { await f.cleanup() }
  })
})

test('R5 published raw ingress binds only evidenced roles, including legal role-prefixed names', async t => {
  for (const variant of ['folder-only', 'scope-only', 'shared', 'folder:Legal', 'workspace:Legal', 'declared-missing-owner']) await t.test(variant, async () => {
    const prefixed = variant.includes(':')
    const raw = prefixed ? variant : variant === 'folder-only' ? 'Only' : variant === 'declared-missing-owner' ? 'absent//Keep' : 'w1'
    const legacy = { folderOrder: { [raw]: ['Z', 'A', 'w:bare'], 'unknown//Residue': ['Keep'] }, expanded: { [raw]: false, 'unknown//Residue': false },
      folders: { ws: variant === 'declared-missing-owner' ? { absent: ['Keep/A', 'Keep/Z'] } : { '': variant === 'scope-only' ? [] : [raw + '/A', raw + '/Z', ...(prefixed ? ['Legal/A', 'Legal/Z'] : [])] }, sess: {} } }
    const f = createFixture({ persistedView: legacy, compactChains: true })
    try {
      f.workspace.items = variant === 'folder-only' || prefixed || variant === 'declared-missing-owner' ? [] : [
        { workspaceId: 'w1', title: 'Parent', path: 'F:/fixture/parent', sessionIds: [] },
        { workspaceId: 'child', title: 'A/one', path: 'F:/fixture/parent/child', sessionIds: ['s1'] },
      ]
      f.view.actions.setWorkspaceGroupMode('disk-slash')
      f.view.actions.setArchivedFilter('only') // no currently visible sessions; evidence must remain complete
      await f.render()
      const state = f.view.getSnapshot(), folderRole = 'folder:' + raw
      assert.equal(state.mainViewKeys.encoding, 'roles-v1')
      assert.deepEqual(state.mainViewKeys.legacy, { folderOrder: legacy.folderOrder, expanded: legacy.expanded })
      // Amended 8e: a historical normalized global name path is declaration
      // evidence even without today's members; a scope string still creates no workspace.
      assert.deepEqual(state.folderOrder[folderRole], legacy.folderOrder[raw])
      assert.equal(state.expanded[folderRole], false, 'expanded has folder roles only')
      if (variant === 'scope-only' || variant === 'shared') assert.deepEqual(state.folderOrder['workspace:w1'], legacy.folderOrder[raw])
      else assert.equal(state.folderOrder['workspace:' + raw], undefined)
      assert.equal(state.folderOrder['folder:unknown//Residue'], undefined)
      assert.equal(state.folderOrder['workspace:unknown'], undefined)
      assert.equal(state.expanded['workspace:w1'], undefined)
      if (prefixed) {
        assert.equal(state.folderOrder[raw], undefined, 'a canonical-looking LEGACY name is not a discriminator')
        assert.equal(state.folderOrder['folder:Legal'], undefined)
      }
      assert.equal(Object.keys(state.folderOrder).every(key => key === '@root' || key.startsWith('folder:') || key.startsWith('workspace:')), true)
    } finally { await f.cleanup() }
  })
})

test('R5 explicit canonical empty/reset/second writes beat legacy and survive reopen and missing roles', async t => {
  for (const beforeBind of [false, true]) await t.test(`reset-before-binding=${beforeBind}`, async () => {
    const legacy = { folderOrder: { '': ['w1'], w1: ['Z', 'A'], late: ['Z', 'A'], 'late//Secret': ['Z', 'A'], 'unknown//Residue': ['Keep'] },
      expanded: { w1: false, 'late//Secret': false, 'unknown//Residue': false }, folders: { ws: { '': ['w1/Z', 'w1/A'] }, sess: {} }, sessionsExpanded: { w1: false } }
    const f = createFixture({ persistedView: legacy, compactChains: true })
    let saved
    const configure = instance => { instance.workspace.items = [{ workspaceId: 'w1', title: 'Owner', path: 'F:/fixture/owner', sessionIds: [] }] }
    try {
      configure(f)
      if (!beforeBind) await f.render()
      await act(async () => {
        f.view.actions.setFolderOrder('folder:w1', [])
        f.view.actions.setFolderOrder('@root', [])
        f.view.actions.setFolderOrder('workspace:w1', [])
        f.view.actions.setExpanded('folder:w1', true)
      })
      await f.render()
      assert.deepEqual(f.view.getSnapshot().folderOrder['folder:w1'], [])
      assert.deepEqual(f.view.getSnapshot().folderOrder['@root'], [])
      assert.deepEqual(f.view.getSnapshot().folderOrder['workspace:w1'], [])
      assert.equal(f.view.getSnapshot().expanded['folder:w1'], true)
      await act(async () => {
        f.view.actions.setFolderOrder('folder:w1', ['A', 'Z'])
        f.view.actions.setFolderOrder('workspace:w1', ['A', 'Z'])
        f.view.actions.setExpanded('folder:w1', false)
      })
      assert.deepEqual(f.view.getSnapshot().folderOrder['folder:w1'], ['A', 'Z'])
      await act(async () => {
        f.view.actions.setFolderOrder('folder:w1', [])
        f.view.actions.setExpanded('folder:w1', null) // reset writes explicit default true
      })
      f.workspace.items = []
      await f.render()
      const state = f.view.getSnapshot()
      assert.deepEqual(state.folderOrder['workspace:w1'], ['A', 'Z'], 'temporarily absent actual workspace retains canonical preferences')
      assert.deepEqual(state.folderOrder['folder:w1'], [])
      assert.deepEqual(state.mainViewKeys.legacy, { folderOrder: legacy.folderOrder, expanded: legacy.expanded })
      assert.equal(state.folderOrder['workspace:late'], undefined)
      assert.equal(state.expanded['folder:late//Secret'], undefined)
      assert.deepEqual(state.sessionsExpanded, { w1: false })
      await act(async () => {
        assert.throws(() => f.view.actions.setFolderOrder('w1', ['Z']), /invalid Main container role/, 'new setter has no raw overload')
        assert.throws(() => f.view.actions.setExpanded('w1', false), /invalid Main folder role/)
      })
      saved = JSON.parse(f.dom.window.localStorage.getItem('dsh.workspaceNavigator.view.v1'))
    } finally { await f.cleanup() }
    const restored = createFixture({ persistedView: saved, compactChains: true })
    try {
      restored.workspace.items = []
      await restored.render()
      configure(restored)
      restored.workspace.items.push({ workspaceId: 'late', title: 'Late', path: 'F:/fixture/late', sessionIds: [] },
        { workspaceId: 'lateZ', title: 'Secret/Z/one', path: 'F:/fixture/late/z', sessionIds: ['s1'] },
        { workspaceId: 'lateA', title: 'Secret/A/two', path: 'F:/fixture/late/a', sessionIds: ['s2'] })
      await act(async () => { restored.view.actions.setWorkspaceGroupMode('disk-slash') })
      await restored.render()
      const state = restored.view.getSnapshot()
      assert.deepEqual(state.folderOrder['folder:w1'], [], 'reopen cannot resurrect a cleared list')
      assert.deepEqual(state.folderOrder['@root'], [], 'root reset also retains explicit presence')
      assert.equal(state.expanded['folder:w1'], true)
      assert.deepEqual(state.folderOrder['workspace:w1'], ['A', 'Z'])
      assert.deepEqual(state.folderOrder['workspace:late'], ['Z', 'A'], 'previously unbound actual workspace role binds when complete owner data arrives')
      assert.deepEqual(state.folderOrder['folder:late//Secret'], ['Z', 'A'])
      assert.equal(state.expanded['folder:late//Secret'], false)
      assert.deepEqual(state.mainViewKeys.legacy, { folderOrder: legacy.folderOrder, expanded: legacy.expanded }, 'unknown residue is never garbage-collected')
      assert.equal(state.folderOrder['folder:unknown//Residue'], undefined)
    } finally { await restored.cleanup() }
  })
})

test('R5 reparent/root/default changes only real scoped folder roles and keeps workspace order stable', async t => {
  for (const compactChains of [false, true]) for (const ingress of ['fresh', 'published-0.1']) await t.test(`compactChains=${compactChains}; ${ingress}`, async () => {
    const legacy = { folderOrder: { w2: ['Z', 'A'], 'w1//w2': ['Keep', 'Other'], 'w1//w2//Keep': ['Z', 'A'] }, expanded: { w2: true, 'w1//w2//Keep': true, 'w1//w2//Other': false } }
    const f = createFixture({ compactChains, ...(ingress === 'published-0.1' ? { persistedView: legacy } : {}) })
    try {
      f.workspace.items = [
        { workspaceId: 'w1', title: 'Parent', path: 'F:/fixture/parent', sessionIds: [] },
        { workspaceId: 'w2', title: 'Child', path: 'F:/fixture/parent/child', sessionIds: [] },
        { workspaceId: 'grandZ', title: 'Keep/Z/one', path: 'F:/fixture/parent/child/z', sessionIds: ['s1'] },
        { workspaceId: 'grandA', title: 'Keep/A/two', path: 'F:/fixture/parent/child/a', sessionIds: ['s2'] },
        { workspaceId: 'nameZ', title: 'w2/Z/three', path: 'F:/fixture/name-z', sessionIds: ['s3'] },
        { workspaceId: 'nameA', title: 'w2/A/four', path: 'F:/fixture/name-a', sessionIds: [] },
      ]
      f.view.actions.setWorkspaceGroupMode('disk-slash')
      f.view.actions.addFolder('workspace', 'w1//w2', 'Other')
      if (ingress === 'fresh') {
        f.view.actions.setFolderOrder('folder:w2', ['Z', 'A'])
        f.view.actions.setExpanded('folder:w2', true)
        f.view.actions.setFolderOrder('workspace:w2', ['Keep', 'Other'])
        f.view.actions.setFolderOrder('folder:w1//w2//Keep', ['Z', 'A'])
        f.view.actions.setExpanded('folder:w1//w2//Keep', true)
        f.view.actions.setExpanded('folder:w1//w2//Other', false)
      }
      f.view.actions.setSessionsExpanded('w2', false)
      f.view.actions.setNavigatorOrder('workspace:w2', ['folder:w1//w2//Other', 'folder:w1//w2//Keep'])
      await detach(f)
      const originalPaths = f.workspace.items.map(w => [w.workspaceId, w.path, w.title, w.sessionIds])
      for (const reset of [false, true]) {
        if (reset) await menuAction(f, 'workspace:w2', 'workspace-parent-reset')
        else await f.command('drop', { id: 'workspace:w2', targetId: null, position: 'inside' })
        assert.equal(f.model().operation.status, 'success')
        const state = f.view.getSnapshot(), scope = reset ? 'w1//w2' : 'w2'
        assert.deepEqual(state.folderOrder['workspace:w2'], ['Keep', 'Other'])
        assert.deepEqual(state.folderOrder['folder:w2'], ['Z', 'A'], 'root name equal to moved workspace ID remains a different role')
        assert.equal(state.expanded['folder:w2'], true)
        assert.deepEqual(state.folderOrder['folder:' + scope + '//Keep'], ['Z', 'A'])
        assert.equal(state.expanded['folder:' + scope + '//Other'], false)
        assert.deepEqual(state.folders.ws[scope], ['Other'])
        assert.deepEqual(state.navigatorOrder['workspace:w2'], ['folder:' + scope + '//Other', 'folder:' + scope + '//Keep'])
        assert.equal(state.sessionsExpanded.w2, false)
        assert.deepEqual(f.workspace.items.map(w => [w.workspaceId, w.path, w.title, w.sessionIds]), originalPaths)
      }
      await f.command('return')
      assert.equal(f.dom.window.document.querySelector('[data-row-key="ws-w2"]').getAttribute('aria-expanded'), 'false')
      await act(async () => { f.dom.window.document.querySelector('[data-row-key="ws-w2"]').click() })
      const expected = compactChains ? ['ws-grandZ', 'ws-grandA'] : ['f-w1//w2//Keep/Z', 'f-w1//w2//Keep/A']
      assert.deepEqual(mainRowKeys(f).filter(key => expected.includes(key)), expected)
    } finally { await f.cleanup() }
  })
})

// 8e F1 stays in the existing real Main fixture: the helpers only locate
// production buildTree nodes or reopen its synthetic persisted view.
function mainFolder(f, idPath) {
  const state = f.view.getSnapshot()
  const tree = f.buildTree(f.workspace.items, 'disk-slash', state.folders?.ws, state.folderOrder, state.workspaceParents)
  const find = node => {
    if (node.idPath === idPath) return node
    for (const child of node.folders) { const found = find(child); if (found) return found }
    for (const workspace of node.workspaces) if (workspace.sub) { const found = find(workspace.sub); if (found) return found }
    return null
  }
  return find(tree)
}

async function reopenMainFixture(f, compactChains) {
  const persistedView = JSON.parse(f.dom.window.localStorage.getItem('dsh.workspaceNavigator.view.v1'))
  const items = structuredClone(f.workspace.items)
  await f.cleanup()
  const reopened = createFixture({ persistedView, compactChains })
  reopened.workspace.items = items
  reopened.view.actions.setWorkspaceGroupMode('disk-slash')
  return reopened
}

async function assertLateMainFolder(f, idPath, compactChains, { order = ['Z', 'A'], expanded = false } = {}) {
  await f.render()
  const node = mainFolder(f, idPath)
  assert.ok(node, 'late members materialize the actual production folder ' + idPath)
  assert.deepEqual(node.seq.filter(item => item.kind === 'folder').map(item => item.node.name), order)
  const row = () => f.dom.window.document.querySelector('.wn-tree [data-row-key="f-' + idPath + '"]')
  assert.ok(row(), 'late folder reaches actual Main DOM')
  assert.equal(row().getAttribute('aria-expanded'), String(expanded))
  if (!expanded) await act(async () => { row().click() })
  const expected = compactChains ? order.map(name => 'ws-late' + name) : order.map(name => 'f-' + idPath + '/' + name)
  assert.deepEqual(mainRowKeys(f).filter(key => expected.includes(key)), expected, 'actual Main DOM consumes the relocated order')
  if (!expanded) await act(async () => { row().click() })
}

const missingKeepOwners = () => [
  { workspaceId: 'p', title: 'Parent', path: 'F:/fixture/p', sessionIds: [] },
  { workspaceId: 'c', title: 'Child', path: 'F:/fixture/p/c', sessionIds: [] },
  { workspaceId: 'q', title: 'Other parent', path: 'F:/fixture/q', sessionIds: [] },
]
const lateKeepMembers = (prefix = 'Keep', directory = 'F:/fixture/p/c') => [
  { workspaceId: 'lateZ', title: prefix + '/Z/one', path: directory + '/z', sessionIds: ['s1'] },
  { workspaceId: 'lateA', title: prefix + '/A/two', path: directory + '/a', sessionIds: ['s2'] },
]

test('R5 8e known missing scoped preferences bind before reparent and reach late Main after reopen or batched writes', async t => {
  for (const compactChains of [false, true]) for (const parent of [null, 'q']) for (const phase of ['live', 'reopen-before', 'reopen-after', 'batched']) await t.test(`compactChains=${compactChains}; parent=${parent}; ${phase}`, async () => {
    const legacy = { folderOrder: { 'p//c': ['Keep'], 'p//c//Keep': ['Z', 'A'] }, expanded: { 'p//c//Keep': false },
      folders: { ws: {}, sess: {} }, sessionsExpanded: { c: true } }
    let f = createFixture({ persistedView: legacy, compactChains })
    try {
      f.workspace.items = missingKeepOwners()
      f.view.actions.setWorkspaceGroupMode('disk-slash')
      if (phase !== 'batched') {
        await f.render()
        assert.equal(mainFolder(f, 'p//c//Keep'), null, 'view-role binding creates no business folder')
        if (phase === 'reopen-before') f = await reopenMainFixture(f, compactChains)
      }
      const originalItems = structuredClone(f.workspace.items)
      await act(async () => {
        if (phase === 'batched') f.view.actions.setWorkspaceParent(f.workspace.items, 'c', parent === null ? 'q' : null, true)
        f.view.actions.setWorkspaceParent(f.workspace.items, 'c', parent, true)
      })
      const scope = parent === null ? 'c' : 'q//c'
      let state = f.view.getSnapshot()
      assert.deepEqual(state.folderOrder['folder:' + scope + '//Keep'], ['Z', 'A'])
      assert.equal(state.expanded['folder:' + scope + '//Keep'], false)
      assert.deepEqual(state.folderOrder['workspace:c'], ['Keep'], 'actual workspace role is stable')
      assert.equal(state.folderOrder['folder:p//c//Keep'], undefined)
      assert.equal(state.mainViewKeys.bound.folderOrder['folder:p//c//Keep'], true)
      assert.equal(state.mainViewKeys.bound.expanded['folder:p//c//Keep'], true)
      assert.deepEqual(state.folders.ws, {}, 'binding adds no declarations')
      assert.deepEqual(f.workspace.items, originalItems, 'only view state was relocated')
      assert.equal(mainFolder(f, scope + '//Keep'), null)
      if (phase === 'reopen-after') f = await reopenMainFixture(f, compactChains)
      f.workspace.items = [...f.workspace.items, ...lateKeepMembers()]
      await assertLateMainFolder(f, scope + '//Keep', compactChains)
      state = f.view.getSnapshot()
      assert.deepEqual(state.sessionsExpanded, { c: true })
      assert.deepEqual(state.mainViewKeys.legacy, { folderOrder: legacy.folderOrder, expanded: legacy.expanded })
      assert.deepEqual(f.calls.business, [], 'no extra business writer is used to bind missing view roles')
    } finally { await f.cleanup() }
  })
})

test('R5 8e unmoved late and prebound moved scoped folders remain positive controls', async t => {
  for (const compactChains of [false, true]) for (const timing of ['unmoved-late', 'prebound-moved']) await t.test(`compactChains=${compactChains}; ${timing}`, async () => {
    const legacy = { folderOrder: { 'p//c//Keep': ['Z', 'A'] }, expanded: { 'p//c//Keep': false } }
    const f = createFixture({ persistedView: legacy, compactChains })
    try {
      f.workspace.items = missingKeepOwners()
      f.view.actions.setWorkspaceGroupMode('disk-slash')
      if (timing === 'prebound-moved') f.workspace.items.push(...lateKeepMembers())
      await f.render()
      if (timing === 'prebound-moved') await act(async () => { f.view.actions.setWorkspaceParent(f.workspace.items, 'c', null, true) })
      else f.workspace.items = [...f.workspace.items, ...lateKeepMembers()]
      await assertLateMainFolder(f, (timing === 'prebound-moved' ? 'c' : 'p//c') + '//Keep', compactChains)
    } finally { await f.cleanup() }
  })
})

test('R5 8e missing global descendants follow Native shared rename and cross-scope move, not destination cache insertion order', async t => {
  for (const compactChains of [false, true]) for (const crossScope of [false, true]) for (const reverseEntries of [false, true]) await t.test(`compactChains=${compactChains}; crossScope=${crossScope}; reverseEntries=${reverseEntries}`, async () => {
    const entries = [['A/Keep', ['Z', 'A']], ['B/Keep', ['A', 'Z']], ['q//B/Keep', ['A', 'Z']]]
    const legacy = { folderOrder: Object.fromEntries(reverseEntries ? entries.slice().reverse() : entries),
      expanded: Object.fromEntries((reverseEntries ? entries.slice().reverse() : entries).map(([raw]) => [raw, raw !== 'A/Keep'])), folders: { ws: {}, sess: {} } }
    let f = createFixture({ persistedView: legacy, compactChains })
    try {
      f.workspace.items = [
        { workspaceId: 'visible', title: 'A/visible', path: 'F:/fixture/visible', sessionIds: ['s3'] },
        { workspaceId: 'q', title: 'Other parent', path: 'F:/fixture/q', sessionIds: [] },
      ]
      f.view.actions.setWorkspaceGroupMode('disk-slash')
      await f.render()
      assert.equal(mainFolder(f, 'A/Keep'), null)
      f = await reopenMainFixture(f, compactChains)
      await detach(f)
      await menuAction(f, 'folder:A', 'rename-folder')
      await submitNativeDialog(f, { value: 'B' })
      assert.equal(f.model().operation.status, 'success')
      if (crossScope) {
        await f.command('drop', { id: 'folder:B', targetId: 'workspace:q', position: 'inside' })
        assert.equal(f.model().operation.status, 'success')
      }
      const idPath = (crossScope ? 'q//' : '') + 'B/Keep'
      assert.deepEqual(f.view.getSnapshot().folderOrder['folder:' + idPath], ['Z', 'A'])
      assert.equal(f.view.getSnapshot().expanded['folder:' + idPath], false)
      assert.equal(mainFolder(f, idPath), null, 'historical preferences alone do not render missing Keep')
      await f.command('return')
      f = await reopenMainFixture(f, compactChains)
      f.workspace.items = [...f.workspace.items, ...lateKeepMembers('B/Keep', crossScope ? 'F:/fixture/q' : 'F:/fixture/late')]
      await assertLateMainFolder(f, idPath, compactChains)
      const state = f.view.getSnapshot()
      assert.equal(state.folderOrder['folder:A/Keep'], undefined)
      assert.equal(state.mainViewKeys.bound.folderOrder['folder:A/Keep'], true)
      assert.equal(state.mainViewKeys.bound.expanded['folder:A/Keep'], true)
      assert.deepEqual(state.folders.ws, {})
      assert.deepEqual(state.mainViewKeys.legacy, { folderOrder: legacy.folderOrder, expanded: legacy.expanded })
    } finally { await f.cleanup() }
  })
})

test('R5 8e only full actual scope inventory unlocks unknown residue; descendant scopes never become name paths', async () => {
  const legacy = { folderOrder: { 'p//c//Keep': ['Z', 'A'], 'future//Keep': ['Z', 'A'], 'p//ghost//Nope': ['Z', 'A'], ' Bad/Path': ['Z', 'A'], 'folder:Legal/Keep': ['Z', 'A'] },
    expanded: { 'p//c//Keep': false, 'future//Keep': false, 'p//ghost//Nope': false, ' Bad/Path': false, 'folder:Legal/Keep': false }, folders: { ws: {}, sess: {} } }
  let f = createFixture({ persistedView: legacy })
  try {
    f.workspace.items = missingKeepOwners().filter(w => w.workspaceId !== 'c')
    f.view.actions.setWorkspaceGroupMode('disk-slash')
    await f.render()
    for (const raw of ['p//c//Keep', 'future//Keep', 'p//ghost//Nope', ' Bad/Path']) {
      assert.equal(f.view.getSnapshot().folderOrder['folder:' + raw], undefined)
      assert.equal(f.view.getSnapshot().expanded['folder:' + raw], undefined)
    }
    assert.equal(f.view.getSnapshot().folderOrder['workspace:c'], undefined)
    assert.equal(f.view.getSnapshot().folderOrder['workspace:future'], undefined)
    assert.equal(f.view.getSnapshot().folderOrder['folder:p/c/Keep'], undefined)
    assert.equal(f.view.getSnapshot().folderOrder['folder:p//c/Keep'], undefined)
    assert.deepEqual(f.view.getSnapshot().folderOrder['folder:folder:Legal/Keep'], ['Z', 'A'], 'legal old role-prefixed names remain names')
    assert.equal(f.view.getSnapshot().folderOrder['folder:Legal/Keep'], undefined)
    assert.equal(mainFolder(f, 'folder:Legal/Keep'), null)
    f = await reopenMainFixture(f, false)
    await f.render()
    f.workspace.items = [...f.workspace.items, missingKeepOwners().find(w => w.workspaceId === 'c'),
      { workspaceId: 'future', title: 'Future', path: 'F:/fixture/future', sessionIds: [] }]
    await f.render()
    for (const raw of ['p//c//Keep', 'future//Keep']) {
      assert.deepEqual(f.view.getSnapshot().folderOrder['folder:' + raw], ['Z', 'A'], 'scope becomes bindable only when the actual complete owner arrives')
      assert.equal(f.view.getSnapshot().expanded['folder:' + raw], false)
      assert.equal(mainFolder(f, raw), null)
    }
    assert.equal(f.view.getSnapshot().folderOrder['folder:p//ghost//Nope'], undefined)
    f.workspace.items = [...f.workspace.items, ...lateKeepMembers()]
    await assertLateMainFolder(f, 'p//c//Keep', false)
    assert.deepEqual(f.view.getSnapshot().mainViewKeys.legacy, { folderOrder: legacy.folderOrder, expanded: legacy.expanded })
    assert.deepEqual(f.view.getSnapshot().folders.ws, {})
  } finally { await f.cleanup() }
})

test('R5 8e source canonical empty and true resets survive repeated missing-role moves, destination caches and reopen', async t => {
  for (const kind of ['rename', 'reparent']) for (const beforeBind of [false, true]) for (const reverseEntries of [false, true]) await t.test(`${kind}; beforeBind=${beforeBind}; reverseEntries=${reverseEntries}`, async () => {
    const keys = kind === 'rename' ? ['A/Keep', 'B/Keep', 'C/Keep'] : ['p//c//Keep', 'c//Keep', 'q//c//Keep']
    const entries = keys.map((key, i) => [key, i === 0 ? ['Z', 'A'] : ['A', 'Z']])
    if (reverseEntries) entries.reverse()
    const legacy = { folderOrder: Object.fromEntries(entries), expanded: Object.fromEntries(entries.map(([key]) => [key, false])), folders: { ws: {}, sess: {} } }
    let f = createFixture({ persistedView: legacy })
    try {
      f.workspace.items = kind === 'rename' ? [{ workspaceId: 'visible', title: 'A/visible', path: 'F:/fixture/visible', sessionIds: ['s3'] }] : missingKeepOwners()
      f.view.actions.setWorkspaceGroupMode('disk-slash')
      if (!beforeBind) await f.render()
      const reset = raw => {
        f.view.actions.setFolderOrder('folder:' + raw, ['Z', 'A'])
        f.view.actions.setExpanded('folder:' + raw, false)
        f.view.actions.setFolderOrder('folder:' + raw, [])
        f.view.actions.setExpanded('folder:' + raw, null)
      }
      await act(async () => {
        reset(keys[0])
        if (kind === 'rename') f.view.actions.renameFolder('workspace', '', 'A', 'B')
        else f.view.actions.setWorkspaceParent(f.workspace.items, 'c', null, true)
      })
      assert.deepEqual(f.view.getSnapshot().folderOrder['folder:' + keys[1]], [])
      assert.equal(f.view.getSnapshot().expanded['folder:' + keys[1]], true)
      f = await reopenMainFixture(f, false)
      await act(async () => {
        // A second write/reset on the carried identity remains canonical.
        f.view.actions.setFolderOrder('folder:' + keys[1], ['Z', 'A'])
        f.view.actions.setExpanded('folder:' + keys[1], false)
        f.view.actions.setFolderOrder('folder:' + keys[1], [])
        f.view.actions.setExpanded('folder:' + keys[1], true)
        if (kind === 'rename') f.view.actions.renameFolder('workspace', '', 'B', 'C')
        else f.view.actions.setWorkspaceParent(f.workspace.items, 'c', 'q', true)
      })
      if (kind === 'rename') f.workspace.items = f.workspace.items.map(w => ({ ...w, title: 'C/visible' }))
      f.workspace.items = [...f.workspace.items, ...lateKeepMembers(kind === 'rename' ? 'C/Keep' : 'Keep', kind === 'rename' ? 'F:/fixture/late' : 'F:/fixture/p/c')]
      await assertLateMainFolder(f, keys[2], false, { order: ['A', 'Z'], expanded: true })
      let state = f.view.getSnapshot()
      assert.deepEqual(state.folderOrder['folder:' + keys[2]], [], 'explicit empty source beats all historical destination caches')
      assert.equal(state.expanded['folder:' + keys[2]], true)
      for (const old of keys.slice(0, 2)) {
        assert.equal(state.folderOrder['folder:' + old], undefined)
        assert.equal(state.expanded['folder:' + old], undefined)
        assert.equal(state.mainViewKeys.bound.folderOrder['folder:' + old], true)
        assert.equal(state.mainViewKeys.bound.expanded['folder:' + old], true)
      }
      f = await reopenMainFixture(f, false)
      if (kind === 'rename') f.workspace.items = [...f.workspace.items,
        { workspaceId: 'returnedOld', title: 'A/Keep/Z/old', path: 'F:/fixture/old', sessionIds: [] }]
      else await act(async () => { f.view.actions.setWorkspaceParent(f.workspace.items, 'c', undefined, true) })
      await f.render()
      state = f.view.getSnapshot()
      const current = kind === 'rename' ? keys[2] : keys[0]
      assert.deepEqual(state.folderOrder['folder:' + current], [])
      assert.equal(state.expanded['folder:' + current], true)
      if (kind === 'rename') {
        assert.equal(state.folderOrder['folder:' + keys[0]], undefined, 'new members at a retired source do not resurrect old raw preferences')
        assert.equal(state.expanded['folder:' + keys[0]], undefined)
      }
      assert.deepEqual(state.mainViewKeys.legacy, { folderOrder: legacy.folderOrder, expanded: legacy.expanded })
      assert.deepEqual(state.folders.ws, {})
    } finally { await f.cleanup() }
  })
})

async function dragMain(f, sourceKey, targetKey, y) {
  const row = key => f.dom.window.document.querySelector('.wn-tree [data-row-key="' + key + '"]')
  const source = row(sourceKey)
  assert.ok(source, 'real Main drag source ' + sourceKey)
  const fire = (target, type) => {
    const event = new f.dom.window.MouseEvent(type, { bubbles: true, cancelable: true, clientY: y })
    Object.defineProperty(event, 'dataTransfer', { value: { setData() {}, effectAllowed: '', dropEffect: '' } })
    target.dispatchEvent(event)
  }
  // Main intentionally arms a browser drag on its next frame. This is a single
  // finite synthetic event turn, not a live GUI or a polling/retry loop.
  await act(async () => { fire(source, 'dragstart'); await new Promise(resolve => setTimeout(resolve, 0)) })
  const target = row(targetKey)
  assert.ok(target, 'real Main drop target ' + targetKey)
  target.getBoundingClientRect = () => ({ top: 0, bottom: 100, height: 100, left: 0, right: 200, width: 200 })
  await act(async () => { fire(target, 'dragover') })
  await act(async () => { fire(row(targetKey), 'drop') })
  await f.render()
}

test('R5 Main drag lookup never first-matches an exact name-container alias to a workspace scope', async t => {
  for (const compactChains of [false, true]) await t.test(`compactChains=${compactChains}`, async () => {
    const f = createFixture({ compactChains })
    try {
      f.workspace.items = aliasItems()
      f.props.insertWorkspaceBefore = async (id, before) => {
        const moving = f.workspace.items.find(w => w.workspaceId === id)
        const rest = f.workspace.items.filter(w => w.workspaceId !== id)
        const at = rest.findIndex(w => w.workspaceId === before)
        rest.splice(at === -1 ? rest.length : at, 0, moving)
        f.workspace.items = rest
      }
      f.view.actions.setWorkspaceGroupMode('disk-slash')
      for (const path of ['w1/A/Empty', 'w1/Z/Empty']) f.view.actions.addFolder('workspace', '', path)
      f.view.actions.setFolderOrder('@root', ['w:w1', 'w1', 'w:X'])
      f.view.actions.setFolderOrder('folder:w1', ['Z', 'A'])
      f.view.actions.setFolderOrder('workspace:w1', ['Z', 'A'])
      await f.render()
      await dragMain(f, 'f-w1/A', 'f-w1/Z', 1)
      assert.deepEqual(f.view.getSnapshot().folderOrder['folder:w1'], ['A', 'Z'])
      assert.deepEqual(f.view.getSnapshot().folderOrder['workspace:w1'], ['Z', 'A'])
      await dragMain(f, 'f-w1', 'ws-w1', 1)
      assert.deepEqual(f.view.getSnapshot().folderOrder['@root'], ['w1', 'w:w1', 'w:X'], 'top-level reordering writes only @root')
      const expected = ['f-w1/A', 'f-w1/Z']
      assert.deepEqual(mainRowKeys(f).filter(key => expected.includes(key)), expected)
      assert.equal(f.workspace.items.find(w => w.workspaceId === 'sourceA').title, 'w1/A/two')
    } finally { await f.cleanup() }
  })
})

test('R5 actual Main drag containers use roles for sibling, mixed, tail, lift and carry paths', async t => {
  for (const compactChains of [false, true]) for (const gesture of ['folder-reorder', 'mixed-workspace', 'mixed-folder', 'folder-tail', 'workspace-lift-folder', 'workspace-lift-row', 'folder-lift', 'folder-nest']) await t.test(`compactChains=${compactChains}; ${gesture}`, async () => {
    const f = createFixture({ compactChains })
    try {
      const movingFolder = gesture.startsWith('folder-lift') || gesture === 'folder-nest'
      const sourceTitle = movingFolder ? 'P/G/one' : 'P/one'
      f.workspace.items = [
        { workspaceId: 'w1', title: 'Owner', path: 'F:/fixture/owner', sessionIds: [] },
        { workspaceId: 'one', title: sourceTitle, path: 'F:/fixture/owner/one', sessionIds: ['s1'] },
        { workspaceId: 'two', title: 'T/two', path: 'F:/fixture/owner/two', sessionIds: ['s2'] },
        { workspaceId: 'bare', title: 'Plain', path: 'F:/fixture/owner/plain', sessionIds: [] },
        { workspaceId: 'unrelated', title: 'w1/Z/three', path: 'F:/fixture/unrelated', sessionIds: ['s3'] },
      ]
      f.props.insertWorkspaceBefore = async (id, before) => {
        f.calls.business.push(['insert-workspace', id, before])
        const entry = f.workspace.items.find(w => w.workspaceId === id)
        const remaining = f.workspace.items.filter(w => w.workspaceId !== id)
        const at = remaining.findIndex(w => w.workspaceId === before)
        remaining.splice(at === -1 ? remaining.length : at, 0, entry)
        f.workspace.items = remaining
      }
      f.view.actions.setWorkspaceGroupMode('disk-slash')
      for (const path of [movingFolder ? 'P/G/Keep' : 'P/Keep', 'T/Keep']) f.view.actions.addFolder('workspace', 'w1', path)
      f.view.actions.addFolder('workspace', '', 'w1/A')
      f.view.actions.setFolderOrder('folder:w1', ['Z', 'A'])
      f.view.actions.setFolderOrder('workspace:w1', ['P', 'w:bare', 'T'])
      f.view.actions.setFolderOrder('folder:w1//P', movingFolder ? ['G'] : ['Keep', 'w:one'])
      if (movingFolder) f.view.actions.setFolderOrder('folder:w1//P/G', ['Keep', 'w:one'])
      await f.render()
      if (gesture === 'folder-reorder') await dragMain(f, 'f-w1//P', 'f-w1//T', 99)
      if (gesture === 'mixed-workspace') await dragMain(f, 'ws-bare', 'f-w1//P', 1)
      if (gesture === 'mixed-folder') await dragMain(f, 'f-w1//T', 'ws-bare', 1)
      if (gesture === 'folder-tail') await dragMain(f, 'f-w1//P', 'ws-w1', 50)
      if (gesture === 'workspace-lift-folder') await dragMain(f, 'ws-one', 'f-w1//T', 1)
      if (gesture === 'workspace-lift-row') await dragMain(f, 'ws-one', 'ws-bare', 1)
      if (gesture === 'folder-lift') await dragMain(f, 'f-w1//P/G', 'ws-bare', 1)
      if (gesture === 'folder-nest') await dragMain(f, 'f-w1//P/G', 'f-w1//T', 50)
      const state = f.view.getSnapshot()
      assert.deepEqual(state.folderOrder['folder:w1'], ['Z', 'A'], 'an exact scope alias never authorizes writing the unrelated root name group')
      const expected = gesture === 'folder-reorder' || gesture === 'folder-tail' ? ['w:bare', 'T', 'P']
        : gesture === 'mixed-workspace' ? ['w:bare', 'P', 'T']
          : gesture === 'mixed-folder' ? ['P', 'T', 'w:bare']
            : gesture === 'workspace-lift-folder' ? ['P', 'w:bare', 'w:one', 'T']
              : gesture === 'workspace-lift-row' ? ['P', 'w:one', 'w:bare', 'T']
                : gesture === 'folder-lift' ? ['P', 'G', 'w:bare', 'T'] : ['P', 'w:bare', 'T']
      assert.deepEqual(state.folderOrder['workspace:w1'], expected)
      if (gesture.startsWith('workspace-lift')) {
        assert.equal(f.workspace.items.find(w => w.workspaceId === 'one').title, 'one', 'container IDs never become semantic title prefixes')
        assert.deepEqual(state.folderOrder['folder:w1//P'], ['Keep'])
      }
      if (movingFolder) {
        const next = gesture === 'folder-lift' ? 'G' : 'T/G'
        assert.equal(f.workspace.items.find(w => w.workspaceId === 'one').title, next + '/one')
        assert.deepEqual(state.folderOrder['folder:w1//' + next], ['Keep', 'w:one'], 'inside order is carried using the canonical folder role')
        assert.equal(state.folderOrder['folder:w1//P/G'], undefined)
        if (gesture === 'folder-nest') assert.deepEqual(state.folderOrder['folder:w1//T'], ['Keep', 'w:two', 'G'])
      }
      assert.equal(Object.keys(state.folderOrder).every(key => key === '@root' || key.startsWith('folder:') || key.startsWith('workspace:')), true)
      assert.equal(f.calls.closes, 0)
    } finally { await f.cleanup() }
  })
})

test('R5 group relocation preserves exact own order intent instead of a visible-child snapshot', async t => {
  for (const compactChains of [false, true]) for (const gesture of ['lift', 'nest']) for (const via of ['main', 'native']) for (const intent of ['absent', 'reset', 'missing-token', 'manual']) {
    if (via === 'native' && gesture === 'lift') continue
    await t.test(`${via}; ${gesture}; ${intent}; compactChains=${compactChains}`, async () => {
      const f = createFixture({ compactChains }), order = intent === 'absent' ? undefined : intent === 'reset' ? [] : intent === 'missing-token' ? ['Z', 'B', 'A'] : ['Z', 'A']
      const nextPath = gesture === 'lift' ? 'G' : 'T/G', sourceRole = 'folder:owner//P/G', destinationRole = 'folder:owner//' + nextPath
      const expectedIds = intent === 'missing-token' ? ['two', 'lateB', 'one'] : intent === 'manual' ? ['two', 'one', 'lateB'] : ['one', 'lateB', 'two']
      const assertOwnIntent = state => {
        if (order === undefined) assert.equal(Object.hasOwn(state.folderOrder, destinationRole), false, 'absence never invents a manual override')
        else assert.deepEqual(state.folderOrder[destinationRole], order, 'the exact own source intent travels, including reset and absent tokens')
        assert.equal(state.folderOrder[sourceRole], undefined)
        assert.deepEqual(state.navigatorOrder[destinationRole], [destinationRole + '/A', destinationRole + '/Z'], 'Native full-ID ordering stays independent')
      }
      let saved, restoredItems
      try {
        f.workspace.items = [
          { workspaceId: 'owner', title: 'Owner', path: 'F:/fixture/owner', sessionIds: [] },
          { workspaceId: 'one', title: 'P/G/A/one', path: 'F:/fixture/owner/a', sessionIds: ['s1'] },
          { workspaceId: 'two', title: 'P/G/Z/two', path: 'F:/fixture/owner/z', sessionIds: ['s2'] },
          { workspaceId: 'bare', title: 'Plain', path: 'F:/fixture/owner/plain', sessionIds: [] },
          { workspaceId: 'dest', title: 'T/dest', path: 'F:/fixture/owner/dest', sessionIds: [] },
        ]
        f.props.insertWorkspaceBefore = async (id, before) => {
          f.calls.business.push(['insert-workspace', id, before])
          const entry = f.workspace.items.find(w => w.workspaceId === id), rest = f.workspace.items.filter(w => w.workspaceId !== id)
          const at = rest.findIndex(w => w.workspaceId === before)
          rest.splice(at === -1 ? rest.length : at, 0, entry); f.workspace.items = rest
        }
        f.view.actions.setWorkspaceGroupMode('disk-slash')
        f.view.actions.addFolder('workspace', 'owner', 'T/Anchor')
        if (order !== undefined) f.view.actions.setFolderOrder(sourceRole, order)
        f.view.actions.setNavigatorOrder(sourceRole, [sourceRole + '/A', sourceRole + '/Z'])
        await f.render()
        if (via === 'main') await dragMain(f, 'f-owner//P/G', gesture === 'lift' ? 'ws-bare' : 'f-owner//T', gesture === 'lift' ? 1 : 50)
        else {
          await detach(f)
          await f.command('drop', { id: sourceRole, targetId: 'folder:owner//T', position: 'inside' })
          assert.equal(f.model().operation.status, 'success')
          await f.command('return', {})
        }
        assertOwnIntent(f.view.getSnapshot())
        assert.equal(f.workspace.items.find(w => w.workspaceId === 'one').title, nextPath + '/A/one')
        assert.equal(f.workspace.items.find(w => w.workspaceId === 'two').title, nextPath + '/Z/two')
        assert.equal(f.workspace.items.find(w => w.workspaceId === 'one').path, 'F:/fixture/owner/a')
        if (via === 'main') {
          const parentOrder = f.view.getSnapshot().folderOrder[gesture === 'lift' ? 'workspace:owner' : 'folder:owner//T']
          if (gesture === 'lift') assert.ok(parentOrder.indexOf('G') < parentOrder.indexOf('w:bare'), 'parent drop placement still takes effect')
          else assert.equal(parentOrder.at(-1), 'G', 'nest still places the group at the target level tail')
        }
        f.workspace.items = [...f.workspace.items, { workspaceId: 'lateB', title: nextPath + '/B/new', path: 'F:/fixture/owner/b', sessionIds: [] }]
        await f.render()
        const expected = expectedIds.map(id => 'ws-' + id)
        assert.deepEqual(mainRowKeys(f).filter(key => expected.includes(key)), expected, 'late child uses default or the complete stored order, not a frozen visible projection')
        assertOwnIntent(f.view.getSnapshot())
        saved = JSON.parse(f.dom.window.localStorage.getItem('dsh.workspaceNavigator.view.v1'))
        restoredItems = f.workspace.items.map(w => ({ ...w, sessionIds: [...w.sessionIds] }))
      } finally { await f.cleanup() }
      const reopened = createFixture({ compactChains, persistedView: saved })
      try {
        // The shared fixture forces disk mode after hydration; restore this test's saved name-aware mode.
        reopened.view.actions.setWorkspaceGroupMode('disk-slash')
        reopened.workspace.items = restoredItems
        await reopened.render()
        assertOwnIntent(reopened.view.getSnapshot())
        const expected = expectedIds.map(id => 'ws-' + id)
        assert.deepEqual(mainRowKeys(reopened).filter(key => expected.includes(key)), expected, 'exact intent survives a new hydrated Main')
      } finally { await reopened.cleanup() }
    })
  }
})

test('R5 Main compression keeps raw group scope, stable idPath and the mixed child sequence', async () => {
  const f = createFixture()
  try {
    const items = [
      { workspaceId: 'parent', title: '父', path: 'F:/fixture/base', sessionIds: [] },
      { workspaceId: 'child', title: 'A/B/子', path: 'F:/fixture/base/child', sessionIds: ['s1'] },
    ]
    const tree = f.buildTree(items, 'disk-slash', { parent: ['A/B/空'] }, {})
    const raw = tree.workspaces[0].sub.folders[0]
    const compressed = f.materializeChain(f.compressTree(raw))
    assert.equal(compressed.scope, 'parent')
    assert.equal(compressed.idPath, 'parent//A/B')
    assert.equal(compressed.name, 'A/B')
    assert.deepEqual(compressed.seq.map(item => item.kind), ['folder', 'ws'])
    assert.equal(compressed.seq[0].node.scope, 'parent')
    assert.equal(compressed.seq[0].node.idPath, 'parent//A/B/空')
    f.workspace.items = items
    f.view.actions.setWorkspaceGroupMode('disk-slash')
    f.view.actions.setPref('compactChains', true)
    f.view.actions.addFolder('workspace', 'parent', 'A/B/空')
    await detach(f)
    assert.ok(f.rows().some(row => row.id === 'folder:parent//A/B/空'))
    assert.equal(f.rows().find(row => row.id === 'session:s1').workspaceId, 'child')
    await menuAction(f, 'folder:parent//A/B/空', 'rename-folder')
    await submitNativeDialog(f, { value: 'A/B/新空' })
    assert.deepEqual(f.view.getSnapshot().folders.ws.parent, ['A/B/新空'])
    assert.equal(f.calls.closes, 0)
  } finally { await f.cleanup() }
})

test('R5 archived-only Main and Native preserve an empty parent branch that contains an archived child session', async () => {
  const f = createFixture()
  try {
    f.workspace.items = [
      { workspaceId: 'w1', title: '空父', path: 'F:/fixture/one', sessionIds: [] },
      { workspaceId: 'w2', title: '归档子', path: 'F:/fixture/one/child', sessionIds: ['s3'] },
      { workspaceId: 'other', title: '无归档', path: 'F:/fixture/other', sessionIds: ['s1', 's2'] },
    ]
    f.workspace.archivedSessionIds = ['s3']
    f.view.actions.setArchivedFilter('only')
    await f.render()
    const tree = f.dom.window.document.querySelector('.wn-tree')
    assert.ok(tree.textContent.includes('空父'))
    assert.ok(tree.textContent.includes('归档子'))
    assert.equal(tree.textContent.includes('无归档'), false)
    await detach(f)
    assert.deepEqual(f.model().workspaces.map(card => card.id), ['workspace:w1'])
    assert.ok(f.rows().some(row => row.id === 'workspace:w2'))
    assert.equal(f.rows().find(row => row.id === 'session:s3').disabled, true)
    assert.equal(f.rows().find(row => row.id === 'session:s3').workspaceId, 'w2')
  } finally { await f.cleanup() }
})

test('R5 manual positions are actual view-store data restored by a newly hydrated Main instance', async () => {
  const first = createFixture()
  let saved
  try {
    await detach(first)
    await first.command('sort', { mode: 'manual' })
    await first.command('drop', { id: 'workspace:w1', targetId: 'workspace:w2', position: 'before' })
    assert.deepEqual(first.model().workspaces.map(card => card.id), ['workspace:w1', 'workspace:w2'])
    saved = JSON.parse(first.dom.window.localStorage.getItem('dsh.workspaceNavigator.view.v1'))
    assert.equal(saved.navigatorSortMode, 'manual')
    assert.deepEqual(saved.navigatorOrder['@root'], ['workspace:w1', 'workspace:w2'])
  } finally { await first.cleanup() }
  const restored = createFixture({ persistedView: saved })
  try {
    await detach(restored)
    assert.equal(restored.model().sortMode, 'manual')
    assert.deepEqual(restored.model().workspaces.map(card => card.id), ['workspace:w1', 'workspace:w2'])
    await restored.command('sort', { mode: 'activity' })
    assert.deepEqual(restored.model().workspaces.map(card => card.id), ['workspace:w2', 'workspace:w1'])
    await restored.command('sort', { mode: 'manual' })
    assert.deepEqual(restored.model().workspaces.map(card => card.id), ['workspace:w1', 'workspace:w2'])
  } finally { await restored.cleanup() }
})

test('R5 absent migration provider refuses cross-workspace drop but leaves same-workspace grouping usable', async () => {
  const f = createFixture()
  try {
    await detach(f)
    const membership = f.workspace.items.map(row => [...row.sessionIds])
    await f.command('drop', { id: 'session:s1', targetId: 'workspace:w2', position: 'inside' })
    assert.equal(f.model().operation.status, 'error')
    assert.equal(f.model().dialog, undefined)
    assert.deepEqual(f.workspace.items.map(row => row.sessionIds), membership)
    await f.command('drop', { id: 'session:s2', targetId: 'sgroup:w1|翻译', position: 'inside' })
    assert.equal(f.sessions.byId.s2.title, '翻译/代码审核')
    assert.equal(f.model().operation.status, 'success')
    assert.equal(f.calls.closes, 0)
  } finally { await f.cleanup() }
})

test('static official artwork never invokes another component as a tree hook and follows strict SVG policy', async () => {
  const f = createFixture()
  try {
    const region = source.slice(source.indexOf('const ICON_CHOICES = ['), source.indexOf('const ICON_PICKER_CHOICES'))
    const modes = [...region.matchAll(/'(Icon[A-Za-z0-9]+)'/g)].map(match => match[1]).concat(Object.keys(artwork))
    for (const mode of ['solid', 'outline', 'none', ...modes]) {
      const svg = f.navigationIcon(mode, true)
      if (!svg) continue
      assert.match(svg, /^<svg /, mode)
      assert.equal(isWorkspaceNavigatorIcon(svg), true, mode)
      assert.doesNotMatch(svg, /<script|onload=|href=|url\((?!#[a-z][\w-]*\))/i, mode)
    }
  } finally { await f.cleanup() }
})
