import { test } from 'node:test'
import assert from 'node:assert/strict'
import { reportPlaybackDiagnostic } from '../src/features/player/playbackDiagnostic.ts'

test('local output diagnostics are optional and a broken sink never interrupts recovery', () => {
  const warn = console.warn
  const records = []
  const diagnostic = { stage: 'resume', reason: 'NotAllowedError' }
  try {
    console.warn = (...record) => records.push(record)
    reportPlaybackDiagnostic(diagnostic)
    assert.deepEqual(records, [['[earmark:audio-output]', diagnostic]])
    console.warn = () => {
      throw new Error('Sink unavailable')
    }
    assert.doesNotThrow(() => reportPlaybackDiagnostic(diagnostic))
  } finally {
    console.warn = warn
  }
})
