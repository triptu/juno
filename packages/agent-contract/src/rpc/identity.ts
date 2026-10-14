import { Schema } from 'effect'
import { ActionId, Digest, Revision } from '@juno/agent-cards'
import { CardId } from '../chat/ids'

export const CardIdentity = Schema.Struct({ cardId: CardId, revision: Revision, digest: Digest })
export const ChildApproval = Schema.Struct({ actionId: ActionId, revision: Revision, digest: Digest, duplicateWarning: Schema.Boolean })
export const CardBinding = Schema.Struct({ identity: CardIdentity, children: Schema.Array(ChildApproval) })
