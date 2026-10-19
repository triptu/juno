/**
 * The fake's idea of "now". Tests can freeze it, set it or move it forward;
 * every ts the fake issues comes from here.
 */
export class Clock {
  #offset = 0
  #frozen: number | undefined

  constructor(start?: number) {
    this.#frozen = start
  }

  now(): number {
    return this.#frozen ?? Date.now() + this.#offset
  }

  advance(millis: number): void {
    if (this.#frozen !== undefined) this.#frozen += millis
    else this.#offset += millis
  }

  /** Freezes the clock at a point in time. */
  set(millis: number): void {
    this.#frozen = millis
  }

  /** Unfreezes the clock: it reads real time again. */
  resume(): void {
    this.#frozen = undefined
    this.#offset = 0
  }
}
