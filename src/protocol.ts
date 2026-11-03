/** Bounded JSON messages for the workspace navigator; no executable or backend state crosses this IPC. */

/** Complete card projection owned by this independent plugin, including localized copy. */
export interface WorkspaceNavigatorModel {
  readonly version: 3
  readonly sortMode: 'activity' | 'manual'
  readonly contextMenu?: WorkspaceNavigatorMenu
  readonly dialog?: WorkspaceNavigatorDialog
  readonly operation?: { readonly id: string; readonly status: 'pending' | 'success' | 'error'; readonly message: string }
  /** One Main-authorized exact Session ID write in the fixed foreground document, not a business action. */
  readonly clipboard?: { readonly id: string; readonly text: string }
  readonly instance: string
  readonly revision: number
  readonly title: string
  readonly query: string
  readonly dark: boolean
  readonly connected: boolean
  readonly lang: string
  readonly direction: 'ltr' | 'rtl'
  readonly density: 'compact' | 'comfortable' | 'roomy'
  readonly labels: {
    readonly search: string
    readonly return: string
    readonly empty: string
    readonly disconnected: string
    readonly error: string
    readonly warning: string
    readonly ongoing: string
    readonly done: string
    readonly overview: string
    readonly searchResults: string
    readonly noSessions: string
    readonly pinned: string
    readonly activityUnavailable: string
    readonly menu?: string
    readonly cancel?: string
    readonly submit?: string
    readonly automatic?: string
    readonly manual?: string
    readonly sort?: string
    readonly pending?: string
    readonly invalidDrop?: string
    readonly color?: string
    readonly glow?: string
    readonly weight?: string
    readonly shadow?: string
    readonly stroke?: string
    readonly strokeWidth?: string
    readonly strokeColor?: string
    readonly icon?: string
    readonly reset?: string
    readonly auto?: string
    readonly iconSolid?: string
    readonly iconOutline?: string
    readonly iconNone?: string
  }
  readonly workspaces: readonly WorkspaceNavigatorWorkspace[]
  readonly layout: WorkspaceNavigatorLayout
}

/** Persisted navigator-only preferences; scroll IDs address overview, strip, or one workspace. */
export interface WorkspaceNavigatorLayout {
  readonly focusedWorkspaceId: string | null
  readonly collapsedGroups: readonly string[]
  readonly scrolls: readonly { readonly id: string; readonly top: number }[]
}

/** Styles admitted by both the renderer and the wire validator. */
export interface WorkspaceNavigatorStyle {
  readonly color?: string
  readonly fontWeight?: string | number
  readonly textShadow?: string
  readonly WebkitTextStrokeWidth?: string
  readonly WebkitTextStrokeColor?: string
}

/** One top-level branch, with real workspaces and groups kept as explicit containers. */
export interface WorkspaceNavigatorWorkspace {
  readonly id: string
  readonly kind?: 'workspace' | 'workspace-group'
  readonly label: string
  readonly title: string
  readonly activityAt: number | null
  /** False when at least one member's content projection has not been materialized. */
  readonly activityKnown: boolean
  readonly matches: boolean
  readonly rows: readonly WorkspaceNavigatorRow[]
  readonly icon?: string
  readonly style?: WorkspaceNavigatorStyle
}

/** Display data only; session IDs address the main document's revalidated open actions. */
export interface WorkspaceNavigatorRow {
  readonly id: string
  readonly kind: 'workspace' | 'workspace-group' | 'group' | 'session'
  readonly workspaceId?: string
  readonly label: string
  readonly title: string
  readonly depth: number
  readonly activityAt: number | null
  /** Separates a known empty history from an unavailable historical projection. */
  readonly activityKnown: boolean
  readonly matches: boolean
  readonly expanded?: boolean
  readonly selected?: boolean
  readonly disabled?: boolean
  readonly status?: 'warning' | 'ongoing' | 'done'
  readonly icon?: string
  readonly style?: WorkspaceNavigatorStyle
  readonly count?: number
  readonly pinned?: boolean
}

export interface WorkspaceNavigatorAppearance {
  readonly color?: string
  readonly glow?: number
  readonly weight?: number
  readonly shadow?: boolean
  readonly stroke?: boolean
  readonly strokeWidth?: number
  readonly strokeColor?: string
  readonly icon?: string
}

