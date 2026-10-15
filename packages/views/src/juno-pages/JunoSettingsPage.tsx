import * as stylex from '@stylexjs/stylex'
import { chatCopy, type JobId, type JunoSettingsPage as JunoSettingsPageModel, type ModelChoice } from '@juno/agent-contract'
import { Button, Checkbox, Chip, ListRow, Page, PageHeader, Section, Select, Surface, Text, TextField } from '@juno/ui'
import type { ReactNode } from 'react'
import { cell } from './cell'
import { fullTime, messageTime } from '../time'

/**
 * A section whose work is not built yet is left out by leaving out its
 * callbacks: Codex (`onSignInCodex`), Rules (`onRuleChange`, `onRuleRemove`,
 * `onRuleAdd`), Backup (`onBackupFolder`, `onExportPhrase`) and This Mac
 * (`onMove`, `onRestore`, `onStopJob`).
 */
export interface JunoSettingsPageProps {
  /** The agent's page. Absent while no provider is set up, as no agent runs: the page shows the provider alone. */
  readonly page?: JunoSettingsPageModel
  readonly now: number
  /** The provider section (`ProviderSection`), from main's state rather than the agent's page. */
  readonly providers: ReactNode
  /** A chat model: a family on OpenRouter, a model id on a custom endpoint, listed or typed. */
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

function modelOptions(models: ReadonlyArray<ModelChoice>) {
  return models.map((model) => ({
    value: model.family,
    // A custom endpoint's row is a model id, its own name.
    label:
      model.resolved === undefined
        ? `${model.family} (not available)`
        : // The resolved name already names its family: "Claude Sonnet 5.5", not "Claude Sonnet · Claude Sonnet 5.5".
          `${model.resolved}${model.price === undefined ? '' : ` · ${model.price}`}`,
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
}: JunoSettingsPageProps) {
  const copy = chatCopy.pages.settings
  if (page === undefined) {
    return (
      <Page width="settings">
        <PageHeader title="Juno" subtitle={chatCopy.providers.noneBody} />
        {providers}
      </Page>
    )
  }
  const custom = page.provider === 'custom'
  const chatSelected = page.chatModels.find((model) => model.selected)?.family ?? ''
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
                  key={chatSelected}
                  defaultValue={chatSelected}
                  onBlur={(event) => commitModel(event.currentTarget.value, chatSelected, onChatModel)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') commitModel(event.currentTarget.value, chatSelected, onChatModel)
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
          ) : (
            <ListRow
              divider={!custom}
              trailing={<Select size={30} label="Chat model" options={modelOptions(page.chatModels)} value={chatSelected} onChange={(event) => onChatModel(event.currentTarget.value)} />}
            >
              <Text variant="body">Chat</Text>
            </ListRow>
          )}
          {custom ? null : (
            <ListRow divider={false} trailing={<Select size={30} label="Compaction model" options={modelOptions(page.compactionModels)} value={compactionSelected} onChange={(event) => onCompactionModel(event.currentTarget.value)} />}>
              <Text variant="body">Compaction</Text>
            </ListRow>
          )}
        </Surface>
      </Section>

      <Section heading="Spend" sub="Juno stops for the day at the cap and asks before going over.">
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
                  {chatCopy.providers.spendUntracked}
                </Text>
              </span>
            ) : (
              <Text variant="body">Daily cap</Text>
            )}
          </ListRow>
        </Surface>
      </Section>

      {onSignInCodex === undefined ? null : (
        <Section heading="Codex">
          <Surface kind="group">
            <ListRow
              divider={false}
              data-codex={page.codex._tag}
              trailing={
                <span {...stylex.props(cell.controls)}>
                  <Chip variant={page.codex._tag === 'ready' ? 'filled' : 'outline'} size={20}>
                    {page.codex._tag === 'ready' ? `Ready · ${page.codex.version}` : page.codex._tag === 'signedOut' ? 'Signed out' : 'Not installed'}
                  </Chip>
                  {page.codex._tag === 'signedOut' ? (
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
        <Section heading="Backup" sub="An encrypted copy of Juno's state, in a folder you choose.">
          <Surface kind="group">
            <ListRow
              trailing={
                <Button variant="ghost" size="xs" tone="subtle" onClick={onBackupFolder}>
                  Choose folder
                </Button>
              }
            >
              <span {...stylex.props(cell.lines)}>
                <Text variant="body" truncate>
                  {page.backupFolder}
                </Text>
                <Text variant="meta" tone="muted">
                  {page.lastBackupAt === undefined ? 'No backup yet' : (
                    <>
                      Last backup <time title={fullTime(page.lastBackupAt)}>{messageTime(page.lastBackupAt, now)}</time>
                    </>
      )}
              </Text>
            </span>
          </ListRow>
          <ListRow divider={false} trailing={<Button variant="ghost" size="xs" tone="subtle" onClick={onExportPhrase}>{copy.exportPhrase}</Button>}>
            <span {...stylex.props(cell.lines)}>
              <Text variant="body">Recovery phrase</Text>
              <Text variant="meta" tone="muted">
                {page.recoveryPhraseExportedAt === undefined ? 'Not exported yet. Without it a backup cannot be read on another Mac.' : (
                  <>
                    Exported <time title={fullTime(page.recoveryPhraseExportedAt)}>{messageTime(page.recoveryPhraseExportedAt, now)}</time>
                  </>
                )}
              </Text>
            </span>
          </ListRow>
        </Surface>
      </Section>

      )}
      {onMove === undefined || onRestore === undefined || onStopJob === undefined ? null : (
        <Section heading="This Mac" sub="Juno runs on one Mac at a time.">
          <Surface kind="group" data-ownership={page.ownership._tag}>
            <ListRow
              trailing={
                <Chip variant={page.ownership._tag === 'active' ? 'filled' : 'outline'} size={20}>
                  {page.ownership._tag === 'active' ? 'Active here' : page.ownership._tag === 'released' ? 'Moving' : 'Recovery'}
                </Chip>
              }
            >
              <span {...stylex.props(cell.lines)}>
                <Text variant="body">
                  {page.ownership._tag === 'active'
                    ? 'This Mac owns Juno’s state.'
                    : page.ownership._tag === 'released'
                      ? 'This Mac is read-only until the other Mac takes over.'
                      : `Restored from a backup. ${page.ownership.pending === 1 ? '1 action was' : `${page.ownership.pending} actions were`} pending.`}
                </Text>
              </span>
            </ListRow>
            {page.removalPending !== undefined ? (
              <ListRow
                data-removal-pending=""
                trailing={
                  <Button variant="ghost" size="xs" tone="subtle" onClick={() => page.removalPending !== undefined && onStopJob(page.removalPending.jobId)}>
                    {copy.stopJob}
                  </Button>
                }
              >
                <Text variant="body">{copy.removalPending(page.removalPending.copies)}</Text>
              </ListRow>
            ) : null}
            <ListRow
              divider={false}
              trailing={
                <span {...stylex.props(cell.controls)}>
                  <Button variant="ghost" size="xs" tone="subtle" onClick={onMove} disabled={page.ownership._tag !== 'active'}>
                    {copy.move}
                  </Button>
                  <Button variant="ghost" size="xs" tone="subtle" onClick={onRestore}>
                    {copy.restore}
                  </Button>
                </span>
              }
            >
              <Text variant="meta" tone="muted" sx={cell.wrap}>
                {copy.attest}
              </Text>
            </ListRow>
          </Surface>
        </Section>
      )}
    </Page>
  )
}
