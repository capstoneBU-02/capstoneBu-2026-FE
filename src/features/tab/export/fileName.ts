// Characters Windows, macOS or Linux will not take in a file name, and
// control characters.
// eslint-disable-next-line no-control-regex
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f\u007f]/g
// Windows drops a trailing dot or space; a leading one hides the file.
const EDGES = /^[\s.]+|[\s.]+$/g
const FALLBACK = '타브'

const clean = (part: string) => part.replace(UNSAFE, '_').replace(EDGES, '')

// The downloaded tab's file name: the song and the section, as the
// breadcrumb names them. A part with nothing left drops out.
export function tabFileName(
  songName: string,
  sectionName: string,
  extension: 'png' | 'pdf',
): string {
  const name = [songName, sectionName].map(clean).filter(Boolean).join('_')
  return `${name || FALLBACK}.${extension}`
}
