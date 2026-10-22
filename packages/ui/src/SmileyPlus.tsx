import { createElement, forwardRef, Fragment, type ReactElement } from 'react'
import type { IconProps, IconWeight } from '@phosphor-icons/react'
import IconBase from '@phosphor-icons/react/dist/lib/IconBase'
import type { PhosphorIcon } from './Icon'

/**
 * More reactions: a smiley with a plus at its top right, where its outline
 * opens. Phosphor has no such glyph, so this one is drawn on Phosphor's
 * 256 grid with its strokes (16 regular, 24 bold) and takes the same props,
 * so `Icon` draws it like any other. Fill draws as bold.
 */
function face(width: number): ReactElement {
  const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: width, strokeLinecap: 'round', strokeLinejoin: 'round' } as const
  const eye = width / 2 + 4
  return createElement(
    Fragment,
    null,
    createElement('path', { d: 'M198.2,122.5A84,84,0,1,1,133.5,57.8', ...stroke }),
    createElement('path', { d: 'M76,161Q116,201,156,161', ...stroke }),
    createElement('path', { d: 'M200,24V88M168,56H232', ...stroke }),
    createElement('circle', { cx: 84.5, cy: 122.5, r: eye, fill: 'currentColor' }),
    createElement('circle', { cx: 147.5, cy: 122.5, r: eye, fill: 'currentColor' }),
  )
}

const regular = face(16)
const bold = face(24)
const weights = new Map<IconWeight, ReactElement>([
  ['regular', regular],
  ['bold', bold],
  ['fill', bold],
])

const Glyph = forwardRef<SVGSVGElement, IconProps>((props, ref) => createElement(IconBase, { ref, ...props, weights }))
Glyph.displayName = 'SmileyPlusIcon'

export const SmileyPlus: PhosphorIcon = Glyph
