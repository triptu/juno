/**
 * Other people's presence (SPEC 7, "Presence in a DM"; SPEC 14, "Show who
 * is active in the sidebar"). An open 1:1 DM always shows whether its
 * person is active or away, in the header's context pill: Juno subscribes
 * to the open DMs' partners over the socket with `presence_sub`. The
 * sidebar's dots are off by default; turned on, Juno also subscribes to the
 * recent DMs' partners and a DM row shows the dot on the person's photo
 * while Slack shows them active. The fake says each subscribed person's
 * presence at once and then each change (`slack.as(name).setPresence`).
 */
import { expect, test } from './fixtures'

test('an open DM shows its person active or away, and the sidebar dots follow their own setting, off by default', async ({ juno, slack }) => {
  await juno.signIn()
  await juno.waitForSync()
  const maya = slack.as('Maya')
  const dm = juno.sidebar.row('Maya', { exact: true })

  await test.step('by default the sidebar shows no dot and Juno asks Slack about no one', async () => {
    maya.setPresence('active')
    await dm.expectVisible()
    await expect(dm.presenceDot).toHaveCount(0)
    await slack.expectPresenceSubscribed('Maya', false)
    expect(slack.presenceSubs()).toEqual([])
  })

  await test.step('opening Maya’s DM shows her active in the header, then away', async () => {
    await dm.select()
    await slack.expectPresenceSubscribed('Maya')
    await juno.topic.expectPresence('active')
    maya.setPresence('away')
    await juno.topic.expectPresence('away')
    // The setting is off: still no dot on her row.
    maya.setPresence('active')
    await juno.topic.expectPresence('active')
    await expect(dm.presenceDot).toHaveCount(0)
    // Only the open DM's person is asked about.
    expect(slack.presenceSubs().at(-1)).toEqual([maya.id])
  })

  await test.step('turning on Show who is active in the sidebar shows her dot', async () => {
    await juno.openSettings('Appearance')
    await expect(juno.settings.sidebarPresence).not.toBeChecked()
    await juno.settings.sidebarPresence.click()
    await expect(juno.settings.sidebarPresence).toBeChecked()
    await expect(dm.presenceDot).toBeVisible()
    await expect(dm.root).toHaveAccessibleDescription(/^active\b/)
    maya.setPresence('away')
    await expect(dm.presenceDot).toHaveCount(0)
    await expect(dm.root).not.toHaveAccessibleDescription(/^active\b/)
  })

  await test.step('turned off while her DM is open, the dot goes and the header still follows her', async () => {
    maya.setPresence('active')
    await expect(dm.presenceDot).toBeVisible()
    await juno.settings.sidebarPresence.click()
    await expect(juno.settings.sidebarPresence).not.toBeChecked()
    await expect(dm.presenceDot).toHaveCount(0)
    await dm.select()
    await juno.topic.expectPresence('active')
    await expect.poll(() => slack.presenceSubs().at(-1)).toEqual([maya.id])
    maya.setPresence('away')
    await juno.topic.expectPresence('away')
    await expect(dm.presenceDot).toHaveCount(0)
    await expect(juno.sidebar.accountButton).toHaveAccessibleDescription(/^(Active|Away)/)
  })
})
