import * as stylex from '@stylexjs/stylex'
import { chatCopy, type JobId, type JunoSettingsPage as JunoSettingsPageModel, type ModelChoice } from '@juno/agent-contract'
import { Button, Checkbox, Chip, ListRow, Page, PageHeader, Section, Select, Surface, Text, TextField } from '@juno/ui'
import { cell } from './cell'
import { fullTime, messageTime } from '../time'

/** The OpenRouter key being typed in its row. The draft is the renderer's; the key goes to main, never to the page. */
export interface KeyEntry {
  readonly draft: string
  /** "That is not an OpenRouter key." and the like, under the field. */
  readonly error?: string
  readonly onDraft: (draft: string) => void
  readonly onSave: () => void
  readonly onCancel: () => void
}

/**
 * A section whose work is not built yet is left out by leaving out its
 * callbacks: Codex (`onSignInCodex`), Rules (`onRuleChange`, `onRuleRemove`,
 * `onRuleAdd`), Backup (`onBackupFolder`, `onExportPhrase`) and This Mac
 * (`onMove`, `onRestore`, `onStopJob`).
 */
export interface JunoSettingsPageProps {
  readonly page: JunoSettingsPageModel
  readonly now: number
  readonly onChatModel: (family: string) => void
  readonly onCompactionModel: (family: string) => void
  readonly onCap: (usd: number) => void
  readonly onOpenRouterKey: () => void
  /** Open while the owner types a key. */
  readonly keyEntry?: KeyEntry
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

const usd = (amount: number): string => `$${amount.toFixed(2)}`

function modelOptions(models: ReadonlyArray<ModelChoice>) {
  return models.map((model) => ({
    value: model.family,
    label: model.resolved === undefined ? `${model.family} (not available)` : `${model.family} · ${model.resolved}${model.price === undefined ? '' : ` · ${model.price}`}`,
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
  onOpenRouterKey,
  keyEntry,
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

      <Section heading="Model" sub="The newest model of each family, from the provider's catalogue.">
        <Surface kind="group">
          <ListRow trailing={<Select size={30} label="Chat model" options={modelOptions(page.chatModels)} value={chatSelected} onChange={(event) => onChatModel(event.currentTarget.value)} />}>
            <Text variant="body">Chat</Text>
          </ListRow>
          <ListRow divider={false} trailing={<Select size={30} label="Compaction model" options={modelOptions(page.compactionModels)} value={compactionSelected} onChange={(event) => onCompactionModel(event.currentTarget.value)} />}>
            <Text variant="body">Compaction</Text>
          </ListRow>
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
            <Text variant="body">Daily cap</Text>
          </ListRow>
        </Surface>
      </Section>

      <Section heading="Providers">
        <Surface kind="group">
          <ListRow
            divider={onSignInCodex !== undefined}
            data-openrouter={page.openRouterKey}
            trailing={
              keyEntry === undefined ? (
                <span {...stylex.props(cell.controls)}>
                  <Chip variant={page.openRouterKey === 'set' ? 'filled' : 'outline'} size={20}>
                    {page.openRouterKey === 'set' ? 'Key set' : page.openRouterKey === 'rejected' ? 'Rejected' : 'No key'}
                  </Chip>
                  <Button variant="ghost" size="xs" tone="subtle" onClick={onOpenRouterKey}>
                    {page.openRouterKey === 'missing' ? 'Add key' : 'Change key'}
                  </Button>
                </span>
              ) : (
                <span {...stylex.props(cell.controls)}>
                  <TextField
                    size={30}
                    label="OpenRouter key"
                    type="password"
                    placeholder="sk-or-…"
                    value={keyEntry.draft}
                    invalid={keyEntry.error !== undefined}
                    autoFocus
                    onChange={(event) => keyEntry.onDraft(event.currentTarget.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') keyEntry.onSave()
                      else if (event.key === 'Escape') keyEntry.onCancel()
                    }}
                    width="keyword"
                  />
                  <Button variant="secondary" size="md" onClick={keyEntry.onSave} disabled={keyEntry.draft.trim() === ''}>
                    Save
                  </Button>
                  <Button variant="ghost" size="md" tone="subtle" onClick={keyEntry.onCancel}>
                    Cancel
                  </Button>
                </span>
              )
            }
          >
            <span {...stylex.props(cell.lines)}>
              <Text variant="body">OpenRouter</Text>
              {keyEntry?.error !== undefined ? (
                <Text variant="meta" tone="danger" data-key-error="">
                  {keyEntry.error}
                </Text>
              ) : page.openRouterKey === 'rejected' ? (
                <Text variant="meta" tone="danger">
                  {copy.keyRejected}
                </Text>
              ) : null}
            </span>
          </ListRow>
          {onSignInCodex === undefined ? null : (
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
              <span {...stylex.props(cell.lines)}>
                <Text variant="body">Codex</Text>
                <Text variant="meta" tone="muted">
                  Uses your ChatGPT plan on this Mac.
                </Text>
              </span>
            </ListRow>
          )}
        </Surface>
      </Section>

      {onRuleChange === undefined || onRuleRemove === undefined || onRuleAdd === undefined ? null : (
        <Section heading="Rules" sub="One line each. Rules can only make Juno ask more, never less.">
          <Surface kind="group">
            {page.rules.map((rule) => (
              <ListRow
                key={rule.id}
                trailing={
                  <Button variant="ghost" size="xs" tone="subtle" onClick={() => onRuleRemove(rule.id)}>
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
