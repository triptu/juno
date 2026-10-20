/**
 * The media viewer's items that are not pictures (SPEC section 8, "Other
 * files"): a PDF in Chromium's PDF viewer, an HTML file in a sandboxed
 * frame, a text file as its kind reads best, and an audio file in a player.
 * Each fills the stage and scrolls inside it; the stage never grows.
 */
import * as stylex from '@stylexjs/stylex'
import { useContext, useEffect, useRef, useState } from 'react'
import { bodyFromMarkdown, csvRows, type FileView } from '@juno/contract'
import { colors, radii, spacing, text } from '@juno/tokens/tokens.stylex'
import { hueForId, Icon, Text } from '@juno/ui'
import { CodeHighlighterContext } from './CodeHighlight'
import { duration, fileIcon } from './FileCard'
import { MessageBody } from './MessageBody'

/** A text file as the container read it: its text, and whether it was cut short. */
export interface FileText {
  readonly text: string
  readonly truncated: boolean
}

/** Reads a text file's `content` url. Undefined when it could not be read. */
export type LoadFileText = (url: string, signal: AbortSignal) => Promise<FileText | undefined>

/** Rows of a CSV file the table shows; the rest wait for Download. */
const CSV_MAX_ROWS = 1000

interface ViewerDocumentProps {
  readonly file: FileView
  readonly now: number
  readonly loadText: LoadFileText | undefined
}

/** What one file shows inside the viewer's frame, which `MediaViewer` sizes to the stage. */
export function ViewerDocument({ file, now, loadText }: ViewerDocumentProps) {
  if (file.kind === 'audio') {
    return (
      <div {...stylex.props(styles.audio)}>
        <span {...stylex.props(styles.audioIcon)}>
          <Icon icon={fileIcon.audio} size={20} />
        </span>
        <Text variant="ui" weight="medium" tone="default" truncate dir="auto" data-sensitive="">
          {file.name}
        </Text>
        {file.durationMs === undefined ? null : (
          <Text variant="meta" tone="muted" numeric>
            {duration(file.durationMs)}
          </Text>
        )}
        <audio src={file.audio} controls preload="metadata" aria-label={file.name} {...stylex.props(styles.player)} />
      </div>
    )
  }
  // Not sandboxed: Chromium does not run its PDF viewer in a sandboxed frame. The frame shows only main's PDF answer.
  if (file.kind === 'pdf') return <iframe src={file.content} title={file.name} {...stylex.props(styles.embed)} />
  // No scripts, forms, popups or top navigation; main's answer adds a policy that allows no network.
  if (file.kind === 'html') return <iframe src={file.content} title={file.name} sandbox="" referrerPolicy="no-referrer" {...stylex.props(styles.embed, styles.page)} />
  return <TextFile file={file} now={now} loadText={loadText} />
}

type Loaded = { readonly state: 'loading' } | { readonly state: 'failed' } | ({ readonly state: 'ready' } & FileText)

/** A text file, read when it opens: blank while it loads, then drawn by its kind. */
function TextFile({ file, now, loadText }: { readonly file: FileView; readonly now: number; readonly loadText: LoadFileText | undefined }) {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const content = file.content
  useEffect(() => {
    if (content === undefined || loadText === undefined) return
    const abort = new AbortController()
    void loadText(content, abort.signal).then((read) => {
      if (!abort.signal.aborted) setLoaded(read === undefined ? { state: 'failed' } : { state: 'ready', ...read })
    })
    return () => abort.abort()
  }, [content, loadText])
  const unreadable = content === undefined || loadText === undefined
  if (!unreadable && loaded.state === 'loading') return null
  if (unreadable || loaded.state !== 'ready') {
    return (
      <div {...stylex.props(styles.empty)}>
        <Text variant="ui" tone="muted">
          Could not load this file. Download it to open it.
        </Text>
      </div>
    )
  }
  const cut = loaded.truncated ? 'Showing the first 2 MB. Download the file to see the rest.' : undefined
  // Focusable, so the keys scroll it.
  return (
    <div tabIndex={0} data-viewer-text="" data-sensitive="" {...stylex.props(styles.scroller)}>
      {file.textKind === 'markdown' ? (
        <div {...stylex.props(styles.markdown)}>
          <MessageBody body={bodyFromMarkdown(loaded.text)} now={now} hueOf={hueForId} />
        </div>
      ) : file.textKind === 'csv' ? (
        <CsvTable text={loaded.text} cut={cut} />
      ) : (
        <Mono text={file.textKind === 'json' ? prettyJson(loaded.text) : loaded.text} language={file.textKind === 'json' ? 'json' : file.textKind === 'code' ? undefined : 'plaintext'} wrap={file.textKind === 'plain'} />
      )}
      {cut === undefined || file.textKind === 'csv' ? null : <Note>{cut}</Note>}
    </div>
  )
}

