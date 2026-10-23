#!/usr/bin/env bun
// Runs a command with ELECTRON_RUN_AS_NODE removed from the environment.
//
// Tools built on Electron (editors, agents) often export ELECTRON_RUN_AS_NODE=1
// to their child shells. With it set, the Electron binary starts as plain
// Node and never opens a window, so `electron-vite dev` and Playwright's
// _electron.launch fail in confusing ways. Usage:
//
//   bun scripts/without-run-as-node.mjs electron-vite dev
import { spawn } from 'node:child_process'

const [command, ...args] = process.argv.slice(2)
if (!command) {
  console.error('usage: without-run-as-node.mjs <command> [args...]')
  process.exit(2)
}

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

const child = spawn(command, args, { stdio: 'inherit', env, shell: process.platform === 'win32' })
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  process.exit(code ?? 1)
})
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal))
}
