# Making and editing channels in Slack

How the official Slack client creates a channel, renames it, adds and removes members, and decides who may do those things. Juno's channel sheet (SPEC 5, "Channel sheet") is built on this.

## Sources and method

- Slack desktop 4.52.178. The newest Service Worker cache entry, `gantry-1792532253` (623 files), extracted and reformatted with esbuild, the same way as `slack-data-access.md` section 0. Bundles are named below by their short names:
  - `vendors` = `gantry-v2-vendors.5955d74ca8ca84ac` (one fetcher module per API method)
  - `client-boot` = `client-boot.c7150e67f4bccc17`
  - `cb-vendors` = `gantry-v2-async-client-boot-vendors.e3d23989a8a4ebad`
  - `cb-shared` = `gantry-v2-async-client-boot-shared.35cfcda49f6375c9`
  - `cb-render` = `gantry-v2-async-client-boot-render.5e213601c2e4c669`
- Module ids are webpack ids. Behaviour claims come from reading those modules.
- Live, on 2026-10-27, on the cached session, one workspace (not Enterprise Grid), an account with admin-level permissions. The only write was one private test channel made for this (named `juno-test-channel-edit-…`): it was renamed, probed with the user's own id and a fake id `U00000000`, then archived. No other person was invited or removed. Only method names, codes, field names and counts were kept.

## Create: `conversations.create`

Observed (`client-boot` `FRBq`, the "Create a channel" thunk; fetcher `vendors` `BIuB`):

```js
if (!isPrivate && isCurrentUserRestricted(state)) reject("restricted_action");
if (!name) reject("invalid_name_required");
let args = { name, validate_name: true };
isPrivate && (args.is_private = true);
teamId && (args.team_id = teamId);   // Enterprise Grid
```

- No `user_ids`: people are added after, with `conversations.invite`.
- The answer is `{ ok, channel }`, the whole channel object.
- Live, a new private channel came back with `is_private: true`, `is_group: false`, `is_channel: true` and a `C…` id. The client's private test is `(is_private || is_group) && !is_mpim` (`client-boot` `zdO/`); Juno's `conversationKind` reads it the same way.
- While the user types, the name field (`cb-shared` `VJrp`) calls `conversations.validateName { name }` 500 ms after the last key. Juno does not: it normalises as it goes and reads `name_taken` from the create answer.

## Names

Observed. The field lowercases, drops a leading `#` and turns whitespace into `-` as the user types (`cb-shared` `VJrp`; skipped when the `friendly_channel_names` experiment is on). With `validate_name` the server refuses a bad name rather than fixing it. Live, on `validateName`, `create` and `rename` alike:

| Input | Answer |
| --- | --- |
| lowercase Latin or non-Latin letters, `ü`, `_`, a leading `-`, `--` | ok |
| uppercase, a space, `!`, `.`, a leading `#` | `invalid_name_specials` |
| an emoji | `invalid_emoji_not_allowed` |
| `---` | `invalid_name_punctuation` |
| empty | `invalid_name_required` |
| 81 characters (80 is fine) | `invalid_name_maxlength` |
| `general` | `name_taken` |

- The client's own checks (`client-boot` `503p`): more than 80 graphemes (`Intl.Segmenter`); the specials ``[ .,;'`~!@#$%^&*+=)(\/:"<>?|‘’{}[\]]``; punctuation only `^[-|_]+$`; uppercase.
- `name_taken` covers a channel, a person's name or a user group with that name.
- The client's words: "Give your channel a name to continue…", "Channel names can’t be longer than 80 characters.", "Channel names can’t contain spaces or punctuation. Use dashes to separate words.", "That name is already taken by a channel, username, or user group in this workspace." Hint under the field: "Names must be lowercase, without spaces or periods, and can’t be longer than 80 characters."

Juno (`normalizeChannelName` in `@juno/domain`) lowercases, drops a leading `#`, turns whitespace into `-`, drops every character that is not a letter, mark, digit, `-` or `_`, and cuts at 80 graphemes. A name of `-` and `_` alone is left for Slack to refuse.

## Rename: `conversations.rename`

Observed (`vendors` `1j/C`; dialog `cb-shared` `BYCL`): `{ channel, name, validate: true }`, sent only when the name changed. The answer is `{ ok, channel }`; the client stores `name` and `name_normalized`.

- Its error list: `channel_not_found, invalid_emoji_not_allowed, invalid_name, invalid_name_maxlength, invalid_name_punctuation, invalid_name_required, invalid_name_specials, is_archived, method_not_supported_for_channel_type, missing_scope, name_taken, not_authorized, not_in_channel, restricted_action`. There is no `cant_rename_general` in this client.
- Live, renaming the private test channel sent `group_rename` with `channel: { id, name, name_normalized, … }` and a `channel_name` message.
- Live, a rename still worked after the channel was archived. Juno does not offer it there.

## Add people: `conversations.invite`

Observed (`vendors` `2aiM`; `client-boot` "addUsersAndGroupsToChannel"): one call, `users` a comma list, `force: true` from the add-people dialog, which leaves out people it knows are members already.

