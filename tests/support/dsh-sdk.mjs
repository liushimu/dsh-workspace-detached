/** Explicit, read-only access to a built DSH SDK checkout for composition tests. */
import { createRequire } from 'node:module'
import { isAbsolute, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

const directory = process.env.DSH_SOURCE_ROOT
if (!directory || !isAbsolute(directory)) throw new Error('Set DSH_SOURCE_ROOT to the absolute path of a built DeepSeek Harness source checkout. See DEVELOPMENT.md.')
const root = pathToFileURL(resolve(directory) + sep)
export const sdkFile = relative => new URL(relative, root)
export const dshRequire = createRequire(sdkFile('package.json'))
export const dshDesktopRequire = createRequire(sdkFile('apps/desktop/package.json'))
