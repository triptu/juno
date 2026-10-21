// The gallery's quotes and facts (SPEC 12, "Pictures and the gallery"): the
// Quotes pill lists the quotes by theme, each with who said it, and the Facts
// pill the facts; neither shows a source, and All stays the pictures.
import { expect, syncedTest } from './fixtures'

syncedTest('the gallery lists the quotes with who said them, and the facts apart from them', async ({ juno, win }) => {
  await juno.openSettings('General')
  await juno.settings.root.getByRole('button', { name: 'Open the gallery' }).click()
  const gallery = win.locator('[data-gallery]')
  await expect(gallery.getByRole('heading', { name: 'Gallery' })).toBeVisible()
  const pill = (name: string) => gallery.locator('[data-pill-row]').getByRole('button', { name: new RegExp(`^${name}\\s*\\d+$`) })
  const pictures = gallery.locator('[data-gallery-picture]')
  const quotes = gallery.locator('[data-gallery-quote]')
  const facts = gallery.locator('[data-gallery-fact]')

  // All is the pictures.
  expect(await pictures.count()).toBeGreaterThan(20)
  await expect(quotes).toHaveCount(0)

  // Quotes: in sections by theme, each with who said it; the pill counts them.
  await pill('Quotes').click()
  await expect(pill('Quotes')).toHaveAttribute('aria-pressed', 'true')
  await expect(pictures).toHaveCount(0)
  await expect(facts).toHaveCount(0)
  const quoteCount = Number((await pill('Quotes').textContent())!.replace(/\D/g, ''))
  expect(quoteCount).toBeGreaterThan(50)
  await expect(quotes).toHaveCount(quoteCount)
  // Quotes have no things made or art: they open on wonder and end on focus and craft.
  const themes = gallery.locator('section[data-gallery-words] > h2')
  await expect(themes).toHaveText(['Wonder at the universe', 'Life', 'Thinking deeply', 'Focus and craft'])
  const dillard = quotes.filter({ hasText: 'How we spend our days is, of course, how we spend our lives.' })
  await expect(dillard.locator('blockquote')).toHaveText('How we spend our days is, of course, how we spend our lives.')
  await expect(dillard.locator('p')).toHaveText('Annie Dillard')
  // A source is never shown.
  await expect(gallery).not.toContainText('The Writing Life')

  // Facts: their own list, with no one named under them.
  await pill('Facts').click()
  await expect(pill('Facts')).toHaveAttribute('aria-pressed', 'true')
  await expect(quotes).toHaveCount(0)
  expect(await facts.count()).toBeGreaterThan(50)
  // Things made and art first, then wonder; no fact is about focus and craft.
  await expect(themes).toHaveText(['Things made', 'Art and beauty', 'Wonder at the universe', 'Life', 'Thinking deeply'])
  const git = facts.filter({ hasText: "Linus Torvalds made Git's first commit" })
  await expect(git.locator('p')).toHaveCount(1)
  await expect(gallery).not.toContainText('Empire State Building, \'History\'')

  // Back to the pictures.
  await pill('All').click()
  expect(await pictures.count()).toBeGreaterThan(20)
  await expect(facts).toHaveCount(0)
})
