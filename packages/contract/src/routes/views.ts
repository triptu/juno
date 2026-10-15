/**
 * Sidebar views (spec section 5 "Views", inventory 2.3, 15.7, 15.8): pills
 * in the filter row, each a set of channels and DMs the user picked. Local
 * to Juno; nothing is written to Slack.
 *
 * `views.list` streams the views in pill order with their conversations.
 * The list itself is `topics.list` with `view`, and the dots are
 * `topics.counts`' `viewMentions`.
 *
 * `views.save` creates a view (no `id`) or replaces one whole, from the
 * sheet; it is also the command a Juno settings tool will call ("make a
 * Bots view with every alerts channel"). Delete, add and remove return their
 * undo (ADR 0010); `views.restore` is the undo of a delete.
 */
import { Schema } from 'effect'
import { Rpc, RpcGroup } from 'effect/rpc'
import { NotFound, NotSignedIn } from '../errors'
import { liveValueRoute } from '../live'
import { ChannelRef } from '../refs'
import { AutomatedPlace, SavedView, ViewIcon } from '../views'
import { CommandResult, TopicActionError } from './topics'

/** A view as the pill row and the sheet show it: its conversations joined, by name. */
export const SidebarView = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  icon: Schema.optionalKey(ViewIcon),
  keepOutOfAll: Schema.Boolean,
  /** Conversations the store knows, by name. */
  channels: Schema.Array(ChannelRef),
  /** Automated only: the conversations Juno put there itself, which the sheet marks "Added by Juno". */
  addedByJuno: Schema.optionalKey(Schema.Array(Schema.String)),
})
export type SidebarView = typeof SidebarView.Type

/** Every view, in pill order. */
export const viewsList = liveValueRoute('views.list', { value: Schema.Array(SidebarView) })

/** What the sheet saves. A name that is blank after trimming is `NotFound` of kind `name`. */
export const ViewDraft = Schema.Struct({
  /** Absent for a new view, which goes last. */
  id: Schema.optionalKey(Schema.String),
  name: Schema.String,
  icon: Schema.optionalKey(ViewIcon),
  keepOutOfAll: Schema.Boolean,
  channels: Schema.Array(Schema.String),
})
export type ViewDraft = typeof ViewDraft.Type

export const ViewError = Schema.Union([NotSignedIn, NotFound])

/** Creates or replaces a view. Returns its id. */
export const viewsSave = Rpc.make('views.save', { payload: ViewDraft, success: Schema.Struct({ id: Schema.String }), error: ViewError })

/** Deletes a view. The undo is `views.restore` with the view as it was. */
export const viewsDelete = Rpc.make('views.delete', { payload: { id: Schema.String }, success: CommandResult, error: TopicActionError })

/** Puts a deleted view back with its id, conversations and place. */
export const viewsRestore = Rpc.make('views.restore', { payload: { view: SavedView }, success: CommandResult, error: TopicActionError })

const membership = { id: Schema.String, channel: Schema.String }

/** Adds a conversation to a view. The undo removes it. */
export const viewsAddChannel = Rpc.make('views.addChannel', { payload: membership, success: CommandResult, error: TopicActionError })

/** Removes a conversation from a view. The undo adds it back. */
export const viewsRemoveChannel = Rpc.make('views.removeChannel', { payload: membership, success: CommandResult, error: TopicActionError })

/** The pill order: every view id, in order. Ids it does not name keep their place after these. */
export const viewsReorder = Rpc.make('views.reorder', { payload: { ids: Schema.Array(Schema.String) }, success: Schema.Void, error: NotSignedIn })

/**
 * The user's answer about the Automated view, from Home's question: Move puts
 * the conversation in the view (making the view if Juno has not yet), Keep
 * in All keeps it where it is. Either is remembered and never asked again.
 * The undo puts back the question, or the earlier answer.
 */
export const viewsSortChannel = Rpc.make('views.sortChannel', { payload: { channel: Schema.String, to: AutomatedPlace }, success: CommandResult, error: TopicActionError })

export const ViewsRoutes = RpcGroup.make(viewsList, viewsSave, viewsDelete, viewsRestore, viewsAddChannel, viewsRemoveChannel, viewsReorder, viewsSortChannel)
