import { readFileSync } from 'node:fs'
import { expect, test, type Page, type Route } from '@playwright/test'

// Song upload through the http repositories against a faked API.
const HARNESS = '/tests/browser/http-harness.html'
const LOGIN = '**/api/v1/auth/tester-login'
const ME = '**/api/v1/workspaces/me'
const UPLOAD = '**/api/v1/tracks/upload'
const fixture = (path: string) => `tests/fixtures/api/${path}`
const TONE = {
  name: 'tone-2s.mp3',
  mimeType: 'audio/mpeg',
  buffer: readFileSync(
    new URL('../fixtures/media/tone-2s.mp3', import.meta.url),
  ),
}

const main = (page: Page) => page.locator('#workspace-content')
const sidebar = (page: Page) =>
  page.getByRole('complementary', { name: '워크스페이스 탐색' })
const dialog = (page: Page) => page.getByRole('dialog', { name: '곡 추가' })
const next = (page: Page) =>
  dialog(page).getByRole('button', { name: '다음', exact: true })
const alertText = (page: Page) => dialog(page).getByRole('alert')

async function openWorkspace(page: Page) {
  await page.route(LOGIN, (route) =>
    route.fulfill({ path: fixture('access/tester-login.json') }),
  )
  await page.route(ME, (route) =>
    route.fulfill({ path: fixture('workspace/me.json') }),
  )
  await page.goto(HARNESS)
  await page
    .getByRole('textbox', { name: '테스터 코드', exact: true })
    .fill('TESTER-2026-A1B2')
  await page.getByRole('button', { name: '시작하기', exact: true }).click()
  await page.getByRole('button', { name: '확인했어요', exact: true }).click()
  await page
    .getByRole('button', { name: '동의하지 않아요', exact: true })
    .click()
  await expect(
    main(page).getByRole('heading', { name: '첫 곡을 올려 주세요' }),
  ).toBeVisible()
}

async function chooseTone(page: Page) {
  const chooser = page.waitForEvent('filechooser')
  await dialog(page)
    .getByRole('button', {
      name: /^(파일을 끌어다 놓거나 선택하세요|파일 바꾸기)$/,
    })
    .click()
  await (await chooser).setFiles(TONE)
  await expect(next(page)).toHaveAttribute('aria-disabled', 'false')
}

test('an uploaded song is listed from the server answer and opens its new-section screen', async ({
  page,
}) => {
  await openWorkspace(page)
  let answer: (() => Promise<void>) | undefined
  const bodies: string[] = []
  await page.route(UPLOAD, (route: Route) => {
    bodies.push(route.request().postDataBuffer()?.toString('latin1') ?? '')
    answer = () =>
      route.fulfill({
        status: 201,
        path: fixture('workspace/track-upload.json'),
      })
  })

  await main(page).getByRole('button', { name: '파일 선택' }).click()
  await dialog(page).getByRole('radio', { name: '분리된 기타 음원' }).check()
  await chooseTone(page)
  await next(page).click()

  // A routed request is held before it reaches the network, so browsers
  // report no upload progress for it; tests/api-upload covers the percent.
  await expect.poll(() => bodies.length).toBe(1)
  await expect(dialog(page).getByText('파일 올리는 중')).toBeVisible()
  expect(bodies[0]).toContain(
    'name="file"; filename="tone-2s.mp3"\r\nContent-Type: audio/mpeg',
  )
  expect(bodies[0]).toContain('name="is_separated_stem"\r\n\r\ntrue\r\n')
  await answer?.()

  await expect(dialog(page)).toHaveCount(0)
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
    '새 구간',
  )
  // The screen shows what the server stored.
  await expect(main(page).getByText('봄날 커버 v2.mp3')).toBeVisible()
  await expect(main(page).getByText('03:33')).toBeVisible()
  await expect(
    sidebar(page).getByRole('button', { name: '봄날 커버 v2', exact: true }),
  ).toBeVisible()
})

test('a refused upload names the reason and waits for another file', async ({
  page,
}) => {
  await openWorkspace(page)
  const answers = [
    (route: Route) =>
      route.fulfill({
        status: 400,
        path: fixture('workspace/upload-duration-exceeded.json'),
      }),
    // A proxy's own body limit, without the backend envelope.
    (route: Route) =>
      route.fulfill({
        status: 413,
        contentType: 'text/html',
        body: '<html>413 Request Entity Too Large</html>',
      }),
    (route: Route) =>
      route.fulfill({
        status: 413,
        path: fixture('workspace/upload-storage-limit.json'),
      }),
  ]
  await page.route(UPLOAD, (route) => answers.shift()?.(route))

  await main(page).getByRole('button', { name: '파일 선택' }).click()
  await chooseTone(page)
  await next(page).click()
  await expect(alertText(page)).toHaveText(
    '5분 이하 파일만 올릴 수 있어요. 필요한 부분만 잘라서 올려 주세요.',
  )
  await expect(next(page)).toHaveAttribute('aria-disabled', 'true')

  await chooseTone(page)
  await next(page).click()
  await expect(alertText(page)).toHaveText(
    '50MB 이하 파일만 올릴 수 있어요. 용량을 줄여서 다시 올려 주세요.',
  )
  await expect(next(page)).toHaveAttribute('aria-disabled', 'true')

  await chooseTone(page)
  await next(page).click()
  await expect(alertText(page)).toHaveText(
    '작업 공간에 더 올릴 수 없어요. 올릴 수 있는 곡 수나 저장 용량을 모두 사용했어요.',
  )
  await expect(next(page)).toHaveAttribute('aria-disabled', 'false')
  await expect(sidebar(page).getByText('아직 곡이 없어요')).toBeVisible()
})
