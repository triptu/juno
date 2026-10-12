import type * as stylex from '@stylexjs/stylex'

/**
 * The style slot a few layout containers (`Text`, `Surface`) expose to their
 * owner. Layout only: colours and type are the primitive's business, and the
 * type rejects them so a view cannot drift off the design.
 */
export type LayoutStyles = stylex.StyleXStylesWithout<{
  color: string
  backgroundColor: string
  font: string
  fontFamily: string
  fontSize: string
  fontWeight: string
}>
