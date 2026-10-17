import * as stylex from '@stylexjs/stylex'
import { useState, type MouseEvent, type ReactNode } from 'react'
import { accent, radii, sizes } from '@juno/tokens/tokens.stylex'
import type { ActivateEvent } from '@juno/ui'

/** What a message's links do, for those that open inside Juno (SPEC 8, "Links"). */
export interface LinkInfo {
  /** The link opens inside Juno: it keeps the arrow cursor, as other links inside the app do. */
  readonly inApp: (url: string) => boolean
  /** Where an in-app link goes ("#eng · Thread"), asked for on hover; undefined keeps the URL as the hover text. */
  readonly describe: (url: string) => Promise<string | undefined>
}

interface LinkProps {
  readonly url: string
  readonly onLink: ((url: string, event: ActivateEvent) => void) | undefined
  readonly linkInfo: LinkInfo | undefined
  readonly tabIndex: 0 | -1
  readonly children: ReactNode
}

/**
 * A link in a message. The URL shows on hover; a Slack link that opens
 * inside Juno shows where it goes instead, once known, and keeps the arrow
 * cursor. Only links that leave the app get the pointer.
 */
export function MessageLink({ url, onLink, linkInfo, tabIndex, children }: LinkProps) {
  const inApp = linkInfo?.inApp(url) === true
  const [described, setDescribed] = useState<{ readonly url: string; readonly place: string }>()
  const title = described?.url === url ? described.place : url
  const open = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    onLink?.(url, { metaKey: event.metaKey, shiftKey: event.shiftKey, altKey: event.altKey, source: event.detail === 0 ? 'keyboard' : 'pointer' })
  }
  const describe = () => {
    if (inApp && described?.url !== url) void linkInfo?.describe(url).then((place) => place === undefined || setDescribed({ url, place }))
  }
  return (
    <a href={url} title={title} onClick={open} onMouseEnter={describe} draggable={false} tabIndex={tabIndex} data-in-app={inApp ? '' : undefined} {...stylex.props(styles.link, inApp ? styles.inAppLink : styles.outLink)}>
      {children}
    </a>
  )
}

const styles = stylex.create({
  link: {
    color: accent['--hl-text'],
    textDecorationLine: 'underline',
    textDecorationColor: 'color-mix(in oklch, currentColor 35%, transparent)',
    textUnderlineOffset: sizes['--link-underline-offset'],
    borderRadius: radii['--radius-xs'],
    outlineStyle: { default: 'none', ':focus-visible': 'solid' },
    outlineWidth: sizes['--focus-ring-width'],
    outlineOffset: sizes['--focus-ring-offset'],
    scrollMargin: sizes['--focus-ring-room'],
    outlineColor: accent['--focus-ring'],
  },
  outLink: {
    cursor: 'pointer', // external-link-cursor
  },
  inAppLink: {
    cursor: 'default',
  },
})
