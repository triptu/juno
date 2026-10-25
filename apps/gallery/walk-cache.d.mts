import type { Route } from './support'

export function sourceKeys(root: string): (component: string) => string
export function walkCache(options: {
  root: string
  kind: 'shift'
  runtime: object
  directory?: string
  all?: boolean
}): {
  key(route: Route): string
  passed(route: Route): boolean
  forget(route: Route): void
  pass(route: Route): void
}
