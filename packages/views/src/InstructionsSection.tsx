import * as stylex from '@stylexjs/stylex'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { Fragment, useRef, useState, type KeyboardEvent, type Ref } from 'react'
import { accent, colors, radii, sizes, spacing, text } from '@juno/tokens/tokens.stylex'
import { Button, Chip, IconButton, Section, Segmented, Surface, Text, TextField } from '@juno/ui'
import type { FoundRule, Instruction, InstructionDirection } from './notificationRules'

export interface InstructionsSectionProps {
  readonly instructions: ReadonlyArray<Instruction>
  /** Off: one line says DMs and mentions notify. The list stays editable. */
  readonly aiAssist: boolean
  /**
   * The checks after adds, by instruction id, each under its instruction:
   * Checking… while the value is undefined, then the rule it found.
   */
  readonly ruleChecks: ReadonlyMap<string, FoundRule | undefined>
  readonly onAdd: (direction: InstructionDirection, text: string) => void
  readonly onEdit: (id: string, change: { readonly direction?: InstructionDirection; readonly text?: string }) => void
  readonly onRemove: (id: string) => void
  /** Removes the instruction and sets the level. */
  readonly onMakeSetting: (instructionId: string) => void
  readonly onKeepInstruction: (instructionId: string) => void
  /** The add row's direction to start with (fixtures). */
  readonly initialDirection?: InstructionDirection
  /** The heading, for the page to scroll to. */
  readonly headingRef?: Ref<HTMLElement>
}

const directions = [
  { value: 'notify', label: 'Notify me' },
  { value: 'stay', label: "Don't notify" },
] as const

/**
 * Examples of instructions, shown while the list is empty. Each is about a
 * kind of message, never one person or channel, since those are settings.
 */
const examples: Record<InstructionDirection, ReadonlyArray<string>> = {
  notify: ['Production incidents', 'Review requests', 'Launch date changes'],
  stay: ['Lunch and social plans', 'Deploy and CI bot messages', 'FYI updates'],
}

/** The add field's hint: neutral until a direction is chosen, then one example for it. */
const placeholders: Record<InstructionDirection | 'none', string> = {
  none: 'Describe it in your own words',
  notify: 'e.g. someone waiting on my review',
  stay: 'e.g. deploy and CI bot messages',
}

/** What the add row holds before Add. */
interface Draft {
  readonly direction: InstructionDirection | null
  readonly text: string
}

/**
 * Settings › Notifications › Your instructions (SPEC 14, inventory 13): the
 * owner's rules, each with Notify me or Don't notify and its words, edited
 * in place and saved on blur. The add row's field and Add wait for a
 * direction, since there is no default; the field's placeholder then shows
 * an example for that direction. While the list is empty, a few examples
 * per direction sit above the add row; one click fills the row, to edit or
 * add. After an add, a line under the new row offers a rule about one
 * person or channel as a setting.
 */
export function InstructionsSection({ instructions, aiAssist, ruleChecks, onAdd, onEdit, onRemove, onMakeSetting, onKeepInstruction, initialDirection, headingRef }: InstructionsSectionProps) {
  const [draft, setDraft] = useState<Draft>({ direction: initialDirection ?? null, text: '' })
  const field = useRef<HTMLInputElement>(null)
  // The field turns on with the direction, in the next render; focus it then.
  const focusField = () => requestAnimationFrame(() => field.current?.focus())
  const pickExample = (direction: InstructionDirection, text: string) => {
    setDraft({ direction, text })
    focusField()
  }
  const add = () => {
    const text = draft.text.trim()
    if (draft.direction === null || text === '') return
    onAdd(draft.direction, text)
    setDraft({ direction: null, text: '' })
  }
  return (
    <Section
      headingRef={headingRef}
      heading="Your instructions"
      sub="Juno follows these when it reads a message on Auto."
    >
      {aiAssist ? null : (
        <Text variant="ui" tone="muted" as="p">
          AI assist is off. DMs and mentions notify you.
        </Text>
      )}
      <Surface kind="group" aria-label="Your instructions">
        {instructions.length === 0 ? <Examples onPick={pickExample} /> : null}
        {instructions.map((instruction) => (
          <Fragment key={instruction.id}>
            <InstructionRow instruction={instruction} onEdit={onEdit} onRemove={onRemove} divided={!ruleChecks.has(instruction.id)} />
            {ruleChecks.has(instruction.id) ? <RuleLine found={ruleChecks.get(instruction.id)} onMake={() => onMakeSetting(instruction.id)} onKeep={() => onKeepInstruction(instruction.id)} /> : null}
          </Fragment>
        ))}
        <AddRow
          draft={draft}
          fieldRef={field}
          onChoose={(direction) => {
            setDraft({ ...draft, direction })
            focusField()
          }}
          onType={(text) => setDraft({ ...draft, text })}
          onAdd={add}
        />
      </Surface>
    </Section>
  )
}

