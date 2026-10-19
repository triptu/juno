import { coreFeature } from './core.ts'
import { forwardFeature } from './forward.ts'
import { huddlesFeature } from './huddles.ts'
import { reactionsFeature } from './reactions.ts'

export const features = [coreFeature, reactionsFeature, forwardFeature, huddlesFeature] as const