export interface WorkspaceNavigatorMenu {
  readonly id: string
  readonly targetId: string
  readonly title: string
  readonly entries: readonly { readonly id: string; readonly label: string; readonly disabled?: boolean; readonly danger?: boolean; readonly separator?: boolean }[]
}

export interface WorkspaceNavigatorDialog {
  readonly id: string
  readonly title: string
  readonly kind: 'text' | 'confirm' | 'select' | 'appearance'
  readonly message?: string
  readonly value?: string
  readonly options?: readonly { readonly id: string; readonly label: string; readonly disabled?: boolean }[]
  readonly appearance?: WorkspaceNavigatorAppearance
}

/** Finite interaction intents; the originating Main remains the sole business executor. */
export type WorkspaceNavigatorCommand = {
  readonly instance: string
  readonly revision: number
  readonly commandId: string
} & (
  | { readonly type: 'activate'; readonly id: string }
  | { readonly type: 'search'; readonly query: string }
  | { readonly type: 'layout'; readonly layout: WorkspaceNavigatorLayout }
  | { readonly type: 'return' }
  | { readonly type: 'context'; readonly id: string }
  | { readonly type: 'action'; readonly id: string; readonly action: string }
  | { readonly type: 'dialog'; readonly id: string; readonly value?: string; readonly appearance?: WorkspaceNavigatorAppearance }
  | { readonly type: 'cancel-dialog'; readonly id: string }
  | { readonly type: 'drop'; readonly id: string; readonly targetId: string | null; readonly position: 'inside' | 'before' | 'after' }
  | { readonly type: 'sort'; readonly mode: 'activity' | 'manual' }
  | { readonly type: 'clipboard-result'; readonly id: string; readonly outcome: 'copied' | 'unavailable' | 'denied' | 'failed' }
)

/** Detached is emitted only after the loaded auxiliary document acknowledges rendering its model. */
export type WorkspaceNavigatorEvent =
  | { readonly kind: 'state'; readonly state: 'opening' | 'detached' | 'closed' | 'error'; readonly code?: string }
  | { readonly kind: 'command'; readonly command: WorkspaceNavigatorCommand }

/** Product API does not expose URLs, Electron objects, IPC channel selection, or window options. */
export interface WorkspaceNavigatorMainBridge {
  readonly protocolVersion: 3
  /**
   * @param model - Initial projection; repeating the same instance/revision focuses the existing window.
   * @returns Ready/rendered completion; rejects after contained load failure or cancellation.
   */
  open(model: WorkspaceNavigatorModel): Promise<void>
  /**
   * @param model - Changed projection with a strictly increasing revision in the open instance; close before replacing the instance.
   * @returns Delivery admission, not a business-action acknowledgement; rejects stale or closed-instance updates.
   */
  publish(model: WorkspaceNavigatorModel): Promise<void>
  /** @returns Focus completion for the existing navigator; never creates a window. */
  focus(): Promise<void>
  /** @returns Closure completion; the main sidebar owner receives closed even while opening. */
  close(): Promise<void>
  /** @param listener - State/intent observer. @returns Idempotent unsubscribe function. */
  subscribe(listener: (event: WorkspaceNavigatorEvent) => void): () => void
}

/** Stale or disconnected intent never executes; the auxiliary document keeps an actionable readable projection. */
export type WorkspaceNavigatorCommandResult =
  | { readonly kind: 'accepted' }
  | { readonly kind: 'refresh' | 'disconnected'; readonly model: WorkspaceNavigatorModel }

/** Rendering acknowledgement carries no data besides the displayed projection identity. */
export interface WorkspaceNavigatorRendered { readonly instance: string; readonly revision: number }

/** Narrow bridge available only to the fixed auxiliary document, never the product API. */
export interface WorkspaceNavigatorAuxApi {
  /** @returns Current model after subscription is installed; does not mark the window detached. */
  ready(): Promise<WorkspaceNavigatorModel>
  /** @param value - Projection already applied to the document; stale acknowledgements request a refresh. */
  rendered(value: WorkspaceNavigatorRendered): Promise<void>
  /** @param value - Observed projection and finite intent. @returns Admission or latest model without executing stale intent. */
  command(value: WorkspaceNavigatorCommand): Promise<WorkspaceNavigatorCommandResult>
  /** @param listener - Projection observer. @returns Unsubscribe function for document teardown. */
  subscribe(listener: (model: WorkspaceNavigatorModel) => void): () => void
}

