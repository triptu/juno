# Sidebar view settings

`juno_views` lists, creates, replaces and deletes local sidebar views. `ViewHost`
uses only AgentHost RPCs; it never writes to Slack. `openTurns({ views })` installs
the tool, its Tier 1 executor and Undo. `startAgent` binds these to the current
account. A view update replaces all fields, including membership and the icon.

The tool uses `toolDecision('viewsSet')`: a clean owner run applies immediately;
an owner run that read Slack, a connection or a job report proposes a Change
card with a Because line. Wakes and reports cannot change views. Both paths show
"Done · Undo". The direct path records an authorization before calling the
host, with the journal position, and keeps unsafe replay. `view_authorities` binds its single-use owner grant
to the card, source input and memory generation; the authorization records that
id as `grant_id`. It is never a live grant for later tool calls. An unconfirmed call
is never retried. The click path uses WP15's dispatcher.

`view_changes` stores the account and the host's undo snapshot for each applied
card. Undo is a renderer command, never a model tool; it survives restart and
refuses a changed account or a newer edit to the view. An acknowledged Undo is
idempotent. A lost response after the host changed a view can leave the action
unconfirmed; the tool does not claim success or retry it.

`slack_channels` uses the existing read-tool surface to find cached channel ids
by a case-insensitive glob (`*alerts*`). It follows every page and returns only
ids and names. Directory metadata does not taint the run; message, topic and
person reads still do. This narrow lookup lets the owner request a view by
channel names without first reading Slack message content.
