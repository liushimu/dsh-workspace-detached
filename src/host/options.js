/** Resolve fixed installed assets and profile-scoped native storage; no production path constants. */
import { fileURLToPath } from 'node:url'
import { isAbsolute, join, normalize } from 'node:path'

/**
 * Parent Config owns defaults; this function accepts only already resolved positive tunables.
 * @param ctx - Injected Host context; profileContext is an optional public boot service.
 * @param config - startupMs, pollMs, leaseMs, graceMs and optional absolute dataDirectory.
 * @returns Process options with package-relative assets and an optional isolated data root.
 */
export function hostOptions(ctx, config) {
  for (const key of ['startupMs', 'pollMs', 'leaseMs', 'graceMs']) {
    if (!Number.isSafeInteger(config[key]) || config[key] <= 0 || config[key] > 2_147_483_647) {
      throw new TypeError(`workspace navigator: ${key} must be a positive timer interval`)
    }
  }
  if (config.leaseMs <= config.pollMs) throw new TypeError('workspace navigator: leaseMs must exceed pollMs')
  const absolute = (value) => typeof value === 'string' && value.length > 0 && !value.includes('\0') && isAbsolute(value)
  let dataDirectory
  if (config.dataDirectory !== undefined) {
    if (!absolute(config.dataDirectory)) throw new TypeError('workspace navigator: dataDirectory must be absolute')
    dataDirectory = normalize(config.dataDirectory)
  } else {
    const profile = ctx.get('profileContext')
    if (profile !== undefined) {
      if (!absolute(profile.dir)) throw new TypeError('workspace navigator: profileContext.dir must be absolute')
      dataDirectory = join(profile.dir, 'data', 'workspace-navigator')
    }
  }
  const packageDirectory = fileURLToPath(new URL('../../', import.meta.url))
  return {
    startupMs: config.startupMs, pollMs: config.pollMs, leaseMs: config.leaseMs, graceMs: config.graceMs,
    packageDirectory,
    executable: join(packageDirectory, 'native', 'win-x64', 'WorkspaceNavigator.exe'),
    rendererDirectory: join(packageDirectory, 'renderer'),
    dataDirectory,
  }
}
