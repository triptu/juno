// The sign-in page: changing the accent and the theme recolours the page and its art without moving anything.
import { expect } from '@playwright/test'
import { landsAndStays, noFlicker, noLayoutShift } from './checks'
import { test } from './feel'

test('sign-in: a new accent and the dark theme recolour the page in place', async ({ juno, win, feel }) => {
  await juno.expectSignedOut()
  // The entrance plays once on mount; let it finish so only the change is recorded.
  await win.waitForTimeout(1200)
  await feel.run(
    {
      name: 'sign-in-appearance',
      title: 'On the sign-in page, pick Teal, then Dark: the title and the button hold still and nothing flickers',
      probes: [
        { kind: 'box', name: 'title', selector: '#sign-in-title' },
        { kind: 'box', name: 'button', selector: 'section[aria-labelledby="sign-in-title"] button' },
      ],
      regions: { column: 'section[aria-labelledby="sign-in-title"]' },
      checks: [
        landsAndStays('title', 'the title', { tolerance: 0 }),
        landsAndStays('button', 'the button', { tolerance: 0 }),
        noLayoutShift({ includeInput: true }),
        noFlicker('column', 'the column'),
      ],
    },
    async (rec) => {
      await rec.mark('go')
      await win.getByRole('button', { name: 'Teal' }).click()
      await expect(win.getByRole('button', { name: 'Teal' })).toHaveAttribute('aria-pressed', 'true')
      await win.getByRole('radio', { name: 'Dark' }).click()
      await expect(win.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true')
      await win.waitForTimeout(300)
    },
  )
})
