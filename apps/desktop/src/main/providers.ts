/**
 * Juno Agent's model providers (SPEC 13.10): OpenRouter, or one
 * OpenAI-compatible endpoint (a local model server or another service).
 * Main owns them because it owns the keychain: the renderer sets them up
 * through `agent.setProvider` and `agent.setOpenRouterKey`, and the agent
 * gets only the active one, over `parentPort`.
 *
 * - Keys are generic passwords in the login keychain (`keychain.ts`), never
 *   in a file or a log. `OPENROUTER_API_KEY` overrides the initial
 *   OpenRouter key in development until a key is saved or removed.
 * - The endpoint's base URL and which provider is active are not secret:
 *   they live in `juno-provider.json` in userData.
 * - One provider is active at a time. Setting one up makes it active;
 *   removing the active one falls back to the other if it is set up, else
 *   to none. With none, the agent does not run (`index.ts`).
 * - Changes run one at a time, in the order they were asked, and the file is
 *   written through a temporary file and a rename, so a change made while
 *   the keychain holds an earlier one lands after it and the file is never
 *   half written.
 */
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Schema } from 'effect'
import type { AgentProvider } from '@juno/agent-contract'
import { ProviderKind, type ProviderChange, type ProviderResult, type ProviderState } from '@juno/contract'
import { KEY_PATTERN, type Keychain } from './keychain'

export const PROVIDER_FILE = 'juno-provider.json'

const Saved = Schema.Struct({ active: Schema.NullOr(ProviderKind), baseUrl: Schema.String })
const decodeSaved = Schema.decodeUnknownSync(Saved)

/** An http or https address; anything else is refused before it is stored. */
function baseUrlOf(text: string): string | undefined {
  try {
    const url = new URL(text.trim())
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href.replace(/\/+$/, '') : undefined
  } catch {
    return undefined
  }
}

export interface ProviderKeychains {
  readonly openRouter: Keychain
  readonly custom: Keychain
}

export class ProviderStore {
  #openRouterKey: string | null = null
  #customKey: string | null = null
  #baseUrl = ''
  #active: ProviderState['active'] = null
  #loading: Promise<void> | undefined
  #last: Promise<unknown> = Promise.resolve()
  readonly #file: string

  constructor(
    userData: string,
    private readonly keychains: ProviderKeychains,
    /** `OPENROUTER_API_KEY`, outside tests. */
    private readonly override: string | undefined,
    /** Called after every change, and once loaded, with public state, the active chat provider and the engine’s OpenRouter key. */
    private readonly changed: (state: ProviderState, provider: AgentProvider | null, engineKey: string | null) => void,
  ) {
    this.#file = join(userData, PROVIDER_FILE)
  }

  get state(): ProviderState {
    return {
      active: this.#active,
      openRouter: { key: this.#openRouterKey === null ? 'missing' : 'set' },
      custom: { baseUrl: this.#baseUrl, key: this.#customKey === null ? 'missing' : 'set' },
    }
  }

  /** What the agent gets: the active provider with its key, or null. */
  get provider(): AgentProvider | null {
    if (this.#active === 'openRouter' && this.#openRouterKey !== null) return { _tag: 'openRouter', key: this.#openRouterKey }
    if (this.#active === 'custom' && this.#baseUrl !== '') return { _tag: 'custom', baseUrl: this.#baseUrl, key: this.#customKey }
    return null
  }

  load(): Promise<void> {
    this.#loading ??= (async () => {
      const read = async (keychain: Keychain) => {
        try {
          return (await keychain.read()) ?? null
        } catch {
          return null
        }
      }
      this.#openRouterKey = this.override !== undefined && this.override !== '' ? this.override : await read(this.keychains.openRouter)
      this.#customKey = await read(this.keychains.custom)
      let saved: typeof Saved.Type | undefined
      try {
        saved = decodeSaved(JSON.parse(await readFile(this.#file, 'utf8')))
      } catch {
        saved = undefined
      }
      this.#baseUrl = saved?.baseUrl ?? ''
      this.#active = saved === undefined ? this.#fallback(null) : saved.active === null ? null : this.#usable(saved.active) ? saved.active : this.#fallback(null)
      this.#notify()
    })()
    return this.#loading
  }

  set(change: ProviderChange): Promise<ProviderResult> {
    const next = this.#last.then(() => this.#apply(change))
    this.#last = next.catch(() => undefined)
    return next
  }

  async #apply(change: ProviderChange): Promise<ProviderResult> {
    await this.load()
    let result: ProviderResult
    switch (change._tag) {
      case 'openRouter': {
        const key = change.key?.trim() ?? null
        if (key !== null && !KEY_PATTERN.test(key)) return 'invalid'
        if (!(await this.#store(this.keychains.openRouter, key))) return 'failed'
        this.#openRouterKey = key
        this.#active = key !== null ? 'openRouter' : this.#active === 'openRouter' ? this.#fallback('openRouter') : this.#active
        result = key === null ? 'removed' : 'saved'
        break
      }
      case 'custom': {
        if (change.baseUrl.trim() === '') {
          if (!(await this.#store(this.keychains.custom, null))) return 'failed'
          this.#customKey = null
          this.#baseUrl = ''
          if (this.#active === 'custom') this.#active = this.#fallback('custom')
          result = 'removed'
          break
        }
        const baseUrl = baseUrlOf(change.baseUrl)
        const key = change.key === undefined ? undefined : change.key === null || change.key.trim() === '' ? null : change.key.trim()
        if (baseUrl === undefined || (key != null && !KEY_PATTERN.test(key))) return 'invalid'
        if (key !== undefined) {
          if (!(await this.#store(this.keychains.custom, key))) return 'failed'
          this.#customKey = key
        }
        this.#baseUrl = baseUrl
        this.#active = 'custom'
        result = 'saved'
        break
      }
      case 'use': {
        if (change.provider !== null && !this.#usable(change.provider)) return 'invalid'
        this.#active = change.provider
        result = 'saved'
        break
      }
    }
    // The keychain already changed: the engine and the agent follow it even if the file write fails.
    try {
      await this.#save()
    } finally {
      this.#notify()
    }
    return result
  }

  #usable(kind: ProviderKind): boolean {
    return kind === 'openRouter' ? this.#openRouterKey !== null : this.#baseUrl !== ''
  }

  /** The provider to fall back to: the other one if set up, else none. */
  #fallback(leaving: ProviderKind | null): ProviderState['active'] {
    const order: ReadonlyArray<ProviderKind> = ['openRouter', 'custom']
    return order.find((kind) => kind !== leaving && this.#usable(kind)) ?? null
  }

  async #store(keychain: Keychain, key: string | null): Promise<boolean> {
    try {
      if (key === null) await keychain.remove()
      else await keychain.write(key)
      return true
    } catch {
      return false
    }
  }

  async #save(): Promise<void> {
    const temporary = `${this.#file}.tmp`
    await writeFile(temporary, JSON.stringify({ active: this.#active, baseUrl: this.#baseUrl }), { mode: 0o600 })
    await rename(temporary, this.#file)
  }

  #notify(): void {
    this.changed(this.state, this.provider, this.#openRouterKey)
  }
}
