import { readFileSync } from 'node:fs'
import {
  expect,
  test,
  type FileChooser,
  type Locator,
  type Page,
} from '@playwright/test'
import type {} from './harness.tsx'

const main = (page: Page) => page.locator('#workspace-content')
const sidebar = (page: Page) =>
  page.getByRole('complementary', { name: '워크스페이스 탐색' })
const addButton = (page: Page) =>
  sidebar(page).getByRole('button', { name: '곡 추가', exact: true })
const dialog = (page: Page) => page.getByRole('dialog', { name: '곡 추가' })
const next = (page: Page) =>
  dialog(page).getByRole('button', { name: '다음', exact: true })
const picker = (page: Page) =>
  dialog(page).getByRole('button', {
    name: /^(파일을 끌어다 놓거나 선택하세요|파일 바꾸기)$/,
  })
const dropzone = (page: Page) =>
  dialog(page).getByRole('button', { name: '파일을 끌어다 놓거나 선택하세요' })
const alertText = (page: Page) => dialog(page).getByRole('alert')
const status = (page: Page) => dialog(page).getByRole('status')
const original = (page: Page) =>
  dialog(page).getByRole('radio', { name: '원곡' })
const separated = (page: Page) =>
  dialog(page).getByRole('radio', { name: '분리된 기타 음원' })

const FORMAT_MESSAGE =
  'MP3, MP4 파일만 올릴 수 있어요. 형식을 바꿔서 다시 올려 주세요.'
const TOO_LONG_MESSAGE =
  '5분 이하 파일만 올릴 수 있어요. 필요한 부분만 잘라서 올려 주세요.'
const UNREADABLE_MESSAGE =
  '이 파일은 재생할 수 없어요. 손상되지 않은 파일인지 확인하고 다시 올려 주세요.'

// 1.5KB of zeros; the harness probe decides each file's length by name.
function audio(name: string, mimeType: string) {
  return { name, mimeType, buffer: Buffer.alloc(1536) }
}

async function openHarness(page: Page, scenario?: string) {
  await page.goto(
    `/tests/browser/harness.html${scenario ? `?scenario=${scenario}` : ''}`,
  )
}

async function openFromSidebar(page: Page, scenario?: string) {
  await openHarness(page, scenario)
  await expect(page.locator('tbody tr')).toHaveCount(4)
  await addButton(page).click()
  await expect(dialog(page)).toBeVisible()
}

async function choose(
  page: Page,
  file: Parameters<FileChooser['setFiles']>[0],
) {
  const chooser = page.waitForEvent('filechooser')
  await picker(page).click()
  await (await chooser).setFiles(file)
}

async function pressNext(page: Page) {
  await next(page).focus()
  await page.keyboard.press('Enter')
}

async function dropFiles(
  target: Locator,
  files: ReadonlyArray<{ name: string; type: string }>,
) {
  const dataTransfer = await target.page().evaluateHandle((list) => {
    const transfer = new DataTransfer()
    for (const file of list)
      transfer.items.add(
        new File([new Uint8Array(1536)], file.name, { type: file.type }),
      )
    return transfer
  }, files)
  for (const type of ['dragenter', 'dragover', 'drop'])
    await target.dispatchEvent(type, { dataTransfer })
}

test('the sidebar + opens the dialog on the input kind, which the keyboard can change', async ({
  page,
}) => {
  await openFromSidebar(page)
  await expect(original(page)).toBeFocused()
  await expect(original(page)).toBeChecked()
  await expect(
    dialog(page).getByRole('group', { name: '올릴 음원 종류' }),
  ).toHaveAccessibleDescription('원곡은 기타를 먼저 분리한 뒤 타브를 만들어요.')
  await page.keyboard.press('ArrowRight')
  await expect(separated(page)).toBeChecked()
  await expect(
    dialog(page).getByText(
      '분리된 기타 음원은 분리 단계 없이 바로 타브를 만들어요.',
    ),
  ).toBeVisible()
  await expect(dropzone(page)).toHaveAccessibleDescription(
    'MP3, MP4 · 최대 5분',
  )
  await expect(next(page)).toHaveAttribute('aria-disabled', 'true')

  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)
  await expect(addButton(page)).toBeFocused()
})

