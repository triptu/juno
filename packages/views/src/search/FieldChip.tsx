/**
 * A chip in the Search field (SPEC 10a): its mark (a person's photo, a
 * topic's art), the operator in the quiet tone and the value. A button, so
 * a click edits it; Backspace or Delete on it removes it.
 */
import * as stylex from '@stylexjs/stylex'
import { colors, radii, sizes, spacing, text, weights } from '@juno/tokens/tokens.stylex'
import { Avatar, focusRing, TopicArt } from '@juno/ui'
import { hueFor, initials } from '../look'
import { chipOperator, type SearchChipView } from './model'

export function FieldChip({ chip, onEdit, onRemove }: { readonly chip: SearchChipView; readonly onEdit: () => void; readonly onRemove: () => void }) {
  const operator = chipOperator[chip.op]
  const lead = chipLead(chip)
  return (
    <button
      type="button"
      data-search-chip={chip.op}
      aria-label={`${chip.negated === true ? 'not ' : ''}${operator ?? ''} ${chip.label}. Edit, or press Delete to remove.`}
      onClick={onEdit}
      onKeyDown={(event) => {
        if (event.key !== 'Backspace' && event.key !== 'Delete') return
        event.preventDefault()
        onRemove()
      }}
      {...stylex.props(styles.chip, lead !== null && styles.lead, focusRing.outside)}
    >
      {lead}
      {operator === undefined ? null : (
        <span {...stylex.props(styles.operator)}>
          {chip.negated === true ? '-' : ''}
          {operator}
        </span>
      )}
      <span data-sensitive="" {...stylex.props(styles.label)}>
        {chip.label}
      </span>
    </button>
  )
}

function chipLead(chip: SearchChipView) {
  const person = chip.person
  if (person !== undefined) return <Avatar size={16} label={initials(person.name)} hue={hueFor(person.color, person.id)} {...(person.avatarUrl === undefined ? {} : { src: person.avatarSmallUrl || person.avatarUrl })} />
  if (chip.topic !== undefined) return <TopicArt topicId={chip.topic.id} {...(chip.topic.art === undefined ? {} : { recipe: chip.topic.art })} size={16} />
  return null
}

const styles = stylex.create({
  // Whole until it is wider than the field; the field wraps it to a line of its own first.
  chip: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    gap: spacing['--space-1'],
    height: sizes['--control-24'],
    maxWidth: '100%',
    paddingBlock: 0,
    paddingInline: spacing['--space-2'],
    margin: 0,
    borderWidth: 0,
    borderRadius: radii['--radius-md'],
    backgroundColor: {
      default: colors['--secondary-default'],
      ':hover': { default: null, '@media (hover: hover)': colors['--secondary-hover'] },
      ':active': { default: colors['--secondary-active'], '@media (hover: hover)': colors['--secondary-active'] },
    },
    color: colors['--foreground-default'],
    fontFamily: 'inherit',
    fontSize: text['--text-meta-size'],
    fontWeight: weights['--weight-medium'],
    whiteSpace: 'nowrap',
    cursor: 'default',
  },
  // A photo or art at the start: 4px in, as the mark is round.
  lead: {
    paddingInlineStart: spacing['--space-1'],
  },
  operator: {
    color: colors['--foreground-muted-on-fill'],
    fontWeight: weights['--weight-regular'],
  },
  label: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    minWidth: 0,
  },
})
