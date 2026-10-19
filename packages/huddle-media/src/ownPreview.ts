/**
 * The elements that preview the user's own share (SPEC 20: a shared window
 * shows in their own tab). Each gets the capture's own stream, so nothing is
 * captured twice; a new share swaps the picture in the same elements.
 */
export class OwnPreviews {
  readonly #elements = new Set<HTMLVideoElement>()
  #stream: MediaStream | undefined

  show(element: HTMLVideoElement): () => void {
    this.#elements.add(element)
    this.#bind(element)
    return () => {
      if (!this.#elements.delete(element)) return
      element.srcObject = null
    }
  }

  /** The capture now shared, or none. */
  set(stream: MediaStream | undefined): void {
    this.#stream = stream
    for (const element of this.#elements) this.#bind(element)
  }

  #bind(element: HTMLVideoElement): void {
    const stream = this.#stream ?? null
    if (element.srcObject === stream) return
    element.muted = true
    element.srcObject = stream
    if (stream !== null) void element.play().catch(() => {})
  }
}
