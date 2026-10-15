import * as stylex from '@stylexjs/stylex'
import { chatCopy, modelChoiceKey, type JobId, type JunoSettingsPage as JunoSettingsPageModel, type ModelChoice } from '@juno/agent-contract'
import { Button, Checkbox, Chip, ListRow, Page, PageHeader, Section, Select, Surface, Text, TextField } from '@juno/ui'
import type { ReactNode } from 'react'
import { BackupSection, ThisMacSection } from './BackupSections'
import { cell } from './cell'

/**
 * A section whose work is not built yet is left out by leaving out its
 * callbacks: Rules (`onRuleChange`, `onRuleRemove`,
 * `onRuleAdd`), Backup (`onBackupFolder`, `onExportPhrase`) and This Mac
 * (`onMove`, `onRestore`). Without `onStopJob` a removal pending in a job
 * is not shown.
 */
export interface JunoSettingsPageProps {
  /** The agent's page. Absent while no provider is set up, as no agent runs: the page shows the provider alone. */
  readonly page?: JunoSettingsPageModel
  readonly now: number
  /** The provider section (`ProviderSection`), from main's state rather than the agent's page. */
  readonly providers: ReactNode
  /** A listed modelChoiceKey, or a typed custom model id. */
  readonly onChatModel: (family: string) => void
  readonly onCompactionModel: (family: string) => void
  readonly onCap: (usd: number) => void
  readonly onPaused: (paused: boolean) => void
  readonly onSignInCodex?: () => void
  readonly onRuleChange?: (id: string, text: string) => void
  readonly onRuleRemove?: (id: string) => void
  readonly onRuleAdd?: () => void
  /** A rule field lost focus or took Enter: the edited list is saved as a whole. */
  readonly onRulesCommit?: () => void
  /** Why the agent refused the list: "Each rule is one line of up to 280 bytes, and there are at most 20." */
  readonly rulesError?: string
  readonly onBackupFolder?: () => void
  readonly onExportPhrase?: () => void
  readonly onMove?: () => void
  readonly onRestore?: () => void
  readonly onStopJob?: (jobId: JobId) => void
  /** A folder change or an export in flight: its button waits. */
  readonly backupBusy?: 'folder' | 'phrase'
  /** Why the last folder change or export failed, under its row. */
  readonly backupError?: { readonly row: 'folder' | 'phrase'; readonly message: string }
}

function commitCap(text: string, current: number, onCap: (usd: number) => void): void {
  const value = Number(text)
  if (text.trim() !== '' && Number.isFinite(value) && value >= 0 && value !== current) onCap(value)
}

function commitModel(text: string, current: string, onChatModel: (id: string) => void): void {
  const id = text.trim()
  if (id !== '' && id !== current) onChatModel(id)
}

const usd = (amount: number): string => `$${amount.toFixed(2)}`

