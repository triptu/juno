# 0014. Keep `net.fetch` for writes; delete the copy the network makes of a post

Status: accepted, 2026-10-16. Adds to ADR 0007 and ADR 0011.

## Context

The break pass found a post that reached Slack twice. `PostWorker` sends each post once through `Outbox.sendOnce`, but under it `net.fetch` (ADR 0007) runs on Chromium's network stack, which sends a request again by itself.

The rule is in `HttpNetworkTransaction::HandleIOError` and `ShouldResendRequest` (`net/http/http_network_transaction.cc`). If a request fails with `ERR_CONNECTION_RESET`, `ERR_CONNECTION_CLOSED`, `ERR_CONNECTION_ABORTED`, `ERR_SOCKET_NOT_CONNECTED` or `ERR_EMPTY_RESPONSE`, and it ran on a reused connection with no response headers yet, Chromium resets the connection and sends it again. The method is not checked. HTTP/2 `ERR_HTTP2_PING_FAILED` and some QUIC errors are resent too (up to two retries), even on a new connection. This is meant for a server that closes an idle keep-alive connection just as the client writes. Chromium cannot tell that case from a server that ran the request and lost the connection before answering. In the second case Slack holds two messages.

We checked this in Electron 44.7.0 against a local server that runs a POST and then closes the connection with no answer. Each row counts how often the server received the POST:

| Request | HTTP/1.1 | HTTP/2 |
| --- | --- | --- |
| `net.fetch` POST on a reused connection | 2 | 2 |
| `net.fetch` POST as the first request on a new connection | 1 | 1 |
| plus `Connection: close` on the POST | 2 | 2 |
| `cache: 'no-store'`, a `FormData` body or a `ReadableStream` body | 2 | |
| `net.request` (`ClientRequest`) | 2 | |
| `fetch` on a separate session | 2 | |
| Node `fetch` (undici) | 1 | |

Neither Chromium nor Electron has an option, a load flag or a session switch that turns the resend off. The engine's vitest suites run on Node `fetch`, so they never saw it. The fake's `loseResponse` closes the connection after running the call, so e2e under Electron shows it.

## Options

1. **Send posts on a path Chromium cannot resend.** Node `fetch` does not resend, but it gives up what ADR 0007 chose `net` for: cookie rotation, the system proxy and PAC, keychain CAs and Chromium's TLS fingerprint. Behind a corporate proxy that intercepts TLS, a user could read but not send. A new connection per post (a separate session closed after each write) avoids the resend on HTTP/1.1 only. It costs a TLS handshake per send, against the send budget, and HTTP/2 PING and QUIC errors still resend. Neither option covers a proxy or load balancer that repeats a request.
2. **Reconcile by `client_msg_id`.** Every post already carries a new id, and Slack returns it on the message (research, "Posting"). A second message with the same id from the same user is a copy, never a second send, so Juno can delete it. This works whatever repeated the request.
3. Hope that Slack deduplicates by `client_msg_id`. Not observed. Fake Slack only for this work, and live writes are limited to a test channel, so we did not check. The official client sends the same way, so Slack may. We cannot rely on it.

## Decision

Option 2. Keep `net.fetch` for every call.

- Before a post's one request leaves, the claim writes a `sent_posts` row (`client_msg_id`, channel, the sender's user id) in the same transaction (`claimPost`). The agent's sends write it before `sendOnce` (`agent-host/host.ts`).
- `writeMessage` calls `reconcileSent` in its transaction. The first copy Juno stores, from the answer, the echo, a page or the lookup, is the message, and `sent_posts.ts` keeps its ts. Another message by the same user with that id in that channel is a copy. It gets a `delete` outbox row naming it by ts alone (`queueCopyDelete`), so the list hides it in the same transaction and the `ActionWorker` deletes it from Slack, with the usual backoff and restart safety. `message_not_found` counts as done.
- A copy that has replies is left alone. Deleting it would hide other people's replies.
- `storedByClientMsgId` returns the kept copy first, so an edit or reaction made while the post was pending lands on the message the user sees.
- Edits, deletes, reactions and the upload calls (`files.getUploadURL`, the bytes, `files.completeUpload`) are safe to repeat as Juno uses them. A repeat sets the same text, deletes nothing more, answers `already_reacted` or `no_reaction`, or (in the fake) completes the same file again. They need nothing new. How real Slack answers a repeated `files.completeUpload` is not known. If it refuses, the post fails with Retry, and Slack still holds one file and no message. `files.share` posts a message with the post's `client_msg_id` and is reconciled like `chat.postMessage`.

## Consequences

- The user sees the message once: the copy is hidden in the transaction that stores it. Slack holds it once after the delete lands, usually within a second. Until then other people's clients can briefly see two, and a notification can go out for the copy. Only a transport that never resends could prevent that, and none we can use does.
- Two posts with the same text have different ids, so a message the user really sent twice is never deleted. Another person's message carrying the same id is never touched. Juno does not reconcile messages sent from other clients.
- `specs/outbox.qnt` models the network copy (`resend`, `observeCopy`, `deleteCopy`), with the broken pairs `networkCopy` (`shownOnce`) and `sameText` (`keepsRealSends`).
- The engine harness's `network.resend` sends a request again after its connection closed, as Chromium does, so engine tests cover this over Node `fetch`.
- If a later Electron gets a way to turn the resend off per request, use it for posts too. Reconciliation stays, because proxies can repeat requests as well.