test('valid MP3 and MP4 files show their length and size and allow 다음', async ({
  page,
}) => {
  await openFromSidebar(page)
  await choose(page, audio('neon_harbor_live.mp3', 'audio/mpeg'))
  await expect(dialog(page).getByText('neon_harbor_live.mp3')).toBeVisible()
  await expect(dialog(page).getByText('04:12 · 1.5KB')).toBeVisible()
  // The drop area that held focus is replaced by the file card.
  await expect(
    dialog(page).getByRole('button', { name: '파일 바꾸기' }),
  ).toBeFocused()
  await expect(status(page)).toHaveText('올릴 수 있는 파일이에요.')
  await expect(alertText(page)).toHaveCount(0)
  await expect(next(page)).toHaveAttribute('aria-disabled', 'false')

  await choose(page, audio('late_train_cover.mp4', 'video/mp4'))
  await expect(dialog(page).getByText('late_train_cover.mp4')).toBeVisible()
  await expect(dialog(page).getByText('03:58 · 1.5KB')).toBeVisible()
  await expect(next(page)).toHaveAttribute('aria-disabled', 'false')
})

test('each rejected file gets its own message and blocks 다음 until another file is chosen', async ({
  page,
}) => {
  await openFromSidebar(page)
  const replace = dialog(page).getByRole('button', { name: '파일 바꾸기' })

  await choose(page, audio('clip.wav', 'audio/wav'))
  await expect(alertText(page)).toHaveText(FORMAT_MESSAGE)
  await expect(replace).toHaveAccessibleDescription(FORMAT_MESSAGE)
  // A disallowed format is never decoded, so only its size is known.
  await expect(dialog(page).getByText('1.5KB', { exact: true })).toBeVisible()
  await expect(next(page)).toHaveAttribute('aria-disabled', 'true')
  await pressNext(page)
  await expect(dialog(page)).toBeVisible()

  // The extension alone is not enough: the MIME type has to agree. The same
  // message for a new file is a new alert, so it is announced again.
  await alertText(page).evaluate((element) =>
    element.setAttribute('data-seen', ''),
  )
  await choose(page, audio('renamed.mp3', 'audio/wav'))
  await expect(alertText(page)).toHaveText(FORMAT_MESSAGE)
  await expect(alertText(page)).not.toHaveAttribute('data-seen')

  await choose(page, audio('long_jam_take3.mp4', 'video/mp4'))
  await expect(alertText(page)).toHaveText(TOO_LONG_MESSAGE)
  await expect(dialog(page).getByText('06:31 · 1.5KB')).toBeVisible()
  await expect(next(page)).toHaveAttribute('aria-disabled', 'true')

  await choose(page, audio('broken.mp3', 'audio/mpeg'))
  await expect(alertText(page)).toHaveText(UNREADABLE_MESSAGE)
  await expect(dialog(page).getByText('길이 알 수 없음 · 1.5KB')).toBeVisible()
  await expect(next(page)).toHaveAttribute('aria-disabled', 'true')

  await choose(page, audio('neon_harbor_live.mp3', 'audio/mpeg'))
  await expect(alertText(page)).toHaveCount(0)
  await expect(next(page)).toHaveAttribute('aria-disabled', 'false')
  expect(
    await page.evaluate(() => window.workspaceTest.probeCalls()),
  ).not.toContain('clip.wav')
  expect(await page.evaluate(() => window.workspaceTest.addCalls())).toEqual([])
})

test('a replaced file never shows a late length result', async ({ page }) => {
  await openFromSidebar(page)
  await choose(page, audio('slow.mp3', 'audio/mpeg'))
  await expect(dialog(page).getByText('길이 확인 중 · 1.5KB')).toBeVisible()
  await expect(status(page)).toHaveText('파일을 확인하고 있어요.')
  await expect(next(page)).toHaveAttribute('aria-disabled', 'true')

  // The replacement is playable and checked before the first file answers, so
  // only the stale-result guard keeps that late answer off the new card.
  await choose(page, audio('neon_harbor_live.mp3', 'audio/mpeg'))
  await expect(dialog(page).getByText('04:12 · 1.5KB')).toBeVisible()
  await expect(next(page)).toHaveAttribute('aria-disabled', 'false')
  await page.evaluate(() => window.workspaceTest.resolveProbe(100))
  // Let React render whatever the late answer scheduled before checking.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => setTimeout(resolve)),
      ),
  )
  await expect(status(page)).toHaveText('올릴 수 있는 파일이에요.')
  await expect(dialog(page).getByText('04:12 · 1.5KB')).toBeVisible()
  await expect(next(page)).toHaveAttribute('aria-disabled', 'false')
  await expect(dialog(page).getByText('01:40', { exact: false })).toHaveCount(0)
})

