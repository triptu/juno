import { createContext, useContext, useLayoutEffect, useRef } from 'react'
import { CodeBlock } from '@juno/ui'

/**
 * Colours code blocks. The app passes one through `CodeHighlighterContext`;
 * without it every block stays plain.
 */
export interface CodeHighlighter {
  /**
   * Colours the code under `element` once it is worked out (at once when
   * it is already known, else when the block comes near the screen), with
   * no change to the element's content. Returns a function that takes the
   * colours off or stops waiting.
   */
  readonly paint: (element: HTMLElement, code: string, language: string | undefined) => () => void
}

export const CodeHighlighterContext = createContext<CodeHighlighter | undefined>(undefined)

export interface HighlightedCodeBlockProps {
  readonly text: string
  /** The code's language, when its source named it; otherwise it is detected or the block stays plain. */
  readonly language?: string | undefined
}

/**
 * A code block with syntax colours. The plain text draws first, and the
 * colours go on in place once they are worked out, so opening a topic never
 * waits for them and the block keeps its size.
 */
export function HighlightedCodeBlock({ text, language }: HighlightedCodeBlockProps) {
  const highlighter = useContext(CodeHighlighterContext)
  const box = useRef<HTMLDivElement>(null)
  // Before paint, so a block whose colours are known never shows plain.
  useLayoutEffect(() => {
    const element = box.current
    if (highlighter === undefined || element === null || language === 'plaintext') return
    return highlighter.paint(element, text, language)
  }, [highlighter, text, language])
  return (
    <div ref={box}>
      <CodeBlock>{text}</CodeBlock>
    </div>
  )
}
