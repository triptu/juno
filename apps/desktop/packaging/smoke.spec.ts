import { FuseV1Options, getCurrentFuseWire } from '@electron/fuses'
import { test, expect, chromium } from '@playwright/test'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { startFakeSlack, writeSlackAppFixture } from '@juno/fake-slack'
import { startFakeOpenRouter } from '@juno/agent-testing/openrouter'

test('packaged app signs in and starts both utility processes @mac', async () => {
  test.setTimeout(180_000)
  const windows = process.platform === 'win32'
  // On Windows this is the per-user NSIS install (docs/development.md, "Windows build").
  const executable = process.env.JUNO_PACKAGED_EXECUTABLE ?? (windows
    ? join(process.env.LOCALAPPDATA ?? '', 'Programs', 'juno', 'Juno.exe')
    : resolve('release/mac-arm64/Juno.app/Contents/MacOS/Juno'))
  const appPath = windows ? executable : resolve(executable, '../../..')
  if (!windows) {
    let signature = ''
    // codesign writes its description to stderr, even on success.
    const inspection = spawn('codesign', ['-dvv', appPath], { stdio: ['ignore', 'ignore', 'pipe'] })
    inspection.stderr.setEncoding('utf8').on('data', (chunk: string) => { signature += chunk })
    await once(inspection, 'exit')
    if (!signature.includes('Authority=Developer ID Application:')) {
      execFileSync('codesign', ['-s', '-', '--force', '--deep', '--preserve-metadata=entitlements,requirements,flags,runtime', appPath], { stdio: 'pipe' })
    }
    execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'pipe' })
  }
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
  const slackAppDir = join(userData, 'slack-app')
  const keychainPassword = 'juno-fake-packaged-keychain'
  const credentials = fake.signIn()
  await writeSlackAppFixture(slackAppDir, {
    team: { id: fake.teamId, name: 'Juno Fake', domain: 'juno-fake', url: `${fake.url}/`, token: credentials.token, userId: credentials.userId },
    cookie: credentials.cookie,
    keychainPassword,
  })
  const env: NodeJS.ProcessEnv = { ...process.env, JUNO_E2E: '1', JUNO_USER_DATA: userData, JUNO_FAKE_SLACK_URL: fake.url,
    JUNO_SLACK_APP_DIR: slackAppDir, JUNO_SLACK_SAFE_STORAGE_PASSWORD: keychainPassword,
    JUNO_E2E_OPENROUTER_KEY: 'sk-or-v1-e2e-packaging-0123456789abcdef', JUNO_FAKE_OPENROUTER_URL: model.origin,
    // The agent runs one script at start and writes the result: the QuickJS worker and binary load from the asar.
    JUNO_AGENT_CODEMODE: '1',
    // Main loads koffi from the asar and calls the screen watcher symbol once, then writes which one it found.
    JUNO_E2E_SCREEN_PROBE: '1',
    // The engine's fake AI answers only with the OpenRouter key main hands it and inside the agent's cap, as the live one does.
    JUNO_FAKE_AI_REQUIRES_KEY: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.NODE_OPTIONS
  try {
    const timings: number[] = []
    for (let pass = 0; pass < 6; pass++) {
      await rm(join(userData, 'DevToolsActivePort'), { force: true })
      const started = performance.timeOrigin + performance.now()
      // This throwaway fake-Slack profile must not wait on the owner's macOS cookie keychain.
      const child = spawn(executable, ['--remote-debugging-port=0', '--use-mock-keychain'], { env, stdio: 'ignore' })
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
            await expect(page.getByRole('button', { name: "Use the Slack app's session", exact: true })).toBeVisible()
            await page.screenshot({ path: test.info().outputPath('packaged-sign-in.png') })
            await page.getByRole('button', { name: "Use the Slack app's session", exact: true }).click()
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
          // The engine got the saved key from main: a sidebar thread has an AI title without being opened.
          await expect(page.locator('[data-topic-row][data-title-source="ai"]').first()).toBeVisible({ timeout: 30_000 })
          await page.screenshot({ path: 'test-results/packaged-sidebar.png' })
          if (pass === 0) {
            await page.getByRole('listitem', { name: '#eng', exact: true }).click()
            const field = page.locator('[data-composer] textarea').last()
            await expect(field).toBeVisible()
            const transfer = await page.evaluateHandle(() => {
              const data = new DataTransfer()
              data.items.add(new File([new Uint8Array(3 * 1024 * 1024)], 'Juno.dmg', { type: '' }))
              data.items.add(new File([new Uint8Array(2 * 1024 * 1024)], 'archive.zip', { type: 'application/zip' }))
              return data
            })
            await field.focus()
            await field.evaluate((element, data) => element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })), transfer)
            await expect(page.locator('[data-attachment="ready"]')).toHaveCount(2)
            await page.screenshot({ path: test.info().outputPath('packaged-attachments.png') })
            await page.getByRole('button', { name: 'Remove Juno.dmg', exact: true }).click()
            await page.getByRole('button', { name: 'Remove archive.zip', exact: true }).click()
            await transfer.dispose()
            await page.getByRole('button', { name: 'Home', exact: true }).click()
          }
        } finally {
          await browser.close()
        }
      } finally {
        if (!exited) child.kill('SIGTERM')
        await closed
      }
    }
    expect(JSON.parse(await readFile(join(userData, 'agent', 'codemode-probe.json'), 'utf8'))).toEqual({ ok: true, value: 12 })
    // koffi's .node is unpacked from the asar and loads in the signed app; SkyLight's name resolves.
    if (!windows) expect(JSON.parse(await readFile(join(userData, 'screen-watch-probe.json'), 'utf8'))).toEqual({ symbol: 'SLSIsScreenWatcherPresent', value: 'boolean' })
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
