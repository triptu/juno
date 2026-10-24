import { cutText, fitImage, JUNO_IMAGE_LIMITS, JUNO_TEXT_LIMITS, JUNO_THUMB_CHARS, JUNO_THUMB_EDGE, junoFileKind, type JunoFileInput } from '@juno/agent-contract'

/** A data URL's or a blob's base64, through the browser's own encoder. */
const dataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)), { once: true })
    reader.addEventListener('error', () => reject(reader.error), { once: true })
    reader.readAsDataURL(blob)
  })

async function encode(bitmap: ImageBitmap, width: number, height: number, type: string, quality: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height)
  const context = canvas.getContext('2d')
  if (context === null) throw new Error('no 2d context')
  // JPEG has no transparency: what was clear becomes white, as a page behind it would be.
  if (type === 'image/jpeg') {
    context.fillStyle = 'white'
    context.fillRect(0, 0, width, height)
  }
  context.imageSmoothingQuality = 'high'
  context.drawImage(bitmap, 0, 0, width, height)
  return canvas.convertToBlob({ type, quality })
}

/** PNG stays PNG (screenshots keep their text sharp), a photo is JPEG; too many bytes goes to JPEG, then smaller, a quarter at a time. */
async function readImage(file: Blob, name: string, mimetype: string): Promise<JunoFileInput | undefined> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => undefined)
  if (bitmap === undefined) return undefined
  try {
    let size = fitImage(bitmap.width, bitmap.height)
    let blob = await encode(bitmap, size.width, size.height, mimetype === 'image/jpeg' ? 'image/jpeg' : 'image/png', 0.85)
    for (let tries = 0; blob.size > JUNO_IMAGE_LIMITS.bytes && tries < 6; tries++) {
      if (tries > 0) size = { width: Math.max(1, Math.floor(size.width * 0.75)), height: Math.max(1, Math.floor(size.height * 0.75)) }
      blob = await encode(bitmap, size.width, size.height, 'image/jpeg', 0.8)
    }
    if (blob.size > JUNO_IMAGE_LIMITS.bytes) return undefined
    const box = fitImage(size.width, size.height, { edge: JUNO_THUMB_EDGE, pixels: Number.POSITIVE_INFINITY })
    let thumb = await dataUrl(await encode(bitmap, box.width, box.height, 'image/webp', 0.8))
    if (thumb.length > JUNO_THUMB_CHARS) thumb = await dataUrl(await encode(bitmap, box.width, box.height, 'image/webp', 0.4))
    if (thumb.length > JUNO_THUMB_CHARS) return undefined
    const data = (await dataUrl(blob)).replace(/^data:[^,]*,/, '')
    return { _tag: 'image', name, mimeType: blob.type === 'image/jpeg' ? 'image/jpeg' : 'image/png', data, width: size.width, height: size.height, thumb }
  } finally {
    bitmap.close()
  }
}

async function readText(file: Blob, name: string): Promise<JunoFileInput | undefined> {
  const text = await file.text()
  // A NUL byte: this is not text, whatever its name says.
  if (text.includes('\u0000')) return undefined
  const kept = cutText(text, JUNO_TEXT_LIMITS.bytes)
  return { _tag: 'text', name, text: kept.text, cut: kept.cut }
}


/** Twice the chip's 44px, for a Retina screen. */
const PREVIEW_EDGE = 88

/**
 * The chip's picture: the image scaled to cover the chip, as a data URL (the
 * page's CSP takes `data:` images), decoded so an `<img>` of it draws in its
 * first frame. Undefined when Chromium cannot decode the image.
 */
export async function previewOf(file: File): Promise<string | undefined> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(() => undefined)
  if (bitmap === undefined) return undefined
  try {
    const scale = Math.min(1, PREVIEW_EDGE / Math.min(bitmap.width, bitmap.height))
    const url = await dataUrl(await encode(bitmap, Math.max(1, Math.round(bitmap.width * scale)), Math.max(1, Math.round(bitmap.height * scale)), 'image/webp', 0.8))
    const image = new Image()
    image.src = url
    await image.decode()
    return url
  } catch {
    return undefined
  } finally {
    bitmap.close()
  }
}


/** Chromium's image decode and text read, warmed before a composer receives files. */
export function readFile(file: Blob, name: string, mimetype: string): Promise<JunoFileInput | undefined> {
  return junoFileKind(mimetype, name) === 'image' ? readImage(file, name, mimetype) : readText(file, name)
}
