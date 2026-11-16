import { expect, test, type Page } from '@playwright/test'
import type {} from './harness.tsx'

const main = (page: Page) => page.locator('#workspace-content')
const consent = (page: Page) =>
  page.getByRole('dialog', { name: 'AI 학습 활용' })
const stop = (page: Page) =>
  main(page).locator('header > div > button', { hasText: '멈추기' })

async function openConsent(page: Page) {
  await page.goto('/tests/browser/harness.html?scenario=pending-save')
  await page.getByRole('button', { name: '설정', exact: true }).click()
  await page.getByRole('button', { name: '선택하기', exact: true }).click()
  await consent(page)
    .getByRole('button', { name: '동의해요', exact: true })
    .click()
  await expect(consent(page).getByRole('status')).toHaveText(
    '선택을 저장하고 있어요.',
  )
}

for (const sameTurn of [false, true]) {
  test(`a natively closed consent save restores its failure (${sameTurn})`, async ({
    page,
  }) => {
    await openConsent(page)
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await page.evaluate((sameTurn) => {
      document.querySelector<HTMLDialogElement>('dialog')?.close()
      if (sameTurn) window.workspaceTest.rejectSave()
    }, sameTurn)
    if (!sameTurn) {
      await expect(consent(page)).not.toBeVisible()
      await page.evaluate(() => window.workspaceTest.rejectSave())
    }
    await expect(consent(page).getByRole('alert')).toBeVisible()
    await expect(
      consent(page).getByRole('heading', { name: 'AI 학습 활용' }),
    ).toBeFocused()
    await consent(page).getByRole('button', { name: '동의하지 않아요' }).click()
    await page.evaluate(() => window.workspaceTest.resolveSave())
    await expect(consent(page)).toHaveCount(0)
    await expect(
      main(page).getByText('현재 선택: 동의하지 않음', { exact: true }),
    ).toBeVisible()
  })
}

test('a natively closed consent save stays closed after success', async ({
  page,
}) => {
  await openConsent(page)
  await page.evaluate(() =>
    document.querySelector<HTMLDialogElement>('dialog')!.close(),
  )
  await expect(consent(page)).not.toBeVisible()
  await page.evaluate(() => window.workspaceTest.resolveSave())
  await expect(page.locator('dialog')).toHaveCount(0)
  await expect(
    main(page).getByText('현재 선택: 동의', { exact: true }),
  ).toBeVisible()
})

test('leaving a hidden consent save prevents a late failure from reopening it', async ({
  page,
}) => {
  await openConsent(page)
  await page.evaluate(() =>
    document.querySelector<HTMLDialogElement>('dialog')!.close(),
  )
  await page.getByRole('button', { name: '내 작업', exact: true }).click()
  await page.evaluate(() => window.workspaceTest.rejectSave())
  await expect(page.locator('dialog')).toHaveCount(0)
  await expect(
    main(page).getByRole('heading', { name: '최근 작업' }),
  ).toBeVisible()
})

for (const status of ['queued', 'completed'] as const) {
  test(`a failed retry response focuses the refreshed ${status} task`, async ({
    page,
  }) => {
    await page.goto(
      '/tests/browser/harness.html?scenario=pending-retry&view=task&task=task-intro',
    )
    await main(page)
      .getByRole('button', { name: '다시 시도', exact: true })
      .click()
    await page.evaluate((status) => {
      window.workspaceTest.updateTaskOnServer('task-intro', {
        processingStatus: status,
        failureKind: null,
      })
      window.workspaceTest.failRetry('retry-task-failed')
    }, status)
    await expect(
      main(page).getByText(status === 'queued' ? '대기' : '완료', {
        exact: true,
      }),
    ).toBeVisible()
    await expect(main(page)).toBeFocused()
    await expect(
      main(page).getByText('다시 시도하지 못했어요.', { exact: false }),
    ).toHaveCount(0)
  })
}

test('a late retry refresh does not take focus from another control', async ({
  page,
}) => {
  await page.goto(
    '/tests/browser/harness.html?scenario=pending-retry&view=task&task=task-intro',
  )
  await main(page)
    .getByRole('button', { name: '다시 시도', exact: true })
    .click()
  const choice = page.getByRole('button', { name: '설정', exact: true })
  await choice.focus()
  await page.evaluate(() => {
    window.workspaceTest.updateTaskOnServer('task-intro', {
      processingStatus: 'queued',
      failureKind: null,
    })
    window.workspaceTest.failRetry('retry-task-failed')
  })
  await expect(main(page).getByText('대기', { exact: true })).toBeVisible()
  await expect(choice).toBeFocused()
})

