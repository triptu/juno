/** Workspace emoji use the same authenticated image handler as Slack thumbnails. */
export const emojiImageUrl = (url: string): string =>
  url.startsWith('juno:') || url.startsWith('data:') ? url : `juno://files/emoji?url=${encodeURIComponent(url)}`
