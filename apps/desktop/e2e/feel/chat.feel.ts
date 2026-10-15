// Opening Juno chat. There is no chat surface in the renderer yet; this
// scenario holds its place in the contact sheet until there is one.
import { recordSkipped, test } from './feel'

const REASON = 'No Juno chat surface in the renderer yet. Record opening it, the first answer streaming in, and the composer, once it exists.'

// oxlint-disable-next-line no-empty-pattern
test('open Juno chat', async ({}, info) => {
  info.annotations.push({ type: 'placeholder' })
  await recordSkipped('juno-chat', 'Open Juno chat', info.title, REASON)
  test.skip(true, REASON)
})
