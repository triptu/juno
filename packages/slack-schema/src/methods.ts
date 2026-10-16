/**
 * One table of every Web API method Juno calls: its argument schema (form
 * fields) and its success fields. The client encodes arguments and decodes
 * responses through it; the fake decodes arguments and encodes responses
 * through it. Neither side can drift from the other without a type error.
 */
import { Schema as S } from 'effect'
import {
  ClientCountsArgs,
  ClientCountsFields,
  ClientUserBootArgs,
  ClientUserBootFields,
  GetWebSocketUrlArgs,
  GetWebSocketUrlFields,
  UsersPrefsGetArgs,
  UsersPrefsGetFields,
} from './boot.ts'
import {
  ChatDeleteArgs,
  ChatDeleteFields,
  ChatPostMessageArgs,
  ChatPostMessageFields,
  ChatUpdateArgs,
  ChatUpdateFields,
  ReactionArgs,
  ReactionFields,
} from './chat.ts'
import { ErrorResponse, okResponse } from './common.ts'
import {
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
  ConversationsViewArgs,
  ConversationsViewFields,
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
} from './files.ts'
import { SearchMessagesArgs, SearchMessagesFields } from './search.ts'
import { AuthTestArgs, AuthTestFields, UsergroupsListArgs, UsergroupsListFields } from './users.ts'
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
  'dnd.info': method(S.Struct({}), {
    dnd_enabled: S.Boolean,
    next_dnd_start_ts: S.Number,
    next_dnd_end_ts: S.Number,
    snooze_enabled: S.Boolean,
  }),
  'users.prefs.get': method(UsersPrefsGetArgs, UsersPrefsGetFields),
  'client.getWebSocketURL': method(GetWebSocketUrlArgs, GetWebSocketUrlFields),
  'api.getFlannelHttpUrl': method(GetFlannelHttpUrlArgs, GetFlannelHttpUrlFields),
  'conversations.history': method(ConversationsHistoryArgs, ConversationsHistoryFields),
  'conversations.replies': method(ConversationsRepliesArgs, ConversationsRepliesFields),
  'conversations.view': method(ConversationsViewArgs, ConversationsViewFields),
  'conversations.info': method(ConversationsInfoArgs, ConversationsInfoFields),
  'conversations.mark': method(ConversationsMarkArgs, ConversationsMarkFields),
  'conversations.open': method(ConversationsOpenArgs, ConversationsOpenFields),
  'subscriptions.thread.getView': method(ThreadGetViewArgs, ThreadGetViewFields),
  'subscriptions.thread.mark': method(ThreadMarkArgs, ThreadMarkFields),
  'subscriptions.thread.add': method(ThreadSubscribeArgs, ThreadSubscribeFields),
  'subscriptions.thread.remove': method(ThreadSubscribeArgs, ThreadSubscribeFields),
  // The official client sends `active` or `away` (research section 3, Presence); `auto` is the public `users.setPresence` value.
  'presence.set': method(S.Struct({ presence: S.Literals(['active', 'away']) }), {}),
  'chat.postMessage': method(ChatPostMessageArgs, ChatPostMessageFields),
  'chat.update': method(ChatUpdateArgs, ChatUpdateFields),
  'chat.delete': method(ChatDeleteArgs, ChatDeleteFields),
  'reactions.add': method(ReactionArgs, ReactionFields),
  'reactions.remove': method(ReactionArgs, ReactionFields),
  'search.modules.messages': method(SearchMessagesArgs, SearchMessagesFields),
  'files.getUploadURL': method(FilesGetUploadUrlArgs, FilesGetUploadUrlFields),
  'files.completeUpload': method(FilesCompleteUploadArgs, FilesCompleteUploadFields),
  'files.share': method(FilesShareArgs, FilesShareFields),
  'usergroups.list': method(UsergroupsListArgs, UsergroupsListFields),
} as const

export type Methods = typeof Methods
export type MethodName = keyof Methods
/** Typed arguments of a method (numbers and booleans, not form strings). */
export type MethodArgs<M extends MethodName> = Methods[M]['args']['Type']
/** The success payload of a method, `ok: true` included. */
export type MethodOk<M extends MethodName> = Methods[M]['ok']['Type']
export type MethodResponse<M extends MethodName> = Methods[M]['response']['Type']

export function isMethodName(name: string): name is MethodName {
  return Object.hasOwn(Methods, name)
}
