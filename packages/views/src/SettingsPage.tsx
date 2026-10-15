import * as stylex from '@stylexjs/stylex'
import { Bell } from '@phosphor-icons/react/dist/icons/Bell'
import { EyeSlash } from '@phosphor-icons/react/dist/icons/EyeSlash'
import { Gear } from '@phosphor-icons/react/dist/icons/Gear'
import { HardDrives } from '@phosphor-icons/react/dist/icons/HardDrives'
import { Info } from '@phosphor-icons/react/dist/icons/Info'
import { Palette } from '@phosphor-icons/react/dist/icons/Palette'
import { Plugs } from '@phosphor-icons/react/dist/icons/Plugs'
import { Sparkle } from '@phosphor-icons/react/dist/icons/Sparkle'
import type { ReactNode } from 'react'
import type { SettingsSection } from '@juno/contract'
import { colors, layout, spacing } from '@juno/tokens/tokens.stylex'
import { NavItem, type PhosphorIcon } from '@juno/ui'

/** Each section's name in the list, in the list's order (SPEC 14). */
const settingsSections: ReadonlyArray<{ readonly section: SettingsSection; readonly label: string; readonly icon: PhosphorIcon }> = [
  { section: 'general', label: 'General', icon: Gear },
  { section: 'appearance', label: 'Appearance', icon: Palette },
  { section: 'notifications', label: 'Notifications', icon: Bell },
  { section: 'ignored', label: 'Ignored', icon: EyeSlash },
  { section: 'juno', label: 'Juno', icon: Sparkle },
  { section: 'connections', label: 'Connections', icon: Plugs },
  { section: 'backup', label: 'Backup & This Mac', icon: HardDrives },
  { section: 'about', label: 'About', icon: Info },
]

export interface SettingsPageProps {
  readonly section: SettingsSection
  readonly onSection: (section: SettingsSection) => void
  /** The section's page: a `Page width="settings"` with its title, which scrolls on its own. */
  readonly children?: ReactNode
}

/**
 * Settings (SPEC 14, inventory 14): the list of sections on the left, as
 * in a Mac app's settings, and the open section's page beside it in the
 * settings column. The list does not scroll with the page. Its first row
 * starts on the page title's top edge, and it keeps the sidebar's inset on
 * both sides.
 */
export function SettingsPage({ section, onSection, children }: SettingsPageProps) {
  return (
    <div {...stylex.props(styles.root)}>
      <nav aria-label="Settings" data-settings-nav="" {...stylex.props(styles.nav)}>
        {settingsSections.map((entry) => (
          <NavItem key={entry.section} icon={entry.icon} active={entry.section === section} onSelect={() => onSection(entry.section)}>
            {entry.label}
          </NavItem>
        ))}
      </nav>
      <div data-settings-section={section} {...stylex.props(styles.page)}>
        {children}
      </div>
    </div>
  )
}

const styles = stylex.create({
  root: {
    display: 'flex',
    flexGrow: 1,
    minHeight: 0,
    minWidth: 0,
  },
  nav: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-0-5'],
    flexShrink: 0,
    width: layout['--settings-nav-width'],
    boxSizing: 'border-box',
    // The page's top padding, so the first row lines up with the section's title.
    paddingTop: spacing['--space-10'],
    paddingInline: layout['--sidebar-inset'],
    borderRightWidth: '1px',
    borderRightStyle: 'solid',
    borderRightColor: colors['--border-subtle'],
    userSelect: 'none',
  },
  page: {
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minWidth: 0,
    minHeight: 0,
  },
})
