const REASONS = [
  'NotAllowedError',
  'InvalidStateError',
  'NotSupportedError',
  'OperationError',
  'AbortError',
  'TypeError',
  'RangeError',
] as const

export interface PlaybackDiagnostic {
  readonly stage: 'context' | 'source' | 'start' | 'resume'
  readonly reason: (typeof REASONS)[number] | 'unknown'
}

// Never forward the exception: its name, message or stack may contain a URL
// or a local file name. Only these fixed classifications leave the player.
export function playbackDiagnostic(
  stage: PlaybackDiagnostic['stage'],
  error: unknown,
): PlaybackDiagnostic {
  let reason: PlaybackDiagnostic['reason'] = 'unknown'
  try {
    const name =
      error instanceof Error || error instanceof DOMException
        ? error.name
        : null
    reason = REASONS.find((candidate) => candidate === name) ?? 'unknown'
  } catch {
    // An exception with a throwing name getter must not break recovery.
  }
  return { stage, reason }
}

// Local diagnostics only. A future collector can consume the same limited
// record; no audio, exception, file, task identifier or URL reaches this sink.
export function reportPlaybackDiagnostic(diagnostic: PlaybackDiagnostic): void {
  try {
    console.warn('[earmark:audio-output]', diagnostic)
  } catch {
    // A diagnostic sink is optional and must not interrupt the user's retry.
  }
}