/** While the list is empty: a lead-in and a few examples per direction. A click fills the add row; it adds nothing by itself. */
function Examples({ onPick }: { readonly onPick: (direction: InstructionDirection, text: string) => void }) {
  return (
    <div data-instruction-examples="" {...stylex.props(styles.examples, styles.divided)}>
      <Text variant="ui" tone="muted" as="p" sx={styles.examplesLead}>
        No instructions yet. Start from an example or write your own.
      </Text>
      {directions.map((direction) => (
        <Fragment key={direction.value}>
          <Text variant="meta" tone="subtle" weight="medium" as="span" sx={styles.examplesLabel}>
            {direction.label}
          </Text>
          <span role="group" aria-label={`${direction.label} examples`} {...stylex.props(styles.examplesChips)}>
            {examples[direction.value].map((example) => (
              <Chip key={example} interactive variant="outline" size={24} onClick={() => onPick(direction.value, example)}>
                {example}
              </Chip>
            ))}
          </span>
        </Fragment>
      ))}
    </div>
  )
}

function InstructionRow({ instruction, onEdit, onRemove, divided }: { readonly instruction: Instruction; readonly onEdit: InstructionsSectionProps['onEdit']; readonly onRemove: (id: string) => void; readonly divided: boolean }) {
  const save = (field: HTMLInputElement) => {
    const typed = field.value.trim()
    // An emptied field goes back to the saved words; Remove is the way to drop one.
    if (typed === '') field.value = instruction.text
    else if (typed !== instruction.text) onEdit(instruction.id, { text: typed })
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur()
    else if (event.key === 'Escape') {
      event.currentTarget.value = instruction.text
      event.currentTarget.blur()
    }
  }
  return (
    <div data-instruction={instruction.id} {...stylex.props(styles.row, divided && styles.divided)}>
      <Segmented options={directions} value={instruction.direction} label="Notify me or Don't notify" onChange={(direction) => direction !== instruction.direction && onEdit(instruction.id, { direction })} />
      <input
        key={instruction.text}
        type="text"
        defaultValue={instruction.text}
        aria-label="Instruction"
        // A long one is cut at the row's end; hover shows it whole.
        title={instruction.text}
        dir="auto"
        autoComplete="off"
        maxLength={MAX_LENGTH}
        onBlur={(event) => save(event.currentTarget)}
        onKeyDown={onKeyDown}
        {...stylex.props(styles.inline)}
      />
      <IconButton icon={X} label="Remove instruction" size={20} iconSize={12} tone="muted" onClick={() => onRemove(instruction.id)} />
    </div>
  )
}

/** Under a new instruction: Checking… while Juno checks it, then the rule it found, with its two answers. */
function RuleLine({ found, onMake, onKeep }: { readonly found: FoundRule | undefined; readonly onMake: () => void; readonly onKeep: () => void }) {
  return (
    <div data-found-rule="" aria-live="polite" {...stylex.props(styles.rule, found !== undefined && styles.ruleFound, styles.divided)}>
      {found === undefined ? (
        <Text variant="meta" tone="muted">
          Checking…
        </Text>
      ) : (
        <>
          <Text variant="ui" tone="subtle" as="p" sx={styles.ruleText}>
            Juno found a rule:{' '}
            <Text variant="ui" tone="default" weight="semibold" as="span">
              {found.name} → {found.level === 'always' ? 'Always' : 'Never'}
            </Text>
            . A setting is exact and shows below.
          </Text>
          <span {...stylex.props(styles.ruleButtons)}>
            <Button variant="secondary" size="sm" onClick={onMake}>
              Make it a setting
            </Button>
            <Button variant="ghost" size="sm" tone="subtle" onClick={onKeep}>
              Keep as instruction
            </Button>
          </span>
        </>
      )}
    </div>
  )
}

