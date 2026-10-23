import { code, files, p, reaction, window } from './messages'
import { people } from './topics'

/**
 * Lines that run to the column's right edge, for the menu button that shows over the end of the first line: a header
 * row, a grouped row, a code block first, a picture and reactions.
 */
export const longLines = window([
  { ago: 30, from: people.maya, text: 'Replication caught up overnight and the lag graph has been flat since about four, so I think we can move the cutover window earlier and skip the second dry run entirely if nobody objects.' },
  { ago: 29, from: people.maya, text: 'The one thing I would still check by hand is the sequence values on the billing tables, because the last migration reset two of them and nobody noticed for a week afterwards.' },
  { ago: 28, from: people.maya, blocks: [code("SELECT relname, last_value FROM pg_sequences JOIN pg_class ON pg_class.relname = pg_sequences.sequencename WHERE schemaname = 'billing';"), p('That is the query I used last time.')] },
  { ago: 20, from: people.leo, blocks: [p('Here is the graph from this morning, flat since 04:10:')], files: [files.landscape] },
  { ago: 19, from: people.leo, text: 'Agreed on skipping the second dry run. I will take the sequence check and post the numbers in the channel before lunch so everyone can see them.', reactions: [reaction('+1', '👍', 3, true), reaction('eyes', '👀', 1)] },
])
