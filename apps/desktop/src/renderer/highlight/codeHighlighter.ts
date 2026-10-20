import type { CodeHighlighter } from '@juno/views'

/**
 * The app's code highlighter. This module is in the start bundle and stays
 * small: a block that mounts loads the painter chunk (`painter.ts`), which
 * waits for the block to come near the screen and only then starts the
 * highlight worker with the grammars.
 */
export const codeHighlighter: CodeHighlighter = {
  paint(element, code, language) {
    let live = true
    let stop: (() => void) | undefined
    void import('./painter').then((painter) => {
      if (live) stop = painter.paint(element, code, language)
    })
    return () => {
      live = false
      stop?.()
    }
  },
}