function AddRow({ draft, fieldRef, onChoose, onType, onAdd }: { readonly draft: Draft; readonly fieldRef: Ref<HTMLInputElement>; readonly onChoose: (direction: InstructionDirection) => void; readonly onType: (text: string) => void; readonly onAdd: () => void }) {
  const ready = draft.direction !== null && draft.text.trim() !== ''
  return (
    <div data-instruction-add="" {...stylex.props(styles.row)}>
      <Segmented options={directions} value={draft.direction} label="New instruction: Notify me or Don't notify" onChange={onChoose} />
      <span {...stylex.props(styles.addField)}>
        <TextField
          ref={fieldRef}
          size={30}
          label="New instruction"
          placeholder={placeholders[draft.direction ?? 'none']}
          value={draft.text}
          maxLength={MAX_LENGTH}
          disabled={draft.direction === null}
          onChange={(event) => onType(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') onAdd()
          }}
        />
      </span>
      <Button variant="secondary" size="sm" disabled={!ready} onClick={onAdd}>
        Add
      </Button>
    </div>
  )
}

/** An instruction's longest text. */
const MAX_LENGTH = 300

const styles = stylex.create({
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-2-5'],
    minHeight: sizes['--control-44'],
    paddingBlock: spacing['--space-2'],
    paddingInline: spacing['--space-3-5'],
    boxSizing: 'border-box',
    minWidth: 0,
  },
  divided: {
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-subtle'],
  },
  // The lead-in over two rows of direction label and its examples; the labels share one column.
  examples: {
    display: 'grid',
    gridTemplateColumns: 'max-content 1fr',
    alignItems: 'center',
    columnGap: spacing['--space-2-5'],
    rowGap: spacing['--space-1-5'],
    paddingBlock: spacing['--space-2-5'],
    paddingInline: spacing['--space-3-5'],
    boxSizing: 'border-box',
    minWidth: 0,
  },
  examplesLead: {
    gridColumn: '1 / -1',
  },
  examplesLabel: {
    whiteSpace: 'nowrap',
  },
  examplesChips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: spacing['--space-1-5'],
    minWidth: 0,
  },
  // Plain text until hovered or focused, then a field.
  inline: {
    appearance: 'none',
    flexGrow: 1,
    minWidth: 0,
    height: sizes['--control-30'],
    margin: 0,
    paddingBlock: 0,
    paddingInline: spacing['--space-2'],
    borderWidth: '1px',
    borderStyle: 'solid',
    borderColor: {
      default: 'transparent',
      ':hover': { default: null, '@media (hover: hover)': colors['--input-border'] },
      ':focus-visible': colors['--input-border'],
    },
    borderRadius: radii['--radius-md'],
    backgroundColor: { default: 'transparent', ':focus-visible': colors['--surface-default'] },
    color: colors['--foreground-default'],
    fontFamily: text['--text-body-small-family'],
    fontSize: text['--text-body-small-size'],
    textOverflow: 'ellipsis',
    cursor: 'text',
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: `calc(-1 * ${sizes['--focus-ring-width']})`,
    outlineColor: accent['--focus-ring'],
  },
  addField: {
    flexGrow: 1,
    minWidth: 0,
  },
  rule: {
    display: 'flex',
    flexWrap: 'wrap',
    alignItems: 'center',
    columnGap: spacing['--space-3'],
    rowGap: spacing['--space-1-5'],
    minHeight: sizes['--control-44'],
    paddingBlock: spacing['--space-2'],
    paddingInline: spacing['--space-3-5'],
    boxSizing: 'border-box',
  },
  ruleFound: {
    backgroundColor: colors['--surface-hover'],
  },
  ruleText: {
    flexGrow: 1,
    flexBasis: 0,
    minWidth: '50%',
  },
  ruleButtons: {
    display: 'flex',
    gap: spacing['--space-1-5'],
  },
})
