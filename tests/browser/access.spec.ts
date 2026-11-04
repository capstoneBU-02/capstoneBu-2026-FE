import { expect, test, type Page } from '@playwright/test'
import { DEMO_ACCESS_CODES } from '../../src/app/demoConfig.ts'
import { maskTesterCode } from '../../src/features/workspace/navigation.ts'
import { ACCESS_ERROR_MESSAGES } from '../../src/features/access/model.ts'
import type {} from './access-harness.tsx'

const input = (page: Page) =>
  page.getByRole('textbox', { name: '테스터 코드', exact: true })
const settings = (page: Page) =>
  page.getByRole('button', { name: '설정', exact: true })
const notice = (page: Page) =>
  page.getByRole('heading', { name: '시작하기 전에 확인해 주세요' })
const consent = (page: Page) =>
  page.getByRole('heading', { name: '올린 음원을 AI 학습에 써도 될까요?' })
const empty = (page: Page) =>
  page.getByRole('heading', { name: '첫 곡을 올려 주세요' })
const dialog = (page: Page) =>
  page.getByRole('dialog', { name: 'AI 학습 활용' })

async function openConsentSettings(page: Page) {
  await settings(page).click()
  await page.getByRole('button', { name: /^(선택|변경)하기$/ }).click()
}

async function enter(page: Page, code: string) {
  await input(page).fill(code)
  await page.getByRole('button', { name: '시작하기', exact: true }).click()
}

async function acknowledge(page: Page) {
  await expect(notice(page)).toBeVisible()
  await page.getByRole('button', { name: '확인했어요', exact: true }).click()
  await expect(consent(page)).toBeVisible()
}

async function expireAndReenter(page: Page) {
  await page.evaluate(() => window.accessTest.expireSession())
  await openConsentSettings(page)
  await dialog(page)
    .getByRole('button', { name: '동의해요', exact: true })
    .click()
  await page
    .getByRole('button', { name: '코드 다시 입력', exact: true })
    .click()
  await expect(input(page)).toHaveValue('')
  await expect(input(page)).toBeFocused()
  await expect(
    page.getByText(
      '오랫동안 사용하지 않아 연결이 끊겼어요. 코드를 다시 입력해 주세요.',
    ),
  ).toBeVisible()
}

for (const choice of [
  { button: '동의해요', saved: '현재 선택: 동의' },
  { button: '동의하지 않아요', saved: '현재 선택: 동의하지 않음' },
  { button: '나중에 정할게요', saved: null },
]) {
  test(`new access, ${choice.button}, and same-code reentry preserve the explicit choice`, async ({
    page,
  }) => {
    await page.goto('/tests/browser/access-harness.html')
    await expect(input(page)).toHaveValue('')
    expect(
      await page.evaluate(() => window.accessTest.calls().workspaceLoads),
    ).toBe(0)
    await enter(page, DEMO_ACCESS_CODES.newWorkspace)
    await acknowledge(page)
    expect(
      await page.evaluate(() => window.accessTest.calls().workspaceLoads),
    ).toBe(0)
    await page.getByRole('button', { name: choice.button, exact: true }).click()
    await expect(empty(page)).toBeVisible()
    await openConsentSettings(page)
    if (choice.saved)
      await expect(
        dialog(page).getByText(choice.saved, { exact: true }),
      ).toBeVisible()
    else
      await expect(
        dialog(page).getByText('현재 선택:', { exact: false }),
      ).toHaveCount(0)
    await page.getByRole('button', { name: 'AI 학습 활용 창 닫기' }).click()

    await expireAndReenter(page)
    await enter(page, DEMO_ACCESS_CODES.newWorkspace)
    await expect(empty(page)).toBeVisible()
    await expect(notice(page)).toHaveCount(0)
    await expect(consent(page)).toHaveCount(0)
    await openConsentSettings(page)
    if (choice.saved)
      await expect(
        dialog(page).getByText(choice.saved, { exact: true }),
      ).toBeVisible()
    else
      await expect(
        dialog(page).getByText('현재 선택:', { exact: false }),
      ).toHaveCount(0)
  })
}

