import { expect, test, type Page } from '@playwright/test'
import { DEMO_ACCESS_CODES } from '../../src/app/demoConfig.ts'
import {
  maskTesterCode,
  WORKSPACE_SCOPE_KEY,
} from '../../src/features/workspace/navigation.ts'
import type {} from './access-harness.tsx'

const settings = (page: Page) =>
  page.getByRole('button', { name: '설정', exact: true })
const main = (page: Page) => page.locator('#workspace-content')
const help = (page: Page) =>
  page.getByRole('button', { name: '도움말', exact: true })
const input = (page: Page) =>
  page.getByRole('textbox', { name: '테스터 코드', exact: true })
const consentDialog = (page: Page) =>
  page.getByRole('dialog', { name: 'AI 학습 활용', exact: true })

async function enter(
  page: Page,
  code: string = DEMO_ACCESS_CODES.returningWorkspace,
) {
  await input(page).fill(code)
  await page.keyboard.press('Enter')
}

async function openSettings(page: Page) {
  await settings(page).click()
  await expect(
    main(page).getByRole('heading', { name: '설정', exact: true }),
  ).toBeVisible()
}

async function openConsent(page: Page) {
  await openSettings(page)
  await page.getByRole('button', { name: /^(선택|변경)하기$/ }).click()
}

async function startHarness(page: Page, scenario = '') {
  await page.goto(
    `/tests/browser/access-harness.html${scenario ? `?scenario=${scenario}` : ''}`,
  )
  await enter(page)
  await expect(page.locator('tbody tr')).toHaveCount(4)
}

test('settings shares consent and preserves list/filter/song state across history without reloading', async ({
  page,
}) => {
  await startHarness(page)
  const loads = (await page.evaluate(() => window.accessTest.calls()))
    .workspaceLoads
  const processing = page.getByRole('button', {
    name: '진행 중 1',
    exact: true,
  })
  await processing.click()
  const song = page.getByRole('button', {
    name: 'neon_harbor_live',
    exact: true,
  })
  await song.click()
  await expect(song).toHaveAttribute('aria-expanded', 'false')
  await openSettings(page)
  await expect(main(page)).toBeFocused()
  await expect(settings(page)).toHaveAttribute('aria-current', 'page')
  await expect(
    main(page).getByText(maskTesterCode(DEMO_ACCESS_CODES.returningWorkspace), {
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByText(DEMO_ACCESS_CODES.returningWorkspace, { exact: true }),
  ).toHaveCount(0)
  await page.getByRole('button', { name: '변경하기' }).click()
  await consentDialog(page)
    .getByRole('button', { name: '동의해요', exact: true })
    .click()
  await expect(consentDialog(page)).toHaveCount(0)
  await expect(
    main(page).getByText('현재 선택: 동의', { exact: true }),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: '변경하기' })).toBeFocused()

  await page.goBack()
  await expect(processing).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('tbody tr')).toHaveCount(1)
  await expect(song).toHaveAttribute('aria-expanded', 'false')
  await expect(main(page)).toBeFocused()
  await page.goForward()
  await expect(
    main(page).getByRole('heading', { name: '설정', exact: true }),
  ).toBeVisible()
  await expect(
    main(page).getByText('현재 선택: 동의', { exact: true }),
  ).toBeVisible()
  expect(
    (await page.evaluate(() => window.accessTest.calls())).workspaceLoads,
  ).toBe(loads)
  const state = await page.evaluate(() => window.history.state)
  expect(Object.keys(state)).toEqual([WORKSPACE_SCOPE_KEY])
  expect(typeof state[WORKSPACE_SCOPE_KEY]).toBe('string')
  expect(JSON.stringify(state)).not.toContain(
    DEMO_ACCESS_CODES.returningWorkspace,
  )
})

