import {
  MediaDurationError,
  type MediaDurationProbe,
} from '../../../src/features/add-song/mediaDuration.ts'
import { createDemoSongAudio } from '../../../src/features/workspace/demoSongAudio.ts'
import { WorkspaceRepositoryError } from '../../../src/features/workspace/repository.ts'
import type { TestControls } from './controls.ts'
import { findTask, scenario, sessionFile, snapshot } from './server.ts'

// Durations by file name; unknown names are unreadable. Decoding is faked
// because Playwright's Chromium may lack MP4 codecs (see real-probe tests).
const PROBE_OUTCOMES: Record<string, number | 'error' | 'pending'> = {
  'neon_harbor_live.mp3': 252.4,
  'fresh_riff.mp3': 140.2,
  'late_train_cover.mp4': 238,
  'long_jam_take3.mp4': 391,
  'broken.mp3': 'error',
  'slow.mp3': 'pending',
}
const probeCalls: string[] = []
const pendingProbes: Array<{
  resolve: (seconds: number) => void
  reject: (error: Error) => void
}> = []
// Ignores AbortSignal so late results exercise stale-result protection.
export const fakeProbe: MediaDurationProbe = (file) => {
  const name = file instanceof File ? file.name : ''
  probeCalls.push(name)
  const outcome = PROBE_OUTCOMES[name]
  if (outcome === 'pending')
    return new Promise((resolve, reject) =>
      pendingProbes.push({ resolve, reject }),
    )
  if (typeof outcome === 'number') return Promise.resolve(outcome)
  return Promise.reject(new MediaDurationError('unreadable'))
}

// Fixture songs play the mock's synthesized demo; added songs play their file.
// audio-error serves bytes no browser decodes; pending-audio never answers;
// short-audio decodes two seconds shorter than the song's listed length.
const audioCalls: Array<{ songId: string; signal: AbortSignal }> = []
let audioBroken = scenario === 'audio-error'

export function songAudio(songId: string, signal: AbortSignal): Promise<Blob> {
  audioCalls.push({ songId, signal })
  if (scenario === 'audio-expired')
    return Promise.reject(
      new WorkspaceRepositoryError('expired', 'Expired while loading audio'),
    )
  if (scenario === 'pending-audio') return new Promise(() => {})
  if (audioBroken)
    return Promise.resolve(new Blob(['not audio'], { type: 'audio/wav' }))
  const file = sessionFile(songId)
  if (file) return Promise.resolve(file)
  const song = snapshot.songs.find((candidate) => candidate.id === songId)
  const decodedSeconds =
    scenario === 'short-audio' ? (song?.durationSeconds ?? 0) - 2 : undefined
  return song
    ? createDemoSongAudio(
        song.id,
        decodedSeconds ?? song.durationSeconds,
        signal,
      )
    : Promise.reject(
        new WorkspaceRepositoryError('audio-unavailable', 'Unavailable'),
      )
}

// The separated guitar is synthesized for the section alone. audio-error and
// separated-error serve bytes no browser decodes; pending-separated never
// answers.
const separatedCalls: Array<{ taskId: string; signal: AbortSignal }> = []
let separatedBroken = scenario === 'separated-error'

export function separatedAudio(
  taskId: string,
  signal: AbortSignal,
): Promise<Blob> {
  separatedCalls.push({ taskId, signal })
  if (scenario === 'pending-separated') return new Promise(() => {})
  if (audioBroken || separatedBroken)
    return Promise.resolve(new Blob(['not audio'], { type: 'audio/wav' }))
  const task = findTask(taskId)
  return task?.hasSeparatedAudio
    ? createDemoSongAudio(
        `${taskId}-guitar`,
        task.rangeEndSeconds - task.rangeStartSeconds,
        signal,
      )
    : Promise.reject(
        new WorkspaceRepositoryError('audio-unavailable', 'Unavailable'),
      )
}

// Replaced when this module loads, before the page renders, so every
// playback output is recorded with its sources and volume. Tests read them to
// check what really plays.
const audioContexts: AudioContext[] = []
const audioSources: AudioBufferSourceNode[] = []
const audioGains: GainNode[] = []
const NativeAudioContext = window.AudioContext
window.AudioContext = class RecordedAudioContext extends NativeAudioContext {
  constructor(options?: AudioContextOptions) {
    super(options)
    audioContexts.push(this)
  }
  createBufferSource() {
    const source = super.createBufferSource()
    audioSources.push(source)
    return source
  }
  createGain() {
    const gain = super.createGain()
    audioGains.push(gain)
    return gain
  }
}

export const mediaControls = {
  resolveProbe(seconds) {
    pendingProbes.splice(0).forEach(({ resolve }) => resolve(seconds))
  },
  timeOutProbe() {
    pendingProbes
      .splice(0)
      .forEach(({ reject }) => reject(new MediaDurationError('timeout')))
  },
  probeCalls: () => [...probeCalls],
  audioCalls: () =>
    audioCalls.map(({ songId, signal }) => ({
      songId,
      aborted: signal.aborted,
    })),
  separatedCalls: () =>
    separatedCalls.map(({ taskId, signal }) => ({
      taskId,
      aborted: signal.aborted,
    })),
  healAudio() {
    audioBroken = false
    separatedBroken = false
  },
  audioContexts: () => audioContexts.map((context) => context.state),
  audioSources: () =>
    audioSources.map(({ loop, loopStart, loopEnd }) => ({
      loop,
      loopStart,
      loopEnd,
    })),
  sourceDurations: () =>
    audioSources.map((source) => source.buffer?.duration ?? 0),
  outputGain: () => audioGains.at(-1)?.gain.value ?? null,
} satisfies Partial<TestControls>
