/** Plugin-owned, constant-size content-activity projection; no Session reads or Agent activation. */

/** @returns Unknown activity for an empty log or a missing prior cache. */
export function initialActivity() { return { lastContentAt: null } }

/**
 * Fold accepted/surfaced human input and settled non-empty Assistant content.
 * Adapts the pure content-time rule only, not another plugin's key or registration.
 * @param state - Previous {lastContentAt:number|null} value, never mutated.
 * @param event - One committed SessionEvent, not a transient stream update.
 * @returns The original reference unless a qualifying event has a later valid epoch time.
 */
export function applyActivity(state, event) {
  if (typeof event.time !== 'number' || !Number.isFinite(event.time) || event.time < 0 || event.time > Number.MAX_SAFE_INTEGER) return state
  switch (event.type) {
    case 'user/message':
      if (event.data.source.kind !== 'user') return state
      break
    case 'assistant/message':
      if (event.data.message.content.length === 0) return state
      break
    case 'agent/inbox/spliced':
      if (!event.data.inserted.some(message => message.source.kind === 'user')) return state
      break
    default:
      // Session event names are merge-extensible; metadata and tools do not advance activity.
      return state
  }
  return state.lastContentAt !== null && event.time <= state.lastContentAt ? state : { lastContentAt: event.time }
}

/**
 * Build the public projection contribution using the registry's actual Zod parse interface.
 * @param z - Zod namespace resolved by installHost only when the Host is installed.
 * @returns A stateVersion-1 definition whose whole wire view reuses the state reference.
 */
export function activityDefinition(z) {
  const schema = z.object({ lastContentAt: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER).nullable() }).strict()
  return {
    key: 'workspaceNavigatorActivity',
    stateVersion: 1,
    stateSchema: schema,
    init: initialActivity,
    apply: applyActivity,
    wire: { viewSchema: schema, view: state => state },
  }
}