/** The model select's rows: the resolved name, Codex, and the price, as Settings › Juno and Set up Juno show them. */
export function modelOptions(models: ReadonlyArray<ModelChoice>) {
  return models.map((model) => ({
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
 * Settings › Juno (SPEC 13.10): the models, today's spend and the cap, the
 * providers, the owner's rules, Pause, the backup folder, and who owns
 * Juno's state with Export recovery phrase, Move and Restore. Settings
 * change only here; no conversation can change them.
 */
export function JunoSettingsPage({
  page,
  now,
  onChatModel,
  onCompactionModel,
  onCap,
  providers,
  onSignInCodex,
  onRuleChange,
  onRuleRemove,
  onRuleAdd,
  onRulesCommit,
  rulesError,
  onPaused,
  onBackupFolder,
  onExportPhrase,
  onMove,
  onRestore,
  onStopJob,
  backupBusy,
  backupError,
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
  return (
    <Page width="settings">
      <PageHeader
        title="Juno"
        subtitle={
          onMove !== undefined
            ? "Models, spend, rules and where Juno's state lives. Only you can change these."
            : onRuleChange !== undefined
              ? 'Models, spend, the provider and your rules. Only you can change these.'
              : 'Models, spend and the provider. Only you can change these.'
        }
      />

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
          {page.modelTyped !== true || page.chatModels.some(model => model.provider === 'codex') ? (
            <ListRow
              divider={!custom}
              trailing={<Select size={30} label="Chat model" options={modelOptions(page.chatModels)} value={chatSelected} onChange={(event) => onChatModel(event.currentTarget.value)} />}
            >
              <Text variant="body">Chat</Text>
            </ListRow>
          ) : null}
          {custom ? null : (
            <ListRow divider={false} trailing={<Select size={30} label="Compaction model" options={modelOptions(page.compactionModels)} value={compactionSelected} onChange={(event) => onCompactionModel(event.currentTarget.value)} />}>
              <Text variant="body">Compaction</Text>
            </ListRow>
          )}
        </Surface>
      </Section>

      <Section heading="Spend" sub="At the cap, new spending waits until tomorrow or you raise it. Work already under way can finish.">
        <Surface kind="group">
          <ListRow
            trailing={
              <Text variant="body" numeric>
                {usd(page.spentTodayUsd)}
              </Text>
            }
          >
            <Text variant="body">Today</Text>
          </ListRow>
          <ListRow
            divider={false}
            trailing={
              <TextField
                size={30}
                label="Daily cap in dollars"
                leading={
                  <Text variant="ui" tone="muted" aria-hidden>
                    $
                  </Text>
                }
                type="number"
                inputMode="decimal"
                min={0}
                step={0.5}
                // Committed on blur or Enter, so a field cleared while typing never sets the cap to $0.
                key={page.capUsd}
                defaultValue={page.capUsd}
                onBlur={(event) => commitCap(event.currentTarget.value, page.capUsd, onCap)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitCap(event.currentTarget.value, page.capUsd, onCap)
                }}
                width="keyword"
              />
            }
          >
            {page.spendUntracked === true ? (
              <span {...stylex.props(cell.lines)}>
                <Text variant="body">Daily cap</Text>
                <Text variant="meta" tone="muted" data-spend-untracked="">
                  {chatChoice?.provider === 'codex' ? 'Codex uses your ChatGPT plan. The daily cap applies to API models only.' : chatCopy.providers.spendUntracked}
                </Text>
              </span>
            ) : (
              <Text variant="body">Daily cap</Text>
            )}
          </ListRow>
        </Surface>
      </Section>

      {(
        <Section heading="Codex">
          <Surface kind="group">
            <ListRow
              divider={false}
              data-codex={page.codex._tag}
              trailing={
                <span {...stylex.props(cell.controls)}>
                  <Chip variant={page.codex._tag === 'ready' ? 'filled' : 'outline'} size={20} data-codex-chip="">
                    {page.codex._tag === 'ready' ? `Ready · ${page.codex.version}` : page.codex._tag === 'signedOut' ? 'Signed out' : 'Not installed'}
                  </Chip>
                  {page.codex._tag === 'signedOut' && onSignInCodex !== undefined ? (
                    <Button variant="ghost" size="xs" tone="subtle" onClick={onSignInCodex}>
                      Sign in
                    </Button>
                  ) : null}
                </span>
              }
            >
              <Text variant="body">Uses your ChatGPT plan on this Mac.</Text>
            </ListRow>
          </Surface>
        </Section>
      )}

      {onRuleChange === undefined || onRuleRemove === undefined || onRuleAdd === undefined ? null : (
        <Section heading="Rules" sub="One line each. Rules can only make Juno ask more, never less.">
          <Surface kind="group">
            {page.rules.map((rule) => (
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
      )}

      <Section heading="Pause" sub="Stops the current reply, asks every running job to stop, and starts nothing new. Messages wait for Resume.">
        <Surface kind="group">
          <ListRow divider={false}>
            <Checkbox size="lg" label="Juno is paused" checked={page.paused} onChange={(event) => onPaused(event.currentTarget.checked)} />
          </ListRow>
        </Surface>
      </Section>

      {onBackupFolder === undefined || onExportPhrase === undefined ? null : (
        <BackupSection
          page={page}
          now={now}
          onBackupFolder={onBackupFolder}
          onExportPhrase={onExportPhrase}
          {...(backupBusy === undefined ? {} : { backupBusy })}
          {...(backupError === undefined ? {} : { backupError })}
        />
      )}
      {onMove === undefined || onRestore === undefined ? null : (
        <ThisMacSection page={page} onMove={onMove} onRestore={onRestore} {...(onStopJob === undefined ? {} : { onStopJob })} />
      )}
    </Page>
  )
}
