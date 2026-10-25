import type { Route } from './support'

export function sourceKeys(root: string, kind: 'shift' | 'ring'): (component: string) => string
export function ownKeys(root: string): (component: string) => string
export function walkCache(options: {
  root: string
  kind: 'shift' | 'ring'
  runtime: object
  directory?: string
  all?: boolean
  /** Key by the component's own files (`ownKeys`) instead of everything it reaches. */
  own?: boolean
}): {
  key(route: Route): string
  readonly all: boolean
  passed(route: Route): boolean
  forget(route: Route): void
  pass(route: Route): void
}
