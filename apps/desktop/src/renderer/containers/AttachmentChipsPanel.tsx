/**
 * The composer's file chips. Loaded on their own (`lazy` in
 * `attachments.tsx`), so they are not in the first bundle; the chunk is
 * fetched once a composer has painted, before the first file is attached.
 */
import { AttachmentChips, type AttachmentChipsProps } from '@juno/views'

export default function AttachmentChipsPanel(props: AttachmentChipsProps) {
  return <AttachmentChips {...props} />
}
