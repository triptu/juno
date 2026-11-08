import { describe, expect, it } from 'bun:test'
import { pillOrder } from '../src/index'

// The saved pill order is a workspace preference; views come and go and
// reorder in the views table while it stays as it was saved.
describe('pill order', () => {
  it('lays the pills out as Juno first does until the user moves one, and ignores a preference it cannot read', () => {
    expect(pillOrder(['automated', 'team'], undefined)).toEqual(['channels', 'dms', 'automated', 'team', 'reactions'])
    expect(pillOrder(['team'], 'reactions,team')).toEqual(['channels', 'dms', 'team', 'reactions'])
    expect(pillOrder(['team'], [42, null, 'team', 'team'])).toEqual(['channels', 'dms', 'team', 'reactions'])
  })

  it('drops a deleted view, puts a new one after the last view, and gives views the order the views table has', () => {
    const saved = ['reactions', 'hiring', 'channels', 'team', 'dms']
    // Team was deleted and Ops made: Ops goes after Hiring, the last view still there.
    expect(pillOrder(['hiring', 'ops'], saved)).toEqual(['reactions', 'hiring', 'ops', 'channels', 'dms'])
    // The view menu swapped Hiring and Team in the table: they swap places; the built-in pills stay put.
    expect(pillOrder(['team', 'hiring'], saved)).toEqual(['reactions', 'team', 'channels', 'hiring', 'dms'])
    // With no view placed yet, a new view goes after Channels and DMs.
    expect(pillOrder(['ops'], ['dms', 'reactions', 'channels'])).toEqual(['dms', 'reactions', 'channels', 'ops'])
  })
})
