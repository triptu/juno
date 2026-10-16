import * as stylex from '@stylexjs/stylex'
import { chatCopy } from '@juno/agent-contract'
import type { ProviderKind, ProviderState } from '@juno/contract'
import { useEffect, useRef } from 'react'
import { Button, Chip, ListRow, Section, Segmented, Surface, Text, TextField } from '@juno/ui'
import { cell } from './cell'

/** What the owner is typing. The drafts are the renderer's; keys go to main, never to a page. */
export interface ProviderDrafts {
  readonly openRouterKey: string
  readonly baseUrl: string
  readonly customKey: string
}

export interface ProviderSectionProps {
  /** Main's provider state: which is active, and what is set up. */
  readonly state: ProviderState
  readonly engineKeyMissing?: boolean
  /** Whose fields show: the active provider, or the one the owner picked to set up. */
  readonly shown: ProviderKind
  readonly drafts: ProviderDrafts
  /** Under the fields: main refused the change (`invalidKey`, `invalidUrl`, `failed`). */
  readonly error?: string
  /** The active provider refused its key on the last call. */
  readonly rejected?: boolean
  /**
   * Put focus in the first field, the key or an endpoint's base URL, each
   * time the section is shown. For "Add a provider".
   */
  readonly focusFirst?: boolean
  /** A segment was picked: the container switches to it if it is set up, else shows its fields. */
  readonly onShow: (kind: ProviderKind) => void
  readonly onDraft: (drafts: ProviderDrafts) => void
  readonly onSave: () => void
  readonly onRemove: () => void
}

/**
 * The provider section of Settings › Juno (SPEC 13.10): OpenRouter with its
 * key, or one OpenAI-compatible endpoint with a base URL and an optional
 * key. One is active at a time; saving one makes it active.
 */
export function ProviderSection({ state, shown, drafts, error, engineKeyMissing = false, rejected = false, focusFirst = false, onShow, onDraft, onSave, onRemove }: ProviderSectionProps) {
  const copy = chatCopy.providers
  const openRouter = shown === 'openRouter'
  const first = useRef<HTMLInputElement>(null)
  // An effect, not autoFocus: a tab that is shown again runs its effects again, so the field takes focus then too.
  useEffect(() => {
    if (focusFirst) first.current?.focus()
  }, [focusFirst])
  const setUp = openRouter ? state.openRouter.key === 'set' : state.custom.baseUrl !== ''
  const canSave = openRouter ? drafts.openRouterKey.trim() !== '' : drafts.baseUrl.trim() !== ''
  const keyDown = (event: { readonly key: string }) => {
    if (event.key === 'Enter' && canSave) onSave()
  }
  const problem = error ?? (rejected && state.active === shown ? (openRouter ? chatCopy.pages.settings.keyRejected : copy.customRejected) : undefined)
  return (
    <Section heading={copy.heading} sub={copy.sub}>
      <span data-provider-shown={shown} {...stylex.props(styles.choice)}>
        <Segmented
          label={copy.heading}
          options={[
            { value: 'openRouter', label: copy.openRouter },
            { value: 'custom', label: copy.custom },
          ]}
          value={shown}
          onChange={onShow}
        />
      </span>
      <Surface kind="group">
        {openRouter ? null : (
          <ListRow
            trailing={
              <TextField
                size={30}
                label={copy.baseUrl}
                type="url"
                placeholder="http://localhost:11434/v1"
                ref={first}
                value={drafts.baseUrl}
                onChange={(event) => onDraft({ ...drafts, baseUrl: event.currentTarget.value })}
                onKeyDown={keyDown}
                width="keyword"
              />
            }
          >
            <span {...stylex.props(cell.lines)}>
              <Text variant="body">{copy.baseUrl}</Text>
              <Text variant="meta" tone="muted">
                {copy.customNote}
              </Text>
            </span>
          </ListRow>
        )}
        <ListRow
          data-provider-key={openRouter ? state.openRouter.key : state.custom.key}
          trailing={
            <span {...stylex.props(cell.controls)}>
              {(openRouter ? state.openRouter.key : state.custom.key) === 'set' ? (
                <Chip variant="filled" size={20}>
                  {copy.keySet}
                </Chip>
              ) : null}
              <TextField
                size={30}
                label={openRouter ? copy.key : copy.keyOptional}
                type="password"
                placeholder={openRouter ? 'sk-or-…' : ''}
                {...(openRouter ? { ref: first } : {})}
                value={openRouter ? drafts.openRouterKey : drafts.customKey}
                invalid={problem !== undefined}
                onChange={(event) => onDraft(openRouter ? { ...drafts, openRouterKey: event.currentTarget.value } : { ...drafts, customKey: event.currentTarget.value })}
                onKeyDown={keyDown}
                width="keyword"
              />
            </span>
          }
        >
          <span {...stylex.props(cell.lines)}>
            <Text variant="body">{openRouter ? copy.key : copy.keyOptional}</Text>
            {problem === undefined ? null : (
              <Text variant="meta" tone="danger" data-provider-error="">
                {problem}
              </Text>
            )}
          </span>
        </ListRow>
        <ListRow
          divider={false}
          trailing={
            <span {...stylex.props(cell.controls)}>
              {setUp ? (
                <Button variant="ghost" size="xs" tone="subtle" onClick={onRemove}>
                  {copy.remove}
                </Button>
              ) : null}
              <Button variant="secondary" size="xs" onClick={onSave} disabled={!canSave}>
                {copy.save}
              </Button>
            </span>
          }
        >
          <Text variant="meta" tone="muted">
            {state.active === shown ? copy.inUse(openRouter ? copy.openRouter : copy.custom) : ''}
          </Text>
        </ListRow>
      </Surface>
      {engineKeyMissing ? <Text variant="meta" tone="muted">Topic art and AI titles need an OpenRouter key.</Text> : null}
    </Section>
  )
}

const styles = stylex.create({
  choice: {
    display: 'flex',
  },
})