/** Stable diagnostic classes contain no untrusted labels, IDs, paths, or IPC payloads. */
export class WorkspaceNavigatorError extends Error {
  constructor(readonly code: 'invalid' | 'unowned' | 'stale' | 'unavailable' | 'load-failed' | 'cancelled') {
    super(`workspace navigator: ${code}`)
    this.name = 'WorkspaceNavigatorError'
  }
}

function invalid(): never { throw new WorkspaceNavigatorError('invalid') }
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}
function fields<const K extends string>(
  value: unknown, required: readonly K[], optional: readonly string[] = [],
): asserts value is Record<K, unknown> & Record<string, unknown> {
  if (!object(value) || Object.keys(value).some(key => !required.some(field => field === key) && !optional.includes(key))
    || required.some(key => !Object.hasOwn(value, key))) invalid()
}
function text(value: unknown, max: number, min = 0): value is string { return typeof value === 'string' && value.length >= min && value.length <= max }
function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max }
function optionalBoolean(value: Record<string, unknown>, key: string): void { if (Object.hasOwn(value, key) && typeof value[key] !== 'boolean') invalid() }

const colorPattern = /^(?:#[\da-f]{3,4}|#[\da-f]{6}|#[\da-f]{8}|[a-z]{1,24}|(?:rgb|rgba|hsl|hsla)\([\d\s.,%+/-]{1,100}\))$/iu
function color(value: unknown): value is string {
  return text(value, 128, 1) && colorPattern.test(value) && !/^(?:url|expression|var|inherit|initial|unset|revert)$/iu.test(value)
}
function shadow(value: unknown): boolean {
  if (value === 'none') return true
  if (!text(value, 512, 1)) return false
  const pieces = value.split(/,(?![^()]*\))/u)
  return pieces.length <= 4 && pieces.every((piece) => {
    const tokens = piece.trim().match(/(?:rgba?|hsla?)\([^)]*\)|\S+/gu) ?? []
    const first = tokens[0]
    const last = tokens.at(-1)
    if (first !== undefined && color(first)) tokens.shift()
    else if (last !== undefined && color(last)) tokens.pop()
    return tokens.length >= 2 && tokens.length <= 4 && tokens.every(token => /^-?(?:\d{1,3}(?:\.\d{1,3})?|\.\d{1,3})(?:px)?$/u.test(token))
  })
}
function style(value: unknown): void {
  fields(value, [], ['color', 'fontWeight', 'textShadow', 'WebkitTextStrokeWidth', 'WebkitTextStrokeColor'])
  for (const key of ['color', 'WebkitTextStrokeColor']) if (Object.hasOwn(value, key) && !color(value[key])) invalid()
  if (Object.hasOwn(value, 'fontWeight') && !(typeof value.fontWeight === 'number' && integer(value.fontWeight, 1000) && value.fontWeight >= 1)
    && !(typeof value.fontWeight === 'string' && /^(?:normal|bold|bolder|lighter|[1-9]\d{0,2}|1000)$/u.test(value.fontWeight))) invalid()
  if (Object.hasOwn(value, 'WebkitTextStrokeWidth') && !(typeof value.WebkitTextStrokeWidth === 'string' && /^(?:[0-8](?:\.\d{1,2})?)(?:px)?$/u.test(value.WebkitTextStrokeWidth))) invalid()
  if (Object.hasOwn(value, 'textShadow') && !shadow(value.textShadow)) invalid()
}

