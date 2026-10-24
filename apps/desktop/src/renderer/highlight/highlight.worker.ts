/**
 * The code highlighter's thread. highlight.js and its grammars load here,
 * on the first code block near the screen, so neither their parse nor any
 * block's colouring runs on the page's thread.
 */
import { highlightCode } from '@juno/highlight/highlight'
import type { HighlightReply, HighlightRequest } from './painter'

const scope = self as unknown as {
  addEventListener: (type: 'message', listener: (event: MessageEvent<HighlightRequest>) => void) => void
  postMessage: (reply: HighlightReply) => void
}

scope.addEventListener('message', ({ data }) => {
  let result
  try {
    result = highlightCode(data.code, data.language)
  } catch {
    result = undefined
  }
  // oxlint-disable-next-line unicorn/require-post-message-target-origin -- Worker messages have no target origin.
  scope.postMessage({ id: data.id, result })
})
