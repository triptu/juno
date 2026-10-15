import { createCodexLocal } from './codex/local'
import type { JunoSettingsPage } from '@juno/agent-contract'
/**
 * The model picker's rows (plan v3 §7.1, SPEC 13.10), for the active
 * provider. On OpenRouter: its catalogue once read today, else the last
 * cached one, else pi-ai's own catalogue. On a custom endpoint: the models
 * its `/models` lists, read at every refresh; when it lists none, the owner
 * types a model id (`typed`). The provider serves every row's model, so a
 * change of choice needs no new provider.
 */
import { JUNO_INSTRUCTIONS } from '../request/prompt'
import type { Store } from '../store/store'
import { createCatalogue, piRows, type PickerModel } from './catalog'
import type { ProviderConnection } from './connection'
import { customRow, listCustomModels } from './custom'

export interface ModelPicker {
  readonly codex?: { readonly agentDir: string; readonly executable: string }
  readonly codexStatus?: () => JunoSettingsPage['codex']
  readonly provider: () => 'openrouter' | 'custom'
  readonly rows: () => readonly PickerModel[]
  /** The custom endpoint listed its models. */
  readonly listed: () => boolean
  /** A row for a model id the custom endpoint did not list; undefined on OpenRouter. */
  readonly typed: (id: string) => PickerModel | undefined
  /**
   * Reads the active provider's models: OpenRouter's catalogue once a day
   * (offline keeps the last), a custom endpoint's list every time. Call once
   * the store is open. Resolves true when the rows changed.
   */
  readonly refresh: (store: Store) => Promise<boolean>
}

export interface PickerOptions {
  readonly codex?: { readonly agentDir: string; readonly executable: string }
  readonly fetch?: typeof fetch
  /**
   * Another origin for OpenRouter, for the catalogue and every model's base
   * URL. Only the e2e tests set it, to reach the fake.
   */
  readonly origin?: string
}

const OPENROUTER_ORIGIN = 'https://openrouter.ai'
const signature = (rows: readonly PickerModel[]) => JSON.stringify(rows.map((row) => [row.choice, row.model.id, row.model.baseUrl, row.price]))

export function modelPicker(connection: ProviderConnection, options: PickerOptions = {}): ModelPicker {
  const rebase = (row: PickerModel): PickerModel =>
    options.origin === undefined || !row.model.baseUrl.startsWith(OPENROUTER_ORIGIN)
      ? row
      : { ...row, model: { ...row.model, baseUrl: options.origin + row.model.baseUrl.slice(OPENROUTER_ORIGIN.length) } }
  let openRouterRows = piRows().map(rebase)
  const local = options.codex ? createCodexLocal(options.codex) : undefined
  let codexRow: PickerModel | undefined
  let codexStatus: JunoSettingsPage['codex'] = { _tag: 'missing' }
  let customRows: readonly PickerModel[] | undefined
  let catalogue: ReturnType<typeof createCatalogue> | undefined
  const endpoint = () => {
    const current = connection.current()
    return current?._tag === 'custom' ? current : undefined
  }
  const provider = () => (endpoint() === undefined ? 'openrouter' : 'custom')
  const rows = () => [...(provider() === 'custom' ? (customRows ?? []) : openRouterRows), ...(codexRow ? [codexRow] : [])]
  return {
    codex: options.codex,
    codexStatus: () => codexStatus,
    provider,
    rows,
    listed: () => customRows !== undefined,
    typed: (id) => {
      const custom = endpoint()
      return custom === undefined ? undefined : customRow(custom.baseUrl, id)
    },
    refresh: async (store) => {
      const before = JSON.stringify([signature(rows()), codexStatus])
      if (local) {
        const state = await local.status().catch(() => 'signedOut' as const)
        codexStatus = state === 'signedIn' ? { _tag: 'ready', version: await local.version() } : { _tag: state }
        const codexCatalogue = catalogue ?? createCatalogue(store, { systemAndTools: [JUNO_INSTRUCTIONS] })
        codexRow = state === 'signedIn' ? codexCatalogue.codex(await local.listModels()).row : undefined
      }
      const custom = endpoint()
      if (custom !== undefined) {
        customRows = await listCustomModels(custom, options.fetch)
      } else {
        catalogue ??= createCatalogue(store, {
          systemAndTools: [JUNO_INSTRUCTIONS],
          ...(options.fetch ? { fetch: options.fetch } : {}),
          ...(options.origin ? { url: `${options.origin}/api/v1/models` } : {}),
        })
        openRouterRows = (await catalogue.refresh().catch(() => ({ rows: openRouterRows }))).rows.map(rebase)
      }
      return JSON.stringify([signature(rows()), codexStatus]) !== before
    },
  }
}
