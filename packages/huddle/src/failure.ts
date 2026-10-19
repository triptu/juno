import type { HuddleStoreError } from './Huddle'

/** What failed, without any stored content. */
export const failureOf = (error: HuddleStoreError): string => {
  const cause = error.cause
  if (typeof cause === 'object' && cause !== null && '_tag' in cause && typeof cause._tag === 'string') return cause._tag
  return cause instanceof Error ? cause.name : typeof cause
}
