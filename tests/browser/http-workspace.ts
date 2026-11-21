import { readFileSync } from 'node:fs'
import { expect, type Page, type Route } from '@playwright/test'

// Shared by the specs that drive the http repositories against a faked API.
export const HARNESS = '/tests/browser/http-harness.html'
export const API = '**/api/v1'
export const fixture = (path: string) => `tests/fixtures/api/${path}`

export const TONE = {
  name: 'tone-2s.mp3',
  mimeType: 'audio/mpeg',
  buffer: readFileSync(
    new URL('../fixtures/media/tone-2s.mp3', import.meta.url),
  ),
}

export const main = (page: Page) => page.locator('#workspace-content')
export const sidebar = (page: Page) =>
  page.getByRole('complementary', { name: '워크스페이스 탐색' })
export const addSongDialog = (page: Page) =>
  page.getByRole('dialog', { name: '곡 추가' })
export const addSongNext = (page: Page) =>
  addSongDialog(page).getByRole('button', { name: '다음', exact: true })

// Signs in with a tester code and passes the first-run notices.
export async function openWorkspace(page: Page) {
  await page.route(`${API}/auth/tester-login`, (route) =>
    route.fulfill({ path: fixture('access/tester-login.json') }),
  )
  await page.route(`${API}/workspaces/me`, (route) =>
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

export async function chooseTone(page: Page) {
  const chooser = page.waitForEvent('filechooser')
  await addSongDialog(page)
    .getByRole('button', {
      name: /^(파일을 끌어다 놓거나 선택하세요|파일 바꾸기)$/,
    })
    .click()
  await (await chooser).setFiles(TONE)
  await expect(addSongNext(page)).toHaveAttribute('aria-disabled', 'false')
}

// Uploads the tone as track 7 (봄날 커버 v2) and waits on its new-section
// screen.
export async function uploadSong(page: Page) {
  await page.route(`${API}/tracks/upload`, (route: Route) =>
    route.fulfill({
      status: 201,
      path: fixture('workspace/track-upload.json'),
    }),
  )
  await main(page).getByRole('button', { name: '파일 선택' }).click()
  await chooseTone(page)
  await addSongNext(page).click()
  await expect(addSongDialog(page)).toHaveCount(0)
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
    '새 구간',
  )
}
