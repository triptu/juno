/**
 * One table of every Web API method Juno calls: its argument schema (form
 * fields) and its success fields. The client encodes arguments and decodes
 * responses through it; the fake decodes arguments and encodes responses
 * through it. Neither side can drift from the other without a type error.
 */
import { Schema as S } from 'effect'
import { ActivityFeedArgs, ActivityFeedFields } from './activity.ts'
import {
  ClientCountsArgs,
  ClientCountsFields,
  ClientUserBootArgs,
  ClientUserBootFields,
  GetWebSocketUrlArgs,
  GetWebSocketUrlFields,
  UsersPrefsGetArgs,
  UsersPrefsGetFields,
  UsersPrefsSetArgs,
  UsersPrefsSetFields,
} from './boot.ts'
import {
  ChatAttachmentActionArgs,
  ChatAttachmentActionFields,
  ChatDeleteArgs,
  ChatDeleteFields,
  ChatPostMessageArgs,
  ChatPostMessageFields,
  ChatShareMessageArgs,
  ChatShareMessageFields,
  ChatUpdateArgs,
  ChatUpdateFields,
  ReactionArgs,
  ReactionFields,
  ReactionsGetArgs,
  ReactionsGetFields,
} from './chat.ts'
import { ErrorResponse, okResponse } from './common.ts'
import { DndEndSnoozeArgs, DndEndSnoozeFields, DndInfoArgs, DndInfoFields, DndSetSnoozeArgs, DndSetSnoozeFields, DndTeamInfoArgs, DndTeamInfoFields } from './dnd.ts'
import {
  DraftsCreateArgs,
  DraftsDeleteArgs,
  DraftsDeleteFields,
  DraftsListArgs,
  DraftsListFields,
  DraftsUpdateArgs,
  DraftWriteFields,
} from './drafts.ts'
import {
  ConversationsCreateArgs,
  ConversationsCreateFields,
  ConversationsHistoryArgs,
  ConversationsHistoryFields,
  ConversationsMarkArgs,
  ConversationsMarkFields,
  ConversationsOpenArgs,
  ConversationsOpenFields,
  ConversationsRepliesArgs,
  ConversationsRepliesFields,
  ConversationsInfoArgs,
  ConversationsInfoFields,
  ConversationsJoinArgs,
  ConversationsJoinFields,
  ConversationsLeaveArgs,
  ConversationsLeaveFields,
  ConversationsViewArgs,
  ConversationsViewFields,
  ConversationsRenameArgs,
  ConversationsRenameFields,
  ConversationsInviteArgs,
  ConversationsInviteFields,
  ConversationsKickArgs,
  ConversationsKickFields,
  ConversationsMembersArgs,
  ConversationsMembersFields,
  GetFlannelHttpUrlArgs,
  GetFlannelHttpUrlFields,
} from './conversations.ts'
import {
  FilesCompleteUploadArgs,
  FilesCompleteUploadFields,
  FilesGetUploadUrlArgs,
  FilesGetUploadUrlFields,
  FilesShareArgs,
  FilesShareFields,
  FilesDeleteArgs,
  FilesDeleteFields,
  FilesInfoArgs,
  FilesInfoFields,
} from './files.ts'
import { RoomsJoinArgs, RoomsJoinFields, RoomsLeaveArgs, RoomsLeaveFields } from './huddles.ts'
import { SearchMessagesArgs, SearchMessagesFields } from './search.ts'
import { AuthTestArgs, AuthTestFields, UsergroupsListArgs, UsergroupsListFields, UsersProfileSetArgs, UsersProfileSetFields } from './users.ts'
import {
  ThreadGetViewArgs,
  ThreadGetViewFields,
  ThreadMarkArgs,
  ThreadMarkFields,
  ThreadSubscribeArgs,
  ThreadSubscribeFields,
} from './threads.ts'

function method<A extends S.Top, const F extends S.Struct.Fields>(args: A, fields: F) {
  const ok = okResponse(fields)
  return { args, ok, response: S.Union([ok, ErrorResponse]) } as const
}

