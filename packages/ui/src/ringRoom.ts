/**
 * Room for focus rings inside a box that clips: a scroller, or a row with
 * paint containment. An outset ring is drawn `--focus-ring-room` past its
 * element, so a control flush with such a box shows its ring cut off. These
 * styles pad the box by that room and take it back with a negative margin of
 * the same size, so nothing in the layout moves; the scroll padding makes a
 * scroll into view stop with the ring in sight. Use them on a box that has no
 * padding of its own on that axis (a fixed height must add the room). Items
 * that fill their scroller edge to edge (tabs, list rows) use the inset ring
 * instead.
 */
import * as stylex from '@stylexjs/stylex'
import { sizes } from '@juno/tokens/tokens.stylex'

const room = sizes['--focus-ring-room']
const back = `calc(-1 * ${sizes['--focus-ring-room']})`

export const ringRoom = stylex.create({
  inline: {
    paddingInline: room,
    marginInline: back,
  },
  block: {
    paddingBlock: room,
    marginBlock: back,
  },
  all: {
    padding: room,
    margin: back,
  },
})
