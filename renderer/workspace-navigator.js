/** Fixed v3 presentation and finite intents only. Main owns membership, business actions and persisted layout. */
(() => {
  const api = window.workspaceNavigator
  const root = document.getElementById('navigator')
  const title = document.getElementById('title')
  const search = document.getElementById('search')
  const view = document.getElementById('view')
  const viewTitle = document.getElementById('view-title')
  const overview = document.getElementById('overview')
  const focused = document.getElementById('focused')
  const strip = document.getElementById('strip')
  const splitter = document.getElementById('pane-splitter')
  const notice = document.getElementById('notice')
  const empty = document.getElementById('empty')
  const returnButton = document.getElementById('return')
  const overviewButton = document.getElementById('show-overview')
  const sortLabel = document.getElementById('sort-label')
  const sortSelect = document.getElementById('sort-mode')
  const operation = document.getElementById('operation')
  const rootDrop = document.getElementById('root-drop')
  const menuLayer = document.getElementById('menu-layer')
  const dialogLayer = document.getElementById('dialog-layer')
  const cards = new Map()
  const hovered = new Set()
  const scrollDrafts = new Map()
  const appliedScrolls = new WeakMap()
  const restoredScrolls = new WeakMap()
  const listeners = []
  const clipboardAttempts = new Set()
  let clipboardFlight
  const styleProperties = { color: 'color', fontWeight: 'font-weight', textShadow: 'text-shadow',
    WebkitTextStrokeWidth: '-webkit-text-stroke-width', WebkitTextStrokeColor: '-webkit-text-stroke-color' }
  let model, layout, searchTimer, layoutTimer, pendingQuery, lastLayoutSent, layoutFlight, pan, savedScrolls
  let itemDrag, dropHighlight, menuState, dialogState, contextAnchor, contextOrigin, dialogOrigin
  let focusClaim = 0
  let menuSettling, contextFlight, sortFlight, invalidDrop = false
  let workspaceOrder = []
  let currentTargets = new Map(), currentParents = new Map(), currentBranches = new Map()
  let composing = false, dirty = false, searchSending = false
  let cardFocus = false, activating = false, suppressUntil = 0, published = false
  let refreshNotice = false, failure = false, disposed = false, searching = false
  let serial = 0
  let paneShare = 80, paneDrag, paneBounds

  function listen(target, type, callback, options) {
    target.addEventListener(type, callback, options)
    listeners.push(() => target.removeEventListener(type, callback, options))
  }
  function node(tag, className) {
    const element = document.createElement(tag)
    if (className) element.className = className
    return element
  }
  function uniqueId() { return `workspace-navigator-${++serial}` }
  function copyLayout(value) {
    return { focusedWorkspaceId: value.focusedWorkspaceId, collapsedGroups: [...value.collapsedGroups],
      scrolls: value.scrolls.map(item => ({ ...item })) }
  }
  function scrollValue(value, id) { return value.scrolls.find(item => item.id === id)?.top }
  function putScroll(id, top) {
    top = Math.max(0, Math.min(10000000, Math.round(top)))
    const item = layout.scrolls.find(item => item.id === id)
    if (item) item.top = top
    else { layout.scrolls.push({ id, top }); if (layout.scrolls.length > 256) layout.scrolls.shift() }
  }
  function container(row) { return row.kind !== 'session' }
  function busy() { return model?.operation?.status === 'pending' }
  function caption(key, fallback = key) { return model.labels[key] ?? fallback }
  function frozen() {
    return hovered.size > 0 || cardFocus || pan !== undefined || itemDrag !== undefined || paneDrag !== undefined
      || Boolean(model?.contextMenu || model?.dialog || contextFlight)
  }
  function ordered(ids, previous) {
    if (!frozen()) return ids
    const members = new Set(ids)
    const kept = previous.filter(id => members.has(id))
    const existing = new Set(kept)
    return [...kept, ...ids.filter(id => !existing.has(id))]
  }

  // Only depth establishes parentage; names and paths remain opaque producer text.
  function hierarchy(rows) {
    const byId = new Map(), parents = new Map(), children = new Map([[null, []]]), stack = []
    for (const row of rows) {
      stack.length = row.depth
      const parent = row.depth === 0 ? null : stack[row.depth - 1]
      byId.set(row.id, row)
      parents.set(row.id, parent)
      if (!children.has(parent)) children.set(parent, [])
      children.get(parent).push(row.id)
      if (container(row)) { children.set(row.id, []); stack[row.depth] = row.id }
    }
    return { byId, parents, children }
  }
  function presentationBranches(forceCurrent = false) {
    // Index only the current Main projection. Held positions never confer target validity.
    currentTargets = new Map(); currentParents = new Map(); currentBranches = new Map()
    for (const workspace of model.workspaces) {
      currentTargets.set(workspace.id, { ...workspace, kind: workspace.kind ?? 'workspace' })
      currentParents.set(workspace.id, null); currentBranches.set(workspace.id, workspace.id)
      const index = hierarchy(workspace.rows)
      for (const row of workspace.rows) {
        currentTargets.set(row.id, row)
        currentParents.set(row.id, index.parents.get(row.id) ?? workspace.id)
        currentBranches.set(row.id, workspace.id)
      }
    }
    for (const id of hovered) if (!currentTargets.has(id)) hovered.delete(id)
    const activeCard = cardFrom(document.activeElement)
    if (activeCard && !currentTargets.has(activeCard.data.id)) cardFocus = false
    if (forceCurrent || !frozen() || cards.size === 0) return model.workspaces
    const branches = [], displayed = new Set()
    for (const id of workspaceOrder) {
      const card = cards.get(id), latest = currentTargets.get(id)
      if (!card || !latest) continue
      displayed.add(id)
      const retained = new Map(), rows = []
      for (const row of card.displayRows) {
        const data = currentTargets.get(row.id)
        if (!data || displayed.has(row.id)) continue
        // Retire invalid ancestor slots, not their still-current descendants.
        let parent = card.displayIndex.parents.get(row.id)
        while (parent !== null && !retained.has(parent)) parent = card.displayIndex.parents.get(parent) ?? null
        const depth = parent === null ? 0 : retained.get(parent) + 1
        rows.push({ ...data, depth }); retained.set(row.id, depth); displayed.add(row.id)
      }
      branches.push({ ...latest, rows })
    }
    // New branches may appear, but cannot duplicate a target held in another visual slot.
    for (const workspace of model.workspaces) if (!displayed.has(workspace.id)) {
      branches.push({ ...workspace, rows: [] }); displayed.add(workspace.id)
    }
    // A deleted card retires its slot owner, not the still-current targets it held.
    // Recover those orphans after existing slots, without releasing unrelated holds.
    const previousTargets = new Set([...cards.values()].flatMap(card => card.displayRows.map(row => row.id)))
    const owners = new Map()
    for (const branch of branches) {
      owners.set(branch.id, branch)
      for (const row of branch.rows) owners.set(row.id, branch)
    }
    for (const workspace of model.workspaces) {
      const branch = owners.get(workspace.id), recovered = new Map()
      for (const row of workspace.rows) {
        if (!previousTargets.has(row.id) || displayed.has(row.id)) continue
        let parent = currentParents.get(row.id)
        while (parent !== null && !recovered.has(parent)) parent = currentParents.get(parent) ?? null
        const depth = parent === null ? 0 : recovered.get(parent) + 1
        branch.rows.push({ ...row, depth }); recovered.set(row.id, depth); displayed.add(row.id)
      }
    }
    return branches
  }
  function reconcile(parent, elements) {
    const keep = new Set(elements)
    for (const child of [...parent.children]) if (!keep.has(child)) child.remove()
    elements.forEach((element, index) => {
      if (parent.children[index] !== element) parent.insertBefore(element, parent.children[index] ?? null)
    })
  }

  // Preload validates the geometry grammar; no markup is inserted into the document.
  function makeIcon(markup) {
    const parsed = new DOMParser().parseFromString(markup, 'image/svg+xml')
    const maskId = uniqueId()
    function copy(element) {
      const result = document.createElementNS('http://www.w3.org/2000/svg', element.localName)
      for (const attribute of element.attributes) {
        const value = attribute.name === 'id' ? maskId : attribute.name === 'mask' ? `url(#${maskId})` : attribute.value
        result.setAttribute(attribute.name, value)
      }
      for (const child of element.children) result.append(copy(child))
      return result
    }
    const icon = copy(parsed.documentElement)
    icon.setAttribute('aria-hidden', 'true')
    icon.setAttribute('focusable', 'false')
    return icon
  }
  function presentation(parts, data) {
    parts.label.textContent = data.label
    for (const [key, property] of Object.entries(styleProperties)) {
      const value = data.style?.[key]
      if (value === undefined) parts.label.style.removeProperty(property)
      else parts.label.style.setProperty(property, String(value))
    }
    parts.element.style.color = data.style?.color ?? ''
    if (parts.markup !== data.icon) {
      parts.icon.replaceChildren(...(data.icon === undefined ? [] : [makeIcon(data.icon)]))
      parts.markup = data.icon
    }
    parts.icon.hidden = data.icon === undefined
  }
  function makeParts(element) {
    const icon = node('span', 'icon'), label = node('span', 'label')
    element.append(icon, label)
    return { element, icon, label }
  }
  function menuButton() {
    const button = node('button', 'menu-button')
    button.type = 'button'
    button.textContent = '⋯'
    button.setAttribute('aria-haspopup', 'menu')
    return button
  }
  function dragHandle() {
    const handle = node('span', 'drag-handle')
    handle.textContent = '⠿'
    handle.setAttribute('aria-hidden', 'true')
    handle.draggable = true
    return handle
  }
  function makeRow(preview) {
    const element = node('div', preview ? 'row preview-row' : 'row')
    element.id = uniqueId()
    element.setAttribute('role', preview ? 'group' : 'treeitem')
    const chevron = node('button', 'chevron')
    chevron.type = 'button'
    chevron.tabIndex = -1 // The tree's arrow keys expose the same expansion control.
    const handle = dragHandle()
    element.append(handle, chevron)
    const primary = preview ? node('button', 'preview-open') : element
    if (preview) { primary.type = 'button'; element.append(primary) }
    const parts = makeParts(primary)
    const count = node('span', 'count'), status = node('span', 'status')
    const pin = node('span', 'pin'), unknown = node('span', 'activity-mark')
    for (const part of [status, pin, unknown]) part.setAttribute('aria-hidden', 'true')
    pin.textContent = '◆'
    unknown.textContent = '?'
    primary.append(count, pin, unknown, status)
    let path
    if (preview) {
      const text = node('span', 'preview-copy')
      path = node('span', 'preview-path')
      primary.insertBefore(text, parts.label)
      text.append(parts.label, path)
    }
    const menu = menuButton()
    element.append(menu)
    return { ...parts, element, primary, chevron, handle, menu, count, status, pin, unknown, path, preview }
  }
  // AgentTeams 0.1.27 WorkGlyph geometry; see THIRD_PARTY_NOTICES.md.
  function makeWorkGlyph() {
    const ns = 'http://www.w3.org/2000/svg', glyph = document.createElementNS(ns, 'svg')
    for (const [key, value] of Object.entries({ class: 'status-work-glyph', width: '11', height: '11', viewBox: '0 0 11 6.8',
      preserveAspectRatio: 'xMidYMid meet', fill: 'currentColor', 'aria-hidden': 'true', focusable: 'false' })) glyph.setAttribute(key, value)
    for (const [index, [x, y]] of [[0, 0], [4.2, 0], [8.4, 0], [0, 4.2], [4.2, 4.2], [8.4, 4.2]].entries()) {
      const rect = document.createElementNS(ns, 'rect')
      for (const [key, value] of Object.entries({ x, y, width: 2.6, height: 2.6, rx: .6 })) rect.setAttribute(key, String(value))
      rect.style.animationDelay = `${index * 0.15}s`
      glyph.append(rect)
    }
    return glyph
  }
  function expanded(row) { return searching || !layout.collapsedGroups.includes(row.id) }
  function updateRow(parts, row) {
    const element = parts.element
    presentation(parts, row)
    element.dataset.rowId = row.id
    element.dataset.kind = row.kind
    const descriptions = [row.title || row.label]
    if (row.status !== undefined) descriptions.push(model.labels[row.status])
    if (row.pinned) descriptions.push(model.labels.pinned)
    if (!row.activityKnown) descriptions.push(model.labels.activityUnavailable)
    element.title = descriptions.join('\n')
    element.setAttribute('aria-label', row.label)
    element.setAttribute('aria-description', descriptions.join(' / '))
    const disabled = !model.connected || failure || row.disabled === true
    element.setAttribute('aria-disabled', String(disabled))
    element.draggable = !disabled && !busy() && !parts.preview && !searching && !model.dialog
    parts.handle.draggable = !disabled && !busy() && !searching && !model.dialog
    parts.menu.disabled = disabled || busy() || Boolean(model.dialog)
    parts.menu.setAttribute('aria-label', `${caption('menu', '⋯')} — ${row.label}`)
    parts.menu.setAttribute('aria-expanded', String(model.contextMenu?.targetId === row.id && menuSettling !== model.contextMenu.id))
    parts.chevron.disabled = disabled || searching
    parts.chevron.setAttribute('aria-label', row.label)
    parts.chevron.setAttribute('aria-expanded', String(expanded(row)))
    if (parts.preview) {
      element.dataset.selected = String(row.selected === true)
      parts.primary.disabled = disabled
      parts.primary.setAttribute('aria-current', String(row.selected === true))
      parts.path.textContent = row.title
    } else {
      element.setAttribute('aria-level', String(row.depth + 1))
      element.setAttribute('aria-selected', String(row.selected === true))
      if (container(row)) element.setAttribute('aria-expanded', String(expanded(row)))
      else element.removeAttribute('aria-expanded')
      element.style.paddingInlineStart = `${8 + row.depth * 16}px`
    }
    parts.chevron.hidden = parts.preview || !container(row)
    parts.chevron.textContent = container(row) ? expanded(row) ? '▾' : '▸' : ''
    parts.count.hidden = row.count === undefined
    parts.count.textContent = row.count === undefined ? '' : String(row.count)
    parts.status.hidden = row.status === undefined
    const status = row.status ?? ''
    if (parts.status.dataset.status !== status) {
      parts.status.dataset.status = status
      if (status === 'ongoing') parts.status.replaceChildren(makeWorkGlyph())
      else parts.status.textContent = { warning: '!', done: '✓' }[status] ?? ''
    }
    parts.pin.hidden = !row.pinned
    parts.pin.title = model.labels.pinned
    parts.unknown.hidden = row.activityKnown
    parts.unknown.title = model.labels.activityUnavailable
  }

  function makeCard(workspace) {
    const element = node('article', 'workspace-card'), header = node('div', 'workspace-header')
    element.dataset.workspaceId = workspace.id
    const heading = node('button', 'workspace-heading')
    heading.type = 'button'
    heading.id = uniqueId()
    const headingParts = makeParts(heading), hint = node('p', 'activity-hint')
    const handle = dragHandle(), menu = menuButton()
    const headingRow = node('div', 'workspace-heading-row')
    headingRow.append(handle, heading, menu)
    header.append(headingRow, hint)
    const tree = node('div', 'workspace-tree'), preview = node('div', 'workspace-preview')
    tree.setAttribute('role', 'tree')
    tree.tabIndex = 0
    tree.setAttribute('aria-labelledby', heading.id)
    preview.setAttribute('role', 'group')
    preview.setAttribute('aria-labelledby', heading.id)
    const blank = node('p', 'card-empty')
    element.append(header, tree, preview, blank)
    const card = { element, heading, headingParts, hint, handle, menu, tree, preview, blank,
      rows: new Map(), previews: new Map(), activeId: undefined, visible: [] }
    return card
  }
  function focusRow(card, id, scroll = false) {
    card.activeId = id
    for (const [rowId, parts] of card.rows) parts.element.classList.toggle('keyboard-focus', rowId === id)
    const element = card.rows.get(id)?.element
    if (!element || !card.tree.contains(element)) card.tree.removeAttribute('aria-activedescendant')
    else {
      card.tree.setAttribute('aria-activedescendant', element.id)
      if (scroll) element.scrollIntoView({ block: 'nearest' })
    }
  }
  function updateCard(card, workspace) {
    card.data = workspace
    card.displayRows = workspace.rows
    card.displayIndex = hierarchy(card.displayRows)
    presentation(card.headingParts, workspace)
    card.heading.title = workspace.title + (workspace.activityKnown ? '' : `\n${model.labels.activityUnavailable}`)
    card.heading.disabled = !model.connected || failure || searching
    card.element.dataset.kind = workspace.kind ?? 'workspace'
    card.element.draggable = !model.dialog && !busy() && model.connected && !failure && !searching
      && card.element.dataset.placement !== 'strip'
    card.handle.draggable = !model.dialog && !busy() && model.connected && !failure && !searching
    card.menu.disabled = !model.connected || failure || busy() || Boolean(model.dialog)
    card.menu.setAttribute('aria-label', `${caption('menu', '⋯')} — ${workspace.label}`)
    card.menu.setAttribute('aria-expanded', String(model.contextMenu?.targetId === workspace.id && menuSettling !== model.contextMenu.id))
    card.hint.textContent = model.labels.activityUnavailable
    card.hint.hidden = workspace.activityKnown
    const visible = []
    function visit(parent) {
      for (const id of card.displayIndex.children.get(parent) ?? []) {
        const row = card.displayIndex.byId.get(id)
        if (!searching || row.matches) visible.push(row)
        if (container(row) && expanded(row)) visit(id)
      }
    }
    visit(null)
    card.visible = visible
    for (const [id, parts] of card.rows) if (!card.displayIndex.byId.has(id)) { parts.element.remove(); card.rows.delete(id) }
    const elements = visible.map(row => {
      if (!card.rows.has(row.id)) card.rows.set(row.id, makeRow(false))
      const parts = card.rows.get(row.id)
      updateRow(parts, row)
      return parts.element
    })
    reconcile(card.tree, elements)
    const latest = workspace.rows.filter(row => row.kind === 'session' && !row.disabled)
      .map((row, index) => ({ row, index }))
      .sort((a, b) => (b.row.activityAt ?? -Infinity) - (a.row.activityAt ?? -Infinity) || a.index - b.index)
      .map(item => item.row.id)
    card.previewOrder = ordered(latest, card.previewOrder ?? []).slice(0, 3)
    for (const [id, parts] of card.previews) if (!card.previewOrder.includes(id)) { parts.element.remove(); card.previews.delete(id) }
    reconcile(card.preview, card.previewOrder.map(id => {
      if (!card.previews.has(id)) card.previews.set(id, makeRow(true))
      const parts = card.previews.get(id)
      updateRow(parts, card.displayIndex.byId.get(id))
      return parts.element
    }))
    card.tree.setAttribute('aria-disabled', String(!model.connected || failure))
    const available = visible.filter(row => !row.disabled)
    focusRow(card, available.some(row => row.id === card.activeId) ? card.activeId
      : available.find(row => row.selected)?.id ?? available[0]?.id)
    card.blank.textContent = model.labels.noSessions
  }
  function isScrollRoot(id) { return id === 'overview' || id === 'strip' || currentParents.get(id) === null }
  function scrollElements() {
    return [[overview, 'overview'], [strip, 'strip'], ...[...cards].filter(([id]) => isScrollRoot(id)).map(([id, card]) => [card.tree, id])]
  }
  function visibleScroll(element) {
    if (element === overview) return !overview.hidden
    if (element === strip) return !strip.hidden
    return element.parentElement?.dataset.placement !== 'strip' && !element.parentElement?.hidden
  }
  function restoreScrolls(force = false) {
    if (searching) return
    for (const [element, id] of scrollElements()) {
      if (!visibleScroll(element)) continue
      const top = scrollValue(layout, id) ?? savedScrolls?.get(id)
      if (top === undefined || (!force && appliedScrolls.get(element) === top)) continue
      if (element === strip) element.scrollLeft = document.documentElement.dir === 'rtl' ? -top : top
      else element.scrollTop = top
      const actual = Math.round(element === strip ? Math.abs(element.scrollLeft) : element.scrollTop)
      appliedScrolls.set(element, actual)
      restoredScrolls.set(element, actual)
    }
  }
  // Window-local geometry only: Main's persisted layout and finite commands are unchanged.
  function releasePaneDrag(event) {
    if (!paneDrag || event?.pointerId !== undefined && event.pointerId !== paneDrag.id) return false
    const id = paneDrag.id
    paneDrag = undefined
    delete root.dataset.resizing
    if (splitter.hasPointerCapture(id)) splitter.releasePointerCapture(id)
    return true
  }
  function syncSplitter() {
    splitter.hidden = focused.hidden || strip.hidden
    const available = view.clientHeight - splitter.getBoundingClientRect().height
    // Read the CSS owner's resolved minima; density changes keep the same authority.
    const min = 100 * parseFloat(getComputedStyle(focused).minHeight) / available
    const max = 100 - 100 * parseFloat(getComputedStyle(strip).minHeight) / available
    const geometry = !splitter.hidden && available > 0 && Number.isFinite(min) && Number.isFinite(max) && min < max
    const share = geometry ? Math.max(min, Math.min(max, paneShare)) : paneShare
    // Border-box basis is exact, unlike grow weights which also redistribute each pane's padding.
    if (geometry) view.style.setProperty('--focused-flex', `0 0 ${available * share / 100}px`)
    else view.style.removeProperty('--focused-flex')
    const enabled = geometry && model?.connected && !failure && !model.dialog && !model.contextMenu
    splitter.setAttribute('aria-disabled', String(!enabled))
    splitter.tabIndex = enabled ? 0 : -1
    paneBounds = enabled ? { min, max, available, share } : undefined
    if (!enabled) {
      releasePaneDrag()
      if (splitter.hidden && document.activeElement === splitter) search.focus({ preventScroll: true })
      return
    }
    for (const [name, value] of [['min', min], ['max', max], ['now', paneBounds.share]]) {
      splitter.setAttribute(`aria-value${name}`, String(Math.round(value * 10) / 10))
    }
  }
  function finishPaneDrag(event) {
    if (releasePaneDrag(event) && !disposed && !frozen()) render()
  }
  function resetPaneShare() {
    if (!paneBounds) return
    releasePaneDrag()
    paneShare = 80
    syncSplitter()
  }
  function captureFocusOrigin(element = document.activeElement) {
    const card = element && cardFrom(element), rowId = element?.closest('.row')?.dataset.rowId
    return { element, claim: focusClaim, workspaceId: card?.data.id, activeTarget: rowId ?? (card && element === card.tree ? card.activeId : undefined),
      previewIndex: card?.previewOrder.indexOf(rowId) ?? -1 }
  }
  function render(forceScroll = false, forceCurrent = false) {
    if (!model || disposed) return
    const origin = captureFocusOrigin(), { element: activeElement, activeTarget, previewIndex } = origin
    const activeCard = cards.get(origin.workspaceId)
    const hadCardFocus = cardFocus && Boolean(activeCard)
    if (!activeCard) cardFocus = false
    const branches = presentationBranches(forceCurrent)
    workspaceOrder = branches.map(workspace => workspace.id)
    const workspaces = new Map(branches.map(workspace => [workspace.id, workspace]))
    for (const [id, card] of cards) if (!workspaces.has(id)) { card.element.remove(); cards.delete(id); hovered.delete(id) }
    const focus = workspaces.has(layout.focusedWorkspaceId) ? layout.focusedWorkspaceId : null
    const inFocus = !searching && focus !== null
    view.dataset.mode = searching ? 'search' : inFocus ? 'focus' : 'overview'
    overview.hidden = inFocus
    focused.hidden = !inFocus
    strip.hidden = !inFocus || workspaces.size <= 1
    overviewButton.hidden = !inFocus
    overviewButton.textContent = model.labels.overview
    strip.setAttribute('aria-label', model.labels.overview)
    viewTitle.textContent = searching ? model.labels.searchResults : inFocus ? workspaces.get(focus).label : model.labels.overview
    const gridCards = [], stripCards = [], focusCards = []
    for (const id of workspaceOrder) {
      const workspace = workspaces.get(id)
      if (!cards.has(id)) cards.set(id, makeCard(workspace))
      const card = cards.get(id)
      const placement = inFocus ? id === focus ? 'focus' : 'strip' : 'overview'
      card.element.dataset.placement = placement
      updateCard(card, workspace)
      card.element.hidden = searching && !workspace.matches
      card.blank.hidden = placement === 'strip' ? card.previewOrder.length !== 0 : card.visible.length !== 0
      if (placement === 'focus') focusCards.push(card.element)
      else if (placement === 'strip') stripCards.push(card.element)
      else gridCards.push(card.element)
    }
    // Move keyed cards before pruning old containers so a mode change never discards a card.
    for (const [parent, elements] of [[overview, gridCards], [focused, focusCards], [strip, stripCards]]) {
      elements.forEach((element, index) => {
        if (parent.children[index] !== element) parent.insertBefore(element, parent.children[index] ?? null)
      })
    }
    empty.textContent = model.labels.empty
    empty.hidden = model.workspaces.some(workspace => !searching || workspace.matches)
    restoreScrolls(forceScroll)
    if (hadCardFocus) restoreCardFocus(activeElement, activeCard.data.id, previewIndex, activeTarget)
    else if (root.contains(activeElement) && activeElement !== document.activeElement
      && !activeElement.closest('.workspace-card')) activeElement.focus({ preventScroll: true })
    syncInteractions()
    showNotice()
  }
  function restoreCardFocus(previous, workspaceId, previewIndex, activeTarget) {
    let card = cards.get(workspaceId)
    if (activeTarget && (!card || card.data.id !== activeTarget && !card.displayIndex.byId.has(activeTarget))) {
      card = [...cards.values()].find(candidate => !candidate.element.hidden
        && (candidate.data.id === activeTarget || candidate.displayIndex.byId.has(activeTarget))) ?? card
    }
    if (!card || card.element.hidden) { (search.disabled ? returnButton : search).focus({ preventScroll: true }); return }
    const inStrip = card.element.dataset.placement === 'strip'
    if (previous !== card.tree && card.element.contains(previous) && !previous.disabled
      && (!previous.closest('.workspace-tree') || !inStrip)
      && (!previous.closest('.workspace-preview') || inStrip)) {
      if (previous !== document.activeElement) previous.focus({ preventScroll: true })
      return
    }
    if (!inStrip) {
      if (activeTarget === card.data.id && !card.heading.disabled) { card.heading.focus({ preventScroll: true }); return }
      let id = activeTarget
      while (id !== undefined && !card.visible.some(row => row.id === id && !row.disabled)) id = card.displayIndex.parents.get(id) ?? undefined
      if (id === undefined && currentTargets.has(activeTarget)) {
        ;(card.heading.disabled ? returnButton : card.heading).focus({ preventScroll: true }); return
      }
      if (id !== undefined) focusRow(card, id)
      card.tree.focus({ preventScroll: true })
      return
    }
    const id = card.previewOrder.includes(activeTarget) ? activeTarget : currentTargets.has(activeTarget) ? undefined
      : card.previewOrder[Math.min(Math.max(previewIndex, 0), card.previewOrder.length - 1)]
    const target = card.previews.get(id)?.primary
    if (target && !target.disabled) target.focus({ preventScroll: true })
    else if (!card.heading.disabled) card.heading.focus({ preventScroll: true })
    else returnButton.focus({ preventScroll: true })
  }
  function showNotice(error = false) {
    if (!model || disposed) return
    if (error) failure = true
    notice.textContent = failure || refreshNotice ? model.labels.error : !model.connected ? model.labels.disconnected
      : invalidDrop ? caption('invalidDrop', model.labels.error) : ''
    notice.hidden = notice.textContent === ''
    const outcome = model.operation
    operation.hidden = !outcome
    operation.dataset.status = outcome?.status ?? ''
    operation.textContent = outcome ? outcome.message || (outcome.status === 'pending' ? caption('pending', '…') : '') : ''
    operation.setAttribute('aria-busy', String(outcome?.status === 'pending'))
    search.disabled = !model.connected
    overviewButton.disabled = !model.connected || failure
    sortSelect.disabled = !model.connected || failure || busy() || Boolean(model.dialog || model.contextMenu || sortFlight)
    for (const card of cards.values()) {
      card.heading.disabled = !model.connected || failure || searching
      card.menu.disabled = !model.connected || failure || busy() || Boolean(model.dialog)
      card.tree.setAttribute('aria-disabled', String(!model.connected || failure))
      for (const parts of [...card.rows.values(), ...card.previews.values()]) {
        const row = card.displayIndex.byId.get(parts.element.dataset.rowId)
        if (!row) continue
        const disabled = !model.connected || failure || row.disabled === true
        parts.element.setAttribute('aria-disabled', String(disabled))
        parts.menu.disabled = disabled || busy() || Boolean(model.dialog)
        if (parts.preview) parts.primary.disabled = disabled
      }
    }
    updateDialogAvailability()
    syncSplitter()
  }

  function currentClipboard(flight) {
    return !disposed && clipboardFlight === flight && model?.instance === flight.instance
      && model.clipboard?.id === flight.id && model.clipboard.text === flight.text
  }
  async function writeClipboard(offer) {
    const flight = { instance: model.instance, id: offer.id, text: offer.text }
    const key = JSON.stringify([flight.instance, flight.id])
    if (clipboardAttempts.has(key)) return
    clipboardAttempts.add(key) // Mark before dispatch/await: refreshes and replays must never repeat OS I/O.
    clipboardFlight = flight
    let outcome
    try {
      const clipboard = window.navigator.clipboard
      if (typeof clipboard?.writeText !== 'function') outcome = 'unavailable'
      else { await clipboard.writeText(offer.text); outcome = 'copied' }
    } catch (error) { outcome = error?.name === 'NotAllowedError' ? 'denied' : 'failed' }
    if (currentClipboard(flight)) await send('clipboard-result', { id: flight.id, outcome }, flight)
  }
  function receive(next) {
    if (disposed || (model?.instance === next.instance && next.revision < model.revision)) return
    const previous = model, fresh = previous?.instance !== next.instance
    const advanced = fresh || previous.revision < next.revision
    const wasSearching = searching
    if (!wasSearching && next.query !== '' && model) {
      savedScrolls = new Map(scrollElements().map(([element, id]) => [id, element === strip ? Math.abs(element.scrollLeft) : element.scrollTop]))
    }
    model = next
    // Receipt/effect lifetime follows the current model, never held hover/focus presentation.
    if (clipboardFlight && !currentClipboard(clipboardFlight)) clipboardFlight = undefined
    if (next.clipboard) void writeClipboard(next.clipboard)
    layout = copyLayout(next.layout)
    searching = next.query !== ''
    activating = false
    if (fresh) {
      releasePaneDrag(); paneShare = 80
      dirty = false; pendingQuery = undefined; lastLayoutSent = undefined
      searchSending = false; layoutFlight = undefined; pan = undefined; itemDrag = undefined; suppressUntil = 0
      menuSettling = undefined; contextFlight = undefined; sortFlight = undefined
      menuState = undefined; dialogState = undefined; invalidDrop = false
      menuLayer.replaceChildren(); dialogLayer.replaceChildren()
      delete strip.dataset.dragging
      clearDropHighlight()
      scrollDrafts.clear(); hovered.clear(); workspaceOrder = []; savedScrolls = undefined
      for (const card of cards.values()) card.element.remove()
      cards.clear()
    }
    const scrollIds = new Set(['overview', 'strip', ...next.workspaces.map(workspace => workspace.id)])
    for (const [id, top] of scrollDrafts) {
      if ((next.connected && !scrollIds.has(id)) || scrollValue(next.layout, id) !== scrollValue(previous.layout, id)) scrollDrafts.delete(id)
      else putScroll(id, top)
    }
    refreshNotice = false
    failure = false
    document.documentElement.dataset.dark = String(model.dark)
    document.documentElement.dataset.density = model.density
    document.documentElement.lang = model.lang
    document.documentElement.dir = model.direction
    document.title = model.title
    title.textContent = model.title
    sortLabel.textContent = caption('sort', '↕')
    sortSelect.setAttribute('aria-label', caption('sort', '↕'))
    sortSelect.options[0].textContent = caption('automatic', 'activity')
    sortSelect.options[1].textContent = caption('manual', 'manual')
    sortSelect.value = model.sortMode
    rootDrop.textContent = `↥ ${model.labels.overview}`
    rootDrop.setAttribute('aria-label', model.labels.overview)
    if (advanced) { sortFlight = undefined; contextFlight = undefined }
    if (itemDrag && !next.workspaces.some(card => card.id === itemDrag.id || card.rows.some(row => row.id === itemDrag.id))) endItemDrag()
    search.placeholder = model.labels.search
    search.setAttribute('aria-label', model.labels.search)
    returnButton.textContent = model.labels.return
    if (advanced && pendingQuery !== undefined && pendingQuery !== model.query) {
      pendingQuery = undefined; refreshNotice = true
    }
    if (!composing && pendingQuery === model.query && search.value === model.query) {
      dirty = false; pendingQuery = undefined
    }
    if (!composing && !dirty) search.value = model.query
    const missingFocus = model.connected && !searching && layout.focusedWorkspaceId !== null
      && !model.workspaces.some(workspace => workspace.id === layout.focusedWorkspaceId)
    if (missingFocus) layout.focusedWorkspaceId = null
    if (JSON.stringify(next.layout) === lastLayoutSent) lastLayoutSent = undefined
    root.hidden = false
    render(wasSearching !== searching || fresh)
    if (missingFocus) void flushLayout()
    const instance = model.instance
    void api.rendered({ instance, revision: model.revision }).catch(() => { if (model?.instance === instance) showNotice(true) })
    if (fresh && !model.dialog && !model.contextMenu) search.focus({ preventScroll: true })
  }
  async function send(type, fields = {}, clipboard) {
    if (!model || disposed || type === 'clipboard-result' && (!clipboard || !currentClipboard(clipboard))) return false
    const command = { instance: model.instance, revision: model.revision, commandId: window.crypto.randomUUID(), type, ...fields }
    try {
      const result = await api.command(command)
      if (disposed || model.instance !== command.instance || clipboard && !currentClipboard(clipboard)) return false
      if (result.kind !== 'accepted') {
        receive(result.model)
        refreshNotice = result.kind === 'refresh'
        showNotice()
        return false
      }
      failure = false; refreshNotice = false; showNotice()
      return true
    } catch (_error) {
      if (model?.instance === command.instance && (!clipboard || currentClipboard(clipboard))) showNotice(true)
      return false
    }
  }
  async function flushSearch() {
    clearTimeout(searchTimer)
    if (disposed || composing || searchSending || !model?.connected || (!dirty && !failure && !refreshNotice)) return
    const query = search.value, instance = model.instance
    if (query === model.query && !failure && !refreshNotice) { dirty = false; pendingQuery = undefined; return }
    if (query === pendingQuery) return
    searchSending = true; pendingQuery = query
    const accepted = await send('search', { query })
    if (disposed || model.instance !== instance) return
    searchSending = false
    if (!accepted) pendingQuery = undefined
    else if (!composing && search.value === query && model.query === query) { dirty = false; pendingQuery = undefined }
    if (accepted && !composing && search.value !== query) void flushSearch()
  }
  async function flushLayout() {
    clearTimeout(layoutTimer)
    if (!model?.connected || disposed || searching || failure || activating) return
    const instance = model.instance
    if (layoutFlight) {
      await layoutFlight
      if (!disposed && model.instance === instance) return flushLayout()
      return
    }
    const value = copyLayout(layout), signature = JSON.stringify(value)
    if (signature === lastLayoutSent
      || (signature === JSON.stringify(model.layout) && lastLayoutSent === undefined)) return
    lastLayoutSent = signature
    const flight = send('layout', { layout: value })
    if (model.instance !== instance) { await flight; return }
    layoutFlight = flight
    const accepted = await flight
    if (disposed || model.instance !== instance) return
    layoutFlight = undefined
    if (!accepted) lastLayoutSent = undefined
    else if (JSON.stringify(layout) !== signature) return flushLayout()
  }
  function saveScroll(element, id) {
    if (!model || searching || !isScrollRoot(id) || !visibleScroll(element)) return
    const top = Math.max(0, Math.min(10000000, Math.round(element === strip ? Math.abs(element.scrollLeft) : element.scrollTop)))
    if (restoredScrolls.get(element) === top) { restoredScrolls.delete(element); return }
    restoredScrolls.delete(element)
    if ((scrollValue(layout, id) ?? 0) === top) return
    scrollDrafts.set(id, top); putScroll(id, top); appliedScrolls.set(element, top)
    clearTimeout(layoutTimer)
    layoutTimer = setTimeout(() => { void flushLayout() }, 180)
  }
  function collectScrolls() { if (model && !searching) for (const [element, id] of scrollElements()) saveScroll(element, id) }
  function focusWorkspace(id) {
    if (id !== null) id = currentBranches.get(id)
    const revealRoot = id !== null && id !== undefined && !cards.has(id)
    if (id === undefined || !model?.connected || searching || failure || composing || layout.focusedWorkspaceId === id && !revealRoot) return
    focusClaim++
    collectScrolls()
    layout.focusedWorkspaceId = id
    // A background slot hold cannot suppress the root the user explicitly selects.
    render(false, revealRoot)
    void flushLayout()
  }
  function toggleGroup(card, row) {
    if (searching || !model.connected || failure || row.disabled || composing) return
    focusClaim++
    const collapsed = new Set(layout.collapsedGroups)
    if (collapsed.has(row.id)) collapsed.delete(row.id)
    else collapsed.add(row.id)
    layout.collapsedGroups = [...collapsed]
    render()
    void flushLayout()
  }
  function activate(row) {
    if (!model?.connected || failure || !row || row.kind !== 'session' || row.disabled || composing || activating) return
    if (dirty || searchSending || search.value !== model.query) { void flushSearch(); return }
    focusClaim++
    clearTimeout(layoutTimer)
    activating = true
    const instance = model.instance
    void send('activate', { id: row.id }).then(accepted => { if (!accepted && model.instance === instance) activating = false })
  }
  function cardFrom(target) { return cards.get(target.closest?.('.workspace-card')?.dataset.workspaceId) }
  function keyTree(event, card) {
    if (composing || event.isComposing || event.keyCode === 229 || !model?.connected || failure) return
    const rows = card.visible.filter(row => !row.disabled), index = rows.findIndex(row => row.id === card.activeId)
    const row = rows[index]
    let next
    if (event.key === 'ArrowDown') next = rows[Math.min(index + 1, rows.length - 1)]
    else if (event.key === 'ArrowUp') next = rows[Math.max(0, index - 1)]
    else if (event.key === 'Home') next = rows[0]
    else if (event.key === 'End') next = rows.at(-1)
    else if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) {
      if (row) requestContext(row.id, card.rows.get(row.id)?.element)
    } else if (event.key === 'Enter' || event.key === ' ') {
      if (row?.kind === 'workspace') focusWorkspace(row.id)
      else if (row && container(row)) toggleGroup(card, row)
      else activate(row)
    } else if (event.key === 'ArrowRight') {
      if (row && container(row)) {
        if (!expanded(row)) toggleGroup(card, row)
        else next = rows.find(child => card.displayIndex.parents.get(child.id) === row.id)
      }
    } else if (event.key === 'ArrowLeft') {
      if (row && container(row) && expanded(row) && !searching) toggleGroup(card, row)
      else if (row) {
        let parent = card.displayIndex.parents.get(row.id)
        while (parent !== null && !rows.some(item => item.id === parent)) parent = card.displayIndex.parents.get(parent) ?? null
        next = card.displayIndex.byId.get(parent)
      }
    } else return
    event.preventDefault()
    if (next) { focusClaim++; focusRow(card, next.id, true) }
  }

  // Menus are projections. No renderer-owned list of business verbs or callback execution.
  function targetAt(element) {
    const card = cardFrom(element)
    if (!card || card.element.hidden) return
    const row = element.closest?.('.row')
    return row ? card.displayIndex.byId.get(row.dataset.rowId) : { ...card.data, kind: card.data.kind ?? 'workspace' }
  }
  function requestContext(id, anchor, point) {
    if (!model?.connected || failure || busy() || model.dialog || composing || contextFlight) return
    const target = renderedTargets().get(id)
    if (!target || target.disabled) return
    contextOrigin = captureFocusOrigin()
    const bounds = (anchor.classList.contains('workspace-tree') ? target.element : anchor).getBoundingClientRect()
    contextAnchor = point ?? { x: bounds.left, y: bounds.bottom }
    contextFlight = id
    void send('context', { id }).then(accepted => {
      if (!accepted && contextFlight === id) { contextFlight = undefined; if (!frozen()) render() }
    })
  }
  function restoreInteractionFocus(origin) {
    if (disposed || origin && origin.claim !== focusClaim || model.dialog || model.contextMenu && menuSettling !== model.contextMenu.id) return
    const active = document.activeElement, element = origin?.element
    if (active !== document.body && active !== element && !menuLayer.contains(active) && !dialogLayer.contains(active)) return
    if (origin?.workspaceId !== undefined) restoreCardFocus(element, origin.workspaceId, origin.previewIndex, origin.activeTarget)
    else if (element && root.contains(element) && !element.disabled) element.focus({ preventScroll: true })
    else (search.disabled ? returnButton : search).focus({ preventScroll: true })
  }
  function chooseMenu(action) {
    const menu = model.contextMenu
    const entry = menu?.entries.find(entry => entry.id === action && !entry.disabled && !entry.separator)
    if (!menu || !entry || menuSettling === menu.id || !model.connected || failure || busy() && action !== 'cancel') return
    menuSettling = menu.id
    menuLayer.hidden = true
    for (const button of view.querySelectorAll('.menu-button[aria-expanded="true"]')) button.setAttribute('aria-expanded', 'false')
    // Admission hides an already chosen menu, but never displays a business-success message.
    void send('action', { id: menu.id, action: entry.id }).then(accepted => {
      if (!accepted && model.contextMenu?.id === menu.id) {
        menuSettling = undefined
        syncMenu()
      } else restoreInteractionFocus(contextOrigin)
    })
  }
  function dismissMenu() {
    // Main explicitly offers cancel. Merely hiding this DOM would strand Main's activity hold.
    chooseMenu('cancel')
  }
  function syncMenu() {
    const menu = model.contextMenu
    if (!menu) {
      const hadFocus = menuLayer.contains(document.activeElement)
      menuLayer.hidden = true; menuLayer.replaceChildren(); menuState = undefined; menuSettling = undefined
      if (hadFocus && !model.dialog) restoreInteractionFocus(contextOrigin)
      return
    }
    if (menuSettling === menu.id || model.dialog) { menuLayer.hidden = true; return }
    const previous = document.activeElement, hadMenuFocus = menuLayer.contains(previous)
    const fresh = menuState?.id !== menu.id
    if (fresh) {
      const panel = node('div', 'context-menu'), heading = node('p', 'menu-title'), entries = node('div', 'menu-entries')
      heading.id = uniqueId()
      panel.setAttribute('role', 'menu')
      panel.setAttribute('aria-labelledby', heading.id)
      panel.append(heading, entries)
      menuLayer.replaceChildren(panel)
      menuState = { id: menu.id, panel, heading, entries, nodes: new Map() }
    }
    menuState.heading.textContent = menu.title
    const parts = []
    for (const entry of menu.entries) {
      let element = menuState.nodes.get(entry.id)
      if (!element || element.dataset.separator !== String(Boolean(entry.separator))) {
        element = node(entry.separator ? 'div' : 'button', entry.separator ? 'menu-separator' : 'menu-entry')
        element.dataset.entryId = entry.id
        element.dataset.separator = String(Boolean(entry.separator))
        element.setAttribute('role', entry.separator ? 'separator' : 'menuitem')
        if (!entry.separator) element.type = 'button'
        menuState.nodes.set(entry.id, element)
      }
      if (!entry.separator) {
        element.textContent = entry.label
        element.disabled = entry.disabled === true || !model.connected || failure || busy() && entry.id !== 'cancel'
        element.setAttribute('aria-disabled', String(element.disabled))
        element.classList.toggle('danger', entry.danger === true)
      }
      parts.push(element)
    }
    for (const [id] of menuState.nodes) if (!menu.entries.some(entry => entry.id === id)) menuState.nodes.delete(id)
    reconcile(menuState.entries, parts)
    menuLayer.hidden = false
    const x = Math.max(8, Math.min(contextAnchor?.x ?? 12, window.innerWidth - 280))
    const y = Math.max(8, Math.min(contextAnchor?.y ?? 80, window.innerHeight - menuState.panel.offsetHeight - 8))
    menuState.panel.style.left = `${x}px`
    menuState.panel.style.top = `${y}px`
    if (fresh) parts.find(element => element.matches('button:not(:disabled)'))?.focus({ preventScroll: true })
    else if (hadMenuFocus) (parts.includes(previous) && !previous.disabled ? previous
      : parts.find(element => element.matches('button:not(:disabled)')))?.focus({ preventScroll: true })
  }

  const appearanceFields = ['color', 'glow', 'weight', 'shadow', 'stroke', 'strokeWidth', 'strokeColor', 'icon']
  const numericFields = { glow: 100, weight: 1000, strokeWidth: 32 }
  const colorPattern = /^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|[a-z]{1,24}|(?:rgb|rgba|hsl|hsla)\([\d\s.,%+/-]{1,100}\))$/iu
  function validColor(value) {
    return value.length <= 128 && colorPattern.test(value) && !/^(?:url|expression|var|inherit|initial|unset|revert)$/iu.test(value)
  }
  function makeDialog(descriptor) {
    const panel = node('section', 'dialog-panel'), form = node('form', 'managed-form')
    const heading = node('h2', 'dialog-title'), message = node('p', 'dialog-message'), fields = node('div', 'dialog-fields')
    heading.id = uniqueId(); message.id = uniqueId()
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-modal', 'false') // Return and the carrier window close remain reachable.
    panel.setAttribute('aria-labelledby', heading.id)
    panel.setAttribute('aria-describedby', message.id)
    const buttons = node('div', 'dialog-buttons'), cancel = node('button'), submit = node('button'), back = node('button')
    cancel.type = 'button'; submit.type = 'submit'; back.type = 'button'
    cancel.dataset.dialogCancel = ''; submit.dataset.dialogSubmit = ''; back.dataset.dialogReturn = ''
    buttons.append(back, cancel, submit)
    form.append(fields, buttons); panel.append(heading, message, form)
    const state = { id: descriptor.id, kind: descriptor.kind, panel, form, heading, message, fields, cancel, submit, back,
      draft: { ...(descriptor.appearance ?? {}) }, controls: new Map(), captions: new Map(), composing: false, submitted: false }
    if (descriptor.kind === 'text') {
      const input = node('input', 'dialog-input')
      input.type = 'text'; input.maxLength = 8192; input.autocomplete = 'off'
      input.value = descriptor.value ?? ''; input.setAttribute('aria-labelledby', heading.id)
      fields.append(input); state.input = input
    } else if (descriptor.kind === 'select') {
      const input = node('select', 'dialog-input')
      input.setAttribute('aria-labelledby', heading.id)
      fields.append(input); state.input = input; state.options = new Map(); state.choice = descriptor.value
    }
    return state
  }
  function appearanceControl(state, key) {
    const field = node('label', 'appearance-field'), label = node('span')
    const input = node(key === 'icon' ? 'select' : 'input', 'dialog-input')
    input.dataset.appearance = key
    if (key === 'shadow' || key === 'stroke') { input.type = 'checkbox'; input.checked = state.draft[key] === true }
    else if (Object.hasOwn(numericFields, key)) {
      input.type = 'number'; input.min = '0'; input.max = String(numericFields[key]); input.step = 'any'
      input.value = state.draft[key] === undefined ? '' : String(state.draft[key])
    } else if (key !== 'icon') {
      input.type = 'text'; input.maxLength = 128; input.autocomplete = 'off'; input.spellcheck = false
      input.value = state.draft[key] ?? ''
      if (key === 'color') {
        const list = node('datalist'); list.id = uniqueId(); input.setAttribute('list', list.id)
        for (let i = 0; i <= 12; i++) { const option = node('option'); option.value = `auto:${i}`; list.append(option) }
        field.append(list); state.colorTokens = list
      }
    }
    field.append(label, input)
    state.controls.set(key, input); state.captions.set(key, label)
    return field
  }
  function syncAppearance(descriptor) {
    const state = dialogState
    const fields = []
    for (const key of appearanceFields) {
      if (key === 'icon' && !Object.hasOwn(descriptor.appearance ?? {}, 'icon')) {
        state.controls.get(key)?.closest('label').remove()
        state.controls.delete(key); state.captions.delete(key)
        continue
      }
      if (!state.controls.has(key)) {
        if (key === 'icon') state.draft.icon = descriptor.appearance.icon
        fields.push(appearanceControl(state, key))
      } else fields.push(state.controls.get(key).closest('label'))
      const input = state.controls.get(key)
      state.captions.get(key).textContent = caption(key)
      input.setAttribute('aria-label', caption(key))
      if (key === 'color') {
        input.placeholder = '#… / auto:0…12'
        for (const option of state.colorTokens.options) option.label = `${caption('auto', 'auto')} ${option.value.slice(5)}`
      }
      if (key === 'strokeColor') input.placeholder = caption('auto', 'auto')
      if (key === 'icon') {
        const selected = state.draft.icon ?? ''
        const choices = [...new Set(['solid', 'outline', 'none', selected])]
        const options = choices.map(value => {
          let option = [...input.options].find(option => option.value === value)
          if (!option) { option = node('option'); option.value = value }
          option.textContent = { solid: caption('iconSolid', 'solid'), outline: caption('iconOutline', 'outline'), none: caption('iconNone', 'none') }[value] ?? (value || '—')
          return option
        })
        reconcile(input, options); input.value = selected
      }
    }
    reconcile(state.fields, fields)
  }
  function syncSelect(descriptor) {
    const state = dialogState
    const options = descriptor.options ?? []
    const elements = options.map(item => {
      let option = state.options.get(item.id)
      if (!option) { option = node('option'); option.value = item.id; state.options.set(item.id, option) }
      option.textContent = item.label; option.disabled = item.disabled === true
      return option
    })
    const optionIds = new Set(options.map(option => option.id))
    for (const [id] of state.options) if (!optionIds.has(id)) state.options.delete(id)
    if (state.choice === undefined) state.choice = options.find(option => !option.disabled)?.id
    reconcile(state.input, elements)
    // A removed/disabled chosen option cannot silently become a different destination.
    state.input.selectedIndex = options.findIndex(option => option.id === state.choice)
  }
  function syncDialog(origin) {
    const descriptor = model.dialog
    if (!descriptor) {
      if (dialogState) {
        const hadFocus = dialogLayer.contains(document.activeElement)
        dialogState = undefined; dialogLayer.replaceChildren(); dialogLayer.hidden = true
        if (hadFocus) restoreInteractionFocus(dialogOrigin)
      }
      return
    }
    const fresh = dialogState?.id !== descriptor.id
    if (fresh) {
      dialogOrigin = origin ?? captureFocusOrigin()
      dialogState = makeDialog(descriptor)
      dialogLayer.replaceChildren(dialogState.panel)
    }
    const state = dialogState
    state.heading.textContent = descriptor.title
    state.message.textContent = descriptor.message ?? ''
    state.message.hidden = !descriptor.message
    state.cancel.textContent = caption('cancel', '×'); state.submit.textContent = caption('submit', '✓'); state.back.textContent = model.labels.return
    if (state.kind === 'appearance') syncAppearance(descriptor)
    if (state.kind === 'select') syncSelect(descriptor)
    if (state.submitted && busy()) state.sawPending = true
    if (state.submitted && model.operation?.status === 'error'
      && (state.sawPending || state.submittedOperationId !== model.operation.id)) state.submitted = false
    if (state.cancelling && model.operation?.status === 'error') state.cancelling = false
    dialogLayer.hidden = false
    updateDialogAvailability()
    if (fresh) (state.input ?? state.controls.values().next().value ?? state.cancel).focus({ preventScroll: true })
  }
  function updateDialogAvailability() {
    if (!dialogState || !model.dialog) return
    const state = dialogState, disabled = !model.connected || failure || busy() || state.submitted
    let invalidSelection = false
    if (state.kind === 'select') invalidSelection = !(model.dialog.options ?? []).some(option => option.id === state.choice && !option.disabled)
    state.submit.disabled = disabled || state.composing || invalidSelection
    // Background status must not blur an active editor/IME. Only committing is gated;
    // the current draft remains editable until Main replaces/removes this dialog id.
    for (const input of state.controls.values()) input.disabled = false
    if (state.input) state.input.disabled = false
    state.cancel.disabled = !model.connected || failure || state.cancelling === true
    state.back.disabled = false
  }
  function submitDialog() {
    const state = dialogState, descriptor = model.dialog
    if (!state || !descriptor || state.id !== descriptor.id || state.submit.disabled || state.composing) return
    const fields = { id: descriptor.id }
    if (state.kind === 'text') fields.value = state.input.value
    if (state.kind === 'select') {
      if (!(descriptor.options ?? []).some(option => option.id === state.choice && !option.disabled)) return
      fields.value = state.choice
    }
    if (state.kind === 'appearance') {
      const appearance = {}
      let invalid
      for (const [key, input] of state.controls) {
        input.setCustomValidity('')
        if (!Object.hasOwn(state.draft, key)) continue
        const value = state.draft[key]
        if (Object.hasOwn(numericFields, key)) {
          if (value === '') continue
          const number = Number(value)
          if (!Number.isFinite(number) || number < 0 || number > numericFields[key]) invalid = input
          else appearance[key] = number
        } else if (key === 'color' || key === 'strokeColor') {
          if (!(value === '' || key === 'color' && /^auto:(?:[0-9]|1[0-2])$/u.test(value)
            || key === 'strokeColor' && value === 'auto' || validColor(value))) invalid = input
          else appearance[key] = value
        } else if (key === 'icon') {
          if (typeof value !== 'string' || value.length > 128 || !/^(?:[a-zA-Z][a-zA-Z\d_:-]{0,127})?$/u.test(value)) invalid = input
          else appearance.icon = value
        } else appearance[key] = value === true
      }
      if (invalid) { invalid.setCustomValidity(model.labels.error); invalid.reportValidity(); invalid.focus(); return }
      fields.appearance = appearance
    }
    // Confirm submits only the id: Main's shared confirm handler does not consume a magic value.
    state.submitted = true; state.sawPending = false; state.submittedOperationId = model.operation?.id
    updateDialogAvailability()
    void send('dialog', fields).then(accepted => {
      if (!accepted && dialogState === state) { state.submitted = false; updateDialogAvailability() }
    })
  }
  function cancelDialog() {
    const state = dialogState
    if (!state || !model.dialog || state.cancel.disabled) return
    state.cancelling = true; updateDialogAvailability()
    void send('cancel-dialog', { id: model.dialog.id }).then(accepted => {
      if (!accepted && dialogState === state) { state.cancelling = false; updateDialogAvailability() }
    })
  }
  function syncInteractions() {
    const active = document.activeElement
    const origin = menuLayer.contains(active) ? contextOrigin : dialogLayer.contains(active) ? dialogOrigin : captureFocusOrigin(active)
    syncMenu(); syncDialog(origin)
    rootDrop.hidden = !itemDrag
  }

  // Native DnD is owner-local. DataTransfer text/files are never parsed or trusted.
  function renderedTargets() {
    const targets = new Map()
    for (const card of cards.values()) {
      if (card.element.hidden) continue
      targets.set(card.data.id, { id: card.data.id, kind: card.data.kind ?? 'workspace', parent: null, element: card.element })
      const rows = card.element.dataset.placement === 'strip' ? card.previewOrder.map(id => card.displayIndex.byId.get(id)) : card.visible
      for (const row of rows) {
        const element = (card.element.dataset.placement === 'strip' ? card.previews : card.rows).get(row.id)?.element
        if (element?.isConnected) targets.set(row.id, { ...row, parent: currentParents.get(row.id) ?? null, element })
      }
    }
    return targets
  }
  function clearDropHighlight() {
    if (dropHighlight) { delete dropHighlight.dataset.drop; dropHighlight.removeAttribute('aria-invalid') }
    dropHighlight = undefined
  }
  function dropCandidate(event) {
    const targets = renderedTargets(), source = itemDrag && targets.get(itemDrag.id)
    const rootTarget = event.target.closest?.('#root-drop')
    const destination = rootTarget ? null : targetAt(event.target)
    const element = rootTarget || (destination && targets.get(destination.id)?.element)
    if (!source || itemDrag.instance !== model.instance || !element) return
    let position = 'inside'
    if (!rootTarget && model.sortMode === 'manual') {
      const rect = (event.target.closest('.row, .workspace-header') ?? element).getBoundingClientRect()
      const fraction = rect.height > 0 ? (event.clientY - rect.top) / rect.height : 0.5
      if (fraction < 0.25) position = 'before'
      else if (fraction > 0.75) position = 'after'
    }
    const target = destination && targets.get(destination.id)
    let valid = model.connected && !failure && !busy() && !model.dialog && !model.contextMenu && !searching
      && !source.disabled && !target?.disabled && source.id !== target?.id
    if (!target) valid &&= Boolean(rootTarget) && ['workspace', 'workspace-group'].includes(source.kind) && position === 'inside'
    else {
      let parent = target.id
      // Check only projected identity/shape; Main revalidates real ownership and moves.
      while (parent !== null && parent !== undefined) {
        if (parent === source.id) { valid = false; break }
        parent = currentParents.get(parent)
      }
      if (position === 'inside' && target.kind === 'session') valid = false
      if (['workspace', 'workspace-group'].includes(source.kind)) valid &&= ['workspace', 'workspace-group'].includes(target.kind)
      else {
        valid &&= position === 'inside' ? ['workspace', 'group'].includes(target.kind) : ['session', 'group'].includes(target.kind)
        if (source.kind === 'group' && source.workspaceId && target.workspaceId && source.workspaceId !== target.workspaceId) valid = false
      }
      if (model.sortMode !== 'manual' && position !== 'inside') valid = false
    }
    return { id: source.id, targetId: target?.id ?? null, position, valid, element }
  }
  function endItemDrag() {
    if (!itemDrag) return
    suppressUntil = Date.now() + 400
    itemDrag.element?.removeAttribute('data-dragging')
    itemDrag = undefined; clearDropHighlight(); rootDrop.hidden = true
    if (!frozen()) render()
  }

  listen(menuLayer, 'click', event => {
    const button = event.target.closest('button[data-entry-id]')
    if (button && !button.disabled) chooseMenu(button.dataset.entryId)
  })
  listen(menuLayer, 'keydown', event => {
    if (event.isComposing || event.keyCode === 229) return
    const buttons = [...menuLayer.querySelectorAll('button:not(:disabled)')]
    const index = buttons.indexOf(document.activeElement)
    let target
    if (event.key === 'ArrowDown') target = buttons[(index + 1) % buttons.length]
    else if (event.key === 'ArrowUp') target = buttons[(index - 1 + buttons.length) % buttons.length]
    else if (event.key === 'Home') target = buttons[0]
    else if (event.key === 'End') target = buttons.at(-1)
    else if (event.key === 'Tab') { focusClaim++; dismissMenu(); return }
    else return
    event.preventDefault(); target?.focus({ preventScroll: true })
  })
  listen(document, 'pointerdown', event => {
    if (view.contains(event.target)) focusClaim++
    if (model?.contextMenu && !menuLayer.contains(event.target)) dismissMenu()
  }, true)
  listen(document, 'keydown', event => {
    if (event.isComposing || event.keyCode === 229 || dialogState?.composing || composing) return
    if (event.key === 'Escape') {
      if (model?.dialog) { event.preventDefault(); cancelDialog() }
      else if (model?.contextMenu) { event.preventDefault(); dismissMenu() }
    }
  })
  listen(dialogLayer, 'submit', event => { event.preventDefault(); submitDialog() })
  listen(dialogLayer, 'click', event => {
    if (event.target.closest('[data-dialog-cancel]')) cancelDialog()
    if (event.target.closest('[data-dialog-return]')) returnToMain()
  })
  listen(dialogLayer, 'compositionstart', () => { if (dialogState) { dialogState.composing = true; updateDialogAvailability() } })
  listen(dialogLayer, 'compositionend', () => { if (dialogState) { dialogState.composing = false; updateDialogAvailability() } })
  listen(dialogLayer, 'input', event => {
    if (!dialogState) return
    const key = event.target.dataset.appearance
    if (key && dialogState.controls.get(key) === event.target) {
      event.target.setCustomValidity('')
      dialogState.draft[key] = event.target.type === 'checkbox' ? event.target.checked : event.target.value
    }
  })
  listen(dialogLayer, 'change', event => {
    if (!dialogState) return
    const key = event.target.dataset.appearance
    if (key && dialogState.controls.get(key) === event.target) dialogState.draft[key] = event.target.type === 'checkbox' ? event.target.checked : event.target.value
    if (dialogState.kind === 'select' && event.target === dialogState.input) dialogState.choice = event.target.value
    updateDialogAvailability()
  })
  listen(sortSelect, 'change', () => {
    const mode = sortSelect.value
    sortSelect.value = model.sortMode
    if (sortSelect.disabled || mode === model.sortMode || !['activity', 'manual'].includes(mode)) return
    sortFlight = true; showNotice()
    void send('sort', { mode }).then(accepted => { if (!accepted) { sortFlight = undefined; showNotice() } })
  })
  listen(view, 'dragstart', event => {
    const target = targetAt(event.target), element = target && renderedTargets().get(target.id)?.element
    if (!element || !model.connected || failure || busy() || model.dialog || model.contextMenu || searching || target.disabled || paneDrag
      || event.target.closest('button') && !event.target.closest('.drag-handle')) { event.preventDefault(); return }
    const card = cardFrom(element)
    if (card.element.dataset.placement === 'strip' && !event.target.closest('.drag-handle')) { event.preventDefault(); return }
    pan = undefined; delete strip.dataset.dragging
    itemDrag = { id: target.id, instance: model.instance, element }
    element.dataset.dragging = 'true'; rootDrop.hidden = false; invalidDrop = false; showNotice()
    if (event.dataTransfer) { event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', target.id) }
  })
  listen(document, 'dragover', event => {
    event.preventDefault() // Including external files/URLs: never let the browser navigate on drop.
    clearDropHighlight()
    const candidate = itemDrag && dropCandidate(event)
    if (candidate) {
      dropHighlight = candidate.element
      dropHighlight.dataset.drop = candidate.valid ? candidate.position : 'invalid'
      dropHighlight.setAttribute('aria-invalid', String(!candidate.valid))
    }
    if (event.dataTransfer) event.dataTransfer.dropEffect = candidate?.valid ? 'move' : 'none'
  })
  listen(document, 'drop', event => {
    event.preventDefault()
    const candidate = itemDrag && dropCandidate(event)
    if (candidate?.valid) {
      const { id, targetId, position } = candidate
      void send('drop', { id, targetId, position })
    } else if (itemDrag) { invalidDrop = true; showNotice() }
    endItemDrag()
  })
  listen(view, 'dragend', endItemDrag)
  listen(view, 'dragleave', event => { if (!view.contains(event.relatedTarget)) clearDropHighlight() })

  listen(search, 'compositionstart', () => { composing = true; clearTimeout(searchTimer) })
  listen(search, 'compositionend', () => { composing = false; dirty = true; void flushSearch() })
  listen(search, 'input', () => {
    dirty = true; clearTimeout(searchTimer)
    if (!composing) searchTimer = setTimeout(() => { void flushSearch() }, 120)
  })
  listen(search, 'keydown', event => {
    if (composing || event.isComposing || event.keyCode === 229) return
    const card = workspaceOrder.map(id => cards.get(id)).find(item => item && !item.element.hidden && item.element.dataset.placement !== 'strip')
    if (event.key === 'Enter') {
      event.preventDefault()
      if (dirty || failure || refreshNotice) void flushSearch()
      else if (card) activate(card.displayIndex.byId.get(card.activeId))
    } else if (event.key === 'ArrowDown' && model?.connected && card) {
      event.preventDefault(); focusClaim++; card.tree.focus({ preventScroll: true }); focusRow(card, card.activeId, true)
    }
  })
  listen(view, 'click', event => {
    if (Date.now() >= suppressUntil) return
    suppressUntil = 0; event.preventDefault(); event.stopImmediatePropagation()
  }, true)
  listen(view, 'click', event => {
    const card = cardFrom(event.target)
    if (!card || model.dialog) return
    const target = targetAt(event.target)
    if (event.target.closest('.menu-button')) { if (target) requestContext(target.id, event.target.closest('.menu-button')); return }
    if (event.target.closest('.drag-handle')) return
    const rowElement = event.target.closest('.row')
    if (rowElement) {
      const row = card.displayIndex.byId.get(rowElement.dataset.rowId)
      if (!row || row.disabled) return
      if (rowElement.closest('.workspace-tree')) {
        focusRow(card, row.id); card.tree.focus({ preventScroll: true })
        if (event.target.closest('.chevron') || row.kind === 'group' || row.kind === 'workspace-group') { toggleGroup(card, row); return }
        if (row.kind === 'workspace') { focusWorkspace(row.id); return }
      }
      activate(row)
    } else focusWorkspace(card.data.id)
  })
  listen(view, 'contextmenu', event => {
    event.preventDefault()
    const card = cardFrom(event.target)
    const target = card && event.target === card.tree ? card.displayIndex.byId.get(card.activeId) : targetAt(event.target)
    if (target) requestContext(target.id, event.target.closest('.row, .workspace-header') ?? card.heading,
      event.clientX || event.clientY ? { x: event.clientX, y: event.clientY } : undefined)
  })
  listen(view, 'keydown', event => {
    const card = cardFrom(event.target)
    if (!card || event.isComposing || event.keyCode === 229 || model.dialog) return
    if (event.key === 'ContextMenu' || event.key === 'F10' && event.shiftKey) {
      event.preventDefault()
      const row = event.target === card.tree ? card.displayIndex.byId.get(card.activeId) : targetAt(event.target)
      if (row) requestContext(row.id, event.target)
    } else if (event.target === card.tree) keyTree(event, card)
  })
  listen(view, 'pointerover', event => {
    const card = cardFrom(event.target)
    if (card) hovered.add(card.data.id)
  })
  listen(view, 'pointerout', event => {
    const card = cardFrom(event.target)
    if (card && !card.element.contains(event.relatedTarget)) { hovered.delete(card.data.id); if (!frozen()) render() }
  })
  listen(view, 'focusin', event => { if (event.target.closest('.workspace-card')) cardFocus = true })
  listen(view, 'focusout', event => {
    cardFocus = Boolean(event.relatedTarget?.closest?.('.workspace-card'))
    if (!frozen()) render()
  })
  listen(view, 'scroll', event => {
    const id = event.target === overview ? 'overview' : event.target === strip ? 'strip'
      : event.target.classList?.contains('workspace-tree') ? cardFrom(event.target)?.data.id : undefined
    if (id !== undefined) saveScroll(event.target, id)
  }, true)
  listen(overviewButton, 'click', () => { focusWorkspace(null) })
  async function returnToMain() {
    const instance = model?.instance, clipboard = clipboardFlight
    collectScrolls()
    // Do not queue window return behind a pending business, clipboard or layout promise.
    void flushLayout()
    const accepted = await send('return')
    // A click may only refresh/fail: retire this flight on admission, never a newer offer/instance.
    if (accepted && model?.instance === instance && clipboardFlight === clipboard) clipboardFlight = undefined
  }
  listen(returnButton, 'click', returnToMain)

  listen(splitter, 'pointerdown', event => {
    syncSplitter()
    if (!paneBounds || paneDrag || pan || itemDrag || event.button !== 0 || event.isPrimary === false) return
    splitter.setPointerCapture(event.pointerId)
    paneDrag = { id: event.pointerId, y: event.clientY, ...paneBounds }
    root.dataset.resizing = 'true'
    splitter.focus({ preventScroll: true })
    event.preventDefault()
  })
  listen(window, 'pointermove', event => {
    if (!paneDrag || event.pointerId !== paneDrag.id) return
    const next = paneDrag.share + 100 * (event.clientY - paneDrag.y) / paneDrag.available
    paneShare = Math.max(paneDrag.min, Math.min(paneDrag.max, next))
    syncSplitter()
    event.preventDefault()
  })
  listen(window, 'pointerup', finishPaneDrag)
  listen(window, 'pointercancel', finishPaneDrag)
  listen(splitter, 'lostpointercapture', finishPaneDrag)
  listen(splitter, 'dblclick', resetPaneShare)
  listen(splitter, 'keydown', event => {
    if (composing || event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey) return
    syncSplitter()
    if (!paneBounds) return
    const step = event.shiftKey ? 10 : 1
    let next
    if (event.key === 'ArrowUp') next = paneBounds.share - step
    else if (event.key === 'ArrowDown') next = paneBounds.share + step
    else if (event.key === 'Home') next = paneBounds.min
    else if (event.key === 'End') next = paneBounds.max
    else if (event.key === 'Enter') { event.preventDefault(); resetPaneShare(); return }
    else return
    releasePaneDrag()
    paneShare = Math.max(paneBounds.min, Math.min(paneBounds.max, next))
    syncSplitter()
    event.preventDefault()
  })
  listen(window, 'resize', () => { finishPaneDrag(); syncSplitter() })

  listen(strip, 'wheel', event => {
    const inner = event.target.closest('.workspace-tree, .workspace-preview')
    if (inner?.classList.contains('workspace-tree')
      || (inner && inner.scrollHeight > inner.clientHeight && Math.abs(event.deltaY) > Math.abs(event.deltaX))) return
    const before = strip.scrollLeft, unit = event.deltaMode === 1 ? 32 : event.deltaMode === 2 ? strip.clientWidth : 1
    const delta = (event.deltaX || event.deltaY) * unit
    strip.scrollLeft += event.deltaX ? delta : delta * (document.documentElement.dir === 'rtl' ? -1 : 1)
    if (strip.scrollLeft !== before) { event.preventDefault(); saveScroll(strip, 'strip') }
  }, { passive: false })
  listen(strip, 'pointerdown', event => {
    if (event.button !== 0 || event.pointerType === 'touch' || model.dialog || model.contextMenu || paneDrag
      || event.target.closest('.drag-handle, .menu-button')) return
    suppressUntil = 0
    pan = { id: event.pointerId, x: event.clientX, left: strip.scrollLeft, moved: false }
  })
  listen(window, 'pointermove', event => {
    if (!pan || event.pointerId !== pan.id || itemDrag) return
    const distance = event.clientX - pan.x
    if (!pan.moved && Math.abs(distance) < 8) return
    pan.moved = true
    strip.dataset.dragging = 'true'
    strip.scrollLeft = pan.left - distance
    event.preventDefault(); saveScroll(strip, 'strip')
  })
  function endPan(event) {
    if (!pan || (event?.pointerId !== undefined && event.pointerId !== pan.id)) return
    if (pan.moved) suppressUntil = Date.now() + 400
    pan = undefined
    delete strip.dataset.dragging
    if (!frozen()) render()
  }
  listen(window, 'pointerup', endPan)
  // HTML5 dragstart cancels its pointer stream; only the drag lifecycle ends an item drag.
  listen(window, 'pointercancel', endPan)
  listen(strip, 'keydown', event => {
    if (composing || event.isComposing || event.keyCode === 229) return
    suppressUntil = 0
    if (event.target !== strip) return
    const rtl = document.documentElement.dir === 'rtl'
    if (event.key === 'ArrowRight') strip.scrollLeft += 100
    else if (event.key === 'ArrowLeft') strip.scrollLeft -= 100
    else if (event.key === 'Home') strip.scrollLeft = 0
    else if (event.key === 'End') strip.scrollLeft = (rtl ? -1 : 1) * strip.scrollWidth
    else return
    event.preventDefault(); saveScroll(strip, 'strip')
  })
  listen(window, 'blur', () => { releasePaneDrag(); hovered.clear(); cardFocus = false; endPan(); endItemDrag(); if (!frozen()) render() })
  listen(window, 'focus', () => { cardFocus = Boolean(document.activeElement?.closest('.workspace-card')) })
  listen(window, 'beforeunload', () => { collectScrolls(); void flushLayout() })
  const unsubscribe = api.subscribe(next => { published = true; receive(next) })
  listen(window, 'pagehide', () => {
    releasePaneDrag()
    collectScrolls(); void flushLayout()
    disposed = true; clipboardFlight = undefined
    clearTimeout(searchTimer); clearTimeout(layoutTimer)
    unsubscribe()
    for (const remove of listeners) remove()
  }, { once: true })
  void api.ready().then(initial => { if (!published) receive(initial) }).catch(() => { showNotice(true) })
})()