export const Methods = {
  'auth.test': method(AuthTestArgs, AuthTestFields),
  'client.userBoot': method(ClientUserBootArgs, ClientUserBootFields),
  'client.counts': method(ClientCountsArgs, ClientCountsFields),
  'dnd.info': method(DndInfoArgs, DndInfoFields),
  'dnd.setSnooze': method(DndSetSnoozeArgs, DndSetSnoozeFields),
  'dnd.endSnooze': method(DndEndSnoozeArgs, DndEndSnoozeFields),
  'dnd.teamInfo': method(DndTeamInfoArgs, DndTeamInfoFields),
  'users.prefs.get': method(UsersPrefsGetArgs, UsersPrefsGetFields),
  'users.prefs.set': method(UsersPrefsSetArgs, UsersPrefsSetFields),
  'client.getWebSocketURL': method(GetWebSocketUrlArgs, GetWebSocketUrlFields),
  'api.getFlannelHttpUrl': method(GetFlannelHttpUrlArgs, GetFlannelHttpUrlFields),
  'conversations.history': method(ConversationsHistoryArgs, ConversationsHistoryFields),
  'conversations.replies': method(ConversationsRepliesArgs, ConversationsRepliesFields),
  'conversations.view': method(ConversationsViewArgs, ConversationsViewFields),
  'conversations.info': method(ConversationsInfoArgs, ConversationsInfoFields),
  'conversations.mark': method(ConversationsMarkArgs, ConversationsMarkFields),
  'conversations.open': method(ConversationsOpenArgs, ConversationsOpenFields),
  'conversations.join': method(ConversationsJoinArgs, ConversationsJoinFields),
  'conversations.leave': method(ConversationsLeaveArgs, ConversationsLeaveFields),
  'conversations.create': method(ConversationsCreateArgs, ConversationsCreateFields),
  'conversations.rename': method(ConversationsRenameArgs, ConversationsRenameFields),
  'conversations.invite': method(ConversationsInviteArgs, ConversationsInviteFields),
  'conversations.kick': method(ConversationsKickArgs, ConversationsKickFields),
  'conversations.members': method(ConversationsMembersArgs, ConversationsMembersFields),
  'subscriptions.thread.getView': method(ThreadGetViewArgs, ThreadGetViewFields),
  'subscriptions.thread.mark': method(ThreadMarkArgs, ThreadMarkFields),
  'subscriptions.thread.add': method(ThreadSubscribeArgs, ThreadSubscribeFields),
  'subscriptions.thread.remove': method(ThreadSubscribeArgs, ThreadSubscribeFields),
  // The official client sends `active` or `away` (research section 3, Presence); `auto` is the public `users.setPresence` value.
  'presence.set': method(S.Struct({ presence: S.Literals(['active', 'away']) }), {}),
  'chat.postMessage': method(ChatPostMessageArgs, ChatPostMessageFields),
  'chat.shareMessage': method(ChatShareMessageArgs, ChatShareMessageFields),
  'chat.update': method(ChatUpdateArgs, ChatUpdateFields),
  'chat.delete': method(ChatDeleteArgs, ChatDeleteFields),
  'chat.attachmentAction': method(ChatAttachmentActionArgs, ChatAttachmentActionFields),
  'reactions.add': method(ReactionArgs, ReactionFields),
  'reactions.remove': method(ReactionArgs, ReactionFields),
  'reactions.get': method(ReactionsGetArgs, ReactionsGetFields),
  'activity.feed': method(ActivityFeedArgs, ActivityFeedFields),
  'search.modules.messages': method(SearchMessagesArgs, SearchMessagesFields),
  'files.getUploadURL': method(FilesGetUploadUrlArgs, FilesGetUploadUrlFields),
  'files.completeUpload': method(FilesCompleteUploadArgs, FilesCompleteUploadFields),
  'files.share': method(FilesShareArgs, FilesShareFields),
  'usergroups.list': method(UsergroupsListArgs, UsergroupsListFields),
  'files.info': method(FilesInfoArgs, FilesInfoFields),
  'files.delete': method(FilesDeleteArgs, FilesDeleteFields),
  'rooms.join': method(RoomsJoinArgs, RoomsJoinFields),
  'rooms.leave': method(RoomsLeaveArgs, RoomsLeaveFields),
  'users.profile.set': method(UsersProfileSetArgs, UsersProfileSetFields),
  'drafts.list': method(DraftsListArgs, DraftsListFields),
  'drafts.create': method(DraftsCreateArgs, DraftWriteFields),
  'drafts.update': method(DraftsUpdateArgs, DraftWriteFields),
  'drafts.delete': method(DraftsDeleteArgs, DraftsDeleteFields),
} as const

export type Methods = typeof Methods
export type MethodName = keyof Methods
/** Typed arguments of a method (numbers and booleans, not form strings). */
export type MethodArgs<M extends MethodName> = Methods[M]['args']['Type']
/** The success payload of a method, `ok: true` included. */
export type MethodOk<M extends MethodName> = Methods[M]['ok']['Type']

export function isMethodName(name: string): name is MethodName {
  return Object.hasOwn(Methods, name)
}
