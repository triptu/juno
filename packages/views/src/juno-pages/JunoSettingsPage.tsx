import * as stylex from '@stylexjs/stylex'
import { chatCopy, type JobId, type JunoSettingsPage as JunoSettingsPageModel, type ModelChoice } from '@juno/agent-contract'
import { Button, Checkbox, Chip, ListRow, Page, PageHeader, Section, Select, Surface, Text, TextField } from '@juno/ui'
import { cell } from './cell'
import { fullTime, messageTime } from '../time'

export interface JunoSettingsPageProps {
  readonly page: JunoSettingsPageModel
  readonly now: number
  readonly onChatModel: (family: string) => void
  readonly onCompactionModel: (family: string) => void
  readonly onCap: (usd: number) => void
  readonly onOpenRouterKey: () => void
  readonly onSignInCodex: () => void
  readonly onRuleChange: (id: string, text: string) => void
  readonly onRuleRemove: (id: string) => void
  readonly onRuleAdd: () => void
  readonly onPaused: (paused: boolean) => void
  readonly onBackupFolder: () => void
  readonly onExportPhrase: () => void
  readonly onMove: () => void
  readonly onRestore: () => void
  readonly onStopJob: (jobId: JobId) => void
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
export function JunoSettingsPage({ page, now, onChatModel, onCompactionModel, onCap, onOpenRouterKey, onSignInCodex, onRuleChange, onRuleRemove, onRuleAdd, onPaused, onBackupFolder, onExportPhrase, onMove, onRestore, onStopJob }: JunoSettingsPageProps) {
  const copy = chatCopy.pages.settings
  const chatSelected = page.chatModels.find((model) => model.selected)?.family ?? ''
  const compactionSelected = page.compactionModels.find((model) => model.selected)?.family ?? ''
  return (
    <Page width="settings">
      <PageHeader title="Juno" subtitle="Models, spend, rules and where Juno's state lives. Only you can change these." />

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
          <ListRow divider={false} trailing={<TextField size={30} label="Daily cap in dollars" type="number" inputMode="decimal" min={0} step={0.5} value={page.capUsd} onChange={(event) => onCap(Number(event.currentTarget.value))} width="keyword" />}>
            <Text variant="body">Daily cap</Text>
          </ListRow>
        </Surface>
      </Section>

      <Section heading="Providers">
        <Surface kind="group">
          <ListRow
            data-openrouter={page.openRouterKey}
            trailing={
              <span {...stylex.props(cell.controls)}>
                <Chip variant={page.openRouterKey === 'set' ? 'filled' : 'outline'} size={20}>
                  {page.openRouterKey === 'set' ? 'Key set' : page.openRouterKey === 'rejected' ? 'Rejected' : 'No key'}
                </Chip>
                <Button variant="ghost" size="xs" tone="subtle" onClick={onOpenRouterKey}>
                  {page.openRouterKey === 'missing' ? 'Add key' : 'Change key'}
                </Button>
              </span>
            }
          >
            <span {...stylex.props(cell.lines)}>
              <Text variant="body">OpenRouter</Text>
              {page.openRouterKey === 'rejected' ? (
                <Text variant="meta" tone="danger">
                  {copy.keyRejected}
                </Text>
              ) : null}
            </span>
          </ListRow>
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
        </Surface>
      </Section>

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
              <TextField size={30} label="Rule" value={rule.text} onChange={(event) => onRuleChange(rule.id, event.currentTarget.value)} dir="auto" />
            </ListRow>
          ))}
          <ListRow divider={false} minHeight={44}>
            <Button variant="ghost" size="sm" tone="subtle" onClick={onRuleAdd}>
              Add a rule
            </Button>
          </ListRow>
        </Surface>
      </Section>

      <Section heading="Pause" sub="Stops the current reply, asks every running job to stop, and starts nothing new. Messages wait for Resume.">
        <Surface kind="group">
          <ListRow divider={false}>
            <Checkbox size="lg" label="Juno is paused" checked={page.paused} onChange={(event) => onPaused(event.currentTarget.checked)} />
          </ListRow>
        </Surface>
      </Section>

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
    </Page>
  )
}
