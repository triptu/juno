/**
 * The open channel sheet's actions (SPEC 5, "Channel sheet"): Save, and the
 * words for what Slack said. Only `ChannelSheet.tsx` imports this, so it
 * loads with the sheet's chunk and not at start.
 */
import { channelsEdit, type ChannelEdited, type ChannelMemberIssue } from '@juno/contract'
import { errorOf, offerUndo, registry, runCommand, showToast } from '@juno/state'
import { closeChannelSheet, editChannel } from './channelActions'

/** Slack's answer to a create or a rename, in plain words. */
export function channelErrorText(code: string): string {
  switch (code) {
    case 'name_taken':
      return 'That name is taken.'
    case 'invalid_name_required':
      return 'Give it a name.'
    case 'invalid_name_maxlength':
      return 'Use 80 characters or fewer.'
    case 'invalid_name':
    case 'invalid_name_specials':
    case 'invalid_name_punctuation':
    case 'invalid_emoji_not_allowed':
      return 'Use lowercase letters, numbers, hyphens and underscores.'
    case 'restricted_action':
    case 'not_authorized':
      return 'Slack doesn’t allow that in this workspace.'
    case 'offline':
      return 'Couldn’t reach Slack. Try again.'
    case 'ratelimited':
      return 'Slack is busy. Try again in a moment.'
    case 'not_authed':
      return 'You’re signed out of Slack.'
    default:
      return `Slack refused it: ${code}.`
  }
}

/** "Maya Chen", "Maya Chen and Leo Park", "Maya Chen and 2 others". */
function peopleText(issues: ReadonlyArray<ChannelMemberIssue>): string {
  const [first, second] = issues
  if (first === undefined) return ''
  if (second === undefined) return first.person.name
  return issues.length === 2 ? `${first.person.name} and ${second.person.name}` : `${first.person.name} and ${issues.length - 1} others`
}

/** The toast after a create: who could not be added, when someone could not. */
export function createdText(name: string, notAdded: ReadonlyArray<ChannelMemberIssue>): string {
  return notAdded.length === 0 ? `Created #${name}` : `Created #${name}. Couldn’t add ${peopleText(notAdded)}.`
}

function editedText(before: string, result: ChannelEdited): string {
  const parts = [result.renameRefused === undefined ? `Saved #${result.name}` : `Couldn’t rename #${before}. ${channelErrorText(result.renameRefused)}`]
  if (result.notAdded.length > 0) parts.push(`Couldn’t add ${peopleText(result.notAdded)}.`)
  if (result.notRemoved.length > 0) parts.push(`Couldn’t remove ${peopleText(result.notRemoved)}.`)
  return parts.join(' ').replace(/^Saved #([^ ]+) Couldn/, 'Saved #$1. Couldn')
}

/** Save in the edit sheet: closes it, applies the changes, then says what Slack did, with Undo when something changed. */
export async function saveChannel(channel: { readonly id: string; readonly name: string }, change: { readonly name: string; readonly add: ReadonlyArray<string>; readonly remove: ReadonlyArray<string> }): Promise<void> {
  closeChannelSheet()
  if (change.name === channel.name && change.add.length === 0 && change.remove.length === 0) return
  const exit = await runCommand(registry, channelsEdit, { channel: channel.id, name: change.name, add: change.add, remove: change.remove })
  if (exit._tag === 'Failure') {
    const error = errorOf(exit)
    const code = error === undefined ? 'offline' : error._tag === 'Rejected' ? error.code : error._tag === 'RateLimited' ? 'ratelimited' : error._tag === 'NotSignedIn' ? 'not_authed' : 'offline'
    showToast(registry, { text: `Couldn’t save #${channel.name}. ${channelErrorText(code)}` })
    return
  }
  const result = exit.value
  const text = editedText(channel.name, result)
  if (result.undo !== undefined) offerUndo(registry, result.undo, { text })
  else showToast(registry, result.renameRefused === undefined ? { text } : { text, action: { label: 'Edit', onAction: () => void editChannel(channel) } })
}
