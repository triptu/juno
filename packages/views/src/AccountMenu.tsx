import * as stylex from '@stylexjs/stylex'
import type { ReactNode } from 'react'
import { spacing } from '@juno/tokens/tokens.stylex'
import { Avatar, OptionHeader, OptionSeparator, Text, type HueName } from '@juno/ui'

export interface AccountMenuSection {
  readonly title: string
  readonly content: ReactNode
}

export interface AccountMenuProps {
  readonly name: string
  readonly initials: string
  readonly hue: HueName
  readonly avatarUrl?: string
  /** "acme.slack.com", or the team name. */
  readonly workspace: string
  /** Titled blocks under the header, separated by hairlines. */
  readonly sections: ReadonlyArray<AccountMenuSection>
}

/**
 * What the avatar button opens (inventory 2.1): who is signed in, then
 * the blocks the owner passes. Until Preferences exists this is where the
 * appearance settings and the diagnostics live.
 */
export function AccountMenu({ name, initials, hue, avatarUrl, workspace, sections }: AccountMenuProps) {
  return (
    <div {...stylex.props(styles.root)}>
      <OptionHeader leading={<Avatar label={initials} name={name} hue={hue} size={32} {...(avatarUrl === undefined ? {} : { src: avatarUrl })} />} title={name} sub={workspace} />
      {sections.map((section) => (
        <div key={section.title} {...stylex.props(styles.section)}>
          <OptionSeparator />
          <section aria-label={section.title} {...stylex.props(styles.block)}>
            <Text variant="sectionLabel" tone="muted" as="h3">
              {section.title}
            </Text>
            {section.content}
          </section>
        </div>
      ))}
    </div>
  )
}

const styles = stylex.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
  },
  block: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing['--space-2-5'],
    paddingBlock: spacing['--space-2'],
    paddingInline: spacing['--space-2'],
  },
})
