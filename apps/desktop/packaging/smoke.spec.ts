import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses'
import { test, expect, chromium } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { startFakeSlack } from '@juno/fake-slack'
import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'

test('packaged app signs in and starts both utility processes @mac', async () => {
  test.setTimeout(180_000)
  const executable = process.env.JUNO_PACKAGED_EXECUTABLE ?? resolve('release/mac-arm64/Juno.app/Contents/MacOS/Juno')
  const appPath = resolve(executable, '../../..')
  let signature = ''
  // codesign writes its description to stderr, even on success.
  const inspection = spawn('codesign', ['-dvv', appPath], { stdio: ['ignore', 'ignore', 'pipe'] })
  inspection.stderr.setEncoding('utf8').on('data', (chunk: string) => { signature += chunk })
  await once(inspection, 'exit')
  if (!signature.includes('Authority=Developer ID Application:')) {
    execFileSync('codesign', ['-s', '-', '--force', '--deep', '--preserve-metadata=entitlements,requirements,flags,runtime', appPath], { stdio: 'pipe' })
  }
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'pipe' })
  const fuses = await getCurrentFuseWire(appPath)
  for (const fuse of [FuseV1Options.RunAsNode, FuseV1Options.EnableNodeOptionsEnvironmentVariable, FuseV1Options.EnableNodeCliInspectArguments]) {
    expect(fuses[fuse]).toBe('0'.charCodeAt(0))
  }
  for (const fuse of [FuseV1Options.EnableCookieEncryption, FuseV1Options.EnableEmbeddedAsarIntegrityValidation, FuseV1Options.OnlyLoadAppFromAsar]) {
    expect(fuses[fuse]).toBe('1'.charCodeAt(0))
  }
  const userData = await mkdtemp(join(tmpdir(), 'juno-package-'))
  const fake = await startFakeSlack()
  const model = await startFakeOpenRouter()
  const env: NodeJS.ProcessEnv = { ...process.env, JUNO_E2E: '1', JUNO_USER_DATA: userData, JUNO_FAKE_SLACK_URL: fake.url,
    JUNO_E2E_OPENROUTER_KEY: 'sk-or-v1-e2e-packaging-0123456789abcdef', JUNO_FAKE_OPENROUTER_URL: model.origin,
    // The agent runs one script at start and writes the result: the QuickJS worker and binary load from the asar.
    JUNO_AGENT_CODEMODE: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NODE_OPTIONS
  try {
    const timings: number[] = []
    for (let pass = 0; pass < 6; pass++) {
      await rm(join(userData, 'DevToolsActivePort'), { force: true })
      const started = performance.timeOrigin + performance.now()
      const child = spawn(executable, ['--remote-debugging-port=0'], { env, stdio: 'ignore' })
      let exited = false
      const closed = once(child, 'exit').then(([code, signal]) => { exited = true; return { code, signal } })
      try {
        await expect.poll(async () => {
          if (exited) throw new Error(`Packaged app exited: ${JSON.stringify(await closed)}`)
          return readFile(join(userData, 'DevToolsActivePort'), 'utf8').catch(() => '')
        }, { timeout: 20_000 }).not.toBe('')
        const [port] = (await readFile(join(userData, 'DevToolsActivePort'), 'utf8')).trim().split('\n')
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`)
        try {
          const context = browser.contexts()[0]
          if (!context) throw new Error('Packaged app has no browser context')
          await expect.poll(() => context.pages().find((candidate) => candidate.url().startsWith('juno://'))?.url()).toBeTruthy()
          const page = context.pages().find((candidate) => candidate.url().startsWith('juno://'))
          if (!page) throw new Error('Packaged app did not open its main window')
          if (pass === 0) {
            await expect(page.getByRole('button', { name: 'Sign in to Slack', exact: true })).toBeVisible()
            const opened = context.waitForEvent('page')
            await page.getByRole('button', { name: 'Sign in to Slack', exact: true }).click()
            const signIn = await opened
            await signIn.getByPlaceholder('Email').fill('tushar@juno-fake.test')
            await signIn.getByPlaceholder('Password').fill('password')
            await signIn.getByRole('button', { name: 'Sign in', exact: true }).click()
          }
          await expect(page.getByRole('complementary', { name: 'Sidebar' }).getByRole('listitem').first()).toBeVisible({ timeout: 20_000 })
          if (pass > 0) {
            await page.waitForFunction(() => performance.getEntriesByName('juno.sidebar-rows', 'measure').length > 0)
            const painted = await page.evaluate(() => {
              const entry = performance.getEntriesByName('juno.sidebar-rows', 'measure')[0]
              if (!entry) throw new Error('Sidebar paint was not recorded')
              return performance.timeOrigin + entry.startTime + entry.duration
            })
            timings.push(painted - started)
          }
          await expect.poll(() => page.evaluate(() => window.juno.agent.requestPort())).toEqual('sent')
          await page.screenshot({ path: 'test-results/packaged-sidebar.png' })
        } finally {
          await browser.close()
        }
      } finally {
        if (!exited) child.kill('SIGTERM')
        await closed
      }
    }
    expect(JSON.parse(await readFile(join(userData, 'agent', 'codemode-probe.json'), 'utf8'))).toEqual({ ok: true, value: 12 })
    expect(timings).toHaveLength(5)
    const sorted = timings.toSorted((a, b) => a - b)
    const report = { samplesMs: timings, medianMs: sorted[2], minMs: sorted[0], maxMs: sorted[4] }
    console.log(`Packaged launch to first sidebar rows painted: ${JSON.stringify(report)}`)
    await writeFile(test.info().outputPath('startup.json'), JSON.stringify(report, null, 2))
  } finally {
    await model.close()
    await fake.close()
    await rm(userData, { recursive: true, force: true })
  }
})
