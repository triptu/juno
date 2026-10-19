/**
 * The Chime media session: one huddle's audio with the Amazon Chime SDK, as
 * the spike joined it (`scripts/huddle-live-page.ts`). Audio only: no video is
 * received (`NoVideoDownlinkBandwidthPolicy`), so a camera someone turns on in
 * Slack costs nothing here.
 */
import {
  ConsoleLogger,
  DefaultActiveSpeakerPolicy,
  LogLevel,
  MeetingSessionConfiguration,
  NoVideoDownlinkBandwidthPolicy,
  type AudioInputDevice,
  type AudioVideoObserver,
  type Logger,
  type MeetingSessionStatus,
} from 'amazon-chime-sdk-js'
import { CONTENT_SUFFIX } from '../externalUserId.ts'
import { INITIAL_SNAPSHOT, patchAttendee, presence, setConnection, speakers, startCall } from '../snapshot.ts'
import { SnapshotStore } from '../store.ts'
import type { Devices, EndReason, HuddleSound, JoinInfo, MediaSession, MicrophoneAccess } from '../types.ts'
import { deviceList, inUse } from '../devices.ts'
import { newCall, type Call } from './call.ts'
import { codeName, endReasonOf } from './endReason.ts'
import { microphoneProblem } from './microphone.ts'
import { playSoundUrl, type SoundUrls } from './sounds.ts'
import { VoiceFocus, voiceFocusSupported } from './voiceFocus.ts'

/** After this long without a connection the call ends as `connection-lost` (SPEC 20: "After 30 seconds"). */
const RECONNECT_TIMEOUT_MS = 30_000
/** `leave()` waits this long for Chime to say it stopped. */
const LEAVE_TIMEOUT_MS = 5_000

export function createChimeMediaSession(options: { readonly sounds?: SoundUrls } = {}): MediaSession {
  return new ChimeMediaSession(options.sounds ?? {})
}

class ChimeMediaSession implements MediaSession {
  readonly #store = new SnapshotStore(INITIAL_SNAPSHOT)
  /** The one element the call plays through. It needs no place in the page. */
  readonly #audio = document.createElement('audio')
  // Chime's logger is off: its lines carry urls and join tokens.
  readonly #logger: Logger = new ConsoleLogger('huddle', LogLevel.OFF)
  #call: Call | undefined
  /** A join before its `Call` exists; `leave()` marks it so the join stops there. */
  #starting: { left: boolean } | undefined
  #microphone: string | null = null
  #speaker: string | null = null
  #noiseSuppression = true
  /** How many microphones Chromium lists, those without a label or id too. None means none is connected. */
  #microphoneCount = 0
  /** Device changes run one at a time, in order. */
  #queue: Promise<unknown> = Promise.resolve()

  readonly #sounds: SoundUrls

  constructor(sounds: SoundUrls) {
    this.#sounds = sounds
  }

  subscribe = this.#store.subscribe
  getSnapshot = this.#store.getSnapshot

