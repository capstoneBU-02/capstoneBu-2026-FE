// Display model for the tab renderer. It does not prescribe the server's
// transcription format, which is still open with the TAB owner; an adapter
// will map the confirmed format into this shape.

// 1 whole, 2 half, 4 quarter, 8 eighth, 16 sixteenth.
export type TabDuration = 1 | 2 | 4 | 8 | 16

export interface TabNote {
  // 1 is the highest-pitched string, drawn on top; it matches tuning[0].
  readonly string: number
  readonly fret: number
  // Hammered to the same string's note in the next beat, shown as `2h4`.
  readonly hammerOn: boolean
  // Holds the same string's note from the previous beat, across a bar line
  // too; shown as `(2)` with an arc.
  readonly tieFromPrevious: boolean
}

export interface TabBeat {
  readonly duration: TabDuration
  readonly dotted: boolean
  // Palm-muted beats that follow each other form one P.M. run.
  readonly palmMute: boolean
  // Empty for a rest.
  readonly notes: readonly TabNote[]
}

export interface TabBar {
  readonly number: number
  // Seconds from the start of the section (0 s). Whether the server sends
  // bar times or a tempo map is still open.
  readonly startSeconds: number
  readonly beats: readonly TabBeat[]
}

export interface TabScore {
  // Pitch names with octave, highest string first: E4 B3 G3 D3 A2 E2.
  readonly tuning: readonly string[]
  // [beats per bar, beat unit]: [4, 4], [3, 4], [6, 8].
  readonly timeSignature: readonly [number, number]
  readonly bars: readonly TabBar[]
  // Where the last bar ends, in section seconds.
  readonly endSeconds: number
}

// Sixteenth notes per duration; a dot adds half.
export const DURATION_TICKS: Readonly<Record<TabDuration, number>> = {
  1: 16,
  2: 8,
  4: 4,
  8: 2,
  16: 1,
}

export function beatTicks(beat: Pick<TabBeat, 'duration' | 'dotted'>): number {
  const ticks = DURATION_TICKS[beat.duration]
  return beat.dotted ? ticks * 1.5 : ticks
}
