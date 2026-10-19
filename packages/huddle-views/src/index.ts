// The public API grows as callers import it: knip's ratchet fails on an export nobody uses.
// Every view is in src/ with its fixtures; add its export here when a container wires it.
export { HuddleBar, type HuddleBarProps } from './HuddleBar'
export { muteShortcut } from './HuddleControls'
export { HuddleDeviceMenu, systemDevice } from './HuddleDeviceMenu'
export { HuddleHeaderButton } from './HuddleHeaderButton'
export { HuddleIndicator, huddleIndicatorLabel } from './HuddleIndicator'
export { HuddlePage, type HuddlePageState } from './HuddlePage'
export type { HuddleConnection, HuddleControlsActions, HuddleControlsState, HuddlePerson, HuddlePlace } from './model'
