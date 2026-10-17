import * as stylex from '@stylexjs/stylex'
import { chatCopy, modelChoiceKey, NO_LIMIT_USD, type JunoSettingsPage as JunoSettingsPageModel, type ModelChoice } from '@juno/agent-contract'
import { Button, Checkbox, Chip, ListRow, Page, PageHeader, Section, Select, Surface, Text, TextField } from '@juno/ui'
import type { ReactNode } from 'react'
import { BackupSection, ThisMacSection, type BackupSectionProps, type ThisMacSectionProps } from './BackupSections'
import { cell } from './cell'

export interface JunoSettingsPageProps {
  /** The agent's page. Absent while no provider is set up, as no agent runs: the page shows the provider alone. */
  readonly page?: JunoSettingsPageModel
  /** The provider section (`ProviderSection`), from main's state rather than the agent's page. */
  readonly providers: ReactNode
  /** A listed modelChoiceKey, or a typed custom model id. */
  readonly onChatModel: (family: string) => void
  readonly onCompactionModel: (family: string) => void
  /** A fallback family, or '' for none. Absent where the page has no fallback (Set up Juno). */
  readonly onFallbackModel?: (family: string) => void
  /** "Change limit": opens Settings › AI activity, where the daily limit is set. */
  readonly onOpenLimit: () => void
  readonly onPaused: (paused: boolean) => void
  readonly onSignInCodex?: () => void
}

function commitModel(text: string, current: string, onChatModel: (id: string) => void): void {
  const id = text.trim()
  if (id !== '' && id !== current) onChatModel(id)
}

const usd = (amount: number): string => `$${amount.toFixed(2)}`
export const CODEX_ENABLED = false

/** The model select's rows: the resolved name, Codex, and the price, as Settings › Juno and Set up Juno show them. */
export function modelOptions(models: ReadonlyArray<ModelChoice>) {
  return models.filter(model => CODEX_ENABLED || model.provider !== 'codex').map((model) => ({
    value: modelChoiceKey(model),
    // A custom endpoint's row is a model id, its own name.
    label:
      model.resolved === undefined
        ? `${model.family} (not available)`
        : // The resolved name already names its family: "Claude Sonnet 5.5", not "Claude Sonnet · Claude Sonnet 5.5".
          `${model.resolved}${model.provider === 'codex' ? ' · Codex' : ''}${model.price === undefined ? '' : ` · ${model.price}`}`,
    disabled: model.resolved === undefined,
  }))
}

/**
 * Settings › Juno (SPEC 13.10): the providers, the models, today's spend
 * with a way to the daily limit in AI activity, Codex and Pause. The owner's rules are on Connections. Settings change only
 * here; no conversation can change them.
 */
