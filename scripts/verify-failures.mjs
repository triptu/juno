import { stripVTControlCharacters } from 'node:util'

// Sparse failures finish the suite. These thresholds identify unusable runs.
export const MIN_COMPLETED = 20
export const FAILURE_FRACTION = 0.5
export const SHARED_SIGNATURE_FAILURES = 8

export function errorSignature(error) {
  const clean = (value) => stripVTControlCharacters(String(value ?? '')).trim()
  const message = clean(error?.message ?? error).split('\n').find(Boolean) ?? 'Unknown error'
  const frame = clean(error?.stack).split('\n').find((line) => /^\s*at /.test(line))?.trim()
  return frame ? `${message} | ${frame}` : message
}

export function failurePolicy() {
  let completed = 0
  let failed = 0
  let stopped
  const signatures = new Map()
  return {
    get completed() { return completed },
    observe({ failure = false, signature, setup = false }) {
      if (stopped) return undefined
      if (setup) return stopped = { scope: 'run', rule: 'setup', signature, completed, failed }
      completed++
      if (failure) {
        failed++
        if (signature) signatures.set(signature, (signatures.get(signature) ?? 0) + 1)
      }
      if (signature && signatures.get(signature) >= SHARED_SIGNATURE_FAILURES)
        return stopped = { scope: 'suite', systemic: true, rule: 'shared-signature', signature, completed, failed, matching: signatures.get(signature) }
      if (completed >= MIN_COMPLETED && failed / completed > FAILURE_FRACTION)
        return stopped = { scope: 'suite', systemic: true, rule: 'failure-rate', completed, failed }
    },
  }
}

/** Structured Playwright results and Bun's complete per-test lines share one policy. */
export function failureMonitor() {
  const policy = failurePolicy()
  let signature
  return {
    get completed() { return policy.completed },
    line(line) {
      if (line.startsWith('juno-test: ')) return policy.observe(JSON.parse(line.slice('juno-test: '.length)))
      const plain = stripVTControlCharacters(line)
      if (/^(?:error|\w*Error): /.test(plain)) signature = errorSignature(plain)
      if (/^\((pass|fail)\) /.test(plain)) {
        const result = policy.observe({ failure: plain.startsWith('(fail)'), signature: plain.startsWith('(fail)') ? signature : undefined })
        signature = undefined
        return result
      }
    },
  }
}

export function stopFromLog(log) {
  const match = /^juno-stop: (.+)$/m.exec(log)
  return match ? JSON.parse(match[1]) : undefined
}
