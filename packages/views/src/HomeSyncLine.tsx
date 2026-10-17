import * as stylex from '@stylexjs/stylex'

export interface HomeSyncLineProps {
  /** Before the conversations are listed: "Syncing with Slack." */
  readonly line: string
  /** Conversations read so far, as the sidebar's card counts them. */
  readonly progress?: { readonly done?: number; readonly total?: number } | undefined
}

/**
 * Home's syncing line: `line` until the count is known, then "Syncing 30 of
 * 143 conversations.", with room for as many digits as the total has, so
 * the line keeps its width as the count goes up.
 */
export function HomeSyncLine({ line, progress }: HomeSyncLineProps) {
  const done = progress?.done
  const total = progress?.total
  if (done === undefined || total === undefined || total <= 0) return line
  return (
    <>
      Syncing <span {...stylex.props(styles.count(String(total).length))}>{done}</span> of {total} conversations.
    </>
  )
}

const styles = stylex.create({
  // Home's line has tabular figures, each one `ch` wide. A fixed width, not a minimum: the count never has more digits
  // than the total, and a box that cannot grow keeps the words after it still even by a fraction of a pixel.
  count: (digits: number) => ({ display: 'inline-block', width: `${digits}ch`, textAlign: 'end' }),
})
