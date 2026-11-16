import { menuAccelerator, type menuShortcuts } from '@juno/contract/channels'
import { keyPlatform, shortcutKeys } from '@juno/ui'

/** The keys of an app-menu command as this platform writes them: "⌘[" on the Mac, "Ctrl+[" on Windows. */
export const menuKeys = (command: keyof typeof menuShortcuts): string => shortcutKeys(menuAccelerator(command, keyPlatform))
