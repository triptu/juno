/**
 * The status sheet's draft (SPEC 14, "Your status"): the emoji, the text and
 * Clear after, local to the open sheet, starting from your status. A preset
 * fills all three. The emoji button shows the emoji picker, custom emoji
 * included, in the sheet's place; a pick or Escape brings the sheet back.
 *
 * Save and Clear status wait for Slack: a refusal keeps the sheet open with
 * the reason under the field; success closes it.
 */
import { useState } from 'react'
import { emojiCatalog, isEmojiSearchWarm, STATUS_CLEAR_AFTER, STATUS_PRESETS, STATUS_TEXT_MAX, statusUntil, warmEmojiSearch, type PreparedEmojiPicker, type StatusClearAfter, type StatusEmoji } from '@juno/contract'
import { errorOf, frequentEmojiAtom, personStatusAtom, registry, setOwnStatus, signedInAtom } from '@juno/state'
import { emojiPickerDataAtom, standardEmojiPickerData, warmWorkspaceEmoji } from '@juno/state/emoji'
import { useAtomValue } from '@juno/state/react'
import { EmojiPicker, SheetLayer, StatusSheet as StatusSheetView, type StatusSheetPreset } from '@juno/views'
import { useEmojiSearchReady } from './useEmojiSearchReady'

const searchIndex = { warmEmojiSearch, isEmojiSearchWarm }
warmWorkspaceEmoji(emojiCatalog)

/** Keeps the time an existing status clears at. */
const KEEP = 'keep'

const clearAfterLabel = (value: StatusClearAfter) => STATUS_CLEAR_AFTER.find((choice) => choice.value === value)?.label ?? ''

/** Why Save or Clear status failed, in plain words. */
function errorText(exit: Parameters<typeof errorOf>[0]): string {
  const error = errorOf(exit) as { readonly _tag: string; readonly code?: string } | undefined
  if (error?._tag === 'RateLimited') return 'Slack is busy. Try again in a moment.'
  if (error?._tag === 'NotSignedIn') return 'Sign in to Slack again to set a status.'
  if (error?._tag === 'Rejected') return error.code === 'too_long' ? `Use ${STATUS_TEXT_MAX} characters or fewer.` : 'Slack didn’t take that status. Try again.'
  return 'Couldn’t reach Slack. Try again.'
}

export function StatusSheet({ onClose }: { readonly onClose: () => void }) {
  const selfId = useAtomValue(signedInAtom)?.userId ?? ''
  const current = useAtomValue(personStatusAtom(selfId)) ?? undefined
  const [emoji, setEmoji] = useState<StatusEmoji | undefined>(current?.emoji)
  const [text, setText] = useState(current?.text ?? '')
  const [clearAfter, setClearAfter] = useState<string>(current?.expiresAt === undefined ? 'today' : KEEP)
  const [picking, setPicking] = useState(false)
  const [openedAt] = useState(() => new Date())

  const picker = useAtomValue(emojiPickerDataAtom(emojiCatalog))
  const data = picker?.data ?? standardEmojiPickerData

  const presets = presetsOf(data)
  const keep = current?.expiresAt
  const options = [...(keep === undefined ? [] : [{ value: KEEP, label: capitalized(statusUntil(keep, openedAt)) }]), ...STATUS_CLEAR_AFTER]
  const { busy, error, run } = useSend(onClose)
  const save = () => {
    const choice = clearAfter === KEEP && keep !== undefined ? { at: keep } : (clearAfter as StatusClearAfter)
    run({ text, emoji: emoji?.name ?? '', clearAfter: choice })
  }

  return (
    <SheetLayer onClose={() => (picking ? setPicking(false) : onClose())}>
      {picking ? (
        <StatusEmojiPicker
          data={data}
          customReady={picker !== undefined}
          onPick={(picked) => {
            setEmoji(picked)
            setPicking(false)
          }}
          onClose={() => setPicking(false)}
        />
      ) : (
        <StatusSheetView
          emoji={emoji}
          text={text}
          maxLength={STATUS_TEXT_MAX}
          presets={presets}
          clearAfterOptions={options}
          clearAfter={clearAfter}
          hasStatus={current !== undefined}
          busy={busy}
          error={error}
          onEmoji={() => setPicking(true)}
          onTextChange={setText}
          onClearField={() => {
            setText('')
            setEmoji(undefined)
          }}
          onPreset={(preset) => {
            setEmoji(preset.emoji)
            setText(preset.text)
            setClearAfter(presets.find((each) => each.text === preset.text)?.value ?? 'today')
          }}
          onClearAfterChange={setClearAfter}
          onSave={save}
          onClearStatus={() => run({ text: '', emoji: '', clearAfter: 'never' })}
          onCancel={onClose}
        />
      )}
    </SheetLayer>
  )
}

/** Slack's presets, their emoji drawn from the picker's data. */
function presetsOf(data: PreparedEmojiPicker): ReadonlyArray<StatusSheetPreset & { readonly value: StatusClearAfter }> {
  return STATUS_PRESETS.map((preset) => {
    const item = data.byName.get(preset.emoji)
    return {
      emoji: { name: preset.emoji, ...(item?.unicode === undefined ? {} : { unicode: item.unicode }), ...(item?.url === undefined ? {} : { url: item.url }) },
      text: preset.text,
      clearAfter: clearAfterLabel(preset.clearAfter),
      value: preset.clearAfter,
    }
  })
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

/** The emoji picker in the sheet's place, custom emoji included, with the frequently used ones first. */
function StatusEmojiPicker({ data, customReady, onPick, onClose }: { readonly data: PreparedEmojiPicker; readonly customReady: boolean; readonly onPick: (emoji: StatusEmoji) => void; readonly onClose: () => void }) {
  const recent = useAtomValue(frequentEmojiAtom)
  const searchReady = useEmojiSearchReady(data.all, searchIndex)
  return (
    <EmojiPicker
      data={data}
      searchReady={searchReady}
      customReady={customReady}
      recent={recent}
      onPick={(name, unicode, url) => onPick({ name, ...(unicode === undefined ? {} : { unicode }), ...(url === undefined ? {} : { url }) })}
      onClose={onClose}
    />
  )
}
