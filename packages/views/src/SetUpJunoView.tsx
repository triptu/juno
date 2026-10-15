import * as stylex from '@stylexjs/stylex'
import { chatCopy, type ModelChoice } from '@juno/agent-contract'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Button, Chip, ListRow, Segmented, Select, Surface, Text, TextField } from '@juno/ui'
import { cell } from './juno-pages/cell'
import { modelOptions } from './juno-pages/JunoSettingsPage'
import { SignInPage } from './SignInPage'
import type { ProviderDrafts } from './juno-pages/ProviderSection'

/** The model providers the step offers. `codex` only when Codex is installed. */
export type SetUpChoice = 'openRouter' | 'custom' | 'codex'

/** Local Codex in Juno's own Codex home. */
export type SetUpCodex = 'missing' | 'signedOut' | 'signedIn'

export interface SetUpJunoViewProps {
  readonly shown: SetUpChoice
  /** Undefined until main has said; `missing` leaves Codex out. */
  readonly codex?: SetUpCodex
  readonly drafts: ProviderDrafts
  /** The shown provider is set up: its key is saved, or Codex is signed in. The model row shows. */
  readonly saved: boolean
  /** The shown provider's models, once the agent has listed them. Undefined while it starts. */
  readonly models?: ReadonlyArray<ModelChoice>
  /** The chosen model's key (`modelChoiceKey`). */
  readonly model?: string
  /** An OpenAI-compatible endpoint that lists no models: the model id is typed. */
  readonly modelTyped?: boolean
  /** What is in progress: saving the key, Codex's sign-in, or finishing. Every button waits. */
  readonly busy?: 'save' | 'codex' | 'finish'
  /** One short sentence about the last failed attempt. */
  readonly error?: string
  readonly onShow: (choice: SetUpChoice) => void
  readonly onDraft: (drafts: ProviderDrafts) => void
  readonly onModel: (key: string) => void
  readonly onSignInCodex: () => void
  /** Saves the key while it is not saved; with a model chosen, finishes. */
  readonly onContinue: () => void
  readonly onSkip: () => void
}

const copy = {
  title: 'Set up Juno',
  body: 'I run on a model you choose. Keys stay in your keychain, and you can change this later in Settings.',
  codex: 'Codex',
  codexSignedIn: 'Codex is signed in on this Mac. It uses your ChatGPT plan.',
  codexSignedOut: 'Sign in to Codex in your browser. It uses your ChatGPT plan.',
  codexSignIn: 'Sign in to Codex',
  model: 'Model',
  modelsWaiting: 'Getting the models…',
  continue: 'Continue',
  skip: 'Skip for now',
  busy: { save: 'Saving the key', codex: 'Waiting for Codex to sign in in your browser', finish: 'Setting the model' },
}

/**
 * The step after Slack sign-in, on the same page (SPEC section 13.10, "Set
 * up Juno"): pick OpenRouter, an OpenAI-compatible endpoint or local Codex,
 * set it up, choose the chat model (Sonnet by default), or skip. Like the
 * sign-in page, Juno speaks in the first person here.
 */
export function SetUpJunoView(props: SetUpJunoViewProps) {
  const { shown, codex, saved, busy, error, onShow, onContinue, onSkip } = props
  const waiting = busy !== undefined
  const choices: Array<{ readonly value: SetUpChoice; readonly label: string }> = [
    { value: 'openRouter', label: chatCopy.providers.openRouter },
    { value: 'custom', label: chatCopy.providers.custom },
  ]
  if (codex !== undefined && codex !== 'missing') choices.push({ value: 'codex', label: copy.codex })
  const status = busy !== undefined ? { text: copy.busy[busy], tone: 'muted' as const } : error === undefined ? undefined : { text: error, tone: 'danger' as const }
  return (
    <SignInPage titleId="set-up-title" title={copy.title} body={copy.body} {...(status === undefined ? {} : { status })} data-set-up-juno="">
      <div {...stylex.props(styles.form)}>
        <span {...stylex.props(styles.choice)}>
          <Segmented label={chatCopy.providers.heading} options={choices} value={shown} onChange={onShow} disabled={waiting} />
        </span>
        <Surface kind="group">
          <Fields {...props} />
          {saved ? <ModelRow {...props} /> : null}
        </Surface>
      </div>
      <div {...stylex.props(styles.actions)}>
        <Button variant="primary" size="2xl" onClick={onContinue} disabled={waiting || !canContinue(props)}>
          {copy.continue}
        </Button>
        <Button variant="ghost" size="2xl" tone="subtle" onClick={onSkip} disabled={waiting}>
          {copy.skip}
        </Button>
      </div>
    </SignInPage>
  )
}

