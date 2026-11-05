import { expect, test, type Page } from '@playwright/test'
import { DEMO_ACCESS_CODES } from '../../src/app/demoConfig.ts'

const main = (page: Page) => page.locator('#workspace-content')
const input = (page: Page) =>
  page.getByRole('textbox', { name: '테스터 코드', exact: true })
const settings = (page: Page) =>
  page.getByRole('button', { name: '설정', exact: true })

async function enter(page: Page, code: string) {
  await input(page).fill(code)
  await page.getByRole('button', { name: '시작하기', exact: true }).click()
}

test.describe('when randomUUID is unavailable', () => {
  test.beforeEach(async ({ page }) => {
    // Simulate the missing API, not an actual non-secure browser origin.
    await page.addInitScript(() => {
      Object.defineProperty(crypto, 'randomUUID', { value: undefined })
    })
  })

  test('direct preview renders and navigates without a runtime error', async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto('/?demo=workspace')
    await expect(page.locator('tbody tr')).toHaveCount(4)
    await settings(page).click()
    await expect(
      main(page).getByRole('heading', { name: '설정', exact: true }),
    ).toBeVisible()
    await page.goBack()
    await expect(page.locator('tbody tr')).toHaveCount(4)
    expect(errors).toEqual([])
  })

  test('regular entry creates distinct session scopes and old history cannot restore another workspace', async ({
    page,
  }) => {
    await page.goto('/')
    await enter(page, DEMO_ACCESS_CODES.returningWorkspace)
    await expect(page.locator('tbody tr')).toHaveCount(4)
    const previousScope = await page.evaluate(
      () => history.state.earmarkWorkspaceScope,
    )
    expect(previousScope).toEqual(expect.any(String))
    await settings(page).click()
    await page.getByRole('button', { name: '나가기', exact: true }).click()
    await enter(page, DEMO_ACCESS_CODES.secondWorkspace)
    await page.getByRole('button', { name: '확인했어요' }).click()
    await page.getByRole('button', { name: '나중에 정할게요' }).click()
    const empty = main(page).getByRole('heading', {
      name: '첫 곡을 올려 주세요',
    })
    await expect(empty).toBeVisible()
    expect(
      await page.evaluate(() => history.state.earmarkWorkspaceScope),
    ).not.toBe(previousScope)
    await page.goBack()
    await expect(empty).toBeVisible()
    await expect(page.locator('tbody tr')).toHaveCount(0)
    await expect(page).toHaveURL('/')
    await page.reload()
    await expect(input(page)).toBeVisible()
    await expect(main(page)).toHaveCount(0)
  })
})

test.describe('when URLSearchParams.size is unavailable', () => {
  test.beforeEach(async ({ page }) => {
    // Model the optional API's absence without claiming Safari coverage.
    await page.addInitScript(() => {
      Reflect.deleteProperty(URLSearchParams.prototype, 'size')
    })
  })

  test('preview selectors survive history while reload still starts a fresh session', async ({
    page,
  }) => {
    await page.goto('/?demo=workspace&code=secret&view=unknown')
    await expect(page.locator('tbody tr')).toHaveCount(4)
    await expect(page).toHaveURL('/?demo=workspace')
    await settings(page).click()
    await expect(page).toHaveURL('/?demo=workspace&view=settings')
    await page.goBack()
    await expect(page.locator('tbody tr')).toHaveCount(4)
    await expect(page).toHaveURL('/?demo=workspace')
    await page.goForward()
    await expect(
      main(page).getByRole('heading', { name: '설정', exact: true }),
    ).toBeVisible()
    await expect(page).toHaveURL('/?demo=workspace&view=settings')
    await page.reload()
    await expect(page.locator('tbody tr')).toHaveCount(4)
    await expect(page).toHaveURL('/?demo=workspace')
  })

  test('entry and exit retain the access fixture while stripping unrelated query data', async ({
    page,
  }) => {
    await page.goto(
      '/?access=consent-error&demo=unknown&code=secret&view=settings',
    )
    await expect(input(page)).toBeVisible()
    await expect(page).toHaveURL('/?access=consent-error')
    await enter(page, DEMO_ACCESS_CODES.returningWorkspace)
    await expect(page.locator('tbody tr')).toHaveCount(4)
    await settings(page).click()
    await expect(page).toHaveURL('/?access=consent-error&view=settings')
    await page.getByRole('button', { name: '나가기', exact: true }).click()
    await expect(input(page)).toBeVisible()
    await expect(page).toHaveURL('/?access=consent-error')
    await page.goBack()
    await expect(input(page)).toBeVisible()
    await expect(page).toHaveURL('/?access=consent-error')
  })
})
