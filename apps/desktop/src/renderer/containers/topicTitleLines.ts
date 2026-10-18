import type { TopicTitleLines } from '@juno/state'

/** A preference change keeps the first visible row, including its partially scrolled offset. */
export function applyTopicTitleLines(lines: TopicTitleLines): void {
  const root = document.documentElement
  const previous = root.dataset['topicTitleLines']
  if (previous === lines) return
  const list = previous === undefined ? null : document.querySelector<HTMLElement>('[role="group"][aria-label="Topics"]')
  let anchor: HTMLElement | undefined
  let top = 0
  if (list !== null && list.scrollTop > 0) {
    const edge = list.getBoundingClientRect().top
    for (const row of list.querySelectorAll<HTMLElement>('[data-topic-row]')) {
      const box = row.getBoundingClientRect()
      if (box.bottom <= edge) continue
      anchor = row
      top = box.top
      break
    }
  }
  root.style.setProperty('--topic-title-lines', lines === 'two' ? '2' : '1')
  root.dataset['topicTitleLines'] = lines
  // One synchronous layout for a preference change, before paint. Native anchoring
  // can choose the preview inside a partially visible row and move its top instead.
  if (anchor !== undefined && list !== null) {
    const delta = anchor.getBoundingClientRect().top - top
    list.scrollTop += delta
  }
}
