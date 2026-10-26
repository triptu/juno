import type { Route } from './support'

type Kind = 'shift' | 'computed' | 'layout' | 'paint'
interface Options {
  root: string
  kind: Kind
  runtime: object
  directory?: string
  all?: boolean
  /** The run named in each record this cache writes. */
  source?: string
  /** A full run's sample seed. */
  sample?: string
}
/** An earlier pass: the run that wrote it, and whether this run's sample checks it again. */
interface Reuse { readonly from: string; readonly sampled: boolean }

export const sampleShare: number
export function inSample(seed: string | undefined, name: string): boolean
export function sourceKeys(root: string, kind: Kind): ((component: string) => string) & { specKey(file: string): string }
export function walkCache(options: Options & { kind: 'shift' | 'computed' }): {
  key(route: Route): string
  reuse(route: Route): Reuse | undefined
  passed(route: Route): boolean
  forget(route: Route): void
  pass(route: Route): void
}
export function testCache(options: Options & { kind: 'layout' | 'paint' }): {
  reuse(file: string, title: string): Reuse | undefined
  passed(file: string, title: string): boolean
  forget(file: string, title: string): void
  pass(file: string, title: string, components: Iterable<string>): void
}
