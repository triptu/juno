/**
 * How a parser's work grows with its input, counted rather than timed, so it
 * reads the same on any machine and load. The work is the characters its
 * string scans visit: each `indexOf` from where it starts to where it stops,
 * each `startsWith` and `slice` by length, each regular expression from
 * where it starts to the end of its match or of the input. The input grows 4 times: linear work counts about 4 times as much, a
 * scan that starts again from each position about 16 times. The counters wrap
 * `String.prototype` and `RegExp.prototype` only while `run` runs, which is
 * synchronous, so nothing else is counted.
 */
export function scanGrowth(run: (bytes: number) => unknown, bytes: number): number {
  return scanned(() => run(bytes * 4)) / scanned(() => run(bytes))
}

function scanned(run: () => unknown): number {
  const string = String.prototype
  const regexp = RegExp.prototype
  const { indexOf, startsWith, slice } = string
  const { exec, test } = regexp
  let count = 0
  string.indexOf = function (this: string, needle: string, from = 0) {
    const at = indexOf.call(this, needle, from)
    count += (at === -1 ? this.length : at + needle.length) - Math.max(0, from)
    return at
  }
  string.startsWith = function (this: string, needle: string, from?: number) {
    count += needle.length
    return startsWith.call(this, needle, from)
  }
  string.slice = function (this: string, start?: number, end?: number) {
    const part = slice.call(this, start, end)
    count += part.length
    return part
  }
  // From where the search starts (`lastIndex` for a global or sticky one) to the end of its match, or of the input.
  const matched = (pattern: RegExp, input: string, match: () => RegExpExecArray | null) => {
    const from = pattern.global || pattern.sticky ? pattern.lastIndex : 0
    const found = match()
    count += (found === null ? String(input).length : found.index + found[0].length) - from
    return found
  }
  regexp.exec = function (this: RegExp, input: string) {
    return matched(this, input, () => exec.call(this, input))
  }
  regexp.test = function (this: RegExp, input: string) {
    return matched(this, input, () => exec.call(this, input)) !== null
  }
  try {
    run()
  } finally {
    Object.assign(string, { indexOf, startsWith, slice })
    Object.assign(regexp, { exec, test })
  }
  return count
}