  playSound(sound: HuddleSound): void {
    playSoundUrl(this.#sounds[sound], inUse(this.#speaker, this.getSnapshot().devices.speakers))
  }

  async join(info: JoinInfo): Promise<void> {
    const state = this.getSnapshot().connection.state
    if (state === 'connecting' || state === 'connected' || state === 'reconnecting') throw new Error('huddle-media: a call is already running')
    this.#microphone = info.microphone ?? null
    this.#speaker = info.speaker ?? null
    this.#noiseSuppression = info.noiseSuppression ?? true
    let configuration: MeetingSessionConfiguration
    try {
      configuration = new MeetingSessionConfiguration(info.meeting, info.attendee)
    } catch {
      this.#store.update(startCall(''))
      this.#store.update(setConnection({ state: 'ended', reason: 'failed', attendeeId: '', code: 'BadJoinInfo' }))
      return
    }
    configuration.reconnectTimeoutMs = RECONNECT_TIMEOUT_MS
    configuration.videoDownlinkBandwidthPolicy = new NoVideoDownlinkBandwidthPolicy()
    const attendeeId = configuration.credentials?.attendeeId ?? ''
    this.#store.update(startCall(attendeeId))

    const attempt = { left: false }
    this.#starting = attempt
    const supported = await voiceFocusSupported(this.#logger)
    this.#starting = undefined
    if (attempt.left) return
    const call = newCall(configuration, supported, this.#logger)
    this.#call = call
    this.#store.update((s) => ({ ...s, noiseSuppression: supported ? (this.#noiseSuppression ? 'on' : 'off') : 'unsupported' }))
    this.#observe(call)
    try {
      const permission = await this.#permission(call)
      this.#store.update((s) => ({ ...s, microphoneAccess: permission ?? 'unknown' }))
      await this.listDevices()
      await this.#enqueue(() => this.#applyMicrophone(call))
      if (call.ended) return
      await call.av.bindAudioElement(this.#audio)
      await this.#enqueue(() => this.#applySpeaker(call))
      if (call.ended) return
      call.av.start()
      call.started = true
    } catch (error) {
      this.#end(call, 'failed', error instanceof Error ? error.name : 'JoinFailed')
      return
    }
    if (supported && this.#noiseSuppression) void this.#loadVoiceFocus(call)
  }

  async leave(): Promise<void> {
    if (this.#starting !== undefined) {
      this.#starting.left = true
      const attendeeId = this.getSnapshot().local.attendeeId ?? ''
      return this.#store.update(setConnection({ state: 'ended', reason: 'left', attendeeId, code: 'Left' }))
    }
    const call = this.#call
    if (call === undefined || call.ended) return
    call.leaving = true
    // Before `start`, Chime has nothing to stop and would never say it stopped.
    if (!call.started) return this.#end(call, 'left', 'Left')
    await call.av.stopAudioInput().catch(() => {})
    call.av.stop()
    const timer = setTimeout(() => this.#end(call, 'left', 'LeaveTimeout'), LEAVE_TIMEOUT_MS)
    await call.stopped
    clearTimeout(timer)
  }

  setMuted(muted: boolean): void {
    const call = this.#live()
    if (call === undefined) return
    if (muted) call.av.realtimeMuteLocalAudio()
    else call.av.realtimeUnmuteLocalAudio()
  }

  async setNoiseSuppression(on: boolean): Promise<void> {
    this.#noiseSuppression = on
    const call = this.#live()
    if (call === undefined || !call.voiceFocusSupported) return
    this.#store.update((s) => ({ ...s, noiseSuppression: on ? 'on' : 'off' }))
    if (on && call.voiceFocus === undefined) await this.#loadVoiceFocus(call)
    else await this.#enqueue(() => this.#applyMicrophone(call))
  }

  async listDevices(): Promise<Devices> {
    const infos = await navigator.mediaDevices.enumerateDevices().catch(() => [])
    this.#microphoneCount = infos.filter((d) => d.kind === 'audioinput').length
    const mics = deviceList(infos.filter((d) => d.kind === 'audioinput'))
    const outs = deviceList(infos.filter((d) => d.kind === 'audiooutput'))
    this.#store.update((s) => ({
      ...s,
      devices: { ...s.devices, microphones: mics.devices, speakers: outs.devices, systemMicrophone: mics.system, systemSpeaker: outs.system },
    }))
    const call = this.#live()
    if (call !== undefined) {
      const { devices, microphoneAccess } = this.getSnapshot()
      // The microphone was off, missing or would not start: try it again unless macOS still says no. The user stays muted.
      const retry = (microphoneAccess === 'denied' || microphoneAccess === 'unavailable' || microphoneAccess === 'failed') && (await this.#permission(call)) !== 'denied'
      if (retry || inUse(this.#microphone, devices.microphones) !== devices.microphoneInUse) await this.#enqueue(() => this.#applyMicrophone(call))
      if (inUse(this.#speaker, devices.speakers) !== devices.speakerInUse) await this.#enqueue(() => this.#applySpeaker(call))
    }
    return this.getSnapshot().devices
  }

  async chooseMicrophone(id: string | null): Promise<void> {
    this.#microphone = id
    this.#store.update((s) => ({ ...s, devices: { ...s.devices, microphone: id } }))
    const call = this.#live()
    if (call !== undefined) await this.#enqueue(() => this.#applyMicrophone(call))
  }

  async chooseSpeaker(id: string | null): Promise<void> {
    this.#speaker = id
    this.#store.update((s) => ({ ...s, devices: { ...s.devices, speaker: id } }))
    const call = this.#live()
    if (call !== undefined) await this.#enqueue(() => this.#applySpeaker(call))
  }

  /** The current call, unless it has ended. */
  #live(): Call | undefined {
    const call = this.#call
    return call === undefined || call.ended ? undefined : call
  }

  #enqueue(task: () => Promise<void>): Promise<void> {
    const next = this.#queue.then(task, task)
    this.#queue = next.catch(() => {})
    return next
  }

  #observe(call: Call): void {
    const { av } = call
    const observer: AudioVideoObserver = {
      audioVideoDidStartConnecting: (reconnecting) => this.#connection(call, reconnecting ? 'reconnecting' : 'connecting'),
      audioVideoDidStart: () => {
        call.everConnected = true
        this.#connection(call, 'connected')
      },
      audioVideoDidStop: (status: MeetingSessionStatus) => {
        const code = status.statusCode()
        this.#end(call, endReasonOf(code, call), codeName(code))
      },
    }
    av.addObserver(observer)

    const watched = new Set<string>()
    const onPresence = (attendeeId: string, present: boolean, externalUserId?: string) => {
      if (call.ended) return
      this.#store.update(presence(attendeeId, present, externalUserId ?? ''))
      if (!present || watched.has(attendeeId) || attendeeId === call.attendeeId || attendeeId.endsWith(CONTENT_SUFFIX)) return
      watched.add(attendeeId)
      av.realtimeSubscribeToVolumeIndicator(attendeeId, (id, _volume, muted) => {
        if (muted !== null && !call.ended) this.#store.updateThrottled(patchAttendee(id, { muted }))
      })
    }
    av.realtimeSubscribeToAttendeeIdPresence(onPresence)

    const onSpeakers = (loudestFirst: string[]) => {
      if (!call.ended) this.#store.updateThrottled(speakers(loudestFirst))
    }
    av.subscribeToActiveSpeakerDetector(new DefaultActiveSpeakerPolicy(), onSpeakers)

    const onLocalMute = (muted: boolean) => {
      if (!call.ended) this.#store.update(patchAttendee(call.attendeeId, { muted }))
    }
    av.realtimeSubscribeToMuteAndUnmuteLocalAudio(onLocalMute)

    const onSignal = (signal: number) => {
      call.signal = signal
      this.#updateSending(call)
    }
    av.realtimeSubscribeToLocalSignalStrengthChange(onSignal)

    const onFatal = (error: Error) => {
      this.#end(call, 'failed', error.name)
      av.stop()
    }
    av.realtimeSubscribeToFatalError(onFatal)

    const onDeviceChange = () => void this.listDevices()
    navigator.mediaDevices.addEventListener('devicechange', onDeviceChange)

    call.cleanups.push(() => {
      av.removeObserver(observer)
      av.realtimeUnsubscribeToAttendeeIdPresence(onPresence)
      for (const id of watched) av.realtimeUnsubscribeFromVolumeIndicator(id)
      av.unsubscribeFromActiveSpeakerDetector(onSpeakers)
      av.realtimeUnsubscribeToMuteAndUnmuteLocalAudio(onLocalMute)
      av.realtimeUnsubscribeToFatalError(onFatal)
      av.realtimeUnsubscribeToLocalSignalStrengthChange(onSignal)
      call.unwatchTrack()
      navigator.mediaDevices.removeEventListener('devicechange', onDeviceChange)
    })
  }

  #connection(call: Call, state: 'connecting' | 'connected' | 'reconnecting'): void {
    if (call.ended) return
    this.#store.update(setConnection({ state }))
    this.#updateSending(call)
  }

  /** Follows the track Chime sends: a new one after every microphone change, Voice Focus's included. */
  #watchTrack(call: Call, track: MediaStreamTrack | undefined): void {
    call.unwatchTrack()
    call.track = track
    const onChange = () => this.#updateSending(call)
    for (const type of ['ended', 'mute', 'unmute']) track?.addEventListener(type, onChange)
    call.unwatchTrack = () => {
      for (const type of ['ended', 'mute', 'unmute']) track?.removeEventListener(type, onChange)
    }
    this.#updateSending(call)
  }

  #updateSending(call: Call): void {
    if (call.ended) return
    const { track, signal } = call
    const live = track !== undefined && track.readyState === 'live' && !track.muted
    const sending = live && signal !== null && signal > 0 && this.getSnapshot().connection.state === 'connected'
    this.#store.update((s) => ({ ...s, local: { ...s.local, sending } }))
  }

  /** Ends the call once, whatever ends it first: Chime's stop, a failure or the leave timeout. */
  #end(call: Call, reason: EndReason, code: string): void {
    if (call.ended) return
    call.ended = true
    this.#store.update(setConnection({ state: 'ended', reason, attendeeId: call.attendeeId, code }))
    for (const cleanup of call.cleanups) cleanup()
    call.av.unbindAudioElement()
    void call.av.stopAudioInput().catch(() => {})
    void call.voiceFocus?.destroy()
    call.voiceFocus = undefined
    call.resolveStopped()
  }

  /** The permission's state, watched for changes while the call lasts. Undefined where the page cannot ask. */
  async #permission(call: Call): Promise<PermissionState | undefined> {
    try {
      const status = await navigator.permissions.query({ name: 'microphone' as PermissionName })
      if (!call.watchingAccess && !call.ended) {
        call.watchingAccess = true
        const onChange = () => void this.listDevices()
        status.addEventListener('change', onChange)
        call.cleanups.push(() => status.removeEventListener('change', onChange))
      }
      return status.state
    } catch {
      return undefined
    }
  }

