import { createElement, forwardRef } from 'react'
import type { IconProps } from '@phosphor-icons/react'
import { Bell } from '@phosphor-icons/react/dist/icons/Bell'
import { CalendarCheck } from '@phosphor-icons/react/dist/icons/CalendarCheck'
import { ChatCircleDots } from '@phosphor-icons/react/dist/icons/ChatCircleDots'
import { Sparkle } from '@phosphor-icons/react/dist/icons/Sparkle'
import { Terminal } from '@phosphor-icons/react/dist/icons/Terminal'
import type { PhosphorIcon } from './Icon'

/**
 * The icons drawn in their duotone weight, and the only way to draw one.
 *
 * Each Phosphor icon ships every weight in one module. The desktop build
 * (`phosphorWeights` in `apps/desktop/renderer.vite.ts`) keeps the
 * duotone weight only for the icons imported here, about 40 KB of the start
 * bundle. `IconWeight` has no duotone, so a duotone icon must come from
 * this file, and `scripts/check-duotone.mjs` fails on the weight's name
 * anywhere else. An icon missing here therefore cannot draw blank.
 */
declare const duotoneBrand: unique symbol

/** A Phosphor icon that always draws its duotone weight. */
export type DuotoneIcon = PhosphorIcon & { readonly [duotoneBrand]: true }

function duotone(Glyph: PhosphorIcon): DuotoneIcon {
  const Duotone = forwardRef<SVGSVGElement, IconProps>((props, ref) => createElement(Glyph, { ...props, ref, weight: 'duotone' }))
  Duotone.displayName = `${Glyph.displayName ?? 'Icon'}Duotone`
  return Duotone as DuotoneIcon
}

/** The Juno sparkle: the one AI surface. */
export const SparkleDuotone = /* @__PURE__ */ duotone(Sparkle)
/** Gallery only: the weights scene. */
export const BellDuotone = /* @__PURE__ */ duotone(Bell)
/** Card kind icons (`Card`), gallery only so far. */
export const TerminalDuotone = /* @__PURE__ */ duotone(Terminal)
export const ChatCircleDotsDuotone = /* @__PURE__ */ duotone(ChatCircleDots)
export const CalendarCheckDuotone = /* @__PURE__ */ duotone(CalendarCheck)
