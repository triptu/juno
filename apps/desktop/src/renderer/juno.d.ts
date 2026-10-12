import type { JunoBridge } from '@juno/contract/channels'

declare global {
  interface Window {
    /** Exposed by the preload script. See packages/contract. */
    readonly juno: JunoBridge
  }
}