test('pressing Escape again while adding keeps the dialog and the add', async ({
  page,
}) => {
  await openFromSidebar(page, 'pending-add')
  await choose(page, audio('fresh_riff.mp3', 'audio/mpeg'))
  await next(page).click()
  await expect(status(page)).toHaveText('곡을 추가하고 있어요.')
  // Chrome lets a page refuse only the first of repeated Escapes with no click
  // or key press in between; the second one closes the modal regardless.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Escape')
  await expect(dialog(page)).toBeVisible()
  await expect(status(page)).toHaveText('곡을 추가하고 있어요.')
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document
            .querySelector('dialog[open]')
            ?.contains(document.activeElement) ?? false,
      ),
    )
    .toBe(true)

  await page.evaluate(() => window.workspaceTest.resolveAdd())
  await expect(dialog(page)).toHaveCount(0)
  await expect(main(page).getByText('fresh_riff.mp3')).toBeVisible()
})

test('dropping several files is refused and dropping one file selects it', async ({
  page,
}) => {
  await openFromSidebar(page)
  await dropFiles(dropzone(page), [
    { name: 'neon_harbor_live.mp3', type: 'audio/mpeg' },
    { name: 'late_train_cover.mp4', type: 'video/mp4' },
  ])
  await expect(alertText(page)).toHaveText(
    '파일은 한 번에 하나만 올릴 수 있어요.',
  )
  await expect(dropzone(page)).toBeVisible()

  await dropFiles(dropzone(page), [
    { name: 'neon_harbor_live.mp3', type: 'audio/mpeg' },
  ])
  await expect(alertText(page)).toHaveCount(0)
  await expect(dialog(page).getByText('04:12 · 1.5KB')).toBeVisible()

  // A refused drop keeps the file already chosen.
  await dropFiles(dialog(page).getByText('neon_harbor_live.mp3'), [
    { name: 'a.mp3', type: 'audio/mpeg' },
    { name: 'b.mp3', type: 'audio/mpeg' },
  ])
  await expect(alertText(page)).toHaveText(
    '파일은 한 번에 하나만 올릴 수 있어요.',
  )
  await expect(dialog(page).getByText('04:12 · 1.5KB')).toBeVisible()
  await expect(next(page)).toHaveAttribute('aria-disabled', 'false')
})

test('cancelling the system file picker keeps the dialog and the chosen file', async ({
  page,
}) => {
  await openFromSidebar(page)
  await choose(page, audio('neon_harbor_live.mp3', 'audio/mpeg'))
  // A cancelled file chooser fires a bubbling cancel event on the input.
  await dialog(page)
    .locator('input[type="file"]')
    .evaluate((input) =>
      input.dispatchEvent(new Event('cancel', { bubbles: true })),
    )
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page).getByText('04:12 · 1.5KB')).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(dialog(page)).toHaveCount(0)
})

test('closing by the close button, 취소 or the backdrop discards the selection', async ({
  page,
}) => {
  await openFromSidebar(page)
  const closers = [
    () => dialog(page).getByRole('button', { name: '곡 추가 창 닫기' }).click(),
    () => dialog(page).getByRole('button', { name: '취소' }).click(),
    () => page.mouse.click(4, 4),
  ]
  for (const close of closers) {
    await separated(page).check()
    await choose(page, audio('neon_harbor_live.mp3', 'audio/mpeg'))
    await expect(dialog(page).getByText('04:12 · 1.5KB')).toBeVisible()
    await close()
    await expect(dialog(page)).toHaveCount(0)
    await expect(addButton(page)).toBeFocused()

    await addButton(page).click()
    await expect(dropzone(page)).toBeVisible()
    await expect(original(page)).toBeChecked()
  }
})