test('returning workspace skips onboarding, retains changed consent, and is isolated from a different code', async ({
  page,
}) => {
  await page.goto('/tests/browser/access-harness.html')
  await input(page).fill(DEMO_ACCESS_CODES.returningWorkspace)
  await page.keyboard.press('Enter')
  await expect(page.locator('tbody tr')).toHaveCount(4)
  await expect(page.locator('#workspace-content')).toBeFocused()
  await expect(notice(page)).toHaveCount(0)
  const processing = page.getByRole('button', {
    name: '진행 중 1',
    exact: true,
  })
  await processing.click()
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(processing).toBeFocused()
  await page.getByRole('button', { name: '전체 4', exact: true }).click()
  await openConsentSettings(page)
  await expect(
    dialog(page).getByText('현재 선택: 동의하지 않음', { exact: true }),
  ).toBeVisible()
  await dialog(page)
    .getByRole('button', { name: '동의해요', exact: true })
    .click()
  await expect(dialog(page)).toHaveCount(0)
  await expireAndReenter(page)
  await enter(page, DEMO_ACCESS_CODES.returningWorkspace)
  await expect(page.locator('tbody tr')).toHaveCount(4)
  await openConsentSettings(page)
  await expect(
    dialog(page).getByText('현재 선택: 동의', { exact: true }),
  ).toBeVisible()
  await page.getByRole('button', { name: 'AI 학습 활용 창 닫기' }).click()
  await expireAndReenter(page)
  await enter(page, DEMO_ACCESS_CODES.secondWorkspace)
  await acknowledge(page)
  await page.getByRole('button', { name: '나중에 정할게요' }).click()
  await expect(empty(page)).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveCount(0)
  await expect(
    page.getByText(maskTesterCode(DEMO_ACCESS_CODES.returningWorkspace), {
      exact: true,
    }),
  ).toHaveCount(0)
  await openConsentSettings(page)
  await expect(
    dialog(page).getByText('현재 선택:', { exact: false }),
  ).toHaveCount(0)
})

test('unknown codes and unknown demo queries cannot open a workspace; input is never persisted or sent', async ({
  page,
}) => {
  const requests: string[] = []
  const logs: string[] = []
  page.on('request', (request) =>
    requests.push(`${request.url()} ${request.postData() ?? ''}`),
  )
  page.on('console', (message) => logs.push(message.text()))
  await page.goto('/?demo=unknown')
  await enter(page, 'not-a-demo-code')
  await expect(page.getByRole('alert')).toHaveText(
    ACCESS_ERROR_MESSAGES.invalid,
  )
  await expect(input(page)).toBeFocused()
  await expect(input(page)).toHaveAttribute('aria-invalid', 'true')
  await expect(notice(page)).toHaveCount(0)
  await input(page).fill('   ')
  await page.getByRole('button', { name: '시작하기', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveText(
    ACCESS_ERROR_MESSAGES.invalid,
  )
  await enter(page, DEMO_ACCESS_CODES.newWorkspace)
  await expect(notice(page)).toBeVisible()
  expect(page.url()).not.toContain(DEMO_ACCESS_CODES.newWorkspace)
  const storage = await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
    cookie: document.cookie,
  }))
  expect(storage).toEqual({ local: {}, session: {}, cookie: '' })
  expect([...requests, ...logs].join('\n')).not.toContain(
    DEMO_ACCESS_CODES.newWorkspace,
  )
  expect([...requests, ...logs].join('\n')).not.toContain('not-a-demo-code')
})

for (const scenario of [
  'invalid',
  'code-expired',
  'revoked',
  'network',
] as const) {
  test(`${scenario} code response is distinct and permits correction or retry`, async ({
    page,
  }) => {
    await page.goto(`/?access=${scenario}`)
    await enter(page, DEMO_ACCESS_CODES.newWorkspace)
    await expect(page.getByRole('alert')).toHaveText(
      ACCESS_ERROR_MESSAGES[scenario],
    )
    await expect(input(page)).toBeEnabled()
    await expect(
      page.getByRole('button', { name: '시작하기', exact: true }),
    ).toBeEnabled()
    await expect(
      page.getByText('오랫동안 사용하지 않아 연결이 끊겼어요.', {
        exact: false,
      }),
    ).toHaveCount(0)
    await input(page).fill(DEMO_ACCESS_CODES.secondWorkspace)
    await expect(page.getByRole('alert')).toHaveCount(0)
  })
}

test('limited fixture provides explicit recheck recovery without a client countdown', async ({
  page,
}) => {
  await page.goto('/?access=limited')
  await enter(page, DEMO_ACCESS_CODES.newWorkspace)
  await expect(page.getByRole('alert')).toHaveText(
    ACCESS_ERROR_MESSAGES.limited,
  )
  await expect(input(page)).toBeDisabled()
  await page.getByRole('button', { name: '다시 확인', exact: true }).click()
  await expect(notice(page)).toBeVisible()
})

