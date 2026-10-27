/** Process kills and file restores do not discard the drive cache. */
export const testDurability = { fullfsync: process.env.JUNO_TEST_FULLFSYNC === '1' }
