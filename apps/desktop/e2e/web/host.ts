import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { expect } from '@playwright/test'
import type { WebShell } from '../../web/host/shell'

/** The actual CLI, outside Playwright's shared CommonJS/ESM transform cache. */
export async function launchWebShell(): Promise<Pick<WebShell, 'url' | 'controlUrl' | 'stop'>> {
  const root = resolve(import.meta.dirname, '../../../..')
  const host = spawn(process.execPath, [
    '--max-old-space-size=384', '--import', resolve(root, 'scripts/ts-resolve-hooks.mjs'),
    '--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', resolve(root, 'apps/desktop/web/host/cli.ts'),
  ], { cwd: root, env: { ...process.env, JUNO_WEB_PORT: '0' }, stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = once(host, 'exit')
  const stop = async () => {
    host.kill('SIGTERM')
    const timer = setTimeout(() => host.kill('SIGKILL'), 8000)
    try {
      const [code] = await exited
      expect(code).toBe(0)
    } finally {
      clearTimeout(timer)
    }
  }
  let output = ''
  host.stdout.on('data', (chunk: Buffer) => { output += chunk.toString() })
  host.stderr.on('data', (chunk: Buffer) => { output += chunk.toString() })
  try {
    await expect.poll(() => {
      if (host.exitCode !== null) throw new Error(output)
      return /Juno web shell: (http:\/\/\S+)\s+control: (http:\/\/\S+)\/<name>/.test(output)
    }, { timeout: 30_000 }).toBe(true)
    const match = /Juno web shell: (http:\/\/\S+)\s+control: (http:\/\/\S+)\/<name>/.exec(output)
    if (!match?.[1] || !match[2]) throw new Error('Missing web shell addresses')
    return { url: match[1], controlUrl: match[2], stop }
  } catch (cause) {
    await stop()
    throw cause
  }
}

export async function messages(controlUrl: string): Promise<unknown> {
  const response = await fetch(`${controlUrl}/messages`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ channel: 'C0ENG' }),
  })
  expect(response.ok).toBe(true)
  const body: unknown = await response.json()
  if (typeof body !== 'object' || body === null || !('result' in body)) throw new Error('Missing fake messages')
  return body.result
}
