/** Independent plugin entry; the public Host/Client capabilities own all behavior. */
import { installHost } from './host/index.js'

export const name = 'dsh-workspace-detached'

let Schema = null
try { Schema = (await import('@deepseek-ai/schemastery')).default }
catch (error) { console.warn('[dsh-workspace-detached] Config UI unavailable:', error.message) }

const live = schema => typeof schema.volatile === 'function' ? schema.volatile() : schema
export const Config = Schema === null ? undefined : Schema.object({
  compactChains: live(Schema.boolean().default(true)),
  statusPulse: live(Schema.boolean().default(true)),
  styling: live(Schema.dict(Schema.any()).default({})),
  appearance: live(Schema.dict(Schema.any()).default({})),
  startupMs: Schema.number().min(1000).max(120000).default(15000),
  pollMs: Schema.number().min(100).max(30000).default(20000),
  leaseMs: Schema.number().min(2000).max(300000).default(60000),
  graceMs: Schema.number().min(100).max(10000).default(2000),
  dataDirectory: Schema.string(),
})

const valueOf = value => value && typeof value.get === 'function' ? value.get() : value
function integer(value, fallback, min, max) {
  const resolved = valueOf(value)
  if (resolved === undefined) return fallback
  if (!Number.isSafeInteger(resolved) || resolved < min || resolved > max) throw new TypeError('workspace navigator: invalid lifecycle configuration')
  return resolved
}

/** Mount the backend only through its public service dependencies; the Client can still show an unavailable-window error if a future Host omits them. */
export function apply(ctx, config = {}) {
  const resolved = {
    startupMs: integer(config.startupMs, 15000, 1000, 120000),
    pollMs: integer(config.pollMs, 20000, 100, 30000),
    leaseMs: integer(config.leaseMs, 60000, 2000, 300000),
    graceMs: integer(config.graceMs, 2000, 100, 10000),
  }
  const dataDirectory = valueOf(config.dataDirectory)
  if (dataDirectory !== undefined && dataDirectory !== '') {
    if (typeof dataDirectory !== 'string') throw new TypeError('workspace navigator: dataDirectory must be a path')
    resolved.dataDirectory = dataDirectory
  }
  ctx.inject(['connection', 'webServer', 'subprocess', 'sessionProjections'], async host => {
    // Keep the public route capability on this registration scope across service-context tracing.
    const registration = host.extend({ webServer: host.get('webServer') })
    await installHost(registration, resolved)
  })
}
