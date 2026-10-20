import { useRef } from 'react'
import type { MessageBody } from '@juno/contract'
import { editAtomic } from './editAtomic'
import { InlineEdit, type InlineEditProps } from '@juno/views'
import { useEmojiSuggestions } from './emojiSuggestions'
import { useComposerMarkup } from './composerMarkup'

/** The inline edit field with the composer's `:emoji:` suggestions, markup and formatting keys (SPEC 8). */
export function EditField({ value, onChange, onSave, onCancel, body }: Pick<InlineEditProps, 'value' | 'onSave' | 'onCancel'> & { readonly onChange: (value: string) => void; readonly body: MessageBody | undefined }) {
  const field = useRef<HTMLTextAreaElement>(null)
  const emoji = useEmojiSuggestions({ text: value, onChange, field })
  const markup = useComposerMarkup(true)
  const atomic = editAtomic(value, body)
  return (
    <InlineEdit
      value={value}
      onChange={emoji.onChange}
      onSave={onSave}
      onCancel={onCancel}
      fieldRef={field}
      onFieldKey={(event) => markup.onKey(event, atomic) || emoji.onFieldKey(event)}
      {...markup.format(value, atomic)}
      onCaret={emoji.onCaret}
      {...(emoji.mention === undefined ? {} : { mention: emoji.mention })}
    />
  )
}