/** JSON indented two spaces, or as written when it does not parse. */
function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

/** Code, JSON or a log in monospace, coloured like a message's code block when its language is known or detected. */
function Mono({ text: code, language, wrap }: { readonly text: string; readonly language: string | undefined; readonly wrap: boolean }) {
  const highlighter = useContext(CodeHighlighterContext)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = box.current
    if (highlighter === undefined || element === null || language === 'plaintext') return
    return highlighter.paint(element, code, language)
  }, [highlighter, code, language])
  return (
    <div ref={box}>
      <Text variant="code" as="pre" tone="default" selectable sx={wrap ? styles.wrap : styles.noWrap}>
        <code>{code}</code>
      </Text>
    </div>
  )
}

function Note({ children }: { readonly children: string }) {
  return (
    <Text variant="meta" tone="muted" as="p" sx={styles.note}>
      {children}
    </Text>
  )
}

/** A CSV file as a table: the first row as a header that stays in view, at most `CSV_MAX_ROWS` rows. */
function CsvTable({ text: source, cut }: { readonly text: string; readonly cut: string | undefined }) {
  const { rows, more } = csvRows(source, CSV_MAX_ROWS + 1)
  const [header, ...body] = rows
  if (header === undefined) return null
  const shown = body.slice(0, CSV_MAX_ROWS)
  const note = body.length > CSV_MAX_ROWS || more ? `Showing the first ${CSV_MAX_ROWS.toLocaleString()} rows. Download the file to see the rest.` : cut
  return (
    <>
      <table {...stylex.props(styles.table)}>
        <thead>
          <tr>
            {header.map((cell, index) => (
              <th key={index} scope="col" {...stylex.props(styles.cell, styles.head)}>
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, at) => (
            <tr key={at}>
              {row.map((cell, index) => (
                <td key={index} {...stylex.props(styles.cell)}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {note === undefined ? null : <Note>{note}</Note>}
    </>
  )
}

const styles = stylex.create({
  embed: {
    display: 'block',
    width: '100%',
    height: '100%',
    borderWidth: 0,
  },
  // The page an HTML file assumes when it sets no background of its own.
  page: {
    backgroundColor: colors['--background'],
  },
  scroller: {
    height: '100%',
    overflow: 'auto',
    overscrollBehavior: 'contain',
    userSelect: 'text',
    outlineStyle: 'none',
  },
  markdown: {
    paddingBlock: spacing['--space-6'],
    paddingInline: spacing['--space-8'],
  },
  wrap: {
    margin: 0,
    paddingBlock: spacing['--space-4'],
    paddingInline: spacing['--space-5'],
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
  noWrap: {
    margin: 0,
    paddingBlock: spacing['--space-4'],
    paddingInline: spacing['--space-5'],
    whiteSpace: 'pre',
  },
  note: {
    margin: 0,
    paddingBlock: spacing['--space-3'],
    paddingInline: spacing['--space-5'],
  },
  table: {
    borderCollapse: 'collapse',
    fontSize: text['--text-meta-size'],
    lineHeight: text['--text-meta-leading'],
    color: colors['--foreground-default'],
    fontVariantNumeric: 'tabular-nums',
  },
  cell: {
    paddingBlock: spacing['--space-1-5'],
    paddingInline: spacing['--space-3'],
    borderBottomWidth: '1px',
    borderBottomStyle: 'solid',
    borderBottomColor: colors['--border-default'],
    whiteSpace: 'nowrap',
    textAlign: 'start',
  },
  head: {
    position: 'sticky',
    top: 0,
    backgroundColor: colors['--surface-default'],
    fontWeight: 'inherit',
    color: colors['--foreground-subtle'],
  },
  empty: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    padding: spacing['--space-6'],
  },
  audio: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: spacing['--space-2'],
    padding: spacing['--space-6'],
    textAlign: 'center',
  },
  audioIcon: {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: spacing['--space-10'],
    height: spacing['--space-10'],
    borderRadius: radii['--radius-full'],
    backgroundColor: colors['--secondary-default'],
    color: colors['--foreground-subtle'],
  },
  player: {
    width: '100%',
    marginTop: spacing['--space-2'],
  },
})
