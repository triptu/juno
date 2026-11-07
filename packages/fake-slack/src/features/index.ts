import { buttonsFeature } from './buttons.ts'
import { coreFeature } from './core.ts'
import { dndFeature } from './dnd.ts'
import { draftsFeature } from './drafts.ts'
import { filesFeature } from './files.ts'
import { forwardFeature } from './forward.ts'
import { huddlesFeature } from './huddles.ts'
import { membershipFeature } from './membership.ts'
import { reactionsFeature } from './reactions.ts'

export const features = [coreFeature, reactionsFeature, forwardFeature, huddlesFeature, filesFeature, buttonsFeature, membershipFeature, draftsFeature, dndFeature] as const