const svgTags = new Set(['svg', 'path', 'g', 'rect', 'circle', 'line', 'polyline', 'polygon', 'ellipse', 'mask'])
const numericAttributes = new Set(['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'stroke-width', 'stroke-miterlimit', 'stroke-dashoffset'])
const numbers = /^[-+\d.eE,\s]+$/u
function svgAttribute(name: string, value: string, tag: string): boolean {
  if (name === 'id') return tag === 'mask' && /^[a-z][\w-]{0,63}$/iu.test(value)
  if (name === 'maskUnits') return tag === 'mask' && value === 'userSpaceOnUse'
  if (name === 'mask') return tag === 'g' && /^url\(#[a-z][\w-]{0,63}\)$/iu.test(value)
  if (numericAttributes.has(name)) return value.length <= 64 && /^-?(?:\d+(?:\.\d*)?|\.\d+)(?:px|%)?$/u.test(value)
  if (['fill', 'stroke', 'color'].includes(name)) return color(value)
  if (['opacity', 'fill-opacity', 'stroke-opacity'].includes(name)) return /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/u.test(value)
  if (name === 'viewBox') return value.trim().split(/[\s,]+/u).length === 4 && numbers.test(value) && value.split(/[\s,]+/u).filter(Boolean).every(part => Number.isFinite(Number(part)))
  if (name === 'd') return value.length <= 12_000 && /^[MmZzLlHhVvCcSsQqTtAa\d.eE,+\s-]+$/u.test(value)
  if (name === 'points' || name === 'stroke-dasharray') return value.length <= 2048 && (value === 'none' || numbers.test(value))
  if (name === 'transform') return value.length <= 1024 && /^(?:\s*(?:matrix|translate|scale|rotate|skewX|skewY)\([-+\d.eE,\s]+\)\s*)+$/u.test(value)
  if (name === 'stroke-linecap') return ['butt', 'round', 'square'].includes(value)
  if (name === 'stroke-linejoin') return ['miter', 'round', 'bevel'].includes(value)
  if (name === 'fill-rule' || name === 'clip-rule') return ['nonzero', 'evenodd'].includes(value)
  if (name === 'vector-effect') return value === 'non-scaling-stroke'
  if (name === 'xmlns') return value === 'http://www.w3.org/2000/svg'
  if (name === 'aria-hidden') return value === 'true'
  if (name === 'focusable') return value === 'false'
  if (name === 'role') return value === 'img'
  return false
}

/**
 * Validate a deliberately restricted SVG grammar, including balanced tags and unique attributes.
 * @param value - Inline SVG without entities, comments, links, style, text nodes, or external resources.
 * @returns Whether the geometry-only icon may be reconstructed by the auxiliary renderer.
 */
export function isWorkspaceNavigatorIcon(value: unknown): value is string {
  if (!text(value, 16_384, 1) || /[&!?]/u.test(value)) return false
  const tags = /<(\/?)([a-zA-Z]+)([^<>]*?)(\/?)>/gu
  const stack: string[] = []
  let end = 0
  let count = 0
  let root = false
  let maskId: string | undefined
  let maskReference: string | undefined
  for (const match of value.matchAll(tags)) {
    if (value.slice(end, match.index).trim() !== '') return false
    end = match.index + match[0].length
    const closing = match[1] === '/'
    const tag = match[2]
    const attrs = match[3]
    if (tag === undefined || attrs === undefined) return false
    const selfClosing = match[4] === '/'
    if (!svgTags.has(tag)) return false
    if (!closing && tag === 'mask' && (maskId !== undefined || stack.length !== 1 || stack[0] !== 'svg')) return false
    if (closing) {
      if (selfClosing || attrs.trim() !== '' || stack.pop() !== tag) return false
      continue
    }
    if (++count > 128 || stack.length > 16 || (stack.length === 0 && (root || tag !== 'svg')) || (root && tag === 'svg')) return false
    root = true
    const attributes = /\s+([a-zA-Z][\w-]*)\s*=\s*(?:"([^"<>]*)"|'([^'<>]*)')/gu
    const seen = new Set<string>()
    let position = 0
    for (const attribute of attrs.matchAll(attributes)) {
      if (attrs.slice(position, attribute.index).trim() !== '') return false
      position = attribute.index + attribute[0].length
      const name = attribute[1]
      const content = attribute[2] ?? attribute[3]
      if (name === undefined || content === undefined || seen.has(name) || !svgAttribute(name, content, tag)) return false
      if (name === 'id') maskId = content
      if (name === 'mask') {
        if (stack.includes('mask') || maskReference !== undefined) return false
        maskReference = content.slice(5, -1)
      }
      seen.add(name)
    }
    if (attrs.slice(position).trim() !== '' || (tag === 'mask' && !seen.has('id'))) return false
    if (!selfClosing) stack.push(tag)
  }
  return root && stack.length === 0 && value.slice(end).trim() === '' && maskId === maskReference
}

function array(value: unknown, max: number): asserts value is unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid()
  const keys = Object.keys(value)
  if (keys.length !== value.length || keys.some((key, index) => key !== String(index))) invalid()
}

function layout(value: unknown): asserts value is WorkspaceNavigatorLayout {
  fields(value, ['focusedWorkspaceId', 'collapsedGroups', 'scrolls'])
  if (value.focusedWorkspaceId !== null && !text(value.focusedWorkspaceId, 512, 1)) invalid()
  array(value.collapsedGroups, 10_000)
  const groups = new Set<string>()
  for (const id of value.collapsedGroups) {
    if (!text(id, 512, 1) || groups.has(id)) invalid()
    groups.add(id)
  }
  array(value.scrolls, 256)
  const scrolls = new Set<string>()
  for (const scroll of value.scrolls) {
    fields(scroll, ['id', 'top'])
    if (!text(scroll.id, 512, 1) || scrolls.has(scroll.id) || !integer(scroll.top, 10_000_000)) invalid()
    scrolls.add(scroll.id)
  }
}

function appearance(value: unknown): void {
  fields(value, [], ['color', 'glow', 'weight', 'shadow', 'stroke', 'strokeWidth', 'strokeColor', 'icon'])
  for (const key of ['color', 'strokeColor']) {
    const item = value[key]
    const paletteToken = key === 'color' && typeof item === 'string' && /^auto:(?:[0-9]|1[0-2])$/u.test(item)
    if (Object.hasOwn(value, key) && item !== '' && !paletteToken && !color(item)) invalid()
  }
  for (const key of ['shadow', 'stroke']) optionalBoolean(value, key)
  for (const [key, maximum] of [['glow', 100], ['weight', 1000], ['strokeWidth', 32]] as const) {
    if (Object.hasOwn(value, key) && !(typeof value[key] === 'number' && Number.isFinite(value[key]) && value[key] >= 0 && value[key] <= maximum)) invalid()
  }
  if (Object.hasOwn(value, 'icon') && !(text(value.icon, 128) && /^(?:[a-zA-Z][a-zA-Z\d_:-]{0,127})?$/u.test(value.icon))) invalid()
}

function menu(value: unknown, targets: Set<string>): void {
  fields(value, ['id', 'targetId', 'title', 'entries'])
  if (!text(value.id, 512, 1) || !text(value.targetId, 512, 1) || !targets.has(value.targetId) || !text(value.title, 8192)) invalid()
  array(value.entries, 64)
  const ids = new Set<string>()
  for (const entry of value.entries) {
    fields(entry, ['id', 'label'], ['disabled', 'danger', 'separator'])
    if (!text(entry.id, 128, 1) || ids.has(entry.id) || !text(entry.label, 1024)) invalid()
    ids.add(entry.id)
    for (const key of ['disabled', 'danger', 'separator']) optionalBoolean(entry, key)
  }
}

function dialog(value: unknown): void {
  fields(value, ['id', 'title', 'kind'], ['message', 'value', 'options', 'appearance'])
  if (!text(value.id, 512, 1) || !text(value.title, 8192) || typeof value.kind !== 'string'
    || !['text', 'confirm', 'select', 'appearance'].includes(value.kind)) invalid()
  if (Object.hasOwn(value, 'message') && !text(value.message, 8192)) invalid()
  if (Object.hasOwn(value, 'value') && !text(value.value, 8192)) invalid()
  if (Object.hasOwn(value, 'appearance')) {
    if (value.kind !== 'appearance') invalid()
    appearance(value.appearance)
  }
  if (Object.hasOwn(value, 'options')) {
    if (value.kind !== 'select') invalid()
    array(value.options, 10_000)
    const ids = new Set<string>()
    for (const option of value.options) {
      fields(option, ['id', 'label'], ['disabled'])
      if (!text(option.id, 512) || ids.has(option.id) || !text(option.label, 4096)) invalid()
      optionalBoolean(option, 'disabled')
      ids.add(option.id)
    }
  }
}

function clipboard(value: unknown): void {
  fields(value, ['id', 'text'])
  if (!text(value.id, 128, 1) || !text(value.text, 512, 1)) invalid()
}

function operation(value: unknown): void {
  fields(value, ['id', 'status', 'message'])
  if (!text(value.id, 128, 1) || typeof value.status !== 'string' || !['pending', 'success', 'error'].includes(value.status)
    || !text(value.message, 8192)) invalid()
}

function activity(value: Record<string, unknown>): void {
  if ((value.activityAt !== null && !integer(value.activityAt))
    || typeof value.activityKnown !== 'boolean' || typeof value.matches !== 'boolean') invalid()
}

function row(value: unknown): asserts value is WorkspaceNavigatorRow {
  fields(value, ['id', 'kind', 'label', 'title', 'depth', 'activityAt', 'activityKnown', 'matches'],
    ['expanded', 'selected', 'disabled', 'status', 'icon', 'style', 'count', 'pinned', 'workspaceId'])
  if (!text(value.id, 512, 1) || typeof value.kind !== 'string' || !['workspace', 'workspace-group', 'group', 'session'].includes(value.kind)
    || !text(value.label, 4096) || !text(value.title, 8192) || !integer(value.depth, 64)) invalid()
  if (Object.hasOwn(value, 'workspaceId') && !text(value.workspaceId, 512, 1)) invalid()
  activity(value)
  for (const key of ['expanded', 'selected', 'disabled', 'pinned']) optionalBoolean(value, key)
  if (Object.hasOwn(value, 'count') && !integer(value.count, 1_000_000_000)) invalid()
  if (Object.hasOwn(value, 'status') && (typeof value.status !== 'string' || !['warning', 'ongoing', 'done'].includes(value.status))) invalid()
  if (Object.hasOwn(value, 'icon') && !isWorkspaceNavigatorIcon(value.icon)) invalid()
  if (Object.hasOwn(value, 'style')) style(value.style)
}

/**
 * Parse complete trees at the wire boundary; at most 10,000 cards plus rows and 4 MiB UTF-8.
 * @param value - Untrusted structured-clone input.
 * @returns Validated data; rejects unknown fields, invalid preorder parents, duplicate IDs, and unsafe styles/icons.
 */
export function parseWorkspaceNavigatorModel(value: unknown): WorkspaceNavigatorModel {
  fields(value, ['version', 'instance', 'revision', 'title', 'query', 'dark', 'connected', 'lang', 'direction', 'density', 'labels', 'workspaces', 'layout', 'sortMode'], ['contextMenu', 'dialog', 'operation', 'clipboard'])
  if (value.version !== 3 || (value.sortMode !== 'activity' && value.sortMode !== 'manual') || !text(value.instance, 128, 1) || !integer(value.revision) || !text(value.title, 512)
    || !text(value.query, 4096) || typeof value.dark !== 'boolean' || typeof value.connected !== 'boolean'
    || !text(value.lang, 64, 1) || !/^[a-z]{2,8}(?:-[a-z\d]{1,8})*$/iu.test(value.lang)
    || typeof value.direction !== 'string' || !['ltr', 'rtl'].includes(value.direction)
    || typeof value.density !== 'string' || !['compact', 'comfortable', 'roomy'].includes(value.density)) invalid()
  array(value.workspaces, 10_000)
  fields(value.labels, ['search', 'return', 'empty', 'disconnected', 'error', 'warning', 'ongoing', 'done',
    'overview', 'searchResults', 'noSessions', 'pinned', 'activityUnavailable'], ['menu', 'cancel', 'submit', 'automatic', 'manual', 'sort', 'pending', 'invalidDrop',
    'color', 'glow', 'weight', 'shadow', 'stroke', 'strokeWidth', 'strokeColor', 'icon', 'reset', 'auto', 'iconSolid', 'iconOutline', 'iconNone'])
  if (!Object.values(value.labels).every(label => text(label, 1024, 1))) invalid()
  layout(value.layout)
  const ids = new Set<string>()
  let count = value.workspaces.length
  for (const workspace of value.workspaces) {
    fields(workspace, ['id', 'label', 'title', 'activityAt', 'activityKnown', 'matches', 'rows'], ['icon', 'style', 'kind'])
    if (!text(workspace.id, 512, 1) || ids.has(workspace.id) || !text(workspace.label, 4096) || !text(workspace.title, 8192)
      || Object.hasOwn(workspace, 'kind') && workspace.kind !== 'workspace' && workspace.kind !== 'workspace-group') invalid()
    ids.add(workspace.id)
    activity(workspace)
    if (Object.hasOwn(workspace, 'icon') && !isWorkspaceNavigatorIcon(workspace.icon)) invalid()
    if (Object.hasOwn(workspace, 'style')) style(workspace.style)
    array(workspace.rows, 10_000)
    count += workspace.rows.length
    if (count > 10_000) invalid()
    const parents: WorkspaceNavigatorRow[] = []
    for (const entry of workspace.rows) {
      row(entry)
      if (ids.has(entry.id) || entry.depth > 0 && (!parents[entry.depth - 1] || parents[entry.depth - 1]?.kind === 'session')) invalid()
      ids.add(entry.id)
      parents.length = entry.depth
      parents.push(entry)
    }
  }
  if (Object.hasOwn(value, 'contextMenu')) menu(value.contextMenu, ids)
  if (Object.hasOwn(value, 'dialog')) dialog(value.dialog)
  if (Object.hasOwn(value, 'operation')) operation(value.operation)
  if (Object.hasOwn(value, 'clipboard')) clipboard(value.clipboard)
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 4 * 1024 * 1024) invalid()
  return value as WorkspaceNavigatorModel
}

