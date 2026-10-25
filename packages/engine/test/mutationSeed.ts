import { largeSeed } from '@juno/fake-slack'

/**
 * Repair needs threads outside the ten-topic recheck with three recent replies, and all 300
 * conversations so a call per conversation would break the catch-up call budget. It is not a
 * throughput workload: 1,500 messages and 150 threads over two days. The performance tests
 * keep 100,000 messages.
 */
export const mutationSeed = () => largeSeed({ users: 60, topics: 150, messages: 1_500, days: 2 })
