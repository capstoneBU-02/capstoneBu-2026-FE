// Demo transcriptions for the mock repository and tests, keyed by tuning id.
// They are raw input, so they go through parseTabScore like a server reply.
// Together they cover every mark the renderer draws: palm mute, hammer-on,
// sixteenths, chords, rests, ties within and across a bar line, a dotted
// quarter, a half note and a whole note. Bars are two seconds long (120 BPM).

const STANDARD_CHORD_G = [
  { string: 6, fret: 3 },
  { string: 5, fret: 2 },
  { string: 4, fret: 0 },
  { string: 3, fret: 0 },
  { string: 2, fret: 0 },
  { string: 1, fret: 3 },
]
const STANDARD_CHORD_C = [
  { string: 5, fret: 3 },
  { string: 4, fret: 2 },
  { string: 3, fret: 0 },
  { string: 2, fret: 1 },
  { string: 1, fret: 0 },
]
const STANDARD_CHORD_E = [
  { string: 6, fret: 0 },
  { string: 5, fret: 2 },
  { string: 4, fret: 2 },
  { string: 3, fret: 0 },
  { string: 2, fret: 0 },
  { string: 1, fret: 0 },
]
const DROP_D_POWER = [
  { string: 6, fret: 0 },
  { string: 5, fret: 0 },
  { string: 4, fret: 0 },
]
const DROP_D_POWER_5 = [
  { string: 6, fret: 5 },
  { string: 5, fret: 5 },
  { string: 4, fret: 5 },
]

const mutedLow = (fret: number) => ({
  duration: 8,
  palmMute: true,
  notes: [{ string: 6, fret }],
})
const mutedPower = { duration: 8, palmMute: true, notes: DROP_D_POWER }

export const DEMO_TAB_INPUTS: Readonly<Record<string, unknown>> = {
  'e-standard': {
    tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'E2'],
    timeSignature: [4, 4],
    bars: [
      {
        number: 1,
        startSeconds: 0,
        beats: [
          mutedLow(0),
          mutedLow(0),
          mutedLow(3),
          mutedLow(0),
          { duration: 8, notes: [{ string: 5, fret: 2 }] },
          { duration: 16, notes: [{ string: 4, fret: 2, hammerOn: true }] },
          { duration: 16, notes: [{ string: 4, fret: 4 }] },
          { duration: 4 },
        ],
      },
      {
        number: 2,
        startSeconds: 2,
        beats: [
          { duration: 4, notes: STANDARD_CHORD_G },
          { duration: 4, notes: STANDARD_CHORD_C },
          { duration: 8 },
          { duration: 8, notes: [{ string: 3, fret: 2 }] },
          {
            duration: 4,
            notes: [{ string: 3, fret: 2, tieFromPrevious: true }],
          },
        ],
      },
      {
        number: 3,
        startSeconds: 4,
        beats: [
          {
            duration: 4,
            notes: [{ string: 3, fret: 2, tieFromPrevious: true }],
          },
          { duration: 16, notes: [{ string: 1, fret: 0 }] },
          { duration: 16, notes: [{ string: 2, fret: 3 }] },
          { duration: 16, notes: [{ string: 1, fret: 0 }] },
          { duration: 16, notes: [{ string: 2, fret: 3 }] },
          { duration: 4, dotted: true, notes: [{ string: 4, fret: 2 }] },
          { duration: 8 },
        ],
      },
      {
        number: 4,
        startSeconds: 6,
        beats: [{ duration: 1, notes: STANDARD_CHORD_E }],
      },
    ],
    endSeconds: 8,
  },
  'drop-d': {
    tuning: ['E4', 'B3', 'G3', 'D3', 'A2', 'D2'],
    timeSignature: [4, 4],
    bars: [
      {
        number: 1,
        startSeconds: 0,
        beats: [
          mutedPower,
          mutedPower,
          mutedPower,
          mutedPower,
          { duration: 8, notes: [{ string: 5, fret: 0, hammerOn: true }] },
          { duration: 8, notes: [{ string: 5, fret: 2 }] },
          { duration: 4 },
        ],
      },
      {
        number: 2,
        startSeconds: 2,
        beats: [
          { duration: 2, notes: DROP_D_POWER_5 },
          { duration: 4 },
          { duration: 4, notes: [{ string: 4, fret: 0 }] },
        ],
      },
    ],
    endSeconds: 4,
  },
}