test('a failed onboarding save stays on consent and later is a separate undecided choice', async ({
  page,
}) => {
  await page.goto('/?access=consent-error')
  await enter(page, DEMO_ACCESS_CODES.newWorkspace)
  await acknowledge(page)
  await page.getByRole('button', { name: '동의해요', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText(
    '선택을 저장하지 못했어요.',
  )
  await expect(consent(page)).toBeVisible()
  await expect(empty(page)).toHaveCount(0)
  await page.getByRole('button', { name: '나중에 정할게요' }).click()
  await expect(empty(page)).toBeVisible()
  await openConsentSettings(page)
  await expect(
    dialog(page).getByText('현재 선택:', { exact: false }),
  ).toHaveCount(0)
})

test('acknowledging notice survives session expiry but does not complete or accept consent', async ({
  page,
}) => {
  await page.goto(
    '/tests/browser/access-harness.html?scenario=expire-onboarding-once',
  )
  await enter(page, DEMO_ACCESS_CODES.newWorkspace)
  await acknowledge(page)
  await page.getByRole('button', { name: '동의해요', exact: true }).click()
  await expect(input(page)).toBeVisible()
  await enter(page, DEMO_ACCESS_CODES.newWorkspace)
  await expect(consent(page)).toBeVisible()
  await expect(notice(page)).toHaveCount(0)
  await expect(empty(page)).toHaveCount(0)
  await page.getByRole('button', { name: '나중에 정할게요' }).click()
  await expect(empty(page)).toBeVisible()
  await openConsentSettings(page)
  await expect(
    dialog(page).getByText('현재 선택:', { exact: false }),
  ).toHaveCount(0)
})

test('duplicate entry is rejected and a cancelled late response cannot replace a new session', async ({
  page,
}) => {
  await page.goto('/tests/browser/access-harness.html?scenario=pending-enter')
  await input(page).fill(DEMO_ACCESS_CODES.newWorkspace)
  await page.locator('form').evaluate((form) => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
  })
  expect((await page.evaluate(() => window.accessTest.calls())).entries).toBe(1)
  await expect(input(page)).toBeDisabled()
  const pending = page
    .getByRole('status')
    .filter({ hasText: '테스터 코드를 확인하고 있어요.' })
  expect(
    await pending.evaluate((element) => element.closest('[aria-busy="true"]')),
  ).toBeNull()
  await page.evaluate(() => window.accessTest.replaceRepository())
  await expect(input(page)).toHaveValue('')
  await enter(page, DEMO_ACCESS_CODES.secondWorkspace)
  await expect(notice(page)).toBeVisible()
  await page.evaluate(() => window.accessTest.releaseEntries())
  expect(
    (await page.evaluate(() => window.accessTest.calls())).aborted,
  ).toBeGreaterThan(0)
  await acknowledge(page)
  await page.getByRole('button', { name: '나중에 정할게요' }).click()
  await expect(empty(page)).toBeVisible()
  await expect(
    page.getByText(maskTesterCode(DEMO_ACCESS_CODES.secondWorkspace), {
      exact: true,
    }),
  ).toBeVisible()
})

test('duplicate consent and a stale save cannot complete a replacement workspace', async ({
  page,
}) => {
  await page.goto(
    '/tests/browser/access-harness.html?scenario=pending-onboarding',
  )
  await enter(page, DEMO_ACCESS_CODES.newWorkspace)
  await acknowledge(page)
  await page
    .getByRole('button', { name: '동의해요', exact: true })
    .evaluate((button) => {
      const choiceButton = button as HTMLButtonElement
      choiceButton.click()
      choiceButton.click()
    })
  expect(
    (await page.evaluate(() => window.accessTest.calls())).completions,
  ).toBe(1)
  await expect(
    page.getByRole('button', { name: '나중에 정할게요' }),
  ).toBeDisabled()
  const pending = page
    .getByRole('status')
    .filter({ hasText: '선택을 저장하고 있어요.' })
  expect(
    await pending.evaluate((element) => element.closest('[aria-busy="true"]')),
  ).toBeNull()
  await page.evaluate(() => window.accessTest.replaceRepository())
  await enter(page, DEMO_ACCESS_CODES.secondWorkspace)
  await expect(notice(page)).toBeVisible()
  await page.evaluate(() => window.accessTest.releaseOnboarding())
  await expect(notice(page)).toBeVisible()
  expect(
    (await page.evaluate(() => window.accessTest.calls())).aborted,
  ).toBeGreaterThan(0)
  await acknowledge(page)
  await page.getByRole('button', { name: '나중에 정할게요' }).click()
  await expect(empty(page)).toBeVisible()
  await openConsentSettings(page)
  await expect(
    dialog(page).getByText('현재 선택:', { exact: false }),
  ).toHaveCount(0)
})

test('expired workspace preview recovers to code entry and mobile onboarding stays keyboard accessible', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?demo=expired')
  await page.getByRole('button', { name: '코드 다시 입력' }).click()
  await expect(input(page)).toBeFocused()
  await input(page).fill(DEMO_ACCESS_CODES.newWorkspace)
  await page.keyboard.press('Enter')
  await expect(notice(page)).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(page.getByRole('button', { name: '확인했어요' })).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(consent(page)).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(
    page.getByRole('button', { name: '나중에 정할게요' }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(empty(page)).toBeVisible()
  await expect(page.locator('#workspace-content')).toBeFocused()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  )
})