test('logout and back/forward never restore a previous workspace; reentry preserves only that code records', async ({
  page,
}) => {
  await startHarness(page)
  await openConsent(page)
  await consentDialog(page)
    .getByRole('button', { name: '동의해요', exact: true })
    .click()
  await expect(consentDialog(page)).toHaveCount(0)
  const previousScope = await page.evaluate(
    () => history.state.earmarkWorkspaceScope,
  )
  await page.getByRole('button', { name: '나가기', exact: true }).click()
  await expect(input(page)).toBeFocused()
  await expect(input(page)).toHaveValue('')
  expect(await page.evaluate(() => history.state)).toBeNull()
  await page.goBack()
  await expect(input(page)).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveCount(0)
  await page.goForward()
  await expect(input(page)).toBeVisible()
  await enter(page)
  await expect(page.locator('tbody tr')).toHaveCount(4)
  await openSettings(page)
  await expect(
    main(page).getByText('현재 선택: 동의', { exact: true }),
  ).toBeVisible()
  expect(
    await page.evaluate(() => history.state.earmarkWorkspaceScope),
  ).not.toBe(previousScope)
  await page.getByRole('button', { name: '나가기', exact: true }).click()
  await enter(page, DEMO_ACCESS_CODES.secondWorkspace)
  await page.getByRole('button', { name: '확인했어요' }).click()
  await page.getByRole('button', { name: '나중에 정할게요' }).click()
  await expect(
    main(page).getByRole('heading', { name: '첫 곡을 올려 주세요' }),
  ).toBeVisible()
  await page.goBack()
  await expect(
    main(page).getByRole('heading', { name: '첫 곡을 올려 주세요' }),
  ).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveCount(0)
  await openSettings(page)
  await expect(
    main(page).getByText('아직 정하지 않았어요.', { exact: false }),
  ).toBeVisible()
  await expect(
    page.getByText(maskTesterCode(DEMO_ACCESS_CODES.returningWorkspace), {
      exact: true,
    }),
  ).toHaveCount(0)
})

test('view queries cannot bypass entry and unavailable cases reveal the same generic message', async ({
  page,
}) => {
  await page.goto('/?view=settings')
  await expect(input(page)).toBeVisible()
  await expect(main(page)).toHaveCount(0)
  await page.goto('/?demo=workspace&view=unknown')
  await expect(page.getByRole('heading', { name: '최근 작업' })).toBeVisible()
  let firstMessage = ''
  for (const view of ['task-not-found', 'task-inaccessible']) {
    await page.goto(
      `/?demo=workspace&view=${view}&task=someone-elses-private-task`,
    )
    await expect(
      main(page).getByRole('heading', { name: '작업을 찾을 수 없어요' }),
    ).toBeVisible()
    const message = await main(page).innerText()
    if (!firstMessage) firstMessage = message
    else expect(message).toBe(firstMessage)
    expect(message).not.toContain('someone-elses-private-task')
    expect(page.url()).not.toContain('someone-elses-private-task')
    await page.getByRole('button', { name: '내 작업으로', exact: true }).click()
    await expect(page.getByRole('heading', { name: '최근 작업' })).toBeVisible()
    await expect(main(page)).toBeFocused()
  }
})

test('old preview selector cannot survive a new code session or restore preview data after reload', async ({
  page,
}) => {
  await page.goto('/?demo=workspace')
  await expect(page.locator('tbody tr')).toHaveCount(4)
  await openSettings(page)
  await page.getByRole('button', { name: '나가기', exact: true }).click()
  await enter(page, DEMO_ACCESS_CODES.secondWorkspace)
  await page.getByRole('button', { name: '확인했어요' }).click()
  await page.getByRole('button', { name: '나중에 정할게요' }).click()
  await expect(
    main(page).getByRole('heading', { name: '첫 곡을 올려 주세요' }),
  ).toBeVisible()
  await page.goBack()
  await expect(
    main(page).getByRole('heading', { name: '첫 곡을 올려 주세요' }),
  ).toBeVisible()
  const restoredUrl = page.url()
  await page.reload()
  await expect(input(page)).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveCount(0)
  await expect(
    page.getByText(maskTesterCode(DEMO_ACCESS_CODES.returningWorkspace), {
      exact: true,
    }),
  ).toHaveCount(0)
  expect(new URL(restoredUrl).searchParams.get('demo')).toBeNull()
})

