/**
 * Who reacted (SPEC 7): hovering a reaction chip shows a card with the
 * emoji, its name and the people who reacted, you first. The pointer can
 * move into the card, and a click on the chip still toggles your reaction.
 */
import { expect, test } from './fixtures'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

const CONFIRMED = 'Confirmed, p95 back to 210ms.'

test('hovering a reaction chip shows who reacted, and a click still toggles it', async ({ juno }) => {
  await juno.sidebar.row('#incidents').open()
  const { topic } = juno
  const root = topic.message('p95 on /v2/search jumped')
  await root.hover()
  await root.getByRole('button', { name: 'Open thread' }).click()
  await expect(topic.message(CONFIRMED)).toBeVisible()

  // The fake lists two people on 🎉: Jonas and you.
  const row = topic.message(CONFIRMED)
  const chip = row.getByRole('button', { name: '2 🎉, including you' })
  await chip.scrollIntoViewIfNeeded()
  await chip.hover()
  const card = juno.win.getByRole('tooltip').filter({ hasText: ':tada:' })
  await expect(card).toBeVisible()
  await expect(card.getByRole('listitem')).toHaveText([/You$/, /Jonas$/])
  await expect(chip).toHaveAttribute('aria-describedby', (await card.getAttribute('id'))!)

  // Into the card: it stays.
  await card.hover()
  await juno.win.waitForTimeout(400)
  await expect(card).toBeVisible()

  // Back on the chip, a click toggles your reaction off and hides the card.
  await chip.click()
  await expect(card).toHaveCount(0)
  await expect(row.getByRole('button', { name: '1 🎉' })).toBeVisible()
})