/** @param value - Untrusted auxiliary intent. @returns Exact, bounded, type-specific command fields. */
export function parseWorkspaceNavigatorCommand(value: unknown): WorkspaceNavigatorCommand {
  if (!object(value)) invalid()
  const type = value.type
  if (typeof type !== 'string' || !['activate', 'search', 'layout', 'return', 'context', 'action', 'dialog', 'cancel-dialog', 'drop', 'sort', 'clipboard-result'].includes(type)) invalid()
  const payload = ['activate', 'context', 'dialog', 'cancel-dialog'].includes(type) ? ['id']
    : type === 'clipboard-result' ? ['id', 'outcome'] : type === 'action' ? ['id', 'action'] : type === 'drop' ? ['id', 'targetId', 'position']
      : type === 'sort' ? ['mode'] : type === 'search' ? ['query'] : type === 'layout' ? ['layout'] : []
  fields(value, ['instance', 'revision', 'commandId', 'type', ...payload], type === 'dialog' ? ['value', 'appearance'] : [])
  if (!text(value.instance, 128, 1) || !integer(value.revision) || !text(value.commandId, 128, 1)
    || payload.includes('id') && !text(value.id, 512, 1)
    || type === 'search' && !text(value.query, 4096)
    || type === 'action' && !text(value.action, 128, 1)
    || type === 'clipboard-result' && (!text(value.id, 128, 1) || typeof value.outcome !== 'string' || !['copied', 'unavailable', 'denied', 'failed'].includes(value.outcome))
    || type === 'drop' && (value.targetId !== null && !text(value.targetId, 512, 1)
      || typeof value.position !== 'string' || !['inside', 'before', 'after'].includes(value.position))
    || type === 'sort' && value.mode !== 'activity' && value.mode !== 'manual') invalid()
  if (type === 'layout') layout(value.layout)
  if (type === 'dialog') {
    if (Object.hasOwn(value, 'value') && !text(value.value, 8192)) invalid()
    if (Object.hasOwn(value, 'appearance')) appearance(value.appearance)
  }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 4 * 1024 * 1024) invalid()
  return value as WorkspaceNavigatorCommand
}

