/**
 * Chime's Voice Focus noise suppression. It loads its model from Chime's CDN
 * (`*.sdkassets.chime.aws`), which can fail or be blocked; every failure means
 * "no noise suppression", never a failed call.
 */
import { VoiceFocusDeviceTransformer, type Logger, type VoiceFocusTransformDevice } from 'amazon-chime-sdk-js'

export async function voiceFocusSupported(logger: Logger): Promise<boolean> {
  try {
    return await VoiceFocusDeviceTransformer.isSupported(undefined, { logger })
  } catch {
    return false
  }
}

export class VoiceFocus {
  readonly #transformer: VoiceFocusDeviceTransformer
  #device: VoiceFocusTransformDevice | undefined

  private constructor(transformer: VoiceFocusDeviceTransformer) {
    this.#transformer = transformer
  }

  /** Undefined when the model does not load. */
  static async load(logger: Logger): Promise<VoiceFocus | undefined> {
    try {
      const transformer = await VoiceFocusDeviceTransformer.create(undefined, { logger })
      if (transformer.isSupported()) return new VoiceFocus(transformer)
      await VoiceFocusDeviceTransformer.destroyVoiceFocus(transformer)
    } catch {
      // Fall through: the call goes on without it.
    }
    return undefined
  }

  /** The microphone with Voice Focus in front of it, or undefined when that fails. */
  async wrap(deviceId: string): Promise<VoiceFocusTransformDevice | undefined> {
    try {
      const next = this.#device === undefined ? await this.#transformer.createTransformDevice(deviceId) : await this.#device.chooseNewInnerDevice(deviceId)
      this.#device = next
      return next
    } catch {
      return undefined
    }
  }

  async destroy(): Promise<void> {
    await this.#device?.stop().catch(() => {})
    this.#device = undefined
    await VoiceFocusDeviceTransformer.destroyVoiceFocus(this.#transformer).catch(() => {})
  }
}
