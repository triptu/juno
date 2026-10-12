/**
 * Styles every interactive primitive shares: the element reset, the 150ms
 * feedback transition, the press scale (never when disabled) and the focus
 * ring (keyboard only). Hover colours live in each primitive and must sit
 * under the `hover` media query from here.
 */
import * as stylex from '@stylexjs/stylex'
import { colors, motion, opacity, sizes } from '@juno/tokens/tokens.stylex'

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
    WebkitAppRegion: 'no-drag',
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
  focusRing: {
    outlineStyle: {
      default: 'none',
      ':focus-visible': 'solid',
    },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-offset'],
    outlineColor: colors['--focus-ring'],
  },
  // A tighter ring for controls that sit flush against others (tabs,
  // segments) where a 2px offset would clip.
  focusRingInset: {
    outlineStyle: {
      default: 'none',
      ':focus-visible': 'solid',
    },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: `calc(-1 * ${sizes['--focus-ring-width']})`,
    outlineColor: colors['--focus-ring'],
  },
  disabled: {
    opacity: opacity['--opacity-disabled'],
  },
  // Looks disabled but stays focusable (Send with an empty draft).
  dimmed: {
    opacity: opacity['--opacity-disabled'],
  },
})
