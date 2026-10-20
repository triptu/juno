import { useRef } from 'react'
import { markupLayout } from '@juno/contract'
import { InlineEdit, type InlineEditProps } from '@juno/views'
import { useEmojiSuggestions } from './emojiSuggestions'
import { formatKey } from './formatKeys'

/** The inline edit field with the composer's `:emoji:` suggestions, markup and formatting keys (SPEC 8). */
export function EditField({ value, onChange, onSave, onCancel }: Pick<InlineEditProps, 'value' | 'onSave' | 'onCancel'> & { readonly onChange: (value: string) => void }) {
  const field = useRef<HTMLTextAreaElement>(null)
  const emoji = useEmojiSuggestions({ text: value, onChange, field })
  return (
    <InlineEdit
      value={value}
      onChange={emoji.onChange}
      onSave={onSave}
      onCancel={onCancel}
      fieldRef={field}
      onFieldKey={(event) => formatKey(event) || emoji.onFieldKey(event)}
      format={markupLayout(value)}
      onCaret={emoji.onCaret}
      {...(emoji.mention === undefined ? {} : { mention: emoji.mention })}
    />
  )
}