/** @param value - Untrusted displayed-model identity. @returns Exact acknowledgement fields. */
export function parseWorkspaceNavigatorRendered(value: unknown): WorkspaceNavigatorRendered {
  fields(value, ['instance', 'revision'])
  if (!text(value.instance, 128, 1) || !integer(value.revision)) invalid()
  return value as WorkspaceNavigatorRendered
}

/** @param value - Main-process notification. @returns Validated state or command with no extra fields. */
export function parseWorkspaceNavigatorEvent(value: unknown): WorkspaceNavigatorEvent {
  if (!object(value)) invalid()
  if (value.kind === 'state') {
    fields(value, ['kind', 'state'], ['code'])
    if (typeof value.state !== 'string' || !['opening', 'detached', 'closed', 'error'].includes(value.state)
      || Object.hasOwn(value, 'code') && !(text(value.code, 128, 1) && /^[a-z][a-z\d/-]*$/u.test(value.code))) invalid()
  } else if (value.kind === 'command') {
    fields(value, ['kind', 'command'])
    parseWorkspaceNavigatorCommand(value.command)
  } else invalid()
  return value as WorkspaceNavigatorEvent
}

/** @param value - Reply to auxiliary intent. @returns Accepted intent or a readable non-executed refresh. */
export function parseWorkspaceNavigatorCommandResult(value: unknown): WorkspaceNavigatorCommandResult {
  if (!object(value)) invalid()
  if (value.kind === 'accepted') fields(value, ['kind'])
  else if (value.kind === 'refresh' || value.kind === 'disconnected') {
    fields(value, ['kind', 'model'])
    parseWorkspaceNavigatorModel(value.model)
  } else invalid()
  return value as WorkspaceNavigatorCommandResult
}
