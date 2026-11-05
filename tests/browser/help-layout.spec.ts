import { expect, test, type Locator, type Page } from '@playwright/test'
import { DEMO_ACCESS_CODES } from '../../src/app/demoConfig.ts'

const topics = [
  { label: '자주 묻는 질문', title: '자주 묻는 질문' },
  { label: '이용 안내 다시 보기', title: '이용 안내' },
  { label: '문의하기', title: '문의하기' },
] as const

async function openMobileHelp(page: Page) {
  await page.getByRole('button', { name: '탐색 메뉴 열기' }).tap()
  await page.getByRole('button', { name: '도움말', exact: true }).tap()
  await expect(page.getByRole('menuitem').first()).toBeFocused()
}

async function expectReachableTarget(item: Locator) {
  await item.scrollIntoViewIfNeeded()
  const target = await item.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const visible = {
      top: Math.max(0, rect.top),
      bottom: Math.min(innerHeight, rect.bottom),
      left: Math.max(0, rect.left),
      right: Math.min(innerWidth, rect.right),
    }
    for (
      let parent = element.parentElement;
      parent;
      parent = parent.parentElement
    ) {
      const style = getComputedStyle(parent)
      const bounds = parent.getBoundingClientRect()
      if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
        visible.top = Math.max(visible.top, bounds.top + parent.clientTop)
        visible.bottom = Math.min(
          visible.bottom,
          bounds.top + parent.clientTop + parent.clientHeight,
        )
      }
      if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
        visible.left = Math.max(visible.left, bounds.left + parent.clientLeft)
        visible.right = Math.min(
          visible.right,
          bounds.left + parent.clientLeft + parent.clientWidth,
        )
      }
    }
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    return {
      x,
      y,
      height: rect.height,
      width: rect.width,
      visibleHeight: Math.max(0, visible.bottom - visible.top),
      visibleWidth: Math.max(0, visible.right - visible.left),
      receivesPointer: [rect.top + 1, y, rect.bottom - 1].every((pointY) =>
        element.contains(document.elementFromPoint(x, pointY)),
      ),
    }
  })
  expect(target.height).toBeGreaterThanOrEqual(44)
  expect(target.visibleHeight).toBeCloseTo(target.height, 1)
  expect(target.visibleWidth).toBeCloseTo(target.width, 1)
  expect(target.receivesPointer).toBe(true)
  return target
}

test.describe('mobile help targets', () => {
  test.use({ isMobile: true, hasTouch: true })

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 320, height: 480 },
  ]) {
    for (const scenario of ['empty', 'new-code', 'workspace']) {
      test(`${scenario} ${viewport.width}x${viewport.height}: every item remains reachable and returns focus`, async ({
        page,
      }) => {
        await page.setViewportSize(viewport)
        await page.goto(scenario === 'new-code' ? '/' : `/?demo=${scenario}`)
        if (scenario === 'new-code') {
          await page
            .getByRole('textbox', { name: '테스터 코드', exact: true })
            .fill(DEMO_ACCESS_CODES.newWorkspace)
          await page.keyboard.press('Enter')
          await page.getByRole('button', { name: '확인했어요' }).tap()
          await page.getByRole('button', { name: '나중에 정할게요' }).tap()
        }
        await expect(
          page.getByRole('heading', {
            name:
              scenario === 'workspace' ? '최근 작업' : '첫 곡을 올려 주세요',
          }),
        ).toBeVisible()

        for (const { label, title } of topics) {
          await openMobileHelp(page)
          const item = page.getByRole('menuitem', { name: label, exact: true })
          const target = await expectReachableTarget(item)
          await page.touchscreen.tap(target.x, target.y)
          const dialog = page.getByRole('dialog', { name: title, exact: true })
          await expect(dialog).toBeVisible()
          await dialog.getByRole('button', { name: '닫기', exact: true }).tap()
          await expect(dialog).toHaveCount(0)
          await expect(
            page.getByRole('button', { name: '탐색 메뉴 열기' }),
          ).toBeFocused()
        }

        await openMobileHelp(page)
        await page.keyboard.press('End')
        await expect(
          page.getByRole('menuitem', { name: '문의하기' }),
        ).toBeFocused()
        await expectReachableTarget(
          page.getByRole('menuitem', { name: '문의하기' }),
        )
        await page.keyboard.press('Home')
        await expect(page.getByRole('menuitem').first()).toBeFocused()
        await page.keyboard.press('Escape')
        await expect(page.getByRole('menu')).toHaveCount(0)
        await expect(
          page.getByRole('button', { name: '도움말', exact: true }),
        ).toBeFocused()
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth),
        ).toBe(viewport.width)
      })
    }
  }
})