test('entry and onboarding keep their initial access selector when older history is visited', async ({
  page,
}) => {
  await page.goto('/?access=session-expired')
  await expect(input(page)).toBeVisible()
  await page.evaluate(() => {
    const currentUrl = location.pathname + location.search
    history.replaceState(null, '', '/?access=network')
    history.pushState(null, '', currentUrl)
  })
  await page.goBack()
  await expect(page).toHaveURL(/\?access=session-expired$/)
  await page.reload()
  await enter(page, DEMO_ACCESS_CODES.newWorkspace)
  await expect(
    page.getByRole('heading', { name: '시작하기 전에 확인해 주세요' }),
  ).toBeVisible()
  await page.evaluate(() => {
    const currentUrl = location.pathname + location.search
    history.replaceState(
      { earmarkWorkspaceScope: 'earlier-session' },
      '',
      '/?demo=workspace',
    )
    history.pushState(null, '', currentUrl)
  })
  await page.goBack()
  await expect(page).toHaveURL(/\?access=session-expired$/)
  await expect(
    page.getByRole('heading', { name: '시작하기 전에 확인해 주세요' }),
  ).toBeVisible()
  await page.reload()
  await expect(input(page)).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveCount(0)
})

test('valid direct preview history retains its own selector across back and forward', async ({
  page,
}) => {
  await page.goto('/?demo=workspace')
  await expect(page.locator('tbody tr')).toHaveCount(4)
  await openSettings(page)
  await expect(page).toHaveURL(/\?demo=workspace&view=settings$/)
  await page.goBack()
  await expect(page.locator('tbody tr')).toHaveCount(4)
  await expect(page).toHaveURL(/\?demo=workspace$/)
  await page.goForward()
  await expect(
    main(page).getByRole('heading', { name: '설정', exact: true }),
  ).toBeVisible()
  await expect(page).toHaveURL(/\?demo=workspace&view=settings$/)
})

test('help keyboard/menu dismissal and read-only usage return to stable triggers without mutations', async ({
  page,
}) => {
  await startHarness(page)
  const before = await page.evaluate(() => window.accessTest.calls())
  const url = page.url()
  await help(page).click()
  await expect(
    page.getByRole('menuitem', { name: '자주 묻는 질문' }),
  ).toBeFocused()
  await page.keyboard.press('End')
  await expect(page.getByRole('menuitem', { name: '문의하기' })).toBeFocused()
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowDown')
  await expect(
    page.getByRole('menuitem', { name: '이용 안내 다시 보기' }),
  ).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(help(page)).toBeFocused()
  await help(page).click()
  await page.getByRole('heading', { name: '최근 작업' }).click()
  await expect(page.getByRole('menu')).toHaveCount(0)
  await help(page).click()
  await page.getByRole('menuitem', { name: '이용 안내 다시 보기' }).click()
  const usage = page.getByRole('dialog', { name: '이용 안내', exact: true })
  await expect(usage).toBeVisible()
  await expect(usage.getByRole('button', { name: '확인했어요' })).toHaveCount(0)
  await expect(usage.getByText('다시 들어올 때', { exact: true })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(usage).toHaveCount(0)
  await expect(help(page)).toBeFocused()
  expect(page.url()).toBe(url)
  await openSettings(page)
  const usageTrigger = page.getByRole('button', { name: '이용 안내 보기' })
  await usageTrigger.click()
  await expect(usage).toBeVisible()
  await usage.getByRole('button', { name: '닫기', exact: true }).click()
  await expect(usageTrigger).toBeFocused()
  expect(await page.evaluate(() => window.accessTest.calls())).toEqual(before)
})

test('contact/deletion dialogs provide guidance only and keep consent/code/data intact', async ({
  page,
}) => {
  await startHarness(page)
  const before = await page.evaluate(() => window.accessTest.calls())
  const posts: string[] = []
  page.on('request', (request) => {
    if (request.method() !== 'GET') posts.push(request.url())
  })
  await openSettings(page)
  await page.getByRole('button', { name: '문의하기', exact: true }).click()
  let guidance = page.getByRole('dialog', { name: '문의하기', exact: true })
  await expect(guidance).toContainText('아직 문의를 보내거나 접수할 수 없어요.')
  await expect(guidance.locator('a, input, textarea')).toHaveCount(0)
  await guidance.getByRole('button', { name: '닫기', exact: true }).click()
  await page.getByRole('button', { name: '요청 방법 보기' }).click()
  guidance = page.getByRole('dialog', { name: '자료 삭제 요청 안내' })
  await expect(guidance).toContainText(
    '지금은 요청을 보내거나 접수할 수 없어요.',
  )
  await expect(guidance.locator('a, input, textarea')).toHaveCount(0)
  await guidance.getByRole('button', { name: '닫기', exact: true }).click()
  await expect(
    main(page).getByText('현재 선택: 동의하지 않음', { exact: true }),
  ).toBeVisible()
  expect(await page.evaluate(() => window.accessTest.calls())).toEqual(before)
  expect(posts).toEqual([])
  await page.getByRole('button', { name: '나가기', exact: true }).click()
  await enter(page)
  await expect(page.locator('tbody tr')).toHaveCount(4)
})

test('mobile support restores drawer trigger focus and settings closes navigation without overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/?demo=workspace')
  await page.getByRole('button', { name: '탐색 메뉴 열기' }).click()
  await help(page).click()
  await page.getByRole('menuitem', { name: '자주 묻는 질문' }).click()
  const faq = page.getByRole('dialog', { name: '자주 묻는 질문' })
  await expect(faq).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(faq).toHaveCount(0)
  await expect(
    page.getByRole('button', { name: '탐색 메뉴 열기' }),
  ).toBeFocused()
  await page.keyboard.press('Enter')
  await settings(page).click()
  await expect(
    main(page).getByRole('heading', { name: '설정', exact: true }),
  ).toBeVisible()
  await expect(main(page)).toBeFocused()
  await expect(
    page.getByRole('button', { name: '탐색 메뉴 열기' }),
  ).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  )
  await page.getByRole('button', { name: '탐색 메뉴 열기' }).click()
  await page.keyboard.press('Escape')
  await expect(
    page.getByRole('button', { name: '탐색 메뉴 열기' }),
  ).toBeFocused()
})

