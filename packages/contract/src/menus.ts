/**
 * The context-menu item lists the renderer asks main to show (inventory
 * 15), with the Notify me rules behind them. They are `@juno/domain` rules;
 * the renderer reaches them here, as it reaches the domain's schemas.
 */
export {
  followsThread,
  notifyChoiceOf,
  threadNotifyChoice,
  topicMenuItems,
  type MenuItem,
  type NotifyAction,
  type NotifyChoice,
  type TopicMenuAction,
  type TopicMenuState,
} from '@juno/domain'
