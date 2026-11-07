/**
 * The status sheet's draft (SPEC 14, "Your status"): the emoji, the text and
 * Clear after, local to the open sheet, starting from your status as it was
 * when the sheet opened. A preset fills all three. The emoji button opens
 * the emoji picker, custom emoji included, as a popover under it.
 *
 * Clear after starts at the time your status already clears at, at Don't
 * clear for a status that never does, and at Today for a new one. A kept
 * time that passes while the sheet is open leaves the choices, and Today
 * takes its place.
 *
 * Save and Clear status wait for Slack: a refusal keeps the sheet open with
 * the reason under the field; success closes it.
 */
import { useEffect, useState } from 'react'
import {
  emojiCatalog,
  isEmojiSearchWarm,
  STATUS_CLEAR_AFTER,
  STATUS_DEFAULT_EMOJI,
  STATUS_PRESETS,
  STATUS_TEXT_MAX,
  statusUntil,
  warmEmojiSearch,
  type PreparedEmojiPicker,
  type StatusClearAfter,
  type StatusClearAfterChoice,
  type StatusEmoji,
} from '@juno/contract'
import { errorOf, frequentEmojiAtom, personStatusAtom, registry, setOwnStatus, signedInAtom } from '@juno/state'
import { emojiPickerDataAtom, standardEmojiPickerData, warmWorkspaceEmoji } from '@juno/state/emoji'
import { useAtomValue } from '@juno/state/react'
import { EmojiPicker, SheetLayer, StatusSheet as StatusSheetView, type StatusSheetPreset } from '@juno/views'
import { useEmojiSearchReady } from './useEmojiSearchReady'

const searchIndex = { warmEmojiSearch, isEmojiSearchWarm }

/** A Clear after choice, or `keep`: the time the status already clears at. */
type ClearAfter = StatusClearAfter | 'keep'

const labelOf = (value: StatusClearAfter) => STATUS_CLEAR_AFTER.find((choice) => choice.value === value)?.label ?? ''

/** Slack's refusals of `users.profile.set` (its API docs), in plain words; a refusal Juno does not know names its code. */
function rejectedText(code: string): string {
  switch (code) {
    case 'too_long':
      return `Use ${STATUS_TEXT_MAX} characters or fewer.`
    case 'profile_set_failed':
      return 'Slack couldn’t save your status. Try again.'
    case 'cannot_update_admin_user':
    case 'not_allowed':
    case 'no_permission':
    case 'restricted_action':
      return 'Your workspace doesn’t let you change your status.'
    case 'reserved_name':
    case 'invalid_profile':
      return 'Slack doesn’t allow that status. Change the text or the emoji.'
    default:
      return `Slack didn’t take that status (${code}).`
  }
}

/** Why Save or Clear status failed, in plain words. */
function errorText(exit: Parameters<typeof errorOf>[0]): string {
  const error = errorOf(exit) as { readonly _tag: string; readonly code?: string } | undefined
  if (error?._tag === 'RateLimited') return 'Slack is busy. Try again in a moment.'
  if (error?._tag === 'NotSignedIn') return 'Sign in to Slack again to set a status.'
  if (error?._tag === 'Rejected') return rejectedText(error.code ?? '')
  return 'Couldn’t reach Slack. Try again.'
}

/** The status as the sheet opened on it: its emoji and text, and when it clears. */
function useDraft() {
  const selfId = useAtomValue(signedInAtom)?.userId ?? ''
  const current = useAtomValue(personStatusAtom(selfId)) ?? undefined
  const [opened] = useState(() => {
    const clearAfter: ClearAfter = current === undefined ? 'today' : current.expiresAt === undefined ? 'never' : 'keep'
    return { at: new Date(), status: current, clearAfter }
  })
  const [emoji, setEmoji] = useState<StatusEmoji | undefined>(opened.status?.emoji)
  const [text, setText] = useState(opened.status?.text ?? '')
  const [clearAfter, setClearAfter] = useState<ClearAfter>(opened.clearAfter)
  const keep = useKeptExpiry(opened.status?.expiresAt)
  return { current, opened, emoji, setEmoji, text, setText, clearAfter: clearAfter === 'keep' && keep === undefined ? 'today' : clearAfter, setClearAfter, keep }
}

