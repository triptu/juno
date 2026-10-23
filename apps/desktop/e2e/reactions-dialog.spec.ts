/**
 * Who reacted (SPEC 7, "Reactions" and "Reactions dialog"): the card on a
 * chip names people in one sentence and, when it cannot name everyone,
 * See all opens the reactions dialog on that emoji. The dialog lists
 * everyone, also the people Slack's page left out (the fake lists 25 per
 * emoji, as `reactions.get` without `full`), and another emoji in its strip
 * changes the list. Esc closes it.
 */
import { expect, test } from './fixtures'

// Starts signed in and synced (README, "Synced start").
test.use({ synced: true })

test.describe.configure({ timeout: 120_000 })

const TEXT = 'Launch day: the new onboarding is live for everyone.'

test('See all on the card opens every reaction, and the strip changes the list', async ({ juno, fake }) => {
  const seed = fake.seedManyReactions({ channel: 'C0ENG' })
  const thumbs = seed.reactions.find((reaction) => reaction.name === '+1')!
  const tada = seed.reactions.find((reaction) => reaction.name === 'tada')!
  expect(thumbs.users).toHaveLength(40)

  await juno.sidebar.row('#eng').open()
  await juno.topic.expectTitle('Main')
  const row = juno.topic.message(TEXT)
  const chip = row.getByRole('button', { name: '40 👍, including you' })
  await expect(chip).toBeVisible()

  // The card: a sentence, you first, cut short, then See all.
  await chip.scrollIntoViewIfNeeded()
  await chip.hover()
  const card = juno.win.getByRole('tooltip').filter({ hasText: 'reacted with :+1:' })
  await expect(card).toBeVisible()
  await expect(card.locator('[data-reactors-names]')).toHaveText(/^You, .+ and \d+ others$/)
  await expect(card.getByRole('listitem')).toHaveCount(0)
  // The sentence wraps between people, never between the words of one name.
  expect(await card.locator('[data-reactors-names] bdi').evaluateAll((names) => names.every((name) => {
    const range = document.createRange()
    range.selectNodeContents(name)
    return new Set([...range.getClientRects()].map((box) => box.top)).size === 1
  }))).toBe(true)
  const seeAll = card.locator('[data-see-all]')
  await expect(seeAll).toHaveText('See all')

  // See all opens the dialog on 👍, listing all forty, you first.
  fake.holdNext({ method: 'edge:users/info' })
  await seeAll.click()
  const dialog = juno.win.getByRole('dialog', { name: 'Reactions' })
  await expect(dialog).toBeVisible()
  await expect(card).toHaveCount(0)
  const strip = dialog.getByRole('tablist', { name: 'Emoji' })
  await expect(strip.getByRole('tab')).toHaveCount(seed.reactions.length)
  await expect(strip.getByRole('tab', { selected: true })).toHaveAccessibleName('40 👍, including you')
  await expect(strip.getByRole('tab', { selected: true })).toBeFocused()
  const people = dialog.getByRole('tabpanel').getByRole('listitem')
  // Keep the final row geometry while known reactor IDs still await their names.
  await expect.poll(() => fake.heldCount()).toBe(1)
  await expect(dialog.locator('[aria-busy]')).toHaveAttribute('aria-busy', 'true')
  await expect(dialog.getByRole('tabpanel').getByRole('listitem', { includeHidden: true })).toHaveCount(40)
  expect(await people.filter({ hasText: /\S/ }).count()).toBeLessThan(40)
  fake.release()
  // Slack's page named 25; the dialog asks for the rest, and every name arrives.
  await expect(people.filter({ hasText: /\S/ })).toHaveCount(40)
  await expect(people.first()).toHaveText(/You$/)
  const last = seed.names[thumbs.users.at(-1)!]!
  await expect(people.filter({ hasText: last }).first()).toBeAttached()

  // Another emoji in the strip: the list changes to its people.
  await strip.getByRole('tab', { name: '28 🎉' }).click()
  await expect(strip.getByRole('tab', { selected: true })).toHaveAccessibleName('28 🎉')
  await expect(dialog.getByText(':tada:', { exact: true })).toBeVisible()
  await expect(people.filter({ hasText: /\S/ })).toHaveCount(28)
  await expect(people.first()).toHaveText(new RegExp(`${seed.names[tada.users[0]!]!}$`))

  // → moves along the strip and chooses.
  await juno.win.keyboard.press('ArrowRight')
  await expect(strip.getByRole('tab', { selected: true })).toHaveAccessibleName('12 :juno_party:')
  await expect(people.filter({ hasText: /\S/ })).toHaveCount(12)

  // Esc closes it; focus goes back to the chip it opened from.
  await juno.win.keyboard.press('Escape')
  await expect(dialog).toHaveCount(0)
  await expect(chip).toBeFocused()

  const { labels } = await juno.topic.chooseInMessageMenu(TEXT, null)
  expect(labels).not.toContain('View reactions')
})
