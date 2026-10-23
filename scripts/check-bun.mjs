// Fails when the Bun running the install is not the version package.json pins
// in `packageManager`. Runs as the root preinstall script.
import { readFileSync } from 'node:fs'

const pinned = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).packageManager.replace(/^bun@/, '')
// During an install, the user agent names the Bun running it (`bun/1.4.4 ...`).
const running = /^bun\/(\S+)/.exec(process.env.npm_config_user_agent ?? '')?.[1] ?? process.versions.bun
if (running !== pinned) {
  console.error(`Juno needs Bun ${pinned}; this is ${running ? `Bun ${running}` : 'not Bun'}. Run \`bun upgrade --version ${pinned}\` or install it from bun.sh.`)
  process.exit(1)
}
