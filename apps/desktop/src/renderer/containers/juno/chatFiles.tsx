import type { ReactNode } from 'react'
import type { ChatMention, JunoFileInput } from '@juno/agent-contract'
import { junoPicksAtom, registry } from '@juno/state'
import { AttachmentNote } from '@juno/views'
import { useAttachments } from '../attachments'
import { chatMentions } from './chatMentions'
import { attachToJuno, leaveComposer, takeForJuno, useJunoFiles } from './junoFiles'

/**
 * The Juno chat composer's files (SPEC 13.1), by the draft's key, so the
 * panel's stay with its topic tab: the attach button, the chips with any
 * line about files that stay, and the send. A send with no Juno files is
 * the plain one, in the same frame; with files it waits for them to be
 * read, which has usually happened since they were attached. An image
 * still being read does not stop a send: one Juno takes is waited for,
 * one that stays (the model reads text only) is left out. The people and
 * channels picked with @ and # go with the text, and the draft's picks clear.
 */
export function useChatFiles(draftKey: string, draft: string, setDraft: (value: string) => void, send: (text: string, files?: ReadonlyArray<JunoFileInput>, mentions?: ReadonlyArray<ChatMention>) => void) {
  const key = `juno:${draftKey}`
  const attachments = useAttachments(key, { take: attachToJuno })
  const juno = useJunoFiles(key, attachments.files, true, 'chat')
  const chips: ReactNode = attachments.chips === undefined || juno.note === undefined ? attachments.chips : <AttachmentNote chips={attachments.chips} note={juno.note} />
  return {
    composer: { leading: attachments.leading, onFiles: attachments.onFiles },
    chips,
    hasFiles: juno.hasFiles,
    send: () => {
      const text = draft.trim()
      const mentions = chatMentions(text, registry.get(junoPicksAtom(draftKey)))
      if (!juno.hasFiles) {
        if (text === '') return
        setDraft('')
        registry.set(junoPicksAtom(draftKey), [])
        send(text, [], mentions)
        return
      }
      setDraft('')
      registry.set(junoPicksAtom(draftKey), [])
      void takeForJuno(key, juno.readsImages).then(({ files, ids }) => {
        if (text === '' && files.length === 0) return
        send(text, files, mentions)
        leaveComposer(key, ids)
      })
    },
  }
}