test('the stop trigger reopens its pending native dialog without sending twice', async ({
  page,
}) => {
  await page.goto(
    '/tests/browser/harness.html?scenario=pending-cancel&view=task&task=task-solo',
  )
  await stop(page).click()
  const dialog = page.getByRole('alertdialog')
  await dialog.getByRole('button', { name: '멈추기', exact: true }).click()
  await expect(dialog.getByRole('status')).toHaveText('멈추는 중…')
  await dialog.evaluate((element) => (element as HTMLDialogElement).close())
  await expect(dialog).not.toBeVisible()
  await stop(page).click()
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('status')).toHaveText('멈추는 중…')
  await dialog.getByRole('button', { name: '멈추는 중…' }).focus()
  await page.keyboard.press('Enter')
  expect(await page.evaluate(() => window.workspaceTest.cancelCalls())).toEqual(
    ['task-solo'],
  )
  await page.evaluate(() =>
    window.workspaceTest.failCancel('cancel-task-failed'),
  )
  await expect(dialog.getByRole('alert')).toBeVisible()
  await dialog.getByRole('button', { name: '취소', exact: true }).click()
  await expect(stop(page)).toBeFocused()
})

test('unknown progress names its stage and differs from zero, including reduced motion', async ({
  page,
}) => {
  await page.goto('/tests/browser/harness.html')
  await expect(page.locator('tbody tr')).toHaveCount(4)
  await page.evaluate(() =>
    window.workspaceTest.updateTaskOnServer('task-verse', {
      processingStatus: 'processing',
      progressPercent: null,
      hasSeparatedAudio: false,
    }),
  )
  await page
    .getByRole('complementary')
    .getByRole('button', { name: /벌스 1/ })
    .click()
  await expect(
    main(page).getByRole('heading', { name: '기타 분리 중', exact: true }),
  ).toBeVisible()
  const bar = main(page).getByRole('progressbar')
  await expect(bar).not.toHaveAttribute('aria-valuenow')
  await expect(
    main(page).getByText('진행률 확인 중', { exact: true }),
  ).toBeVisible()
  const fill = bar.locator('span')
  await expect(fill).toBeVisible()
  await expect(fill).not.toHaveCSS('animation-name', 'none')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await expect(fill).toHaveCSS('animation-name', 'none')
  await expect(fill).toBeVisible()
})

test('an editor waiting for its task uses a neutral headline', async ({
  page,
}) => {
  await page.goto(
    '/tests/browser/harness.html?scenario=pending-task&view=edit-section&task=task-chorus',
  )
  await expect(
    main(page).getByRole('heading', { name: '작업을 여는 중이에요' }),
  ).toBeVisible()
  await expect(main(page).locator('header').first()).toContainText(
    '작업 불러오기',
  )
  await expect(main(page).locator('header').first()).not.toContainText(
    '구간 수정',
  )
  await page.evaluate(() => window.workspaceTest.resolveTask('task-chorus'))
  await expect(
    main(page).getByRole('heading', { name: '구간 다시 정하기', exact: true }),
  ).toBeVisible()
})

test('previous results keep distinct numbers and copy metadata when a range returns', async ({
  page,
}) => {
  await page.goto(
    '/tests/browser/harness.html?view=edit-section&task=task-verse',
  )
  for (const end of ['01:00.0', '01:05.8']) {
    const input = main(page).getByLabel('끝', { exact: true })
    await input.fill(end)
    await input.press('Tab')
    await main(page)
      .getByRole('button', { name: '타브 다시 만들기', exact: true })
      .click()
    await expect(main(page).getByText('대기', { exact: true })).toBeVisible()
    await page.evaluate(() =>
      window.workspaceTest.updateTaskOnServer('task-verse', {
        processingStatus: 'completed',
        progressPercent: null,
        hasSeparatedAudio: true,
      }),
    )
    if (end === '01:00.0') {
      await page.getByRole('button', { name: '내 작업', exact: true }).click()
      await page
        .getByRole('complementary')
        .getByRole('button', { name: /벌스 1/ })
        .click()
      await main(page)
        .getByRole('button', { name: '구간 수정', exact: true })
        .click()
    }
  }
  const results = main(page)
    .getByRole('region', { name: '이전 결과' })
    .getByRole('listitem')
  await expect(results).toHaveCount(2)
  await expect(results.nth(0)).toContainText('결과 2')
  await expect(results.nth(0)).toContainText('비교 0회')
  await expect(results.nth(0)).toContainText('카피 미확인')
  await expect(results.nth(1)).toContainText('결과 1')
  await expect(results.nth(1)).toContainText('비교 2회')
  await expect(results.nth(1)).toContainText('카피 완료')
  await page.setViewportSize({ width: 390, height: 844 })
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    390,
  )
})
