// The pool daemon runs from a copy of its modules in the pool folder, never
// from a worktree: on 10-17 one started by verify:main outlived its temporary checkout.
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const sources = ['pool.mjs', 'pool-decisions.mjs', 'outage.mjs', 'locks.mjs', 'daemon-home.mjs']

/** The daemon's script in `<pool>/daemon/<hash>/`, copied there if needed; older copies are removed. Call only when starting a daemon. */
export function daemonScript(pool) {
  const here = dirname(fileURLToPath(import.meta.url))
  const hash = createHash('sha256')
  for (const name of sources) hash.update(name).update('\0').update(readFileSync(join(here, name)))
  const home = join(pool, 'daemon', hash.digest('hex').slice(0, 16))
  if (!sources.every((name) => existsSync(join(home, name)))) {
    const temporary = `${home}.${process.pid}.tmp`
    rmSync(temporary, { recursive: true, force: true })
    mkdirSync(temporary, { recursive: true })
    for (const name of sources) copyFileSync(join(here, name), join(temporary, name))
    rmSync(home, { recursive: true, force: true })
    renameSync(temporary, home)
  }
  for (const name of readdirSync(join(pool, 'daemon'))) if (join(pool, 'daemon', name) !== home) rmSync(join(pool, 'daemon', name), { recursive: true, force: true })
  return join(home, 'pool.mjs')
}
