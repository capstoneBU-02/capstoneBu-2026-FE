import { expect, test, type Route } from '@playwright/test'
import {
  addSongDialog as dialog,
  addSongNext as next,
  API,
  chooseTone,
  fixture,
  main,
  openWorkspace,
  sidebar,
} from './http-workspace.ts'

// Song upload through the http repositories against a faked API.
const UPLOAD = `${API}/tracks/upload`
const alertText = (page: Parameters<typeof dialog>[0]) =>
  dialog(page).getByRole('alert')

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
