import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import {
  chooseTakeFile,
  comparisonAnswer,
  listedTake,
  openComparison,
  sendTake,
  serveComparison,
  serveTakes,
  takeDialog,
  takes,
} from './http-takes.ts'
import { main } from './http-workspace.ts'

// Takes saved and listed through the http repositories against a faked API.
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

const comparisonStatus = (page: Page) =>
  main(page)
    .getByRole('tabpanel', { name: /^비교/ })
    .getByRole('status')
    .filter({ has: page.getByRole('heading', { level: 2 }) })

test('an uploaded take is sent as a form, then listed and compared', async ({
  page,
}) => {
  const [server, comparison] = await openComparison(page, () =>
    Promise.all([serveTakes(page, []), serveComparison(page)]),
  )
  await expect(
    main(page).getByText('아직 비교한 연주가 없어요', { exact: true }),
  ).toBeVisible()
  await chooseTakeFile(page)

  await sendTake(page).click()
  // A request held by the test may report no progress, so only the start of
  // the footer is fixed; tests/comparison-http-repository covers the percent.
  await expect(takeDialog(page).getByText(/^파일 올리는 중/)).toBeVisible()
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
  await expect(takeDialog(page)).toBeHidden()
  await expect(takes(page)).toHaveCount(1)
  await expect(takes(page).first()).toContainText('파일 #1')
  await expect(takes(page).first()).toContainText('방금')
  // The saved take goes on to be compared.
  await expect(comparisonStatus(page)).toContainText(
    '비교 순서를 기다리고 있어요',
  )
  expect(comparison.sent.map(({ key }) => key)).toEqual(['request'])
  await expect(page.getByText(SAVED_NOTICE)).toHaveCount(0)
  expect(server.sent).toHaveLength(1)
})

test('a saved take whose comparison cannot start says it was saved', async ({
  page,
}) => {
  const [server, comparison] = await openComparison(page, () =>
    Promise.all([
      serveTakes(page, []),
      serveComparison(page, {
        request: comparisonAnswer('job-enqueue-failed', 503),
      }),
    ]),
  )
  server.release()
  await chooseTakeFile(page)

  await sendTake(page).click()

  await expect(page.getByText(SAVED_NOTICE)).toBeVisible()
  await expect(takes(page)).toHaveCount(1)
  expect(comparison.sent.map(({ key }) => key)).toEqual(['request'])
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
  await chooseTakeFile(page)

  await sendTake(page).click()

  await expect(takeDialog(page).getByRole('alert')).toHaveText(REFUSED)
  await expect(takeDialog(page)).toBeVisible()
  await expect(takes(page)).toHaveCount(0)
  expect(server.sent).toHaveLength(1)
})
