/**
 * Windows' stand-ins for the Dock: the unread dot over the taskbar button,
 * and the icon in the notification area (the tray) that keeps Juno running
 * after its window closes, as chat apps do on Windows. Closing the window
 * hides it (`index.ts`); the tray's Open brings it back and Quit quits.
 * Nothing here runs on the Mac.
 */
import { app, Menu, nativeImage, Tray, type BrowserWindow, type NativeImage } from 'electron'
import { join } from 'node:path'

/**
 * Windows takes toasts only from an app with an AppUserModelID, and shows
 * that app's name and icon on them. It must equal electron-builder's
 * `appId`, which the installer gives the Start menu shortcut.
 */
export const APP_USER_MODEL_ID = 'app.juno.desktop'

/** The overlay icon is 16 by 16; drawn at twice that for high-DPI screens. */
const DOT_PIXELS = 32
/** Red, as Windows' own unread badges, with a white ring that keeps it apart from the app icon under it. */
const DOT_FILL = [0x2b, 0x3a, 0xd9] as const // BGR of #d93a2b
const DOT_RING = [0xff, 0xff, 0xff] as const

/** A filled circle with a ring, antialiased, as BGRA pixels. */
function drawDot(): NativeImage {
  const pixels = Buffer.alloc(DOT_PIXELS * DOT_PIXELS * 4)
  const centre = DOT_PIXELS / 2
  const outer = DOT_PIXELS / 2 - 1
  const inner = outer - 3
  for (let y = 0; y < DOT_PIXELS; y++) {
    for (let x = 0; x < DOT_PIXELS; x++) {
      const distance = Math.hypot(x + 0.5 - centre, y + 0.5 - centre)
      const coverage = Math.min(1, Math.max(0, outer + 0.5 - distance))
      if (coverage === 0) continue
      const fill = Math.min(1, Math.max(0, inner + 0.5 - distance))
      const offset = (y * DOT_PIXELS + x) * 4
      for (let channel = 0; channel < 3; channel++) {
        // Premultiplied, as Skia's BGRA bitmaps are.
        pixels[offset + channel] = Math.round((DOT_FILL[channel]! * fill + DOT_RING[channel]! * (1 - fill)) * coverage)
      }
      pixels[offset + 3] = Math.round(255 * coverage)
    }
  }
  return nativeImage.createFromBitmap(pixels, { width: DOT_PIXELS, height: DOT_PIXELS, scaleFactor: 2 })
}

let dot: NativeImage | undefined

/** The unread dot over the window's taskbar button while `text` (the Dock badge's) is not empty. */
export function showUnreadOverlay(window: BrowserWindow | undefined, text: string): void {
  if (window === undefined || window.isDestroyed()) return
  if (text === '') window.setOverlayIcon(null, '')
  else window.setOverlayIcon((dot ??= drawDot()), 'Unread messages')
}

/** The packaged app's own icon, from its executable; Electron's would show in development, so the build's icon there. */
async function trayIcon(): Promise<NativeImage> {
  if (app.isPackaged) return app.getFileIcon(process.execPath, { size: 'normal' })
  return nativeImage.createFromPath(join(__dirname, '../../build/icon.png')).resize({ width: 32, height: 32, quality: 'best' })
}

/** The tray icon: a click opens the window, and its menu has Open and Quit. */
export async function createTray(open: () => void): Promise<Tray> {
  const tray = new Tray(await trayIcon())
  tray.setToolTip(app.name)
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: `Open ${app.name}`, click: open },
    { type: 'separator' },
    { role: 'quit', label: `Quit ${app.name}` },
  ]))
  tray.on('click', open)
  return tray
}
