// Long enough for the browser to start the download, which reads the URL
// after the click returns; revoked any sooner, some browsers save nothing.
const KEEP_URL_MS = 40_000

// Hands the file to the browser to save under this name.
export function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.hidden = true
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), KEEP_URL_MS)
}
