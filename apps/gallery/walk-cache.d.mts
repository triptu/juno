import type { Route } from './support'

type Kind = 'shift' | 'computed' | 'layout' | 'paint'
interface Options {
  root: string
  kind: Kind
  runtime: object
  directory?: string
  all?: boolean
}

export function sourceKeys(root: string, kind: Kind): ((component: string) => string) & { specKey(file: string): string }
export function walkCache(options: Options & { kind: 'shift' | 'computed' }): {
  key(route: Route): string
  passed(route: Route): boolean
  forget(route: Route): void
  pass(route: Route): void
}
export function testCache(options: Options & { kind: 'layout' | 'paint' }): {
  passed(file: string, title: string): boolean
  forget(file: string, title: string): void
  pass(file: string, title: string, components: Iterable<string>): void
}
