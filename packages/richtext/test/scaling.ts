/**
 * How a parser's time grows with its input, for the catastrophic-backtracking
 * guards. A wall-clock bound fails on a loaded machine; a ratio does not.
 * The input grows 4 times: linear work takes about 4 times as long, quadratic
 * work 16 times. Each size runs after a warm-up and keeps its fastest of three
 * runs, so a pause on the machine does not count.
 */
export function growth(run: (bytes: number) => unknown, bytes: number): number {
  const fastest = (size: number) => {
    run(size)
    let best = Number.POSITIVE_INFINITY
    for (let i = 0; i < 3; i++) {
      const started = performance.now()
      run(size)
      best = Math.min(best, performance.now() - started)
    }
    return Math.max(best, 0.1)
  }
  return fastest(bytes * 4) / fastest(bytes)
}
