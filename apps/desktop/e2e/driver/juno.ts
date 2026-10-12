/**
 * The user-language driver for Juno (architecture 13). Tests read as what a
 * person does: `juno.signIn()`, `juno.expectSignedIn('Juno Fake')`. Later
 * milestones add verbs here (`juno.sidebar.resolve('Title')`); a test that
 * needs a raw selector means a verb is missing.
 */
import { expect, type ElectronApplication, type Page } from '@playwright/test'

export class Juno {
  readonly app: ElectronApplication
  readonly win: Page

  constructor(app: ElectronApplication, win: Page) {
    this.app = app
    this.win = win
  }

  /** The sign-in page's primary and secondary actions. */
  get signInButton() {
    return this.win.getByRole('button', { name: 'Sign in to Slack' })
  }

  get importButton() {
    return this.win.getByRole('button', { name: "Use the Slack app's session" })
  }

  /**
   * Clicks "Sign in to Slack", fills the fake's sign-in page in the window
   * that opens, and waits for the app to come back signed in.
   */
  async signIn(options: { readonly email?: string } = {}): Promise<void> {
    const opened = this.app.waitForEvent('window')
    await this.signInButton.click()
    const page = await opened
    await page.getByPlaceholder('Email').fill(options.email ?? 'tushar@juno-fake.test')
    await page.getByPlaceholder('Password').fill('password')
    await page.getByRole('button', { name: 'Sign in' }).click()
    await page.waitForEvent('close')
  }

  /** Clicks "Sign in to Slack" and closes the window without signing in. */
  async abandonSignIn(): Promise<void> {
    const opened = this.app.waitForEvent('window')
    await this.signInButton.click()
    const page = await opened
    await page.close()
  }

  /** Clicks "Use the Slack app's session". The app reads the fixture directory it was launched with. */
  async importFromSlackApp(): Promise<void> {
    await this.importButton.click()
  }

  async signOut(): Promise<void> {
    await this.win.getByRole('button', { name: 'Sign out' }).click()
  }

  async expectSignedIn(teamName: string, userName = 'tushar'): Promise<void> {
    await expect(this.win.getByRole('status', { name: 'Session status' })).toHaveText(`Signed in to ${teamName} as ${userName}`, {
      timeout: 15_000,
    })
  }

  async expectSignedOut(): Promise<void> {
    await expect(this.win.getByRole('heading', { name: 'Welcome to Juno', exact: true })).toBeVisible({ timeout: 15_000 })
  }

  async expectSessionExpired(): Promise<void> {
    await expect(this.win.getByRole('heading', { name: 'Sign in again', exact: true })).toBeVisible({ timeout: 15_000 })
  }

  async expectSignInError(text: string | RegExp): Promise<void> {
    await expect(this.win.getByText(text)).toBeVisible({ timeout: 15_000 })
  }
}
