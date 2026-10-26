// The package has no DOM or Node types; bun and every browser have this clock.
declare const performance: { now(): number }

/**
 * How a parser's time grows with its input, for the catastrophic-backtracking
 * guards. A wall-clock bound fails on a loaded machine; a ratio does not.
 * The input grows 4 times: linear work takes about 4 times as long, quadratic
 * work 16 times. After a warm-up the two sizes take turns, five runs each, and
 * each keeps its fastest, so a pause or a busy stretch on the machine falls on
 * both sizes rather than one (a full run on two cores read 11.3 for linear work
 * timed one size after the other).
 */
export function growth(run: (bytes: number) => unknown, bytes: number): number {
  const time = (size: number) => {
    const started = performance.now()
    run(size)
    return performance.now() - started
  }
  run(bytes)
  run(bytes * 4)
  let small = Number.POSITIVE_INFINITY
  let large = Number.POSITIVE_INFINITY
  for (let i = 0; i < 5; i++) {
    small = Math.min(small, time(bytes))
    large = Math.min(large, time(bytes * 4))
  }
  return Math.max(large, 0.1) / Math.max(small, 0.1)
}
