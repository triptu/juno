/**
 * The gallery and the picture page (SPEC 12, "Pictures and the gallery"),
 * one lazy chunk with the catalog's. The catalog is bundled; the files come
 * through the engine's picture cache, which downloads a picture's small
 * file as it nears the screen and the large one when its page opens.
 */
import { use, useEffect, useMemo, useState } from 'react'
import { ensurePicture, lastPictureId, loadPictures, openExternal, pictureFilesAtom, pictureUrl, pictureYear, readPictureFiles, registry, tabsAtom, type Picture } from '@juno/state'
import { useAtomValue } from '@juno/state/react'
import { Gallery, GALLERY_SECTIONS, PicturePage, type GalleryFilter, type GalleryOrder, type GalleryPictureView } from '@juno/views'
import { openGallery, stepPicture } from './navigation'

/** Each gallery tab's filter, order and scroll, so Back returns to the wall where it was. */
const walls = new Map<string, { filter: GalleryFilter; order: GalleryOrder; scrollTop: number }>()

/** What the wall shows of each picture: its card, its line and its year. */
const onTheWall = (picture: Picture): GalleryPictureView => ({
  id: picture.id,
  kind: picture.kind,
  title: picture.title,
  artist: picture.artist,
  date: picture.date,
  ratio: picture.ratio,
  line: picture.line.by === undefined ? { text: picture.line.text } : { text: picture.line.text, by: picture.line.by },
  year: pictureYear(picture) ?? 0,
})

/** The gallery's order: the sections in turn, each in the catalog's order. */
const inGalleryOrder = (pictures: ReadonlyArray<Picture>): ReadonlyArray<Picture> => GALLERY_SECTIONS.flatMap((section) => pictures.filter((picture) => picture.kind === section.kind))

export function GalleryTab({ pictureId, tabId }: { readonly pictureId: string | undefined; readonly tabId: string }) {
  const pictures = use(loadPictures())
  const picture = pictureId === undefined ? undefined : pictures.find((entry) => entry.id === pictureId)
  return picture === undefined ? <Wall pictures={pictures} tabId={tabId} /> : <Story picture={picture} pictures={pictures} tabId={tabId} />
}

function Wall({ pictures, tabId }: { readonly pictures: ReadonlyArray<Picture>; readonly tabId: string }) {
  const files = useAtomValue(pictureFilesAtom)
  const kept = walls.get(tabId)
  const [filter, setFilter] = useState<GalleryFilter>(kept?.filter ?? 'all')
  const [order, setOrder] = useState<GalleryOrder>(kept?.order ?? 'kind')
  const [current] = useState(lastPictureId)
  const wall = useMemo(() => pictures.map(onTheWall), [pictures])
  useEffect(() => void readPictureFiles(registry, 'small'), [])
  const sources: Record<string, string> = {}
  for (const picture of pictures) if (files.has(`${picture.id}-small`)) sources[picture.id] = pictureUrl(picture.id, 'small')
  return (
    <Gallery
      pictures={wall}
      sources={sources}
      {...(current === undefined ? {} : { current })}
      filter={filter}
      onFilter={(next) => {
        walls.set(tabId, { filter: next, order, scrollTop: 0 })
        setFilter(next)
      }}
      order={order}
      onOrder={(next) => {
        walls.set(tabId, { filter, order: next, scrollTop: 0 })
        setOrder(next)
      }}
      onOpen={(id, event) => openGallery(id, { newTab: event.metaKey })}
      onNear={(id) => void ensurePicture(registry, id, 'small')}
      {...(kept === undefined ? {} : { scrollTop: kept.scrollTop })}
      onScroll={(scrollTop) => walls.set(tabId, { filter, order, scrollTop })}
    />
  )
}

function Story({ picture, pictures, tabId }: { readonly picture: Picture; readonly pictures: ReadonlyArray<Picture>; readonly tabId: string }) {
  const files = useAtomValue(pictureFilesAtom)
  useEffect(() => {
    void readPictureFiles(registry, 'large').then(() => ensurePicture(registry, picture.id, 'small')).then(() => ensurePicture(registry, picture.id, 'large'))
  }, [picture.id])

  const step = (by: -1 | 1) => {
    const order = inGalleryOrder(pictures)
    const at = order.findIndex((entry) => entry.id === picture.id)
    const next = order[(at + by + order.length) % order.length]
    if (next !== undefined) stepPicture(tabId, next.id)
  }

  // ← and → step while this tab is the active one and no field has the keys.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
      if (registry.get(tabsAtom).active !== tabId) return
      const target = event.target as HTMLElement | null
      if (target !== null && (target.isContentEditable || target.closest('input, textarea, select, [role="dialog"], [role="menu"], [role="listbox"]') !== null)) return
      event.preventDefault()
      step(event.key === 'ArrowLeft' ? -1 : 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const src = files.has(`${picture.id}-large`) ? pictureUrl(picture.id, 'large') : files.has(`${picture.id}-small`) ? pictureUrl(picture.id, 'small') : undefined
  return <PicturePage picture={picture} src={src} onAllPictures={(event) => openGallery(undefined, { newTab: event.metaKey })} onStep={step} onOpenLink={openExternal} />
}
