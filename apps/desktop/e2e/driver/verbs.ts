/**
 * The verbs the Playwright driver (`juno.ts`) and the DOM lane's driver
 * (`apps/desktop/dom/driver/`) both have, with the same names and
 * arguments, so a test moves between lanes by changing its imports and its
 * locators' assertions, not its steps. Each driver class `implements` its
 * part here; a verb only one lane can do (a box, a drag, a scroll) stays
 * out.
 */
import type { AppMenuItem, WorkPassName } from './surface'

export type TextMatch = string | RegExp
export type SidebarSectionName = 'Pinned' | 'Recent'
export type SidebarFilterName = 'All' | 'Channels' | 'DMs'
export type SettingsSectionName = 'General' | 'Appearance' | 'Notifications' | 'Ignored' | 'Tidy up' | 'Juno' | 'AI activity' | 'Connections' | 'Backup & This Mac' | 'About'
export type PaletteTabName = 'All' | 'Conversations' | 'Messages' | 'Commands'

/** What a native menu showed: its labels ("-" a separator, "(label)" disabled) and where it was asked to open. */
export interface MenuSeen {
  readonly labels: string[]
  readonly at: { readonly x: number; readonly y: number } | null
}

export interface SidebarRowVerbs {
  hover(): Promise<void>
  focus(): Promise<void>
  select(): Promise<void>
  open(): Promise<void>
  openInNewTab(): Promise<void>
  chooseInMenu(item: string): Promise<MenuSeen>
  expectVisible(): Promise<void>
  expectAbsent(): Promise<void>
  expectSelected(selected?: boolean): Promise<void>
  expectFocused(): Promise<void>
  expectPreview(text: TextMatch): Promise<void>
  expectUnread(count: number): Promise<void>
  expectRead(): Promise<void>
  expectMention(): Promise<void>
  expectChannel(name: string): Promise<void>
  expectResolvedCheck(shown?: boolean): Promise<void>
}

export interface SidebarVerbs {
  row(title: string, options?: { readonly exact?: boolean }): SidebarRowVerbs
  leave(): Promise<void>
  titles(section?: SidebarSectionName): Promise<string[]>
  expectTop(...titles: ReadonlyArray<string>): Promise<void>
  expectRows(): Promise<void>
  expectNoSection(section: SidebarSectionName): Promise<void>
  filter(name: SidebarFilterName): Promise<void>
  toggleUnread(): Promise<void>
  expectFilterDot(name: 'Channels' | 'DMs', shown: boolean): Promise<void>
  clearFilters(): Promise<void>
  selectView(name: string): Promise<void>
  expectEmpty(title: string): Promise<void>
}

export interface TabStripVerbs {
  titles(): Promise<string[]>
  expectCount(count: number): Promise<void>
  expectActive(title: string): Promise<void>
  select(title: string): Promise<void>
  close(title: string): Promise<void>
  menu(id: AppMenuItem): Promise<void>
}

export interface TopicVerbs {
  send(text: string): Promise<void>
  expectSent(text: string): Promise<void>
  expectTitle(title: TextMatch): Promise<void>
  expectMessage(text: string): Promise<void>
  chooseInMenu(item: string): Promise<MenuSeen>
  chooseInTitleMenu(item: string): Promise<MenuSeen>
  chooseInMessageMenu(text: string, item: string | null, options?: { readonly onSender?: boolean }): Promise<{ readonly labels: string[] }>
}

export interface PaletteVerbs {
  open(): Promise<void>
  openCommands(): Promise<void>
  openMessages(): Promise<void>
  expectOpen(): Promise<void>
  expectClosed(): Promise<void>
  expectTab(name: PaletteTabName): Promise<void>
  type(text: string): Promise<void>
  clear(): Promise<void>
  press(key: string): Promise<void>
  activeText(): Promise<string>
  expectActive(text: TextMatch): Promise<void>
  expectResults(): Promise<void>
  arrowTo(text: TextMatch): Promise<void>
  choose(text: TextMatch, options?: { readonly newTab?: boolean }): Promise<void>
  chooseFromMenu(text: TextMatch, id: string): Promise<void>
  expectNoMatches(): Promise<void>
}

export interface HomeWriteVerbs {
  write(text: string): Promise<void>
  send(): Promise<void>
  pickConversation(query: string, name: string): Promise<void>
  expectDestination(label: string): Promise<void>
  pickTopic(query: string, title: string): Promise<void>
  expectTopic(label: string): Promise<void>
}

export interface SettingsVerbs {
  show(name: SettingsSectionName): Promise<void>
}

export interface AccountMenuVerbs {
  open(): Promise<void>
  close(): Promise<void>
  choose(name: TextMatch): Promise<void>
}

export interface JunoVerbs {
  signIn(options?: { readonly skipSetUp?: boolean }): Promise<void>
  skipSetUp(): Promise<void>
  waitForSync(): Promise<void>
  expectEngineLive(timeout?: number): Promise<void>
  chooseNextMenuItem(id: string | null, options?: { readonly hold?: boolean }): Promise<void>
  lastMenu(): Promise<MenuSeen>
  releaseMenu(): Promise<void>
  menusAsked(): Promise<number>
  expectToast(text: string): Promise<void>
  undoFromToast(): Promise<void>
  undo(): Promise<void>
  rename(title: string): Promise<void>
  clipboard(): Promise<string>
  browserLinks(): Promise<string[]>
  slackLinks(): Promise<string[]>
  workPass(name: WorkPassName): Promise<void>
  aiCalls(): Promise<Record<string, number>>
  openSettings(section?: SettingsSectionName): Promise<void>
  openNotifications(): Promise<void>
  setTheme(theme: 'Light' | 'Dark'): Promise<void>
  expectNothingOpen(): Promise<void>
}
