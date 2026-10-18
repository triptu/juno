import { coreFeature } from './core.ts'
import { huddlesFeature } from './huddles.ts'
import { reactionsFeature } from './reactions.ts'

export const features = [coreFeature, reactionsFeature, huddlesFeature] as const