test('adding a song opens its new-section screen and lists it in the sidebar', async ({
  page,
}) => {
  await openFromSidebar(page)
  await separated(page).check()
  await choose(page, audio('fresh_riff.mp3', 'audio/mpeg'))
  await expect(next(page)).toHaveAttribute('aria-disabled', 'false')
  await next(page).click()

  await expect(dialog(page)).toHaveCount(0)
  await expect(page).toHaveURL(
    '/tests/browser/harness.html?view=new-section&song=song-added-1',
  )
  await expect(main(page)).toBeFocused()
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
    '새 구간',
  )
  await expect(main(page).getByText('fresh_riff.mp3')).toBeVisible()
  await expect(main(page).getByText('02:20')).toBeVisible()
  await expect(main(page).getByText('분리된 기타 음원')).toBeVisible()
  await expect(
    main(page).getByRole('heading', { name: '구간 입력 준비 중' }),
  ).toBeVisible()
  await expect(
    main(page).getByRole('navigation', { name: '작업 위치' }),
  ).toHaveText('fresh_riff새 구간')
  await expect(
    sidebar(page).getByRole('button', { name: 'fresh_riff', exact: true }),
  ).toBeVisible()
  expect(await page.evaluate(() => window.workspaceTest.addCalls())).toEqual([
    {
      fileName: 'fresh_riff.mp3',
      inputKind: 'separated-guitar',
      durationSeconds: 140.2,
    },
  ])

  await page.goBack()
  await expect(page).toHaveURL('/tests/browser/harness.html')
  await page.goForward()
  await expect(main(page).getByText('fresh_riff.mp3')).toBeVisible()
})

test('while adding the dialog stays open, and a failure keeps the file for a retry', async ({
  page,
}) => {
  await openFromSidebar(page, 'pending-add')
  await choose(page, audio('fresh_riff.mp3', 'audio/mpeg'))
  // A refused drop's message gives way once the chosen file is submitted.
  await dropFiles(dialog(page).getByText('fresh_riff.mp3'), [
    { name: 'a.mp3', type: 'audio/mpeg' },
    { name: 'b.mp3', type: 'audio/mpeg' },
  ])
  await expect(alertText(page)).toBeVisible()
  await next(page).click()
  await expect(status(page)).toHaveText('곡을 추가하고 있어요.')
  await expect(alertText(page)).toHaveCount(0)
  await expect(
    dialog(page).getByRole('button', { name: '취소' }),
  ).toBeDisabled()
  await expect(
    dialog(page).getByRole('button', { name: '곡 추가 창 닫기' }),
  ).toBeDisabled()
  await expect(original(page)).toBeDisabled()
  await expect(next(page)).toHaveAttribute('aria-disabled', 'true')
  await page.keyboard.press('Escape')
  await pressNext(page)
  await expect(dialog(page)).toBeVisible()
  expect(
    await page.evaluate(() => window.workspaceTest.addCalls().length),
  ).toBe(1)

  await page.evaluate(() => window.workspaceTest.failAdd('add-song-failed'))
  await expect(alertText(page)).toHaveText(
    '곡을 추가하지 못했어요. 다시 시도해 주세요.',
  )
  await expect(dialog(page).getByText('fresh_riff.mp3')).toBeVisible()
  await expect(next(page)).toHaveAttribute('aria-disabled', 'false')

  await next(page).click()
  await expect(alertText(page)).toHaveCount(0)
  await page.evaluate(() => window.workspaceTest.resolveAdd())
  await expect(dialog(page)).toHaveCount(0)
  await expect(main(page).getByText('fresh_riff.mp3')).toBeVisible()
})

test('an expired session while adding closes the dialog and shows the expiry state', async ({
  page,
}) => {
  await openFromSidebar(page, 'pending-add')
  await choose(page, audio('fresh_riff.mp3', 'audio/mpeg'))
  await next(page).click()
  await page.evaluate(() => window.workspaceTest.failAdd('expired'))
  await expect(dialog(page)).toHaveCount(0)
  await expect(
    main(page).getByRole('heading', { name: '작업 공간을 열 수 없어요' }),
  ).toBeVisible()
  await expect(main(page)).toBeFocused()
})

test('an empty workspace opens the dialog from 파일 선택 and from a dropped file', async ({
  page,
}) => {
  await openHarness(page, 'empty')
  const selectFile = main(page).getByRole('button', { name: '파일 선택' })
  await expect(
    main(page).getByRole('heading', { name: '첫 곡을 올려 주세요' }),
  ).toBeVisible()
  await expect(main(page).getByText('MP3, MP4 · 최대 5분')).toBeVisible()
  await expect(sidebar(page).getByText('아직 곡이 없어요')).toBeVisible()

  await selectFile.click()
  await expect(dialog(page)).toBeVisible()
  await expect(dropzone(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(selectFile).toBeFocused()

  await dropFiles(main(page).getByRole('heading', { level: 1 }), [
    { name: 'fresh_riff.mp3', type: 'audio/mpeg' },
  ])
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page).getByText('02:20 · 1.5KB')).toBeVisible()
  await next(page).click()
  await expect(main(page).getByText('fresh_riff.mp3')).toBeVisible()

  await sidebar(page).getByRole('button', { name: '내 작업' }).click()
  await expect(
    main(page).getByRole('heading', { name: '아직 만든 구간이 없어요' }),
  ).toBeVisible()
  await expect(sidebar(page).getByText('아직 곡이 없어요')).toHaveCount(0)
})

