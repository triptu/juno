import { largeSeed } from '@juno/fake-slack'

/**
 * Repair needs 150 recently active conversations and threads outside the ten-topic recheck,
 * not a throughput workload. Keep all 300 conversations and enough paginated follows and
 * three-reply threads, with one week's activity. The performance tests retain 100,000 messages.
 */
export const mutationSeed = () => largeSeed({ users: 400, topics: 1_000, messages: 20_000, days: 7 })
