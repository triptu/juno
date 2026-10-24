import type { Browser, BrowserContext, Page } from '@playwright/test'

type Options = Pick<Parameters<Browser['newContext']>[0] & object, 'viewport' | 'permissions'>

/** Keeps immutable HTTP assets warm; every test gets a new page and empty origin storage. */
export class WebPages {
  #context: BrowserContext | undefined
  #options = ''

  constructor(readonly browser: Browser) {}

  async open(options: Options): Promise<Page> {
    const key = JSON.stringify(options)
    if (this.#context !== undefined && this.#options !== key) await this.close()
    this.#context ??= await this.browser.newContext(options)
    this.#options = key
    await this.#context.grantPermissions(options.permissions ?? [])
    return this.#context.newPage()
  }

  async release(page: Page): Promise<void> {
    const context = page.context()
    try {
      const origins = new Set((await context.storageState()).origins.map(({ origin }) => origin))
      for (const frame of page.frames()) {
        const url = new URL(frame.url())
        if (url.protocol === 'http:' || url.protocol === 'https:') origins.add(url.origin)
      }
      // Destroy the document before clearing storage so no old effect can write it back.
      await page.goto('about:blank')
      const session = await context.newCDPSession(page)
      try {
        for (const origin of origins) await session.send('Storage.clearDataForOrigin', { origin, storageTypes: 'all' })
      } finally { await session.detach() }
      await context.clearCookies()
      await context.clearPermissions()
      await context.setOffline(false)
      await page.close()
    } catch (error) {
      await this.close()
      throw error
    }
  }

  async close(): Promise<void> {
    const context = this.#context
    this.#context = undefined
    await context?.close()
  }
}