  async #loadVoiceFocus(call: Call): Promise<void> {
    const voiceFocus = await VoiceFocus.load(this.#logger)
    if (call.ended || voiceFocus === undefined) {
      void voiceFocus?.destroy()
      if (!call.ended) this.#store.update((s) => ({ ...s, noiseSuppression: 'unsupported' }))
      return
    }
    call.voiceFocus = voiceFocus
    await this.#enqueue(() => this.#applyMicrophone(call))
  }

  /** Starts the microphone the picks ask for. When it cannot, the call goes on muted with a silent input, so the user can still listen. */
  async #applyMicrophone(call: Call): Promise<void> {
    if (call.ended) return
    const id = inUse(this.#microphone, this.getSnapshot().devices.microphones)
    const plain = id ?? 'default'
    const filtered = this.#noiseSuppression && call.voiceFocus !== undefined ? await call.voiceFocus.wrap(plain) : undefined
    const device: AudioInputDevice = filtered ?? plain
    let access: MicrophoneAccess = 'granted'
    let stream: MediaStream | undefined
    try {
      stream = await call.av.startAudioInput(device)
    } catch (error) {
      access = microphoneProblem(error, this.#microphoneCount)
      stream = await call.av.startAudioInput(null).catch(() => undefined)
      call.av.realtimeMuteLocalAudio()
    }
    if (call.ended) return
    this.#watchTrack(call, stream?.getAudioTracks()[0])
    call.av.realtimeSetCanUnmuteLocalAudio(access === 'granted')
    this.#store.update((s) => ({ ...s, microphoneAccess: access, devices: { ...s.devices, microphoneInUse: id } }))
  }

  async #applySpeaker(call: Call): Promise<void> {
    if (call.ended) return
    const id = inUse(this.#speaker, this.getSnapshot().devices.speakers)
    // Throws only where `setSinkId` is missing, which Chromium has; the system's speaker plays then.
    await call.av.chooseAudioOutput(id).catch(() => {})
    if (!call.ended) this.#store.update((s) => ({ ...s, devices: { ...s.devices, speakerInUse: id } }))
  }
}
