import type { MessageActions } from '../Message'

const noop = () => {}

/** Row actions that do nothing, for fixtures of rows with their own controls. */
export const noopActions: MessageActions = {
  onConfirmDelete: noop,
  onCancelDelete: noop,
}
