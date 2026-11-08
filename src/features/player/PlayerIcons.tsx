import type { ReactNode } from 'react'

// Transport icons follow the text color, unlike the fixed-color app icons,
// so one shape serves the idle, hover and pressed states of the dark bar.
function Glyph({ size, children }: { size: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export function RestartIcon() {
  return (
    <Glyph size={18}>
      <path d="M6 5v14" />
      <path d="M18 5.5v13L9 12l9-6.5Z" />
    </Glyph>
  )
}

export function PlayIcon() {
  return (
    <Glyph size={18}>
      <path d="M8 5.2v13.6L19 12 8 5.2Z" fill="currentColor" />
    </Glyph>
  )
}

export function PauseIcon() {
  return (
    <Glyph size={18}>
      <path d="M8.5 5.5v13M15.5 5.5v13" strokeWidth="3.2" />
    </Glyph>
  )
}

export function RepeatIcon() {
  return (
    <Glyph size={20}>
      <path d="m16.5 3 3.5 3.5-3.5 3.5" />
      <path d="M4 11.5v-1a4 4 0 0 1 4-4h12" />
      <path d="m7.5 21-3.5-3.5 3.5-3.5" />
      <path d="M20 12.5v1a4 4 0 0 1-4 4H4" />
    </Glyph>
  )
}

export function VolumeIcon({ muted }: { muted: boolean }) {
  return (
    <Glyph size={20}>
      <path d="M4 9.5h3.2L12 5.5v13l-4.8-4H4v-5Z" />
      {muted ? (
        <path d="m16 9.5 5 5M21 9.5l-5 5" />
      ) : (
        <>
          <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" />
          <path d="M18.2 7a7 7 0 0 1 0 10" />
        </>
      )}
    </Glyph>
  )
}
