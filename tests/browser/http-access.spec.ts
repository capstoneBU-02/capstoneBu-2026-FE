import type { Page, Route } from '@playwright/test'
import { ACCESS_ERROR_MESSAGES } from '../../src/features/access/model.ts'
import { maskTesterCode } from '../../src/features/workspace/navigation.ts'
import { expect, test } from './http-test.ts'

// The http repositories against a faked API: no backend runs.
const HARNESS = '/tests/browser/http-harness.html'
const LOGIN = '**/api/v1/auth/tester-login'
const ME = '**/api/v1/workspaces/me'
const TRACKS = '**/api/v1/tracks'
const CODE = 'TESTER-2026-A1B2'
const fixture = (path: string) => `tests/fixtures/api/${path}`

const input = (page: Page) =>
  page.getByRole('textbox', { name: '테스터 코드', exact: true })
const notice = (page: Page) =>
  page.getByRole('heading', { name: '시작하기 전에 확인해 주세요' })
const empty = (page: Page) =>
  page.getByRole('heading', { name: '첫 곡을 올려 주세요' })
const expired = (page: Page) =>
  page.getByRole('heading', { name: '작업 공간을 열 수 없어요' })
const DISCONNECTED =
  '오랫동안 사용하지 않아 연결이 끊겼어요. 코드를 다시 입력해 주세요.'

const rejectedSession = (route: Route) =>
  route.fulfill({
    status: 401,
    path: fixture('common/unauthorized-session.json'),
  })
// What a session cookie of another code answers, as after entering that code
// in another tab.
const otherWorkspace = (route: Route) =>
  route.fulfill({
    json: {
      success: true,
      data: {
        workspace_id: 7,
        owner_type: 'TESTER_CODE',
        session_active: true,
        created_at: '2026-11-19T09:30:00Z',
      },
    },
  })
const ownWorkspace = (route: Route) =>
  route.fulfill({ path: fixture('workspace/me.json') })
const emptyTracks = (route: Route) =>
  route.fulfill({ json: { success: true, data: { items: [] } } })

// The login answers for 42; the session check answers ownWorkspace until the
// spec changes it.
async function serve(page: Page) {
  let session = ownWorkspace
  await page.route(LOGIN, (route) =>
    route.fulfill({ path: fixture('access/tester-login.json') }),
  )
  await page.route(ME, (route) => session(route))
  await page.route(TRACKS, emptyTracks)
  return {
    answerSession(next: (route: Route) => Promise<void>) {
      session = next
    },
  }
}

async function enter(page: Page, code: string) {
  await input(page).fill(code)
  await page.getByRole('button', { name: '시작하기', exact: true }).click()
}

async function onboard(page: Page) {
  await expect(notice(page)).toBeVisible()
  await page.getByRole('button', { name: '확인했어요', exact: true }).click()
  await page
    .getByRole('button', { name: '동의하지 않아요', exact: true })
    .click()
}

test('a tester code opens an empty workspace through the API', async ({
  page,
}) => {
  const logins: unknown[] = []
  await page.route(LOGIN, (route) => {
    logins.push(route.request().postDataJSON())
    return route.fulfill({ path: fixture('access/tester-login.json') })
  })
  await page.route(ME, (route) =>
    route.fulfill({ path: fixture('workspace/me.json') }),
  )
  await page.route(TRACKS, (route) =>
    route.fulfill({ json: { success: true, data: { items: [] } } }),
  )

  // Demo selectors do nothing in http mode.
  await page.goto(`${HARNESS}?demo=task-states`)
  await enter(page, ' tester-2026-a1b2 ')
  await onboard(page)

  await expect(empty(page)).toBeVisible()
  await expect(page.getByText(maskTesterCode(CODE))).toBeVisible()
  expect(logins).toEqual([{ tester_code: CODE }])
})

test('an unknown code stays at entry with the code message', async ({
  page,
}) => {
  await page.route(LOGIN, (route) =>
    route.fulfill({
      status: 401,
      path: fixture('access/tester-code-not-found.json'),
    }),
  )
  await page.goto(HARNESS)
  await enter(page, CODE)

  await expect(page.getByText(ACCESS_ERROR_MESSAGES.invalid)).toBeVisible()
  await expect(input(page)).toHaveValue(CODE)
  await expect(notice(page)).toHaveCount(0)
})

for (const [name, session] of [
  ['no session', rejectedSession],
  ['the session of another workspace', otherWorkspace],
] as const) {
  test(`a login that finds ${name} right after stays at entry until a retry`, async ({
    page,
  }) => {
    const server = await serve(page)
    server.answerSession(session)
    await page.goto(HARNESS)
    await enter(page, CODE)

    await expect(page.getByText(ACCESS_ERROR_MESSAGES.network)).toBeVisible()
    await expect(input(page)).toHaveValue(CODE)
    await expect(notice(page)).toHaveCount(0)

    // The kept code goes again once the browser keeps the cookie.
    server.answerSession(ownWorkspace)
    await page.getByRole('button', { name: '시작하기', exact: true }).click()
    await expect(notice(page)).toBeVisible()
  })

  test(`${name} at opening sends the workspace back to code entry`, async ({
    page,
  }) => {
    const server = await serve(page)
    await page.goto(HARNESS)
    await enter(page, CODE)
    await expect(notice(page)).toBeVisible()
    server.answerSession(session)
    await onboard(page)

    await expect(expired(page)).toBeVisible()
    await page
      .getByRole('button', { name: '코드 다시 입력', exact: true })
      .click()
    await expect(input(page)).toHaveValue('')
    await expect(page.getByText(DISCONNECTED)).toBeVisible()
  })

  test(`${name} found when the window gets focus back ends the workspace`, async ({
    page,
  }) => {
    const server = await serve(page)
    await page.goto(HARNESS)
    await enter(page, CODE)
    await onboard(page)
    await expect(empty(page)).toBeVisible()

    server.answerSession(session)
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(expired(page)).toBeVisible()
  })
}
