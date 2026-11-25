import { readFileSync } from 'node:fs'
import { expect, type Page } from '@playwright/test'
import {
  API,
  answer,
  fixtureData,
  listSegment,
  listTrack,
  load,
  main,
  sidebar,
  signIn,
  TONE,
} from './http-workspace.ts'

// Shared by the specs that save and compare takes through the http
// repositories. Track 7 and segment 31 (코러스) match the fixtures. The
// section is cut to three seconds so the two-second tone counts as a take of
// it.
type Json = Record<string, unknown>

export const RANGE = { start_ms: 0, end_ms: 3000 }

export const takes = (page: Page) =>
  main(page).getByRole('combobox', { name: '연주' }).locator('option')
export const takeOpener = (page: Page) =>
  main(page).getByRole('button', { name: '파일 올리기', exact: true })
export const takeDialog = (page: Page) =>
  page.getByRole('dialog', { name: '연주 파일 올리기' })
export const sendTake = (page: Page) =>
  takeDialog(page).getByRole('button', { name: '비교하기', exact: true })

export function listedTake(
  id: number,
  source: string,
  createdAt: string,
): Json {
  return {
    performance_id: id,
    track_id: 7,
    source,
    ...RANGE,
    created_at: createdAt,
  }
}

interface SentTake {
  readonly contentType: string
  readonly body: string
}

// The server side of the section's takes: GET lists them, POST saves one
// with `saveAnswer` (take 12 by default) once `release` lets it through.
// StrictMode may ask for the list twice, so only saves are counted.
export async function serveTakes(
  page: Page,
  listed: readonly Json[],
  saveAnswer?: () => [unknown, number],
) {
  let current = [...listed]
  const sent: SentTake[] = []
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(`${API}/segments/31/performances`, async (route) => {
    const request = route.request()
    if (request.method() === 'GET')
      return answer(route, {
        success: true,
        data: { segment_id: 31, performances: current },
      })
    sent.push({
      contentType: request.headers()['content-type'] ?? '',
      // Latin-1 keeps the file's bytes one character each.
      body: request.postDataBuffer()?.toString('latin1') ?? '',
    })
    await held
    if (saveAnswer) {
      const [body, status] = saveAnswer()
      return answer(route, body, status)
    }
    const take = listedTake(12, 'UPLOAD', new Date().toISOString())
    current = [take, ...current]
    return answer(
      route,
      { success: true, data: { ...take, workspace_id: 5, segment_id: 31 } },
      201,
    )
  })
  return { sent, release: () => release() }
}

// Track 7 with 코러스 finished, opened on its comparison view. `serve` routes
// the section's takes after sign-in, so it wins over the empty list every
// workspace in these specs answers with.
export async function openComparison<T>(
  page: Page,
  serve: () => Promise<T>,
): Promise<T> {
  const listed = (name: string) => fixtureData(name).items as Json[]
  listTrack(page, listed('tracks')[1])
  listSegment(page, { ...listed('segments')[0], ...RANGE, duration_ms: 3000 })
  await page.route(`${API}/segments/31/processing-status`, (route) =>
    answer(route, load('status-completed')),
  )
  await page.route(`${API}/tabs/88/result`, (route) =>
    answer(route, load('tab-result')),
  )
  await page.route(`${API}/stems/54/playback`, (route) =>
    answer(route, load('stem-not-ready'), 409),
  )
  await signIn(page)
  const server = await serve()
  await sidebar(page)
    .getByRole('button', { name: /^코러스/ })
    .click()
  await main(page).getByRole('tab', { name: /^비교/ }).click()
  return server
}

// Opens the upload dialog and picks the tone as the take.
export async function chooseTakeFile(page: Page) {
  await takeOpener(page).click()
  await expect(takeDialog(page)).toBeVisible()
  const chooser = page.waitForEvent('filechooser')
  await takeDialog(page)
    .getByRole('button', { name: '파일을 끌어다 놓거나 선택하세요' })
    .click()
  await (await chooser).setFiles(TONE)
  await expect(sendTake(page)).toHaveAttribute('aria-disabled', 'false', {
    timeout: 15_000,
  })
}

// --- comparison 41 of take 12 ---------------------------------------------

export type Answer = readonly [body: unknown, status: number]

export const comparisonFixture = (name: string): Json =>
  JSON.parse(
    readFileSync(
      new URL(`../fixtures/api/comparison/${name}.json`, import.meta.url),
      'utf8',
    ),
  )

export const comparisonAnswer = (name: string, status = 200): Answer => [
  comparisonFixture(name),
  status,
]

interface SentRequest {
  readonly key: string
  readonly body: unknown
}

// The server side of comparison 41. `show` sets the status every later poll
// answers with, as StrictMode and the 2.5 s polling make counting GETs
// unreliable. Requests that change something are kept in `sent`, sound
// downloads from storage in `downloads`.
export async function serveComparison(
  page: Page,
  {
    request = comparisonAnswer('created', 202),
    status = 'status-queued',
    result = comparisonAnswer('result'),
    playback = comparisonAnswer('playback'),
    mark = () => comparisonAnswer('region-checked'),
    retry = comparisonAnswer('retry', 202),
    statusAfterRetry = 'status-retried',
  }: {
    request?: Answer
    status?: string
    result?: Answer
    playback?: Answer
    mark?: () => Answer | Promise<Answer>
    retry?: Answer
    statusAfterRetry?: string
  } = {},
) {
  let shown = status
  const sent: SentRequest[] = []
  const downloads: string[] = []
  const record = (key: string, body: unknown = null) => sent.push({ key, body })

  await page.route(`${API}/performances/12/comparisons`, (route) => {
    record('request')
    return answer(route, ...request)
  })
  await page.route(`${API}/comparisons/41`, (route) =>
    answer(route, comparisonFixture(shown)),
  )
  await page.route(`${API}/comparisons/41/result`, (route) =>
    answer(route, ...result),
  )
  await page.route(`${API}/comparisons/41/playback`, (route) =>
    answer(route, ...playback),
  )
  await page.route(`${API}/comparisons/41/regions/*`, async (route) => {
    const regionId = new URL(route.request().url()).pathname.split('/').at(-1)
    record(`mark ${regionId}`, route.request().postDataJSON())
    return answer(route, ...(await mark()))
  })
  await page.route(`${API}/comparisons/41/retry`, (route) => {
    record('retry')
    if (retry[1] < 400) shown = statusAfterRetry
    return answer(route, ...retry)
  })
  // Signed links go to the storage, which answers the page's origin.
  await page.route('https://storage.example.com/**', (route) => {
    downloads.push(new URL(route.request().url()).pathname)
    return route.fulfill({
      status: 200,
      contentType: TONE.mimeType,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: TONE.buffer,
    })
  })

  return {
    sent,
    downloads,
    show(name: string) {
      shown = name
    },
  }
}
