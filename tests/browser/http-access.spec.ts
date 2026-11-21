import { expect, test, type Page } from '@playwright/test'
import { ACCESS_ERROR_MESSAGES } from '../../src/features/access/model.ts'
import { maskTesterCode } from '../../src/features/workspace/navigation.ts'

// The http repositories against a faked API: no backend runs.
const HARNESS = '/tests/browser/http-harness.html'
const LOGIN = '**/api/v1/auth/tester-login'
const ME = '**/api/v1/workspaces/me'
const CODE = 'TESTER-2026-A1B2'
const fixture = (path: string) => `tests/fixtures/api/${path}`

const input = (page: Page) =>
  page.getByRole('textbox', { name: '테스터 코드', exact: true })
const notice = (page: Page) =>
  page.getByRole('heading', { name: '시작하기 전에 확인해 주세요' })
const empty = (page: Page) =>
  page.getByRole('heading', { name: '첫 곡을 올려 주세요' })

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

test('a rejected session sends the workspace back to code entry', async ({
  page,
}) => {
  await page.route(LOGIN, (route) =>
    route.fulfill({ path: fixture('access/tester-login.json') }),
  )
  await page.route(ME, (route) =>
    route.fulfill({
      status: 401,
      path: fixture('common/unauthorized-session.json'),
    }),
  )
  await page.goto(HARNESS)
  await enter(page, CODE)
  await onboard(page)

  await expect(
    page.getByRole('heading', { name: '작업 공간을 열 수 없어요' }),
  ).toBeVisible()
  await page
    .getByRole('button', { name: '코드 다시 입력', exact: true })
    .click()
  await expect(input(page)).toHaveValue('')
  await expect(
    page.getByText(
      '오랫동안 사용하지 않아 연결이 끊겼어요. 코드를 다시 입력해 주세요.',
    ),
  ).toBeVisible()
})
