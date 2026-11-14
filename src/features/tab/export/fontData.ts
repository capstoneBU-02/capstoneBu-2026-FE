// A font file's bytes in base64, as jsPDF and a data URL take them.
export async function base64Of(url: string): Promise<string> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Font request failed: ${response.status}`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  // In slices: one call with every byte overflows the argument limit.
  let binary = ''
  for (let start = 0; start < bytes.length; start += 0x8000)
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000))
  return btoa(binary)
}
