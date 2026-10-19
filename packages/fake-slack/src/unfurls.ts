import type { Attachment } from '@juno/slack-schema'

/** Invented link previews, and a shared Slack message; every image is served by the fake. */
export function unfurlFixtures(base: string): Readonly<Record<'xImage' | 'xText' | 'failed' | 'youtube' | 'github' | 'docs' | 'generic' | 'shared', Attachment>> {
  const image = `${base}/avatars/U0MAYA.svg`
  const post = { service_name: 'X', service_icon: image, author_name: 'Avery Example (@avery_example)', author_icon: image, title: 'Avery Example on X', from_url: 'https://example.test/post/1', text: 'Small experiments make the next decision clearer.', footer: 'X', ts: 1792141200 }
  return {
    xImage: { ...post, image_url: image, image_width: 600, image_height: 400 },
    xText: { ...post, text: 'A text-only update from the test workspace.' },
    failed: { title: 'Unavailable preview image', text: 'The description remains readable.', image_url: `${base}/avatars/missing.svg`, image_width: 1200, image_height: 630, service_name: 'Example' },
    youtube: { service_name: 'YouTube', service_icon: image, author_name: 'Example Studio', title: 'How the demo works', title_link: 'https://example.test/watch/demo', text: 'A short tour of the prototype.', thumb_url: image, image_width: 640, image_height: 360 },
    github: { service_name: 'GitHub', title: 'sample/project', text: 'A small demonstration project.', from_url: 'https://example.test/sample/project', thumb_url: image },
    docs: { service_name: 'Google Docs', title: 'Planning notes', text: 'Decisions for the next iteration.', from_url: 'https://example.test/document/1', service_icon: image },
    // As Slack sends a shared message: its words as rich text in `message_blocks`, again as mrkdwn `text`, and in `fallback`.
    shared: {
      is_msg_unfurl: true, author_name: 'Maya', author_icon: image, from_url: `${base}/archives/C0ENG/p1792141200000100`, ts: '1792141200.000100',
      footer: 'Thread in Slack conversation', fallback: '[October 16th, 2026 10:30 AM] Maya: Shared words appear once.', text: 'Shared words appear once.', mrkdwn_in: ['text'],
      message_blocks: [{ message: { blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text: 'Shared words appear once.' }] }] }] } }],
    },
    generic: { service_name: 'Example Journal', title: 'A useful observation', text: 'The summary supplied by the page.', from_url: 'https://example.test/article/1', image_url: image, image_width: 800, image_height: 420 },
  }
}

/**
 * `message`, from `channel`, shared into another conversation, as Slack sends
 * it: `is_share`, the source's `channel_id`, its permalink in `from_url` (with
 * `thread_ts` for a reply), the generic footer Slack was seen to send
 * (research, integration-shapes), and its words as rich text and as `text`.
 * `base` is the workspace URL.
 */
export function sharedMessage(base: string, channel: string, message: { readonly ts: string; readonly text?: string | undefined; readonly thread_ts?: string | undefined; readonly user?: string | undefined }, author: string): Attachment {
  const reply = message.thread_ts !== undefined && message.thread_ts !== message.ts
  const text = message.text ?? ''
  return {
    is_share: true, is_msg_unfurl: true, channel_id: channel,
    author_name: author, ...(message.user === undefined ? {} : { author_icon: `${base}/avatars/${message.user}.svg` }),
    from_url: `${base}/archives/${channel}/p${message.ts.replace('.', '')}${reply ? `?thread_ts=${message.thread_ts}&cid=${channel}` : ''}`,
    ts: message.ts, footer: 'Thread in Slack conversation',
    fallback: `${author}: ${text}`, text, mrkdwn_in: ['text'],
    message_blocks: [{ message: { blocks: [{ type: 'rich_text', elements: [{ type: 'rich_text_section', elements: [{ type: 'text', text }] }] }] } }],
  }
}
