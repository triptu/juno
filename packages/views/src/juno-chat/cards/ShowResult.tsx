import * as stylex from '@stylexjs/stylex'
import { chatCopy } from '@juno/agent-contract'
import { TextButton } from '../TextButton'

export interface ResultToggle {
  readonly shown: boolean
  readonly toggle: () => void
}

/**
 * "Show result" after the line, a quiet disclosure for everything a connection call gave back.
 * The other label holds its room, so the line keeps its width when it toggles; only the result
 * below grows, which the person asked for (`data-expands-in-place`).
 */
export function ShowResult({ toggle }: { readonly toggle: ResultToggle | undefined }) {
  if (toggle === undefined) return null
  const copy = chatCopy.card.change.result
  return (
    <>
      {' · '}
      <span data-expands-in-place="" {...stylex.props(styles.toggle)}>
        <span {...stylex.props(styles.toggleLabel)}>
          <TextButton aria-expanded={toggle.shown} onClick={toggle.toggle}>
            {toggle.shown ? copy.hide : copy.show}
          </TextButton>
        </span>
        <span aria-hidden {...stylex.props(styles.toggleLabel, styles.toggleReserve)}>
          {toggle.shown ? copy.show : copy.hide}
        </span>
      </span>
    </>
  )
}

const styles = stylex.create({
  // Both labels in one cell: the wider sets the width.
  toggle: {
    display: 'inline-grid',
  },
  toggleLabel: {
    gridArea: '1 / 1',
  },
  toggleReserve: {
    visibility: 'hidden',
  },
})
