/**
 * Which keys and words the page uses: the Mac's (⌘, "this Mac") or
 * Windows' (Ctrl, "this PC"). Main puts `?platform=<process.platform>` in
 * the page's address, so this is known before the first render. Linux runs
 * only in tests, which drive the Mac's keys, so everything but Windows is
 * Mac. The gallery shows a component's Windows look with `?platform=win32`.
 *
 * The platform branches for keys and words live here, so views and
 * containers ask one question ("is the command key held?", "what is this
 * shortcut's label?", "what is this computer called?") and never test the
 * platform themselves.
 */
export type KeyPlatform = 'mac' | 'windows'

function read(): KeyPlatform {
  const search = (globalThis as { readonly location?: { readonly search: string } }).location?.search ?? ''
  return /[?&]platform=win32(&|$)/.test(search) ? 'windows' : 'mac'
}

export const keyPlatform: KeyPlatform = read()
export const isWindows = keyPlatform === 'windows'

interface Modifiers {
  readonly metaKey: boolean
  readonly ctrlKey: boolean
}

/**
 * The command key is held: ⌘ on the Mac, Ctrl on Windows. It opens a
 * click in a new tab and leads the page's own shortcuts (⌘↵, ⌘2).
 */
export const commandKey = (event: Modifiers): boolean => (isWindows ? event.ctrlKey : event.metaKey)

/** The modifier that is not the command key is held: Ctrl on the Mac, the Windows key on Windows. */
export const otherCommandKey = (event: Modifiers): boolean => (isWindows ? event.metaKey : event.ctrlKey)

/** A Ctrl-press is a right click on the Mac, so pointer handlers leave it to the context menu. On Windows it is a plain press with the command key. */
export const contextClick = (event: { readonly ctrlKey: boolean }): boolean => !isWindows && event.ctrlKey

const macGlyphs: Record<string, string> = {
  CommandOrControl: '⌘',
  CmdOrCtrl: '⌘',
  Command: '⌘',
  Control: '⌃',
  Alt: '⌥',
  Option: '⌥',
  Shift: '⇧',
  Plus: '+',
  Enter: '↵',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
}
const windowsWords: Record<string, string> = {
  CommandOrControl: 'Ctrl',
  CmdOrCtrl: 'Ctrl',
  Command: 'Ctrl',
  Control: 'Ctrl',
  Option: 'Alt',
  Plus: '+',
}
// Each platform writes the modifiers in its own order, whatever order the accelerator uses.
const macOrder = ['⌃', '⌥', '⇧', '⌘']
const windowsOrder = ['Ctrl', 'Alt', 'Shift']

/** An accelerator as `platform` writes it: "Control+Command+S" is "⌃⌘S" on the Mac; "CommandOrControl+Shift+F" is "Ctrl+Shift+F" on Windows. */
export function shortcutLabel(accelerator: string, platform: KeyPlatform): string {
  const mac = platform === 'mac'
  const names = mac ? macGlyphs : windowsWords
  const order = mac ? macOrder : windowsOrder
  const parts = accelerator.split('+').map((part) => names[part] ?? part)
  const key = parts.at(-1) ?? ''
  const modifiers = parts.slice(0, -1).toSorted((a, b) => order.indexOf(a) - order.indexOf(b))
  return mac ? [...modifiers, key].join('') : [...modifiers, key].join('+')
}

/** An accelerator as this platform writes it ("⌘K" or "Ctrl+K"). */
export const shortcutKeys = (accelerator: string): string => shortcutLabel(accelerator, keyPlatform)

/** A shortcut label as keycaps: "⌃⌘S" is ⌃, ⌘, S; "Ctrl+Shift+S" is Ctrl, Shift, S. */
export function keycaps(keys: string): ReadonlyArray<string> {
  if (/^(Ctrl|Alt|Shift)\+/.test(keys)) {
    const parts = keys.split('+')
    // "Ctrl++" ends in the plus key itself.
    return parts.at(-1) === '' ? [...parts.slice(0, -2), '+'] : parts
  }
  const caps: string[] = []
  let rest = keys
  while (rest.length > 0 && macModifiers.has(rest[0]!)) {
    caps.push(rest[0]!)
    rest = rest.slice(1)
  }
  if (rest.length > 0) caps.push(rest)
  return caps
}
const macModifiers = new Set(macOrder)

/**
 * The names of this computer and its parts, for copy that names them
 * (decision D4): the Mac keeps its words, Windows gets its own.
 */
export const systemWords =
  keyPlatform === 'windows'
    ? {
        /** "Juno runs on one PC at a time." */
        computer: 'PC',
        thisComputer: 'this PC',
        ThisComputer: 'This PC',
        system: 'Windows',
        systemSettings: 'Windows Settings',
        fileManager: 'File Explorer',
        Dock: 'Taskbar',
        /** Where Juno keeps keys: "Keys stay encrypted on this PC". */
        keyStore: 'encrypted on this PC',
        /** "Juno could not reach the keychain." */
        keyStoreName: 'Windows’ secure storage',
        /** The Option key as a setting names it. */
        optionKey: 'Alt',
        /** The Option key in a sentence: "Hold ⌥ over a topic". */
        optionGlyph: 'Alt',
        /** A click with the command key, in a sentence: "⌘-click a topic". */
        commandClick: 'Ctrl+click',
      }
    : {
        computer: 'Mac',
        thisComputer: 'this Mac',
        ThisComputer: 'This Mac',
        system: 'macOS',
        systemSettings: 'System Settings',
        fileManager: 'Finder',
        Dock: 'Dock',
        keyStore: 'in your keychain',
        keyStoreName: 'the keychain',
        optionKey: '⌥ Option',
        optionGlyph: '⌥',
        commandClick: '⌘-click',
      }

/** A context menu's key as this platform writes it: the Mac's ⌫ is Del on Windows, where the menu takes Delete and Backspace alike. */
export const menuKeyLabel = (key: string): string => (keyPlatform === 'windows' && key === '⌫' ? 'Del' : key)

/** The command key's name in `aria-keyshortcuts` and Playwright: Meta on the Mac, Control on Windows. */
export const commandKeyName = keyPlatform === 'windows' ? 'Control' : 'Meta'
