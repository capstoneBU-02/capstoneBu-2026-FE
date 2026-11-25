import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
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

// Takes saved and listed through the http repositories against a faked API.
// Track 7 and segment 31 (코러스) match the fixtures. The section is cut to
// three seconds so the two-second tone counts as a take of it.
type Json = Record<string, unknown>

const RANGE = { start_ms: 0, end_ms: 3000 }
const SAVED_NOTICE =
  '코러스 연주는 저장됐지만 비교를 시작하지 못했어요. 해당 작업의 비교 화면에서 다시 시도해 주세요.'
const REFUSED = '이 파일은 연주로 사용할 수 없어요.'

const performanceFixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../fixtures/api/performance/${name}.json`, import.meta.url),
      'utf8',
    ),
  )

const takes = (page: Page) =>
  main(page).getByRole('combobox', { name: '연주' }).locator('option')
const opener = (page: Page) =>
  main(page).getByRole('button', { name: '파일 올리기', exact: true })
const dialog = (page: Page) =>
  page.getByRole('dialog', { name: '연주 파일 올리기' })
const compare = (page: Page) =>
  dialog(page).getByRole('button', { name: '비교하기', exact: true })

function listedTake(id: number, source: string, createdAt: string): Json {
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
// with `saveAnswer` (a new take by default) once `release` lets it through.
// StrictMode may ask for the list twice, so only saves are counted.
async function serveTakes(
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
async function openComparison<T>(
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

async function chooseTone(page: Page) {
  await opener(page).click()
  await expect(dialog(page)).toBeVisible()
  const chooser = page.waitForEvent('filechooser')
  await dialog(page)
    .getByRole('button', { name: '파일을 끌어다 놓거나 선택하세요' })
    .click()
  await (await chooser).setFiles(TONE)
  await expect(compare(page)).toHaveAttribute('aria-disabled', 'false', {
    timeout: 15_000,
  })
}

test('an uploaded take is sent as a form, then listed as the newest take', async ({
  page,
}) => {
  const server = await openComparison(page, () => serveTakes(page, []))
  await expect(
    main(page).getByText('아직 비교한 연주가 없어요', { exact: true }),
  ).toBeVisible()
  await chooseTone(page)

  await compare(page).click()
  // A request held by the test may report no progress, so only the start of
  // the footer is fixed; tests/comparison-http-repository covers the percent.
  await expect(dialog(page).getByText(/^파일 올리는 중/)).toBeVisible()
  await expect.poll(() => server.sent.length).toBe(1)
  const [{ contentType, body }] = server.sent
  expect(contentType).toMatch(/^multipart\/form-data; boundary=/)
  expect(body).toContain(
    'Content-Disposition: form-data; name="audio_file"; filename="tone-2s.mp3"\r\nContent-Type: audio/mpeg',
  )
  expect(body).toContain(
    'Content-Disposition: form-data; name="source"\r\n\r\nUPLOAD\r\n',
  )

  server.release()
  await expect(dialog(page)).toBeHidden()
  await expect(takes(page)).toHaveCount(1)
  await expect(takes(page).first()).toContainText('파일 #1')
  await expect(takes(page).first()).toContainText('방금')
  // Comparing is not connected yet, so the saved take says so.
  await expect(page.getByText(SAVED_NOTICE)).toBeVisible()
  expect(server.sent).toHaveLength(1)
})

test('takes saved before are listed from the server, newest first', async ({
  page,
}) => {
  const server = await openComparison(page, () =>
    serveTakes(page, [
      listedTake(12, 'UPLOAD', '2026-11-02T03:00:00.402913Z'),
      listedTake(9, 'RECORDING', '2026-11-01T03:00:00.118064Z'),
    ]),
  )

  await expect(takes(page)).toHaveCount(2)
  await expect(takes(page).first()).toContainText('파일 #1')
  await expect(takes(page).first()).toContainText('11월 2일')
  await expect(takes(page).last()).toContainText('녹음 #1')
  await expect(takes(page).last()).toContainText('11월 1일')
  expect(server.sent).toHaveLength(0)
})

test('a file the server refuses keeps the dialog with the reason', async ({
  page,
}) => {
  const server = await openComparison(page, () =>
    serveTakes(page, [], () => [performanceFixture('unsupported-audio'), 400]),
  )
  server.release()
  await chooseTone(page)

  await compare(page).click()

  await expect(dialog(page).getByRole('alert')).toHaveText(REFUSED)
  await expect(dialog(page)).toBeVisible()
  await expect(takes(page)).toHaveCount(0)
  expect(server.sent).toHaveLength(1)
})
