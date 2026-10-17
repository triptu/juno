import * as stylex from '@stylexjs/stylex'
import { useState, type Ref } from 'react'
import { colors, layout, sizes, spacing } from '@juno/tokens/tokens.stylex'
import { ArrowSquareOut } from '@phosphor-icons/react/dist/icons/ArrowSquareOut'
import { Globe } from '@phosphor-icons/react/dist/icons/Globe'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { Icon, IconButton, Text } from '@juno/ui'
import { HeaderIslands } from './header/HeaderIslands'

export interface WebPanelProps {
  /** The page's title; empty while it has none, and the host shows instead. */
  readonly title: string
  readonly host: string
  /** The page's icon url, or null for the globe. */
  readonly favicon: string | null
  readonly loading: boolean
  readonly onOpenInBrowser: () => void
  readonly onClose: () => void
  /** The empty box main draws the page over. */
  readonly pageRef: Ref<HTMLDivElement>
}

/**
 * The web panel (SPEC 7): a link's page beside the topic, in the Juno
 * panel's place. The header is the panel's islands row: the site's icon and
 * the page title (the host while there is none) on the left, Open in browser
 * and Close on the right. Below it is an empty box; main draws the page over it.
 */
export function WebPanel({ title, host, favicon, loading, onOpenInBrowser, onClose, pageRef }: WebPanelProps) {
  const name = title === '' ? host : title
  return (
    <div data-web-panel="" data-testid="web-panel" {...stylex.props(styles.root)}>
      <HeaderIslands
        column="panel"
        left={
          <span {...stylex.props(styles.title)}>
            <SiteIcon src={favicon} />
            <Text variant="ui" weight="medium" truncate tooltipWhenTruncated dir="auto" as="span" data-testid="web-panel-title">
              {name}
            </Text>
            {loading ? (
              <Text variant="ui" tone="muted" as="span" sx={styles.loading}>
                Loading…
              </Text>
            ) : null}
          </span>
        }
        right={
          <>
            <IconButton icon={ArrowSquareOut} label="Open in browser" size={28} iconSize={15} radius="full" variant="island" onClick={onOpenInBrowser} data-testid="web-panel-open-browser" />
            <IconButton icon={X} label="Close" size={28} iconSize={15} radius="full" variant="island" onClick={onClose} data-testid="web-panel-close" />
          </>
        }
      />
      <div ref={pageRef} data-testid="web-panel-page" {...stylex.props(styles.page)} />
    </div>
  )
}

/** The page's icon, or the globe when it has none or it fails to load. */
function SiteIcon({ src }: { readonly src: string | null }) {
  const [failed, setFailed] = useState<string | null>(null)
  if (src === null || failed === src) return <Icon icon={Globe} size={16} />
  return <img src={src} alt="" onError={() => setFailed(src)} {...stylex.props(styles.icon)} />
}

const styles = stylex.create({
  root: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'column',
    flexGrow: 1,
    minHeight: 0,
  },
  // Spaced as the Juno panel's title button, which this replaces.
  title: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: spacing['--space-1-5'],
    minWidth: 0,
    height: sizes['--control-28'],
    paddingInline: spacing['--space-2'],
    color: colors['--foreground-default'],
  },
  loading: {
    flexShrink: 0,
  },
  icon: {
    flexShrink: 0,
    width: sizes['--icon-16'],
    height: sizes['--icon-16'],
  },
  page: {
    flexGrow: 1,
    minHeight: 0,
    marginTop: layout['--header-island-height'],
  },
})
