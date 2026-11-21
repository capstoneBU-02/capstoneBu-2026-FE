export interface UploadFormat {
  readonly label: string
  readonly extensions: readonly string[]
  // What browsers report for the format; the file input and the check take
  // them all.
  readonly mimeTypes: readonly string[]
  // The one type the upload declares. The server accepts only a short list
  // and reads an empty type as application/octet-stream.
  readonly uploadType: string
}

export interface UploadPolicy {
  readonly formats: readonly UploadFormat[]
  readonly maxDurationSeconds: number
  // The server's own limit (50 MiB); a larger file is refused before upload.
  readonly maxFileBytes: number
  readonly metadataTimeoutMs: number
}

// The backend's upload limits (POST /tracks/upload), checked here first so a
// refused file is not sent. D08 (3–5 minute cap) and IN-01~05 (codecs, MP4
// audio) are still open in planning. Change only this object when the
// server's limits change: the hint, the file input filter, the upload type
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
      uploadType: 'audio/mpeg',
    },
    {
      label: 'MP4',
      extensions: ['mp4'],
      mimeTypes: ['video/mp4', 'audio/mp4', 'application/mp4'],
      uploadType: 'video/mp4',
    },
  ],
  maxDurationSeconds: 300,
  maxFileBytes: 50 * 1024 * 1024,
  metadataTimeoutMs: 15_000,
}
