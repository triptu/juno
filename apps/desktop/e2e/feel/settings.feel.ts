// The avatar menu's hover and Settings' sections, on the default seed.
import { expect } from '@playwright/test'
import { feedbackInOneFrame, landsAndStays, noFlicker, noLayoutShift, switchesOnce } from './checks'
import { test } from './feel'
import { tag } from './pane'
import type { ProbeFrame } from './recorder'

const title = (values: ProbeFrame['values']): string => (typeof values['title'] === 'string' ? values['title'] : 'no title')

test('menu hover: the avatar menu highlights the item under the pointer in the next frame', async ({ juno, win, feel }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.accountMenu.open()
  const item = await tag(juno.accountMenu.item(/^Notifications/), 'menu-item')
  await juno.accountMenu.item(/^Set yourself/).hover()
  await win.waitForTimeout(300)
  await feel.run(
    {
      name: 'menu-hover',
      title: 'Point at Notifications in the avatar menu: it is highlighted in the next frame',
      probes: [{ kind: 'look', name: 'look', selector: item }],
      checks: [feedbackInOneFrame('look', 'pointerover', 'menu item hover', { from: 'go' }), noLayoutShift({ includeInput: true }), noFlicker('window', 'the window')],
    },
    async (rec) => {
      await rec.mark('go')
      await juno.accountMenu.item(/^Notifications/).hover()
    },
  )
  await juno.accountMenu.close()
})

test('settings sections switch in place: the list holds still and the page changes once', async ({ juno, feel }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.openSettings()
  const nav = '[data-settings-nav]'
  await feel.run(
    {
      name: 'settings-section',
      title: 'In Settings, pick Appearance: the section list holds still and the page switches once',
      probes: [
        { kind: 'rect', name: 'nav', selector: nav },
        { kind: 'text', name: 'title', selector: 'main [data-settings-section] h1' },
      ],
      regions: { nav },
      checks: [switchesOnce('the section title', title, { from: 'go' }), landsAndStays('nav', 'the section list'), noFlicker('window', 'the window'), noFlicker('nav', 'the section list')],
    },
    async (rec) => {
      await rec.mark('go')
      await juno.settings.section('Appearance').click()
      await expect(juno.settings.section('Appearance')).toHaveAttribute('aria-current', 'page')
    },
  )
})