/** The time the status already clears at, until that time passes. */
function useKeptExpiry(expiresAt: number | undefined): number | undefined {
  const [passed, setPassed] = useState(() => expiresAt !== undefined && expiresAt <= Date.now())
  useEffect(() => {
    if (expiresAt === undefined || passed) return
    const timer = setTimeout(() => setPassed(true), Math.max(0, expiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [expiresAt, passed])
  return passed ? undefined : expiresAt
}

export function StatusSheet({ onClose }: { readonly onClose: () => void }) {
  // The chunk loads when idle, so the workspace's emoji are read once the sheet opens, not at startup.
  warmWorkspaceEmoji(emojiCatalog)
  const draft = useDraft()
  const { emoji, text, clearAfter, keep } = draft
  const [picking, setPicking] = useState(false)

  const picker = useAtomValue(emojiPickerDataAtom(emojiCatalog))
  const data = picker?.data ?? standardEmojiPickerData

  const presets = presetsOf(data)
  const options: ReadonlyArray<{ readonly value: ClearAfter; readonly label: string }> = [
    ...(keep === undefined ? [] : [{ value: 'keep' as const, label: capitalized(statusUntil(keep, draft.opened.at)) }]),
    ...STATUS_CLEAR_AFTER,
  ]
  const { busy, error, run } = useSend(onClose)
  const save = () => {
    // A kept time that has passed by now is Today, as the choices show once it does.
    const choice: StatusClearAfterChoice = clearAfter !== 'keep' ? clearAfter : keep !== undefined && keep > Date.now() ? { at: keep } : 'today'
    run({ text, emoji: emoji?.name ?? '', clearAfter: choice })
  }

  return (
    <SheetLayer anchor="top" onClose={() => (picking ? setPicking(false) : onClose())}>
      <StatusSheetView
        emoji={emoji}
        textEmoji={emojiOf(data, STATUS_DEFAULT_EMOJI)}
        text={text}
        maxLength={STATUS_TEXT_MAX}
        presets={presets}
        clearAfterOptions={options}
        clearAfter={clearAfter}
        hasStatus={draft.current !== undefined}
        busy={busy}
        error={error}
        picker={
          picking ? (
            <StatusEmojiPicker
              data={data}
              customReady={picker !== undefined}
              onPick={(picked) => {
                draft.setEmoji(picked)
                setPicking(false)
              }}
              onClose={() => setPicking(false)}
            />
          ) : undefined
        }
        onEmoji={() => setPicking(!picking)}
        onClosePicker={() => setPicking(false)}
        onTextChange={draft.setText}
        onClearField={() => {
          draft.setText('')
          draft.setEmoji(undefined)
        }}
        onPreset={(preset) => {
          draft.setEmoji(preset.emoji)
          draft.setText(preset.text)
          draft.setClearAfter(preset.clearAfter)
        }}
        onClearAfterChange={draft.setClearAfter}
        onSave={save}
        onClearStatus={() => run({ text: '', emoji: '', clearAfter: 'never' })}
        onCancel={onClose}
      />
    </SheetLayer>
  )
}

/** An emoji by name as the picker's data draws it. */
function emojiOf(data: PreparedEmojiPicker, name: string): StatusEmoji {
  const item = data.byName.get(name)
  return { name, ...(item?.unicode === undefined ? {} : { unicode: item.unicode }), ...(item?.url === undefined ? {} : { url: item.url }) }
}

/** Slack's presets, their emoji drawn from the picker's data. */
function presetsOf(data: PreparedEmojiPicker): ReadonlyArray<StatusSheetPreset<ClearAfter>> {
  return STATUS_PRESETS.map((preset) => ({ emoji: emojiOf(data, preset.emoji), text: preset.text, clearAfter: preset.clearAfter, clearAfterLabel: labelOf(preset.clearAfter) }))
}

/** Save and Clear status: busy while Slack answers, then closed, or the reason it failed. */
function useSend(onClose: () => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const run = (input: Parameters<typeof setOwnStatus>[1]) => {
    setBusy(true)
    setError(undefined)
    void setOwnStatus(registry, input).then((exit) => {
      setBusy(false)
      if (exit._tag === 'Success') onClose()
      else setError(errorText(exit))
    })
  }
  return { busy, error, run }
}

const capitalized = (line: string) => line.charAt(0).toUpperCase() + line.slice(1)

/** The emoji picker under the emoji button, custom emoji included, with the frequently used ones first. */
function StatusEmojiPicker({ data, customReady, onPick, onClose }: { readonly data: PreparedEmojiPicker; readonly customReady: boolean; readonly onPick: (emoji: StatusEmoji) => void; readonly onClose: () => void }) {
  const recent = useAtomValue(frequentEmojiAtom)
  const searchReady = useEmojiSearchReady(data.all, searchIndex)
  return (
    <EmojiPicker
      data={data}
      searchReady={searchReady}
      customReady={customReady}
      recent={recent}
      width="fill"
      onPick={(name, unicode, url) => onPick({ name, ...(unicode === undefined ? {} : { unicode }), ...(url === undefined ? {} : { url }) })}
      onClose={onClose}
    />
  )
}
