/**
 * A draft from Slack as the composer stores drafts (research
 * `slack-drafts.md`): its `rich_text` written as markup, with people,
 * user groups and channels encoded as the composer picks them
 * (`<@U…|Maya>`, `<!subteam^S…|@design-team>`, `<#C…|eng>`) and linked
 * words as `<url|words>`, so the field shows them as picks and links and
 * `composeOutgoing` sends them back by id. The rest reads as in the edit
 * field (`editMarkup`).
 */
import type { Block, RichTextInline } from '@juno/slack-schema'
import type { Lookups } from './model'
import { elementMarkup, fieldText } from './edit-markup'
import { UNKNOWN_USERGROUP } from './inline'

/** Slack's encoding has no escape for "|" or ">" in a URL, nor for "|" in a name (`encodeDraft` in `@juno/domain`). */
const url = (value: string) => value.replace(/\|/g, '%7C').replace(/>/g, '%3E').replace(/\s/g, '%20')
const name = (value: string) => value.replace(/[|>]/g, '')
const words = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function draftText(element: RichTextInline, lookups: Lookups): string {
  switch (element.type) {
    case 'user':
      return `<@${element.user_id}|${name(lookups.user?.(element.user_id) ?? element.user_id)}>`
    case 'channel':
      return `<#${element.channel_id}|${name(lookups.channel?.(element.channel_id) ?? element.channel_id)}>`
    case 'usergroup':
      return `<!subteam^${element.usergroup_id}|@${name(lookups.usergroup?.(element.usergroup_id)?.handle ?? UNKNOWN_USERGROUP)}>`
    case 'link':
      return element.text === undefined || element.text === '' || element.text === element.url ? element.url : `<${url(element.url)}|${words(element.text)}>`
    default:
      return fieldText(element, lookups)
  }
}

/** The draft text for Slack's `blocks`; `''` when they hold no `rich_text`. Other blocks are left out. */
export function draftMarkup(blocks: ReadonlyArray<Block>, lookups: Lookups = {}): string {
  return blocks
    .flatMap((block) => (block.type === 'rich_text' ? block.elements : []))
    .flatMap((element) => elementMarkup(element, lookups, draftText) ?? [])
    .join('\n')
}
