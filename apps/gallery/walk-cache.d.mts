import type { Route } from './support'

export function sourceKeys(root: string, kind: 'shift' | 'ring'): (component: string) => string
export function walkCache(options: {
  root: string
  kind: 'shift' | 'ring'
  runtime: object
  directory?: string
  all?: boolean
}): {
  key(route: Route): string
  passed(route: Route): boolean
  forget(route: Route): void
  pass(route: Route): void
}