- The client handles two failure shapes: `ok: true` with `errors: [{ user, error }]`, and `ok: false` with an `errors` list in the error data. It ignores `already_in_channel`, `already_in_channel_ug` and `cant_invite_self`.
- Live: the user alone gave `ok: false, error: cant_invite_self` with an `errors` list; a fake id `user_not_found`; both together, with or without `force`, `ok: false` with both listed; an archived channel `is_archived` with no list.
- Other codes in the fetcher: `cant_invite`, `ura_max_channels` (single-channel guest), `user_is_restricted` (multi-channel guest into a public channel), `no_permission`, `not_owner`, `user_team_not_in_channel` (outside the organisation), `too_many_members`, `not_in_channel`, `restricted_action` and more.

Juno sends one `conversations.invite` with `force`, counts the ignored codes as done, and names each person in `errors` as not added. When the whole call fails, every person is named with its code.

## Remove people: `conversations.kick`

Observed (`vendors` `sS0r`; `cb-shared` `xi7f`): `{ channel, user }`, one person per call. Live: `cant_kick_self`, and `user_not_found` (also on an archived channel). The dialog handles `restricted_action` and `not_in_channel`. The client blocks #general itself (`is_general || is_org_mandatory`).

Juno sends one call per person and counts `not_in_channel` as done.

## Events

| Event | Fields |
| --- | --- |
| `channel_created` | `{ channel }` |
| `channel_joined`, `group_joined` | `{ channel }`, the whole object |
| `channel_rename`, `group_rename` | `{ channel: { id, name, name_normalized, is_channel, is_mpim, created } }` |
| `member_joined_channel` | `{ user, channel, inviter?, channel_type, team }` |
| `member_left_channel` | `{ user, channel }` |
| `user_permissions_added`, `_removed`, `_invalidated` | `{ entity_type, entity_id, permissions }` |

Live, the creator of a private channel got `channel_joined` with the whole object, then `member_joined_channel`, then a `channel_join` message. No `channel_created` or `group_joined`. The fake sends the same for a private channel, and `channel_created` first for a public one.

## Who may do what

Observed. The client reads no `who_can_*` team setting for channels. It asks the server through the edge API's `permissions/info` (`client-boot` `M3rm`): `{ user_id, permissions: [...], channel_id? }`, answer `{ allowed: [...] }`, cached for an hour. Live, without `channel_id`: `CREATE_PUBLIC_CHANNEL, CREATE_PRIVATE_CHANNEL, REMOVE_FROM_CHANNEL, REMOVE_FROM_PRIVATE_CHANNEL, ARCHIVE_CHANNEL, MANAGE_PUBLIC_CHANNELS`; with it, also `RENAME_CHANNEL, INVITE_TO_CHANNEL, ASSIGN_CHANNEL_MANAGER`.

The rules the client applies:

- New channel: `CREATE_PUBLIC_CHANNEL` or `CREATE_PRIVATE_CHANNEL`; guests cannot make public channels.
- Rename: `RENAME_CHANNEL` for that channel; never a DM or group DM.
- Add people: not single-channel guests, frontline workers or visitors, not archived channels. Public: any member, or an owner or org admin. Private: an owner or org admin, or a member with `INVITE_TO_CHANNEL`.
- Remove people: not guests, archived channels or #general. `REMOVE_FROM_CHANNEL` (public) or `REMOVE_FROM_PRIVATE_CHANNEL` (private); not yourself.
- Account fields read: `is_restricted`, `is_ultra_restricted`, `is_admin`, `is_owner`, `is_primary_owner`.

Juno does not call `permissions/info`: a menu cannot wait for the network. `channelEditRights` in `@juno/domain` reads the store: nothing in a DM, group DM, archived channel or channel the user is not in, and nothing for a guest; a Slack Connect channel only for an admin, an owner or its creator; in #general only an admin or owner renames and members are not changed. Slack still refuses what a workspace's settings forbid, and Juno says so in the toast. The role comes from `client.userBoot`'s `self` (`sync_state.selfRole`); `is_general`, `is_ext_shared` and `creator` from the channel objects.

## Member lists

Observed. The channel details list uses the edge API's `users/list` with `channels: [id]`, paged by `next_marker`; `channels/membership` checks given people. `conversations.members` (`{ members, response_metadata.next_cursor }`, live) appears in one AI path. Juno uses `conversations.members`, pages of 200, at most 1000 people.

## Unknowns

- An invite where some people are added and some refused, with `force`. It needs a second real account.
- Whether the creator of a public channel gets `channel_created`, and whether a public rename sends `channel_rename`.
- What a successful kick answers and which events it sends.
- The denial answers (`restricted_action`, `not_authorized`, `no_permission`): the test account is admin-level.
- Whether a rename of an archived channel is meant to work.
- How names behave with the `friendly_channel_names` experiment on.
- Enterprise Grid: `team_id` on create and the `as_admin` paths were read in code only.
- `cant_rename_general`, `cant_kick_from_general` and `no_channel` appear in Slack's public docs, not in this client.
