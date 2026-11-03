/** Public Host installation entry; importing this module does not resolve optional framework peers. */
import { activityDefinition } from './activity.js'
import { HostBridge } from './bridge.js'
import { hostOptions } from './options.js'
import { HostError } from './validation.js'

/**
 * Install from the main entry's public registration context: inject connection, webServer,
 * subprocess and sessionProjections, then retain webServer on ctx.extend({ webServer }).
 *
 * RPC /workspace-navigator accepts exactly capabilities({clientId}), open/publish({clientId,model}),
 * focus/close({clientId}), events({clientId,after}). clientId is 32 lowercase hex characters.
 * capabilities or open establishes the binding; every later call requires the same admitted owner Peer.
 * capabilities returns additive bindingId: 32 random lowercase hex characters owned by this binding,
 * distinct from clientId/Peer identity. Before explicit open/retry, confirm capabilities: preserve the
 * events cursor for an unchanged bindingId; reset to zero only for a confirmed different bindingId.
 * open resolves null only after helper started + ready + current matching rendered, including reopen.
 * Explicit refocus/reopen reports opening/detached again; ordinary publish only admits delivery of a
 * newer same-instance revision and never toggles sidebar state. Commands acknowledge forwarding only.
 * events has one cancellable held read per binding; acknowledge only its returned next cursor.
 * Request cancellation stops waiting, while explicit close, Peer disposal, lease expiry or plugin unload
 * owns helper termination. No method opens a DSH Session, launches an Agent, or edits a registry.
 *
 * @param ctx - Context with the three public injected services, effect(), and get().
 * @param config - Parent-resolved startupMs/pollMs/leaseMs/graceMs plus optional absolute dataDirectory.
 * @returns Promise<{dispose:()=>Promise<void>, diagnostics:()=>object}>; disposal removes RPC/projection
 * contributions and awaits every managed helper range. diagnostics contains only redacted local counts/codes.
 */
export async function installHost(ctx, config) {
  const options = hostOptions(ctx, config)
  if (typeof ctx.connection?.rpc?.handle !== 'function' || typeof ctx.subprocess?.spawn !== 'function'
    || typeof ctx.sessionProjections?.register !== 'function') {
    throw new Error('workspace navigator: required public Host services are unavailable')
  }
  // The registry validates through Zod.parse. No module is resolved merely to import this entry.
  const { z } = await import('zod')
  const bridge = new HostBridge(ctx.subprocess, options)
  let removeProjection, removeRpc, cleanup
  const release = () => {
    if (cleanup !== undefined) return cleanup
    cleanup = (async () => {
      let failed = false
      // Unregister even when a provider cannot confirm process exit; the failure still propagates.
      for (const remove of [() => bridge.dispose(), () => removeRpc(), () => removeProjection()]) {
        try { await remove() } catch (error) { failed = true }
      }
      if (failed) throw new HostError('cleanup-failed')
    })()
    return cleanup
  }
  const disposeEffect = ctx.effect(function* () {
    removeProjection = ctx.sessionProjections.register(activityDefinition(z))
    yield removeProjection
    removeRpc = ctx.connection.rpc.handle('/workspace-navigator', bridge.handle)
    yield removeRpc
    yield release
  }, 'workspace-navigator: Host bridge and activity projection')
  return {
    dispose: async () => { await release(); await disposeEffect() },
    diagnostics: () => bridge.diagnostics(),
  }
}
