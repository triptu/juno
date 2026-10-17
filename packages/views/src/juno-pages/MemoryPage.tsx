import * as stylex from '@stylexjs/stylex'
import { chatCopy, type MemoryLine, type MemoryPage as MemoryPageModel } from '@juno/agent-contract'
import { spacing } from '@juno/tokens/tokens.stylex'
import { EmptyState, ListRow, Page, PageHeader, Surface, Text } from '@juno/ui'
import { cell } from './cell'
import { dayLabel, fullTime } from '../time'

export interface MemoryPageProps {
  readonly page: MemoryPageModel
  readonly now: number
}

const copy = chatCopy.pages.memory

/** The dates one summary line covers: one day, or "Oct 3 – Oct 9". */
function span(line: MemoryLine, now: number): string {
  const from = dayLabel(line.from, now)
  const to = dayLabel(line.to, now)
  return from === to ? from : copy.span(from, to)
}

/**
 * Juno's summary of the chat as a dated timeline (SPEC 13.8). Older lines
 * cover more days. A line being rebuilt after a removal reads "being
 * updated"; messages after `coveredThrough` are not summarised yet.
 */
export function MemoryPage({ page, now }: MemoryPageProps) {
  return (
    <Page>
      <PageHeader title={chatCopy.pageTitles.memory} subtitle={copy.subtitle} />
      {page.lines.length === 0 ? (
        <EmptyState illustration="nothing-here" title={copy.empty.title} body={copy.empty.body} enter={false} />
      ) : (
        <Surface kind="group" role="list" aria-label={copy.label}>
          {page.lines.map((line, index) => (
            <ListRow key={line.id} role="listitem" data-memory-line={line._tag} divider={index < page.lines.length - 1}>
              <span {...stylex.props(cell.lines, styles.entry)}>
                <Text variant="meta" tone="muted" numeric as="time" title={copy.spanTitle(fullTime(line.from), fullTime(line.to))}>
                  {span(line, now)}
                </Text>
                {line._tag === 'line' ? (
                  <Text variant="body" selectable dir="auto" sx={cell.wrap}>
                    {line.text}
                  </Text>
                ) : (
                  <Text variant="body" tone="muted" sx={styles.masked}>
                    {copy.beingUpdated}
                  </Text>
                )}
              </span>
            </ListRow>
          ))}
        </Surface>
      )}
      {page.coveredThrough !== undefined ? (
        <Text variant="meta" tone="muted" as="p">
          {copy.notYet(dayLabel(page.coveredThrough, now))}
        </Text>
      ) : null}
    </Page>
  )
}

const styles = stylex.create({
  entry: {
    paddingBlock: spacing['--space-1'],
  },
  masked: {
    fontStyle: 'italic',
  },
})
