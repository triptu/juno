import type { FakeSlack } from '../index.ts'
import type { ApiError, Handlers, MethodContext } from '../methods.ts'

export type FakeControls = Readonly<Record<string, (fake: FakeSlack, input: never) => unknown>>

/** Edge (Flannel) methods by name: the JSON body in, the whole answer out (`ok` included), or an error. */
export type EdgeHandlers = Readonly<Record<string, (ctx: MethodContext, body: Readonly<Record<string, unknown>>) => { readonly ok: true } | ApiError>>

export interface FakeFeature {
  readonly methods: Partial<Handlers>
  readonly edge?: EdgeHandlers
  readonly controls: FakeControls
}

type UnionToIntersection<U> = (U extends unknown ? (value: U) => void : never) extends (value: infer I) => void ? I : never

export function mergeFeatures<const F extends readonly FakeFeature[]>(features: F): {
  readonly methods: UnionToIntersection<F[number]['methods']>
  readonly edge: EdgeHandlers
  readonly controls: FakeControls
} {
  const label = { methods: 'method', edge: 'edge method', controls: 'control' } as const
  for (const kind of ['methods', 'edge', 'controls'] as const) {
    const names = new Set<string>()
    for (const feature of features) {
      for (const name of Object.keys(feature[kind] ?? {})) {
        if (names.has(name)) throw new Error(`duplicate fake Slack ${label[kind]} ${name}`)
        names.add(name)
      }
    }
  }
  return {
    // The duplicate check makes this the intersection of the feature maps.
    methods: Object.assign({}, ...features.map((feature) => feature.methods)) as UnionToIntersection<F[number]['methods']>,
    edge: Object.assign({}, ...features.map((feature) => feature.edge ?? {})),
    controls: Object.assign({}, ...features.map((feature) => feature.controls)),
  }
}
