import type { FakeSlack } from '../index.ts'
import type { Handlers } from '../methods.ts'

export type FakeControls = Readonly<Record<string, (fake: FakeSlack, input: never) => unknown>>

export interface FakeFeature {
  readonly methods: Partial<Handlers>
  readonly controls: FakeControls
}

type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (value: infer I) => void ? I : never

export function mergeFeatures<const F extends readonly FakeFeature[]>(features: F): {
  readonly methods: UnionToIntersection<F[number]['methods']>
  readonly controls: FakeControls
} {
  for (const kind of ['methods', 'controls'] as const) {
    const names = new Set<string>()
    for (const feature of features) {
      for (const name of Object.keys(feature[kind])) {
        if (names.has(name)) throw new Error(`duplicate fake Slack ${kind === 'methods' ? 'method' : 'control'} ${name}`)
        names.add(name)
      }
    }
  }
  return {
    // The duplicate check makes this the intersection of the feature maps.
    methods: Object.assign({}, ...features.map((feature) => feature.methods)) as UnionToIntersection<F[number]['methods']>,
    controls: Object.assign({}, ...features.map((feature) => feature.controls)),
  }
}
