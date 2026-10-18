// The public API grows as callers import it: knip's ratchet fails on an export nobody uses.
// Every view is in src/ with its fixtures; add its export here when a container wires it.
export { HuddleBar, type HuddleBarProps } from './HuddleBar'
export { HuddleDeviceMenu } from './HuddleDeviceMenu'
export type { HuddlePerson } from './model'
