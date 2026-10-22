import { useRef, useState } from 'react'
import { encodeDraft, type MessageBody } from '@juno/contract'
import { editAtomic, editLinks } from './editAtomic'
import { InlineEdit, type InlineEditProps } from '@juno/views'
import { useEmojiSuggestions } from './emojiSuggestions'
import { useComposerMarkup } from './composerMarkup'
import { useComposerLinks } from './composerLinks'

/** The inline edit field with the composer's `:emoji:` suggestions, markup and formatting keys (SPEC 8). */
export function EditField({ value, onChange, onSave, onCancel, body }: Pick<InlineEditProps, 'value' | 'onCancel'> & { readonly onChange: (value: string) => void; readonly onSave: (encoded: string) => void; readonly body: MessageBody | undefined }) {
  const field = useRef<HTMLTextAreaElement>(null)
  const emoji = useEmojiSuggestions({ text: value, onChange, field })
  const markup = useComposerMarkup(true)
  const [initialLinks] = useState(() => editLinks(value, body))
  const links = useComposerLinks({ field, initialText: value, initial: initialLinks, onChange })
  const linkMarks = links.shown(value, []).map((link) => ({ start: link.start, end: link.end, look: 'link' as const }))
  const atomic = [...editAtomic(value, body), ...linkMarks]
  return (
    <InlineEdit
      value={value}
      onChange={(next, caret) => {
        links.moved(next)
        emoji.onChange(next, caret)
      }}
      onSave={() => onSave(encodeDraft(value, [], links.current()))}
      onCancel={onCancel}
      fieldRef={field}
      onFieldKey={(event) => markup.onKey(event, atomic) || emoji.onFieldKey(event)}
      {...markup.format(value, atomic)}
      marks={linkMarks}
      onPasteText={links.onPasteText}
      onCaret={emoji.onCaret}
      {...(emoji.mention === undefined ? {} : { mention: emoji.mention })}
    />
  )
}
