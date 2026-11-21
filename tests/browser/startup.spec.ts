import { expect, test } from '@playwright/test'

const MOCK_CHUNK = '**/src/app/mockRepositories.ts*'

test('a chunk that fails at startup shows a reload that recovers', async ({
  page,
}) => {
  const errors: string[] = []
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text())
  })
  await page.route(MOCK_CHUNK, (route) => route.abort())

  await page.goto('/')
  await expect(
    page.getByRole('heading', { name: '화면을 열지 못했어요' }),
  ).toBeVisible()
  expect(errors.join('\n')).toMatch(/mockRepositories/)

  await page.unroute(MOCK_CHUNK)
  await page.getByRole('button', { name: '다시 불러오기', exact: true }).click()
  await expect(
    page.getByRole('textbox', { name: '테스터 코드', exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole('heading', { name: '화면을 열지 못했어요' }),
  ).toHaveCount(0)
})