test('a file dropped outside a drop area does not open in the browser', async ({
  page,
}) => {
  await openHarness(page)
  await expect(page.locator('tbody tr')).toHaveCount(4)
  const prevented = await page.evaluate(() =>
    ['dragover', 'drop'].map((type) => {
      const dataTransfer = new DataTransfer()
      dataTransfer.items.add(new File(['x'], 'stray.mp3'))
      const event = new DragEvent(type, {
        bubbles: true,
        cancelable: true,
        dataTransfer,
      })
      document.querySelector('#workspace-content')!.dispatchEvent(event)
      return event.defaultPrevented
    }),
  )
  expect(prevented).toEqual([true, true])
})

test('the real media probe reads an MP3, rejects a corrupt file and revokes its object URLs', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const counts = { created: 0, revoked: 0 }
    const create = URL.createObjectURL.bind(URL)
    const revoke = URL.revokeObjectURL.bind(URL)
    URL.createObjectURL = (object) => {
      counts.created += 1
      return create(object)
    }
    URL.revokeObjectURL = (url) => {
      counts.revoked += 1
      revoke(url)
    }
    Object.assign(window, { objectUrlCounts: counts })
  })
  await openFromSidebar(page, 'real-probe')
  const counts = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            objectUrlCounts: { created: number; revoked: number }
          }
        ).objectUrlCounts,
    )

  await choose(page, {
    name: 'tone-2s.mp3',
    mimeType: 'audio/mpeg',
    buffer: readFileSync(
      new URL('../fixtures/media/tone-2s.mp3', import.meta.url),
    ),
  })
  await expect(dialog(page).getByText(/^00:02 · \d+(\.\d)?KB$/)).toBeVisible()
  await expect(next(page)).toHaveAttribute('aria-disabled', 'false')

  await choose(page, {
    name: 'corrupt.mp3',
    mimeType: 'audio/mpeg',
    buffer: Buffer.from('not really audio '.repeat(200)),
  })
  await expect(alertText(page)).toHaveText(UNREADABLE_MESSAGE)

  await expect
    .poll(async () => {
      const { created, revoked } = await counts()
      return created >= 2 && created === revoked
    })
    .toBe(true)
})

for (const width of [390, 320]) {
  test(`at ${width}px the dialog fits and focus returns to the menu trigger`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 720 })
    await openHarness(page)
    const trigger = page.getByRole('button', { name: '탐색 메뉴 열기' })
    await trigger.click()
    await addButton(page).click()
    await expect(dialog(page)).toBeVisible()
    await choose(page, audio('a_very_long_file_name_for_narrow_phones.mp3', ''))
    await expect(alertText(page)).toHaveText(UNREADABLE_MESSAGE)

    const box = await dialog(page).boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(width)
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBe(width)
    for (const button of ['취소', '다음']) {
      const target = await dialog(page)
        .getByRole('button', { name: button, exact: true })
        .boundingBox()
      expect(target!.x + target!.width).toBeLessThanOrEqual(width)
    }

    await page.keyboard.press('Escape')
    await expect(dialog(page)).toHaveCount(0)
    await expect(trigger).toBeFocused()
  })
}

test('a new-section URL opens only a song of this workspace', async ({
  page,
}) => {
  await page.goto('/?demo=workspace&view=new-section&song=song-neon-harbor')
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
    '새 구간',
  )
  await expect(main(page).getByText('neon_harbor_live.mp3')).toBeVisible()

  await page.goto('/?demo=workspace&view=new-section&song=song-missing')
  await expect(
    main(page).getByRole('heading', { name: '곡을 찾을 수 없어요' }),
  ).toBeVisible()
  await main(page).getByRole('button', { name: '내 작업으로' }).click()
  await expect(page).toHaveURL('/?demo=workspace')

  await page.goto('/?demo=workspace&view=new-section&song=Bad_Id')
  await expect(page).toHaveURL('/?demo=workspace&view=song-not-found')
  await expect(
    main(page).getByRole('heading', { name: '곡을 찾을 수 없어요' }),
  ).toBeVisible()
})
