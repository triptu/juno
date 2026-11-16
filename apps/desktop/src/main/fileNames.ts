import { parse } from 'node:path'

/** Names Windows keeps for devices, with any extension: "con.txt" cannot be a file either. */
const RESERVED_NAMES = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(\.|$)/i

/**
 * `name` as a file name this system accepts. Windows also refuses `<>"|?*`
 * and control characters, a name ending in a dot or a space, and the device
 * names; a reserved name gets a leading underscore.
 */
export function safeFileName(name: string, windows = process.platform === 'win32'): string {
  if (!windows) return parse(name.replace(/[/\\:]/g, '-')).base.replace(/^\.+/, '') || 'download'
  const replaced = name.replace(/[/\\:<>"|?*\p{Cc}]/gu, '-').replace(/^\.+/, '').replace(/[. ]+$/, '')
  return RESERVED_NAMES.test(replaced) ? `_${replaced}` : replaced || 'download'
}