export function JunoSettingsPage({
  page,
  onChatModel,
  onCompactionModel,
  onFallbackModel,
  onOpenLimit,
  providers,
  onSignInCodex,
  onPaused,
}: JunoSettingsPageProps) {
  if (page === undefined) {
    return (
      <Page width="settings">
        {/* One line, as on the full page, so nothing moves when the agent's part arrives after a key is saved. */}
        <PageHeader title="Juno" subtitle="Models, spend and the provider. Only you can change these." />
        {providers}
      </Page>
    )
  }
  const custom = page.provider === 'custom'
  const chatChoice = page.chatModels.find((model) => model.selected)
  const customSelected = page.chatModels.find(model => model.provider === 'custom')?.family ?? ''
  const chatSelected = chatChoice === undefined ? '' : modelChoiceKey(chatChoice)
  const compactionSelected = page.compactionModels.find((model) => model.selected)?.family ?? ''
  const fallbacks = page.fallbackModels
  const fallbackSelected = fallbacks?.find((model) => model.selected)?.family ?? ''
  return (
    <Page width="settings">
      <PageHeader title="Juno" subtitle="Models, spend and the provider. Only you can change these." />

      {providers}

      <Section heading="Model" sub={custom ? 'The model this endpoint runs. Compaction uses it too.' : "The newest model of each family, from the provider's catalogue."}>
        <Surface kind="group">
          {page.modelTyped === true ? (
            <ListRow
              divider={false}
              trailing={
                <TextField
                  size={30}
                  label={chatCopy.providers.modelId}
                  placeholder="llama3.2"
                  // Committed on blur or Enter, as the cap is.
                  key={customSelected}
                  defaultValue={customSelected}
                  onBlur={(event) => commitModel(event.currentTarget.value, customSelected, onChatModel)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitModel(event.currentTarget.value, customSelected, onChatModel)
                  }}
                  width="keyword"
                />
              }
            >
              <span {...stylex.props(cell.lines)}>
                <Text variant="body">Chat</Text>
                <Text variant="meta" tone="muted">
                  {chatCopy.providers.modelTyped}
                </Text>
              </span>
            </ListRow>
          ) : null}
          {page.modelTyped !== true ? (
            <ListRow
              divider={!custom}
              trailing={<Select size={30} label="Chat model" options={modelOptions(page.chatModels)} value={chatSelected} onChange={(event) => onChatModel(event.currentTarget.value)} />}
            >
              <Text variant="body">Chat</Text>
            </ListRow>
          ) : null}
          {custom ? null : (
            <ListRow divider={fallbacks !== undefined} trailing={<Select size={30} label="Compaction model" options={modelOptions(page.compactionModels)} value={compactionSelected} onChange={(event) => onCompactionModel(event.currentTarget.value)} />}>
              <Text variant="body">Compaction</Text>
            </ListRow>
          )}
          {custom || fallbacks === undefined ? null : (
            <ListRow
              divider={false}
              trailing={
                <Select
                  size={30}
                  label="Fallback model"
                  options={[{ value: '', label: 'None' }, ...modelOptions(fallbacks)]}
                  value={fallbackSelected}
                  onChange={(event) => onFallbackModel?.(event.currentTarget.value)}
                />
              }
            >
              <span {...stylex.props(cell.lines)}>
                <Text variant="body">Fallback</Text>
                <Text variant="meta" tone="muted">
                  Asked once when the model refuses under its own policy or is down. Pick one from another maker.
                </Text>
              </span>
            </ListRow>
          )}
        </Surface>
      </Section>

      <Section heading="Spend" sub="At the daily limit, new spending waits until midnight or until you raise it. Work already under way can finish.">
        <Surface kind="group">
          <ListRow
            divider={false}
            trailing={
              <span {...stylex.props(cell.controls)}>
                <Text variant="body" numeric>
                  {page.capUsd >= NO_LIMIT_USD ? `${usd(page.spentTodayUsd)} today` : `${usd(page.spentTodayUsd)} of ${usd(page.limitTodayUsd)} today`}
                </Text>
                <Button variant="secondary" size="sm" onClick={onOpenLimit}>
                  Change limit
                </Button>
              </span>
            }
          >
            {page.spendUntracked === true ? (
              <span {...stylex.props(cell.lines)}>
                <Text variant="body">Today</Text>
                <Text variant="meta" tone="muted" data-spend-untracked="">
                  {chatChoice?.provider === 'codex' ? 'Codex uses your ChatGPT plan. The daily limit applies to API models only.' : chatCopy.providers.spendUntracked}
                </Text>
              </span>
            ) : (
              <Text variant="body">Today</Text>
            )}
          </ListRow>
        </Surface>
      </Section>

      {
        <Section heading="Codex">
          <Surface kind="group">
            <ListRow
              divider={false}
              data-codex={page.codex._tag}
              trailing={
                <span {...stylex.props(cell.controls)}>
                  <Chip variant={CODEX_ENABLED && page.codex._tag === 'ready' ? 'filled' : 'outline'} size={20} data-codex-chip="">
                    {CODEX_ENABLED
                      ? page.codex._tag === 'ready' ? `Ready · ${page.codex.version}` : page.codex._tag === 'signedOut' ? 'Signed out' : 'Not installed'
                      : 'Coming soon'}
                  </Chip>
                  {CODEX_ENABLED && page.codex._tag === 'signedOut' && onSignInCodex !== undefined ? (
                    <Button variant="ghost" size="xs" tone="subtle" onClick={onSignInCodex}>
                      Sign in
                    </Button>
                  ) : null}
                </span>
              }
            >
              <Text variant="body">{CODEX_ENABLED ? 'Uses your ChatGPT plan on this Mac.' : 'Use your ChatGPT plan instead of an API key.'}</Text>
            </ListRow>
          </Surface>
        </Section>
      }

      <Section heading="Pause Juno" sub="Stops Juno from doing anything. Whatever it is working on stops now, and it starts nothing new. Messages you send it wait until you turn this off.">
        <Surface kind="group">
          <ListRow divider={false}>
            <Checkbox size="lg" label="Pause Juno" checked={page.paused} onChange={(event) => onPaused(event.currentTarget.checked)} />
          </ListRow>
        </Surface>
      </Section>

    </Page>
  )
}

export type JunoBackupPageProps = Omit<BackupSectionProps, 'page'> &
  Omit<ThisMacSectionProps, 'page'> & {
    /** The agent's page. Absent while no provider is set up, as no agent runs. */
    readonly page?: BackupSectionProps['page'] & ThisMacSectionProps['page']
    /** With no agent running: opens Settings › Juno to add a provider. */
    readonly onAddProvider: () => void
  }

/**
 * Settings › Backup & This Mac (SPEC 13.8, 13.10): the backup folder, the
 * recovery phrase, and who owns Juno's state with Move and Restore. With
 * no provider no agent runs, so the page says where to start.
 */
export function JunoBackupPage({ page, onAddProvider, ...props }: JunoBackupPageProps) {
  return (
    <Page width="settings">
      <PageHeader title="Backup & This Mac" subtitle="Where Juno's state is kept, and which Mac runs Juno." />
      {page === undefined ? (
        <Section heading="Backup" sub="Juno's backup settings show once Juno has a model.">
          <div>
            <Button variant="secondary" size="sm" onClick={onAddProvider}>
              {chatCopy.providers.add}
            </Button>
          </div>
        </Section>
      ) : (
        <>
          <BackupSection page={page} {...props} />
          <ThisMacSection page={page} {...props} />
        </>
      )}
    </Page>
  )
}
