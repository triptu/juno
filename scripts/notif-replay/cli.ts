#!/usr/bin/env node
/**
 * `pnpm notif:replay <command>`: measure the notification decision against
 * the owner's own messages. See `scripts/notif-replay/README.md`.
 */
const [command, ...rest] = process.argv.slice(2)

const commands: Record<string, () => Promise<{ readonly [name: string]: (argv: ReadonlyArray<string>) => Promise<void> }>> = {
  run: () => import('./replay'),
  sample: () => import('./sample'),
  label: () => import('./serve'),
  report: () => import('./report'),
}

const load = command === undefined ? undefined : commands[command]
if (load === undefined) {
  console.log('Usage: pnpm notif:replay run|sample|label|report [flags]. See scripts/notif-replay/README.md.')
  process.exitCode = 1
} else {
  const module = await load()
  const main = module[command === 'run' ? 'run' : command === 'label' ? 'serve' : command!]!
  await main(rest)
}
