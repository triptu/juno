/**
 * The preview line of a row (SPEC section 5, "Row anatomy"): the latest
 * message's text, or a short label when it has none, and who wrote it. The
 * sidebar and All topics show the same line, so a conversation reads the
 * same in both.
 */
import { bodyFromMrkdwn, messageBody, previewText, readableText, type Lookups, type MessageContent } from '@juno/richtext'
import type { Attachment, File } from '@juno/slack-schema'
import { firstName, type ConversationKind } from './channel'
import { fileMediaKind } from './files'

/** A message as the preview reads it. */
export interface PreviewMessage extends MessageContent {
  readonly subtype?: string
}

/**
 * The text a row shows for a message. The message's own words when it has
 * any (quote lines dropped); otherwise a label for what it carries: its
 * files, a shared message, a link, a bot's attachment or a huddle. Never
 * empty.
 */
export function messagePreviewText(message: PreviewMessage, lookups: Lookups = {}): string {
  const link = bareLink(message.text)
  if (link !== undefined) return `Link: ${link}`
  const body = messageBody({ text: message.text, blocks: message.blocks }, lookups)
  const text = previewText(body)
  if (text !== '') return text
  const files = (message.files ?? []).filter((file) => file.id !== '')
  if (files.length > 0) return filesLabel(files)
  for (const attachment of message.attachments ?? []) {
    const label = attachmentLabel(attachment, lookups)
    if (label !== '') return label
  }
  if (message.subtype === 'huddle_thread') return 'Huddle'
  // Only a quote: show what it quotes rather than nothing.
  const quoted = oneLine(readableText(body).replace(/^> ?/gm, ''))
  if (quoted !== '') return quoted
  return 'Message'
}

/**
 * A label for a message's files: "Image", "3 images", "Video", "Voice clip",
 * "Snippet: name", "Canvas: name", "File: report.pdf", or "3 files" for a mix.
 */
export function filesLabel(files: ReadonlyArray<File>): string {
  const kinds = files.map(fileKind)
  const first = kinds[0]
  if (first === undefined) return ''
  const same = kinds.every((kind) => kind === first)
  if (files.length > 1) {
    if (same && first === 'image') return `${files.length} images`
    if (same && first === 'video') return `${files.length} videos`
    return `${files.length} files`
  }
  const file = files[0]!
  const name = file.title || file.name || ''
  switch (first) {
    case 'image':
      return 'Image'
    case 'video':
      return 'Video'
    case 'voice':
      return 'Voice clip'
    case 'deleted':
      return 'Deleted file'
    case 'snippet':
      return name === '' ? 'Snippet' : `Snippet: ${name}`
    case 'canvas':
      return name === '' ? 'Canvas' : `Canvas: ${name}`
    case 'file':
      return name === '' ? 'File' : `File: ${name}`
  }
}

type FileKind = 'image' | 'video' | 'voice' | 'snippet' | 'canvas' | 'deleted' | 'file'

function fileKind(file: File): FileKind {
  if (file.mode === 'tombstone' || file.file_access === 'file_not_found') return 'deleted'
  if (file.subtype === 'slack_audio') return 'voice'
  if (file.subtype === 'slack_video') return 'video'
  if (file.mode === 'snippet') return 'snippet'
  if (file.filetype === 'quip' || file.filetype === 'canvas') return 'canvas'
  const kind = fileMediaKind(file)
  return kind === 'image' || kind === 'video' ? kind : 'file'
}

/**
 * A shared message's words or files, a bot attachment's title or text, or a
 * link's domain. Slack's `fallback` ("[date] name: file") only when there is
 * nothing else.
 */
function attachmentLabel(attachment: Attachment, lookups: Lookups): string {
  const shared = attachment.is_msg_unfurl === true || attachment.is_share === true || attachment.message_blocks !== undefined
  const mrkdwn = (part: string | undefined) => (part === undefined ? '' : previewText(bodyFromMrkdwn(part, lookups)))
  const files = (attachment.files ?? []).filter((file) => file.id !== '')
  const words = oneLine([attachment.title, attachment.text, attachment.pretext].map(mrkdwn).find((part) => part !== '') || filesLabel(files) || mrkdwn(attachment.fallback))
  if (shared) return words === '' ? 'Shared message' : `Shared message: ${words}`
  if (words !== '') return words
  const url = attachment.from_url ?? attachment.original_url ?? attachment.title_link
  const domain = url === undefined ? undefined : domainOf(url)
  return domain === undefined ? '' : `Link: ${domain}`
}

/** The domain when the whole text is one link with no label of its own. */
function bareLink(text: string | undefined): string | undefined {
  const match = /^<(https?:\/\/[^|>\s]+)>$/.exec(text?.trim() ?? '')
  return match === null ? undefined : domainOf(match[1]!)
}

function domainOf(url: string): string | undefined {
  const host = /^[a-z][a-z0-9+.-]*:\/\/(?:[^@/?#]*@)?([^/?#:]+)/i.exec(url)?.[1]
  return host === undefined ? undefined : host.toLowerCase().replace(/^www\./, '')
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/** A person as the preview names them: the name the app shows, and the full name for a last initial. */
export interface PreviewPerson {
  readonly id: string
  readonly name: string
  readonly realName?: string
}

/**
 * The name before the colon, or '' for none. Your own messages read "You".
 * In a one-to-one DM the other side's messages have no name: the row already
 * names them. Everywhere else a person is their first name, with their last
 * initial when another person in `others` has the same first name ("Alex K").
 * A bot or an app keeps its whole name.
 */
export function previewSender(input: {
  readonly kind: ConversationKind | undefined
  readonly mine: boolean
  /** The person who wrote it; undefined for a bot or an app, named by `botName`. */
  readonly person?: PreviewPerson
  readonly botName?: string
  /** Other people in the conversation, to tell two people with one first name apart. */
  readonly others?: ReadonlyArray<PreviewPerson>
}): string {
  if (input.mine) return 'You'
  if (input.kind === 'im') return ''
  if (input.person === undefined) return input.botName ?? ''
  return shortName(input.person, input.others ?? [])
}

/** "Maya", or "Maya C" when someone else in `others` is also called Maya. */
export function shortName(person: PreviewPerson, others: ReadonlyArray<PreviewPerson>): string {
  const first = firstName(person.name)
  // "🦄 Unicorn" stays whole: a first word with no letter in it is not a name.
  if (!/\p{L}/u.test(first)) return person.name.trim()
  if (!others.some((other) => other.id !== person.id && sameFirstName(other, first))) return first
  const initial = lastInitial(person)
  return initial === undefined ? person.name.trim() : `${first} ${initial}`
}

/** The ids in `others` with the same first name as `person`, for a later `shortName`. */
export function namesakes(person: PreviewPerson, others: ReadonlyArray<PreviewPerson>): ReadonlyArray<string> {
  const first = firstName(person.name)
  return others.filter((other) => other.id !== person.id && sameFirstName(other, first)).map((other) => other.id)
}

function sameFirstName(person: PreviewPerson, first: string): boolean {
  return first !== '' && firstName(person.name).toLocaleLowerCase() === first.toLocaleLowerCase()
}

/** The first letter of the last word of the full name, or of the shown name; undefined for a one-word name. */
function lastInitial(person: PreviewPerson): string | undefined {
  for (const name of [person.realName, person.name]) {
    const words = name?.trim().split(/\s+/) ?? []
    const last = words.length > 1 ? words[words.length - 1] : undefined
    const letter = last === undefined ? undefined : [...last][0]
    if (letter !== undefined) return letter.toLocaleUpperCase()
  }
  return undefined
}
