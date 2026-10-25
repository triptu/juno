import { expect, hooks, syncedTest as test } from './fixtures'

// Restart brings the engine back, so the supervisor can give up on it a second time.
test('the app is served from the juno: scheme; when the engine stops for good, the sidebar and About say so, and Restart brings it back', { tag: ['@nightly', '@nightly-crash'] }, async ({ juno, app, win }) => {

  await test.step('is served from the juno: scheme, and nothing outside the renderer folder', async () => {
    expect(await win.evaluate(() => `${location.protocol}//${location.host}${location.pathname}`)).toBe('juno://app/index.html')
    // Nothing outside the renderer folder is served: a traversal attempt ends
    // as a 404 (Chromium normalises the path; main refuses what is left).
    const escaped = await win.evaluate(() =>
      fetch('juno://app/../../package.json').then(
        (r) => r.status,
        () => 'failed',
      ),
    )
    expect(escaped).toBe(404)
  })

  await test.step('says so under the filters when the engine stops for good, and Restart brings it back', async () => {
    const { sidebar } = juno
    await sidebar.expectNoSyncStatus()

    await hooks(app, 'failEngine')

    // The rows stay; the line under the filters says what happened and offers the one action.
    await sidebar.expectSyncStatus('Sync stopped')
    await sidebar.expectRows()
    expect(await hooks(app, 'engineState')).toBe('failed')

    await sidebar.restartButton.click()
    await sidebar.expectNoSyncStatus(30_000)
    await expect.poll(() => hooks(app, 'engineState'), { timeout: 30_000 }).toBe('ready')
    await juno.expectEngineLive()
    await sidebar.expectRows()
  })

  await test.step('says so when the supervisor gives up on the engine', async () => {
    await juno.openSettings('About')
    const line = juno.settings.engineStatus
    await expect(line).toHaveText('Engine live')

    await hooks(app, 'failEngine')

    // The port closes; the renderer asks for a new one and is told there will
    // be none. No restart is attempted.
    await expect(line).toHaveText('Engine failed', { timeout: 15_000 })
    expect(await hooks(app, 'engineState')).toBe('failed')
    expect(await hooks(app, 'enginePid')).toBeUndefined()
  })
})
