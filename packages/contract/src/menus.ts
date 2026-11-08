/**
 * The context-menu item lists the renderer asks main to show (inventory
 * 15), with the Notify me rules behind them. They are `@juno/domain` rules;
 * the renderer reaches them here, as it reaches the domain's schemas.
 */
export {
  channelMenuItems,
  dropViewOrder,
  isViewMenuAction,
  moveViewOrder,
  notifyChoice,
  notifyChoiceLabel,
  notifyChoiceOf,
  personMenuItems,
  REACTIONS_PILL,
  REACTIONS_PILL_PREF,
  splitReactionsPill,
  threadNotifyChoice,
  topicMenuItems,
  viewMenuChoice,
  viewPillMenuItems,
  withReactionsPill,
  type ChannelMenuAction,
  type HuddleMenuItem,
  type LeaveMenuItem,
  type ViewChoice,
  type ViewMenuAction,
  type ViewPillAction,
  type MenuItem,
  type NotifyAction,
  type NotifyChoice,
  type TopicMenuAction,
} from '@juno/domain'
