import type { MessageActions } from '../Message'

const noop = () => {}

/** Hover toolbar actions that do nothing, for fixtures that show the toolbar. */
export const noopActions: MessageActions = {
  onReact: noop,
  onMoreReactions: noop,
  onQuote: noop,
  onReply: noop,
  onMore: noop,
  onConfirmDelete: noop,
  onCancelDelete: noop,
}
