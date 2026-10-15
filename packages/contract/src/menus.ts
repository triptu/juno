/**
 * The context-menu item lists the renderer asks main to show (inventory
 * 15), with the Notify me rules behind them. They are `@juno/domain` rules;
 * the renderer reaches them here, as it reaches the domain's schemas.
 */
export {
  channelMenuItems,
  followsThread,
  notifyChoiceOf,
  personMenuItems,
  threadNotifyChoice,
  topicMenuItems,
  type ChannelMenuAction,
  type ChannelMenuState,
  type MenuItem,
  type NotifyAction,
  type NotifyChoice,
  type PersonMenuAction,
  type PersonMenuState,
  type TopicMenuAction,
  type TopicMenuState,
} from '@juno/domain'
