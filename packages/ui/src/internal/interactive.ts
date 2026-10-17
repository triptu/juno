/**
 * Styles every interactive primitive shares: the element reset, the 150ms
 * feedback transition and the press scale (never when disabled). The focus
 * ring is `focusRing` (../focusRing.ts), which views use too. Hover colours
 * live in each primitive and must sit under the `hover` media query from here.
 */
import * as stylex from '@stylexjs/stylex'
import { motion, opacity } from '@juno/tokens/tokens.stylex'

export const interactive = stylex.create({
  reset: {
    appearance: 'none',
    margin: 0,
    padding: 0,
    borderWidth: 0,
    borderStyle: 'solid',
    borderColor: 'transparent',
    backgroundColor: 'transparent',
    color: 'inherit',
    fontFamily: 'inherit',
    fontSize: 'inherit',
    fontWeight: 'inherit',
    lineHeight: 'inherit',
    letterSpacing: 'inherit',
    textAlign: 'start',
    textDecoration: 'none',
    userSelect: 'none',
    // No app region here. In a title bar's drag strip the control's group
    // opts out (no-drag on its container); everywhere else no-drag does
    // nothing but cost: Chromium redraws every region rectangle each frame
    // they move, and on every control of a scrolling list that was 10 to
    // 20 % of the scroll's frame work (performance.md 8.5).
  },
  feedback: {
    transitionProperty: 'scale, background-color, color, border-color, box-shadow, opacity',
    transitionDuration: motion['--duration-fast'],
    transitionTimingFunction: motion['--ease-out'],
  },
  press: {
    scale: {
      default: '1',
      ':active': motion['--press-scale'],
      ':disabled': '1',
    },
    // Disabled controls get no pointer events, so :active can never match
    // and the press scale never applies to them.
    pointerEvents: {
      default: 'auto',
      ':disabled': 'none',
    },
  },
  // The disabled look, also used by `dimmed` controls that look disabled but
  // stay focusable (Send with an empty draft).
  dimmed: {
    opacity: opacity['--opacity-disabled'],
  },
})
