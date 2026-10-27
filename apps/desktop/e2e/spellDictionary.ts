import { existsSync } from 'node:fs'
import { copyFile, mkdir, rename, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// On Linux, Electron spell-checks with Hunspell and downloads the dictionary from Google's CDN into each user-data
// folder the first time a field is checked, so a test's spelling menu waited on the network. The setup step fetches it
// once into the machine's cache (`/cache/electron` on the runner), and every launch copies it in. macOS uses its own
// checker and needs none.
const FILE = 'en-US-10-1.bdic'
const cached = () => join(process.env.electron_config_cache ?? join(tmpdir(), 'juno-electron-cache'), 'dictionaries', FILE)

export async function fetchSpellDictionary(): Promise<void> {
  if (process.platform !== 'linux' || existsSync(cached())) return
  const response = await fetch(`https://redirector.gvt1.com/edgedl/chrome/dict/${FILE.toLowerCase()}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (!response.ok || bytes.subarray(0, 4).toString('latin1') !== 'BDic') throw new Error(`Could not fetch the spelling dictionary ${FILE}: HTTP ${response.status}`)
  await mkdir(join(cached(), '..'), { recursive: true })
  // Jobs on one machine share the cache: write aside, then rename.
  const aside = `${cached()}.${process.pid}`
  await writeFile(aside, bytes)
  await rename(aside, cached())
}

export async function copySpellDictionary(userData: string): Promise<void> {
  if (process.platform !== 'linux' || !existsSync(cached())) return
  await mkdir(join(userData, 'Dictionaries'), { recursive: true })
  await copyFile(cached(), join(userData, 'Dictionaries', FILE))
}
