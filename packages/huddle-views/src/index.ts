export { HuddleBar, type HuddleBarProps } from './HuddleBar'
export { HuddleControls, muteShortcut, type ControlsShape, type HuddleControlsProps } from './HuddleControls'
export { HuddleDeviceMenu, systemDevice, type HuddleDeviceMenuProps } from './HuddleDeviceMenu'
export { HuddleHeaderButton, type HuddleHeaderButtonProps, type HuddleHeaderMode } from './HuddleHeaderButton'
export { HuddleIndicator, huddleIndicatorLabel, type HuddleIndicatorProps } from './HuddleIndicator'
export {
  HuddlePage,
  type HuddleEndedState,
  type HuddleFailedState,
  type HuddleInState,
  type HuddleOutState,
  type HuddlePageProps,
  type HuddlePageState,
} from './HuddlePage'
export { placeLabel, sharingLine, statusLine } from './look'
export type { HuddleConnection, HuddleControlsActions, HuddleControlsState, HuddleDevice, HuddlePerson, HuddlePlace, HuddlePlaceKind, HuddleShare } from './model'
export { ScreenSourcePicker, type ScreenPermission, type ScreenSource, type ScreenSourcePickerProps } from './ScreenSourcePicker'
/** The huddle tab's glyph, for the tab table (SPEC 6 and 20). */
export { Headphones as HuddleTabIcon } from '@phosphor-icons/react/dist/icons/Headphones'
