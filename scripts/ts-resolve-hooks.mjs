/**
 * Lets plain Node run the workspace's TypeScript directly. Node strips types
 * on its own, but the packages use bundler-style imports (`./sync` for
 * `./sync.ts`), which Node's resolver does not try. This hook adds the
 * `.ts`, `.tsx` and `/index.ts` candidates for a relative import that did
 * not resolve. Use: `node --import ./scripts/ts-resolve-hooks.mjs <script>`.
 */
import { existsSync } from 'node:fs'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      const relative = specifier.startsWith('./') || specifier.startsWith('../')
      const code = error?.code
      if (!relative || context.parentURL === undefined || (code !== 'ERR_MODULE_NOT_FOUND' && code !== 'ERR_UNSUPPORTED_DIR_IMPORT')) throw error
      const base = new URL(specifier, context.parentURL).href
      for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
        if (existsSync(fileURLToPath(candidate))) return nextResolve(candidate, context)
      }
      throw error
    }
  },
})
