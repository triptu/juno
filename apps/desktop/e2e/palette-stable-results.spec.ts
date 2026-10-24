import { expect, test } from './fixtures'

test.use({ synced: true })

test('keeps the rendered results body on every frame while typing unmatched queries in each search tab', async ({ juno }) => {
  const { palette, win } = juno
  await palette.open()

  for (const tab of ['All', 'Conversations', 'Messages'] as const) {
    await test.step(tab, async () => {
      await palette.tab(tab).click()
      await palette.expectResults()
      await expect(palette.rows().first()).toBeVisible()

      const recording = await win.evaluateHandle(() => {
        const samples: Array<{ query: string; body: boolean; busy: boolean }> = []
        let frame = 0
        const sample = () => {
          const input = document.querySelector<HTMLInputElement>('[role="dialog"] [role="combobox"]')
          const list = document.getElementById('palette-results')
          samples.push({
            query: input?.value ?? '',
            body: list !== null && (list.querySelector('[role="option"]') !== null || list.textContent?.includes('No matches.') === true),
            busy: list?.getAttribute('aria-busy') === 'true',
          })
          frame = requestAnimationFrame(sample)
        }
        frame = requestAnimationFrame(sample)
        return { samples, stop: () => cancelAnimationFrame(frame) }
      })

      try {
        for (const character of 'zzunmatched 122') {
          await palette.type(character)
          await palette.expectResults()
          await win.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
        }
        await expect(palette.root.getByText('No matches.', { exact: true })).toBeVisible()
        const samples = await recording.evaluate((record) => record.samples)
        expect(samples.filter((sample) => sample.query !== '').length).toBeGreaterThan(0)
        expect(samples.filter((sample) => sample.query !== '' && !sample.body), `${tab}: collapsed frames`).toEqual([])

        await palette.clear()
        const cleared = await win.evaluate(() => new Promise<string | null>((resolve) => requestAnimationFrame(() => resolve(document.getElementById('palette-results')?.textContent ?? null))))
        expect(cleared).toContain(tab === 'Messages' ? 'Recent' : 'Frequent')
        expect(cleared).not.toContain('No matches.')
        await palette.expectResults()
      } finally {
        await recording.evaluate((record) => record.stop())
        await recording.dispose()
      }
    })
  }
})
