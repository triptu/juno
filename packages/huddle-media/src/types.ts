/**
 * The media session's interface and its snapshot. Plain data only, so the
 * snapshot can go straight into React's `useSyncExternalStore`.
 */

/** Why a call ended. */
export type EndReason =
  /** `leave()` was called. */
  | 'left'
  /** The same user joined the huddle from another device (Chime's `AudioJoinedFromAnotherDevice`). */
  | 'another-device'
  /** The meeting was deleted, which is how a huddle ends for everyone. */
  | 'meeting-ended'
  /** Chime removed this attendee. */
  | 'removed'
  /** The meeting has no room for another attendee. */
  | 'full'
  /** The connection dropped and did not come back within the reconnect window (30 s, SPEC 20). */
  | 'connection-lost'
  /** The call could not start, or broke in a way a retry of the same credentials will not fix. */
  | 'failed'

export type Connection =
  | { readonly state: 'idle' }
  | { readonly state: 'connecting' }
  | { readonly state: 'connected' }
  /** The connection dropped and Chime is trying again. Mute and device changes still apply. */
  | { readonly state: 'reconnecting' }
  /**
   * `attendeeId` is the call's own attendee, so a late end is never taken for a newer call's.
   * `code` is Chime's status code name, for logs.
   */
  | { readonly state: 'ended'; readonly reason: EndReason; readonly attendeeId: string; readonly code: string }

/** Whether Juno may use the microphone. `unavailable`: no microphone is connected. */
export type MicrophoneAccess = 'unknown' | 'prompt' | 'granted' | 'denied' | 'unavailable'

/** Chime's Voice Focus. `unsupported` when this machine or page cannot run it; the call then goes on without it. */
export type NoiseSuppression = 'unsupported' | 'on' | 'off'

export interface RemoteAttendee {
  /** Chime's attendee id. */
  readonly attendeeId: string
  /** Chime's `ExternalUserId`: team id, room id and user id joined by `-`. */
  readonly externalUserId: string
  /** The Slack user id parsed out of `externalUserId`, when it has the expected shape. */
  readonly userId: string | undefined
  readonly muted: boolean
  readonly speaking: boolean
}

export interface LocalAttendee {
  /** Set from `join()` until the next one. */
  readonly attendeeId: string | undefined
  readonly muted: boolean
  readonly speaking: boolean
  /**
   * The call is connected, the microphone's track is live and giving data, and
   * Chime's server reports a signal from us (signal strength above 0). It says
   * the uplink carries audio packets, not that they are loud: a quiet room and
   * a muted microphone still send.
   */
  readonly sending: boolean
}

export interface MediaDevice {
  readonly id: string
  readonly label: string
}

/**
 * The devices macOS lists, and the user's picks. A pick of `null` is "Same as
 * system". A pick that is not connected stays the pick; the system's device is
 * used until it comes back (SPEC 20), so `*InUse` can differ from the pick.
 */
export interface Devices {
  readonly microphones: ReadonlyArray<MediaDevice>
  readonly speakers: ReadonlyArray<MediaDevice>
  /** The system device's name, for "Same as system (MacBook Pro Speakers)". Empty when unknown. */
  readonly systemMicrophone: string
  readonly systemSpeaker: string
  readonly microphone: string | null
  readonly speaker: string | null
  readonly microphoneInUse: string | null
  readonly speakerInUse: string | null
}

/**
 * Phase 4, screen share (docs/plans/huddles.md section 5). Someone else's
 * shared screen; Slack allows two at once. The Chime session knows of a share
 * from its `#content` attendee but receives no video yet.
 */
export interface RemoteShare {
  /** The share's own Chime attendee id: the owner's id with `#content`. */
  readonly attendeeId: string
  /** The Slack user id of the person sharing, when known. */
  readonly userId: string | undefined
}

/** Phase 4: what the user shares, started from a `chromeMediaSourceId`. Not built yet. */
export interface LocalShare {
  readonly sourceId: string
}

export interface MediaSnapshot {
  readonly connection: Connection
  readonly local: LocalAttendee
  /** Everyone else in the call, in the order they joined. Content share attendees are not here. */
  readonly remotes: ReadonlyArray<RemoteAttendee>
  /** The attendee id of whoever speaks most right now, local or remote. */
  readonly activeSpeaker: string | undefined
  readonly devices: Devices
  readonly microphoneAccess: MicrophoneAccess
  readonly noiseSuppression: NoiseSuppression
  // Phase 4, screen share.
  readonly shares: ReadonlyArray<RemoteShare>
  readonly localShare: LocalShare | undefined
}

/** The `meeting` and `attendee` of `rooms.join`'s `call.free_willy`, as Slack sends them (Chime's own PascalCase shapes). */
export interface JoinInfo {
  readonly meeting: unknown
  readonly attendee: unknown
  /** The kept device picks. Absent or `null`: the system's. */
  readonly microphone?: string | null
  readonly speaker?: string | null
  /** Start with Voice Focus on. Default true. */
  readonly noiseSuppression?: boolean
}

/**
 * One huddle's audio, in the renderer. One call at a time: `join` while a call
 * is connecting or connected throws. After it ends, `join` may start a new one.
 */
export interface MediaSession {
  /** Starts the call. Resolves once Chime is starting; follow `connection` for the rest. */
  join(info: JoinInfo): Promise<void>
  /** Stops the call. Resolves when it has stopped, within 5 s. Safe to call in any state. */
  leave(): Promise<void>
  /** Takes effect at once, also while reconnecting. Unmuting does nothing while the microphone is blocked. */
  setMuted(muted: boolean): void
  setNoiseSuppression(on: boolean): Promise<void>
  /** Lists the devices again, and tries the microphone again when access was off. Call it when the window regains focus. */
  listDevices(): Promise<Devices>
  /** `null` is "Same as system". */
  chooseMicrophone(id: string | null): Promise<void>
  chooseSpeaker(id: string | null): Promise<void>
  /** Returns the unsubscribe function. */
  subscribe(listener: () => void): () => void
  /** The same object until something changes. */
  getSnapshot(): MediaSnapshot
}
