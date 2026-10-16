import * as stylex from '@stylexjs/stylex'
import { Button, ListRow, Section, Surface, Text, TextField } from '@juno/ui'
import { cell } from './cell'

export interface RulesSectionProps {
  /** The owner's rules, one line each. */
  readonly rules: ReadonlyArray<{ readonly id: string; readonly text: string }>
  readonly onRuleChange: (id: string, text: string) => void
  readonly onRuleRemove: (id: string) => void
  readonly onRuleAdd: () => void
  /** A rule field lost focus or took Enter: the edited list is saved as a whole. */
  readonly onRulesCommit?: () => void
  /** Why the agent refused the list: "Each rule is one line, a sentence or two, and there are at most 20." */
  readonly rulesError?: string
}

/**
 * When Juno asks first (SPEC 13.10), at the top of Connections: how each
 * tool's rule and the owner's own rules decide when Juno checks first.
 */
export function RulesSection({ rules, onRuleChange, onRuleRemove, onRuleAdd, onRulesCommit, rulesError }: RulesSectionProps) {
  return (
    <Section heading="When Juno asks first" sub="Set each tool to Auto, Always ask or Never ask with Configure. Your own rules can add checks but never remove one. Deletes always ask.">
      <Surface kind="group" data-rules="">
        {rules.map((rule) => (
          <ListRow
            key={rule.id}
            trailing={
              <Button variant="ghost" size="xs" tone="subtle" aria-label="Remove rule" onClick={() => onRuleRemove(rule.id)}>
                Remove
              </Button>
            }
          >
            <TextField
              size={30}
              label="Rule"
              placeholder="Always ask before messaging my manager"
              value={rule.text}
              onChange={(event) => onRuleChange(rule.id, event.currentTarget.value)}
              onBlur={() => onRulesCommit?.()}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onRulesCommit?.()
              }}
              autoFocus={rule.text === ''}
              dir="auto"
            />
          </ListRow>
        ))}
        <ListRow divider={false} minHeight={44}>
          <span {...stylex.props(cell.lines)}>
            <Button variant="ghost" size="sm" tone="subtle" onClick={onRuleAdd}>
              Add a rule
            </Button>
            {rulesError === undefined ? null : (
              <Text variant="meta" tone="danger" data-rules-error="">
                {rulesError}
              </Text>
            )}
          </span>
        </ListRow>
      </Surface>
    </Section>
  )
}
