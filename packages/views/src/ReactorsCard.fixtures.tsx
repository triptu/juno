import { defineFixtures, fixture } from '@juno/ui'
import { asReactor, crowd, customEmoji, manyReactions } from './fixtures/reactions'
import { me } from './fixtures/messages'
import { people } from './fixtures/topics'
import { ReactorsCard } from './ReactorsCard'

const seeAll = () => {}
const tada = manyReactions[0]!

export default defineFixtures(ReactorsCard, {
  // Who reacted, from the reaction chip under a message.
  Reactors: {
    one: fixture({ name: 'eyes', emoji: '👀', reactors: [asReactor(people.maya)], count: 1, onSeeAll: seeAll }),
    three: fixture({ name: '+1', emoji: '👍', reactors: [asReactor(me), asReactor(people.leo), asReactor(people.sam)], count: 3, onSeeAll: seeAll }),
    // Six names fit, so all six are named and there is nothing more to see.
    six: fixture({ name: 'heart', emoji: '❤️', reactors: crowd.slice(1, 7).map(asReactor), count: 6, onSeeAll: seeAll }),
    // Forty: ten known, you first; the sentence stops at about two lines and See all opens the dialog.
    forty: fixture({ name: 'tada', emoji: '🎉', reactors: tada.people.slice(0, 10), count: 40, onSeeAll: seeAll }),
    'see-all-hover': fixture({ name: 'tada', emoji: '🎉', reactors: tada.people.slice(0, 10), count: 40, onSeeAll: seeAll }, { hover: '[data-see-all]' }),
    // In a peek the chips are labels: no dialog, so no See all.
    'forty-no-dialog': fixture({ name: 'tada', emoji: '🎉', reactors: tada.people.slice(0, 10), count: 40 }),
  },
  Data: {
    // Slack listed fewer people than its count.
    partial: fixture({ name: 'white_check_mark', emoji: '✅', reactors: [asReactor(people.dev), asReactor(people.priya)], count: 6, onSeeAll: seeAll }),
    'nobody-listed': fixture({ name: 'rocket', emoji: '🚀', reactors: [], count: 3, onSeeAll: seeAll }),
    custom: fixture({ name: 'party-blob', emoji: ':party-blob:', url: customEmoji['party-blob'], reactors: [asReactor(people.elena), asReactor(people.jonas)], count: 2, onSeeAll: seeAll }),
    'long-name': fixture({ name: 'face_with_open_eyes_and_hand_over_mouth', emoji: '🫢', reactors: [asReactor({ id: 'U0LONG', name: 'Maximilian-Alexander Fitzgerald-Montgomery-Rutherford', color: 'jordy' })], count: 1, onSeeAll: seeAll }),
    'long-names-many': fixture({ name: 'raised_hands', emoji: '🙌', reactors: crowd.slice(18, 28).map(asReactor), count: 14, onSeeAll: seeAll }),
  },
})
