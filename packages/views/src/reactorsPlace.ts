/** The gap from the chip, and from the window's edges (`--space-1-5`, `--space-2`). */
const GAP = 6
const EDGE = 8

/**
 * Puts a fixed layer under its chip, its start on the chip's, moved in to
 * stay inside the window; over the chip when there is no room below. The
 * who-reacted card and the reactions dialog both hang this way.
 */
export function placeNear(layer: HTMLElement, chip: HTMLElement): void {
  const anchor = chip.getBoundingClientRect()
  const box = layer.getBoundingClientRect()
  const x = Math.max(EDGE, Math.min(anchor.left, window.innerWidth - EDGE - box.width))
  const below = anchor.bottom + GAP
  const y = below + box.height <= window.innerHeight - EDGE ? below : Math.max(EDGE, anchor.top - GAP - box.height)
  layer.style.translate = `${Math.round(x)}px ${Math.round(y)}px`
}
