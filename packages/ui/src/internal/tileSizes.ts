import * as stylex from '@stylexjs/stylex'
import { sizes } from '@juno/tokens/tokens.stylex'

export const tileSizes = stylex.create({
  44: { width: sizes['--tile-44'], height: sizes['--tile-44'], fontSize: sizes['--initials-44'] },
  36: { width: sizes['--tile-36'], height: sizes['--tile-36'], fontSize: sizes['--initials-36'] },
  32: { width: sizes['--avatar-32'], height: sizes['--avatar-32'], fontSize: sizes['--initials-32'] },
  28: { width: sizes['--avatar-28'], height: sizes['--avatar-28'], fontSize: sizes['--initials-28'] },
  24: { width: sizes['--avatar-24'], height: sizes['--avatar-24'], fontSize: sizes['--initials-24'] },
  20: { width: sizes['--avatar-20'], height: sizes['--avatar-20'], fontSize: sizes['--initials-20'] },
  18: { width: sizes['--avatar-18'], height: sizes['--avatar-18'], fontSize: sizes['--initials-18'] },
  16: { width: sizes['--avatar-16'], height: sizes['--avatar-16'], fontSize: sizes['--initials-16'] },
  // Too small for a letter: the photo or the person's colour alone.
  13: { width: sizes['--avatar-13'], height: sizes['--avatar-13'], fontSize: 0 },
  11: { width: sizes['--avatar-11'], height: sizes['--avatar-11'], fontSize: 0 },
})

