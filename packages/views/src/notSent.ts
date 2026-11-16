/**
 * The toast for a send Slack or the engine refused before anything was
 * queued (SPEC 12, "Sending to a person or channel"; 17). It starts as a
 * failed row does, "Not sent", and says why in plain words.
 */
import type { SendError } from '@juno/contract'
import { systemWords } from '@juno/ui'

/** Slack's refusals a send can meet, in plain words. Any other code is shown as Slack gave it. */
const REFUSALS: Record<string, string> = {
  user_disabled: 'Their account is deactivated',
  user_not_found: 'Slack cannot find that person',
  user_not_visible: 'Slack cannot find that person',
  cannot_dm_bot: 'Slack does not allow messages to this app',
  channel_not_found: 'Slack cannot find that conversation',
  not_in_channel: 'You are not in that channel',
  is_archived: 'The channel is archived',
  restricted_action: 'Your workspace does not allow it',
  msg_too_long: 'The message is too long',
  too_many_files: 'Too many files for one message',
  file_not_found: 'A file is not ready',
  file_not_found_on_device: `A file is no longer on ${systemWords.thisComputer}`,
}

/** Why a send was refused, as a toast says it. */
function notSentReason(error: SendError | undefined): string {
  switch (error?._tag) {
    case 'Offline':
      return 'You are offline'
    case 'RateLimited':
      return 'Slack is busy. Try again shortly'
    case 'NotSignedIn':
      return 'You are signed out'
    case 'NotFound':
      return 'Slack cannot find that conversation'
    case 'Rejected':
      return REFUSALS[error.code] ?? `Slack refused it: ${error.code}`
    case undefined:
      return 'Something went wrong. Try again'
  }
}

/** "Not sent · Their account is deactivated". The draft and its destination stay on screen, so the toast keeps its room for the reason. */
export const notSentText = (error: SendError | undefined): string => `Not sent · ${notSentReason(error)}`
