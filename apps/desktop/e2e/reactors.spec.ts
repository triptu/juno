/**
 * Who reacted (SPEC 7): hovering a reaction chip shows a card with the
 * emoji, its name and the people who reacted, you first. The pointer can
 * move into the card, and a click on the chip still toggles your reaction.
 */
import { expect, test } from './fixtures'

test.describe.configure({ timeout: 120_000 })

const WAL = 'We keep the old primary warm for 48h'

test('hovering a reaction chip shows who reacted, and a click still toggles it', async ({ juno }) => {
  await juno.signIn()
  await juno.waitForSync()
  await juno.sidebar.row('#eng').open()
  const { topic } = juno
  const root = topic.message('Draft plan is in the doc')
  await root.hover()
  await root.getByRole('button', { name: 'Open thread' }).click()
  await topic.expectTitle(/Postgres|Draft plan/)

  // The fake lists two people on 👍: you and Dev.
  const row = topic.message(WAL)
  const chip = row.getByRole('button', { name: '2 👍, including you' })
  await chip.scrollIntoViewIfNeeded()
  await chip.hover()
  const card = juno.win.getByRole('tooltip').filter({ hasText: ':+1:' })
  await expect(card).toBeVisible()
  await expect(card.getByRole('listitem')).toHaveText(['You', /Dev/])
  await expect(chip).toHaveAttribute('aria-describedby', (await card.getAttribute('id'))!)

  // Into the card: it stays.
  await card.hover()
  await juno.win.waitForTimeout(400)
  await expect(card).toBeVisible()

  // Back on the chip, a click toggles your reaction off and hides the card.
  await chip.click()
  await expect(card).toHaveCount(0)
  await expect(row.getByRole('button', { name: '1 👍' })).toBeVisible()
})