test('logout aborts an in-flight settings save and its late result cannot affect the next workspace', async ({
  page,
}) => {
  await startHarness(page, 'pending-workspace-save')
  await openConsent(page)
  await consentDialog(page)
    .getByRole('button', { name: '동의해요', exact: true })
    .click()
  await consentDialog(page).evaluate((element) =>
    (element as HTMLDialogElement).close(),
  )
  await expect(consentDialog(page)).toHaveCount(0)
  await page.getByRole('button', { name: '나가기', exact: true }).click()
  await expect(input(page)).toBeFocused()
  expect(
    (await page.evaluate(() => window.accessTest.calls())).aborted,
  ).toBeGreaterThan(0)
  await enter(page, DEMO_ACCESS_CODES.secondWorkspace)
  await page.getByRole('button', { name: '확인했어요' }).click()
  await page.getByRole('button', { name: '나중에 정할게요' }).click()
  await expect(
    main(page).getByRole('heading', { name: '첫 곡을 올려 주세요' }),
  ).toBeVisible()
  await page.evaluate(() => window.accessTest.releaseWorkspaceSaves())
  await openSettings(page)
  await expect(
    main(page).getByText('아직 정하지 않았어요.', { exact: false }),
  ).toBeVisible()
  await expect(consentDialog(page)).toHaveCount(0)
})

test('expiry from settings closes overlays and old history cannot bypass renewed entry', async ({
  page,
}) => {
  await startHarness(page)
  await openConsent(page)
  await page.evaluate(() => window.accessTest.expireSession())
  await consentDialog(page)
    .getByRole('button', { name: '동의해요', exact: true })
    .click()
  await expect(consentDialog(page)).toHaveCount(0)
  await page.getByRole('button', { name: '코드 다시 입력' }).click()
  await expect(input(page)).toBeFocused()
  await page.goBack()
  await expect(input(page)).toBeVisible()
  await expect(page.locator('tbody tr')).toHaveCount(0)
  await enter(page)
  await expect(page.locator('tbody tr')).toHaveCount(4)
  await expect(main(page)).toBeFocused()
})
