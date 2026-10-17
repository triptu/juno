// ⌘K's pages and Settings sections (spec section 10): ">" lists the pages,
// a page opens from its row, and text that names a whole group, as
// "settings" does, shows every row of it.
import { expect, test } from './fixtures'

test.describe.configure({ timeout: 120_000 })

test('">" lists the pages; "Juno" opens the Juno tab, and then Memory of this chat is one of them', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { palette, tabs } = juno
  const pages = palette.section('Pages')

  await palette.open()
  await palette.type('>')
  for (const name of ['Home', 'All topics', 'Juno', 'Scheduled', 'What Juno remembers', 'Activity', 'Settings']) {
    await expect(pages.getByRole('option', { name: new RegExp(`^${name}`) })).toBeVisible()
  }
  await expect(pages.getByRole('option', { name: /Memory of this chat/ })).toHaveCount(0)
  await palette.clear()
  await palette.type('juno')
  await palette.expectActive(/ Juno$/)
  await palette.press('Enter')
  await palette.expectClosed()
  await tabs.expectActive('Juno')

  await palette.open()
  await palette.type('>')
  await expect(pages.getByRole('option', { name: /Memory of this chat/ })).toBeVisible()
})

test('"settings" lists every Settings section, and Enter on one opens Settings there', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { palette, settings, tabs } = juno

  await palette.open()
  await palette.type('settings')
  const sections = palette.section('Settings')
  await expect(sections.getByRole('option')).toHaveCount(10)
  for (const name of ['General', 'Appearance', 'Notifications', 'Ignored', 'Tidy up', 'Juno', 'AI activity', 'Connections', 'Backup & This Mac', 'About']) {
    await expect(sections.getByRole('option', { name: new RegExp(`Settings: ${name}`) })).toBeVisible()
  }
  await palette.row('Settings: Notifications').hover()
  await palette.expectActive(/Settings: Notifications/)
  await palette.press('Enter')
  await palette.expectClosed()
  await tabs.expectActive('Settings')
  await expect(settings.section('Notifications')).toHaveAttribute('aria-current', 'page')
})

test('"scheduled" then Enter opens the Scheduled page', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  const { palette, tabs } = juno

  await palette.open()
  await palette.type('scheduled')
  await palette.expectActive(/ Scheduled$/)
  await palette.press('Enter')
  await palette.expectClosed()
  await tabs.expectActive('Scheduled')
})