/** Continue saves filled fields, or finishes once a model is chosen. */
function canContinue({ shown, drafts, saved, models, model, modelTyped }: SetUpJunoViewProps): boolean {
  if (saved) return modelTyped === true ? (model ?? '').trim() !== '' : models !== undefined && model !== undefined
  if (shown === 'openRouter') return drafts.openRouterKey.trim() !== ''
  if (shown === 'custom') return drafts.baseUrl.trim() !== ''
  return false
}

function Fields({ shown, codex, drafts, saved, busy, error, onDraft, onSignInCodex, onContinue }: SetUpJunoViewProps) {
  const providers = chatCopy.providers
  const enter = (event: { readonly key: string }) => {
    if (event.key === 'Enter') onContinue()
  }
  if (shown === 'codex') {
    return (
      <ListRow
        divider={saved}
        trailing={
          codex === 'signedIn' ? null : (
            <Button variant="secondary" size="xs" onClick={onSignInCodex} disabled={busy !== undefined}>
              {copy.codexSignIn}
            </Button>
          )
        }
      >
        <Text variant="body">{codex === 'signedIn' ? copy.codexSignedIn : copy.codexSignedOut}</Text>
      </ListRow>
    )
  }
  const openRouter = shown === 'openRouter'
  const key = (
    <ListRow
      divider={saved}
      trailing={
        // As Settings › Juno draws it: a saved key is a chip beside the field, which keeps its placeholder.
        <span {...stylex.props(cell.controls)}>
          {saved ? (
            <Chip variant="filled" size={20}>
              {providers.keySet}
            </Chip>
          ) : null}
          <TextField
            size={30}
            label={openRouter ? providers.key : providers.keyOptional}
            type="password"
            placeholder={openRouter ? 'sk-or-…' : ''}
            value={openRouter ? drafts.openRouterKey : drafts.customKey}
            invalid={error !== undefined}
            onChange={(event) => onDraft(openRouter ? { ...drafts, openRouterKey: event.currentTarget.value } : { ...drafts, customKey: event.currentTarget.value })}
            onKeyDown={enter}
            width="keyword"
          />
        </span>
      }
    >
      <Text variant="body">{openRouter ? providers.key : providers.keyOptional}</Text>
    </ListRow>
  )
  if (openRouter) return key
  return (
    <>
      <ListRow
        trailing={
          <TextField
            size={30}
            label={providers.baseUrl}
            type="url"
            placeholder="http://localhost:11434/v1"
            value={drafts.baseUrl}
            invalid={error !== undefined}
            onChange={(event) => onDraft({ ...drafts, baseUrl: event.currentTarget.value })}
            onKeyDown={enter}
            width="keyword"
          />
        }
      >
        <span {...stylex.props(cell.lines)}>
          <Text variant="body">{providers.baseUrl}</Text>
          <Text variant="meta" tone="muted">
            {providers.customNote}
          </Text>
        </span>
      </ListRow>
      {key}
    </>
  )
}

function ModelRow({ models, model, modelTyped, busy, onModel }: SetUpJunoViewProps) {
  const control =
    modelTyped === true ? (
      <TextField size={30} label={chatCopy.providers.modelId} value={model ?? ''} onChange={(event) => onModel(event.currentTarget.value)} width="keyword" />
    ) : models === undefined ? (
      <Text variant="ui" tone="muted">
        {copy.modelsWaiting}
      </Text>
    ) : (
      <Select size={30} label={copy.model} options={modelOptions(models)} value={model ?? ''} onChange={(event) => onModel(event.currentTarget.value)} disabled={busy !== undefined} />
    )
  return (
    <ListRow divider={false} trailing={control} data-set-up-model="">
      <Text variant="body">{modelTyped === true ? chatCopy.providers.modelId : copy.model}</Text>
    </ListRow>
  )
}

const styles = stylex.create({
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-3'],
  },
  choice: {
    display: 'flex',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing['--space-3'],
  },
})
