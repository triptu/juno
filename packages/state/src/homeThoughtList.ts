/**
 * Home's thoughts (SPEC 12, "A thought"): quotes and facts, loaded as their
 * own chunk (`homeThoughts.ts`). Every quote is real and correctly
 * attributed, every fact true and stable; `source` says where to check it
 * and is never shown. When in doubt, leave an entry out.
 */
import type { ThoughtEntry } from './homeThoughts'

export const HOME_THOUGHTS: ReadonlyArray<ThoughtEntry> = [
  { text: 'The first principle is that you must not fool yourself and you are the easiest person to fool.', by: 'Richard Feynman', theme: 'thinking', source: '"Cargo Cult Science", Caltech commencement address, 1974' },
  { text: 'How we spend our days is, of course, how we spend our lives.', by: 'Annie Dillard', theme: 'life', source: 'The Writing Life, 1989' },
  { text: 'Light from the Sun takes about 8 minutes and 20 seconds to reach Earth.', theme: 'wonder', source: 'NASA, "Sun: Facts"' },
]
