export interface UploadFormat {
  readonly label: string
  readonly extensions: readonly string[]
  readonly mimeTypes: readonly string[]
}

export interface UploadPolicy {
  readonly formats: readonly UploadFormat[]
  readonly maxDurationSeconds: number
  readonly metadataTimeoutMs: number
}

// Provisional limits. D08 (3–5 minute cap) and IN-01~05 (bytes, codecs, MP4
// audio) are still open; the Figma "최대 5분" is a placeholder. Change only
// this object once the policy is confirmed: the hint, the file input filter
// and every error message derive from it.
export const UPLOAD_POLICY: UploadPolicy = {
  formats: [
    {
      label: 'MP3',
      extensions: ['mp3'],
      mimeTypes: [
        'audio/mpeg',
        'audio/mp3',
        'audio/x-mp3',
        'audio/mpeg3',
        'audio/x-mpeg-3',
      ],
    },
    {
      label: 'MP4',
      extensions: ['mp4'],
      mimeTypes: ['video/mp4', 'audio/mp4', 'application/mp4'],
    },
  ],
  maxDurationSeconds: 300,
  metadataTimeoutMs: 15_000,
}
