import { useRef } from 'react'
import { InlineEdit, type InlineEditProps } from '@juno/views'
import { useEmojiSuggestions } from './emojiSuggestions'
import { useComposerMarkup } from './composerMarkup'

/** The inline edit field with the composer's `:emoji:` suggestions, markup and formatting keys (SPEC 8). */
export function EditField({ value, onChange, onSave, onCancel }: Pick<InlineEditProps, 'value' | 'onSave' | 'onCancel'> & { readonly onChange: (value: string) => void }) {
  const field = useRef<HTMLTextAreaElement>(null)
  const emoji = useEmojiSuggestions({ text: value, onChange, field })
  const markup = useComposerMarkup(true)
  return (
    <InlineEdit
      value={value}
      onChange={emoji.onChange}
      onSave={onSave}
      onCancel={onCancel}
      fieldRef={field}
      onFieldKey={(event) => markup.onKey(event) || emoji.onFieldKey(event)}
      {...markup.format(value)}
      onCaret={emoji.onCaret}
      {...(emoji.mention === undefined ? {} : { mention: emoji.mention })}
    />
  )
}
