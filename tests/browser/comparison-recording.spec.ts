import { expect, test, type Page } from '@playwright/test'
import type {} from './harness.tsx'
import type {} from './harness/recording.ts'

// Chromium's synthesized microphone, for the tests of the real engine at the
// end of this file. Playwright only takes launch options for a whole file.
test.use({
  launchOptions: [
    async ({ browserName }, use) => {
      await use(
        browserName === 'chromium'
          ? {
              args: [
                '--use-fake-device-for-media-stream',
                '--use-fake-ui-for-media-stream',
                '--autoplay-policy=no-user-gesture-required',
              ],
            }
          : {},
      )
    },
    { scope: 'worker' },
  ],
})

const SECTION_SECONDS = 23.7
const LIMIT_SECONDS = 47.4

const main = (page: Page) => page.locator('#workspace-content')
const panel = (page: Page) =>
  page.getByRole('region', { name: '벌스 1 녹음', exact: true })
const inPanel = (page: Page, name: string) =>
  panel(page).getByRole('button', { name, exact: true })
const confirmation = (page: Page) => page.getByRole('alertdialog')
const opens = (page: Page) => page.evaluate(() => window.recordingTest.opens())
const held = (page: Page) => page.evaluate(() => window.recordingTest.held())
const advance = (page: Page, seconds: number) =>
  page.evaluate((value) => window.recordingTest.advance(value), seconds)
const otherTask = (page: Page) =>
  page.getByRole('complementary').getByRole('button', {
    name: '인트로',
    exact: true,
  })
const taskTitle = (page: Page, name: string) =>
  page.getByRole('heading', { level: 1, name, exact: true })
// Whether the page asks the browser to confirm before it closes.
const pageCloseIsHeld = (page: Page) =>
  page.evaluate(() => {
    const closing = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(closing)
    return closing.defaultPrevented
  })
const takes = (page: Page) =>
  main(page).getByRole('combobox', { name: '연주' }).locator('option')

async function openPanel(page: Page, query = '') {
  await page.goto(
    `/tests/browser/harness.html?view=task&task=task-verse&comparison=1${query}`,
  )
  await main(page).getByRole('button', { name: '녹음', exact: true }).click()
  await expect(panel(page)).toBeVisible()
}

async function startRecording(page: Page, query = '') {
  await openPanel(page, query)
  await inPanel(page, '녹음 시작').click()
  await expect(panel(page).getByText('녹음 중', { exact: true })).toBeVisible()
}

async function recordTake(page: Page, query = '', seconds = 12) {
  await startRecording(page, query)
  await advance(page, seconds)
  await inPanel(page, '정지').click()
  await expect(inPanel(page, '비교하기')).toBeVisible()
}

async function trackWavUrls(page: Page) {
  await page.addInitScript(() => {
    const live = new Set<string>()
    const create = URL.createObjectURL.bind(URL)
    const revoke = URL.revokeObjectURL.bind(URL)
    URL.createObjectURL = (source) => {
      const url = create(source)
      if (source instanceof Blob && source.type === 'audio/wav') live.add(url)
      return url
    }
    URL.revokeObjectURL = (url) => {
      live.delete(url)
      revoke(url)
    }
    Object.assign(window, { liveWavUrls: () => live.size })
  })
}

const liveWavUrls = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { liveWavUrls(): number }).liveWavUrls(),
  )

test('opening the panel does not ask for the microphone', async ({ page }) => {
  await openPanel(page)

  await expect(
    panel(page).getByText(
      '녹음을 시작하면 브라우저가 마이크 권한을 물어봐요. 정지를 누르면 바로 멈춰요.',
    ),
  ).toBeVisible()
  await expect(panel(page).getByText('00:23.7')).toBeVisible()
  await expect(inPanel(page, '파일 올리기')).toBeVisible()
  expect(await opens(page)).toBe(0)
})

test('녹음 시작 asks once and shows the take under way', async ({ page }) => {
  await startRecording(page)

  expect(await opens(page)).toBe(1)
  await expect(panel(page).getByText('USB 오디오 인터페이스')).toBeVisible()
  await expect(
    panel(page).getByText(
      '이어폰으로 원곡을 들으며 기타 소리만 녹음해 주세요.',
    ),
  ).toBeVisible()
  await expect(inPanel(page, '정지')).toBeFocused()
})

test('the clock and waveform move without rendering the page', async ({
  page,
}) => {
  await startRecording(page)
  const before = await page.evaluate(() => window.workspaceTest.commits())

  await advance(page, 14.6)

  await expect(panel(page).getByRole('timer')).toHaveText('00:14.6')
  await expect
    .poll(() =>
      page.evaluate(() => {
        const canvas = document.querySelector<HTMLCanvasElement>(
          'canvas[data-recording="waveform"]',
        )
        const context = canvas?.getContext('2d')
        if (!canvas || !context) return 0
        const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
        return data.reduce((sum, value) => sum + value, 0)
      }),
    )
    .toBeGreaterThan(0)
  expect(await page.evaluate(() => window.workspaceTest.commits())).toBe(before)
})

test('처음부터 starts the take over without asking again', async ({ page }) => {
  await startRecording(page)
  await advance(page, 10)
  await expect(panel(page).getByRole('timer')).toHaveText('00:10.0')

  await inPanel(page, '처음부터').click()

  await expect(panel(page).getByRole('timer')).toHaveText('00:00.0')
  await advance(page, 2)
  await inPanel(page, '정지').click()
  await expect(panel(page).getByText('00:02.0', { exact: true })).toBeVisible()
  expect(await opens(page)).toBe(1)
})

test('정지 releases the microphone and offers the take', async ({ page }) => {
  await recordTake(page)

  expect(await held(page)).toBe(0)
  await expect(panel(page).getByText('00:12.0', { exact: true })).toBeVisible()
  await expect(inPanel(page, '들어 보기')).toBeVisible()
  await expect(inPanel(page, '다시 녹음')).toBeVisible()
})

test('the take is a 48 kHz mono 16-bit WAV', async ({ page }) => {
  await recordTake(page, '', 2)

  const header = await page.evaluate(async () => {
    const audio = document.querySelector<HTMLAudioElement>(
      'audio[data-recording="preview"]',
    )
    const response = await fetch(audio?.src ?? '')
    const view = new DataView(await response.arrayBuffer())
    return {
      channels: view.getUint16(22, true),
      sampleRate: view.getUint32(24, true),
      bits: view.getUint16(34, true),
      bytes: view.getUint32(40, true),
    }
  })

  expect(header).toEqual({
    channels: 1,
    sampleRate: 48_000,
    bits: 16,
    bytes: 2 * 2 * 48_000,
  })
})

test('the take stops by itself at the recording limit', async ({ page }) => {
  await startRecording(page)

  await advance(page, SECTION_SECONDS)
  await expect(inPanel(page, '정지')).toBeVisible()

  await advance(page, LIMIT_SECONDS - SECTION_SECONDS + 5)

  await expect(inPanel(page, '비교하기')).toBeVisible()
  await expect(panel(page).getByText('00:47.4', { exact: true })).toBeVisible()
  expect(await held(page)).toBe(0)
})

test('비교하기 saves the take and closes the panel', async ({ page }) => {
  await trackWavUrls(page)
  await recordTake(page)
  expect(await liveWavUrls(page)).toBe(1)

  await inPanel(page, '비교하기').click()

  await expect(panel(page)).toBeHidden()
  await expect(takes(page)).toHaveCount(1)
  await expect(takes(page).first()).toContainText('녹음 #1')
  expect(await liveWavUrls(page)).toBe(0)
})

test('비교하기 saves once however often it is pressed', async ({ page }) => {
  await recordTake(page)

  await inPanel(page, '비교하기').evaluate((button: HTMLButtonElement) => {
    button.click()
    button.click()
  })

  await expect(panel(page)).toBeHidden()
  await expect(takes(page)).toHaveCount(1)
})

test('a failed save keeps the take and can be tried again', async ({
  page,
}) => {
  await recordTake(page)
  // The repository refuses audio with no bytes.
  const restoreSize = await page.evaluateHandle(() => {
    const native = Object.getOwnPropertyDescriptor(
      Blob.prototype,
      'size',
    ) as PropertyDescriptor
    Object.defineProperty(Blob.prototype, 'size', {
      configurable: true,
      get: () => 0,
    })
    return () => {
      Object.defineProperty(Blob.prototype, 'size', native)
    }
  })

  await inPanel(page, '비교하기').click()

  await expect(panel(page).getByRole('alert')).toBeVisible()
  await expect(inPanel(page, '들어 보기')).toBeVisible()

  await restoreSize.evaluate((restore) => restore())
  await inPanel(page, '다시 시도').click()

  await expect(panel(page)).toBeHidden()
  await expect(takes(page)).toHaveCount(1)
})

test('다시 녹음 throws the take away and records again', async ({ page }) => {
  await trackWavUrls(page)
  await recordTake(page)

  await inPanel(page, '다시 녹음').click()

  await expect(panel(page).getByText('녹음 중', { exact: true })).toBeVisible()
  expect(await opens(page)).toBe(2)
  expect(await held(page)).toBe(1)
  expect(await liveWavUrls(page)).toBe(0)
})

test('a take that heard nothing warns before it is compared', async ({
  page,
}) => {
  await recordTake(page, '&recording=silent')

  await expect(panel(page).getByRole('alert')).toContainText(
    '소리가 녹음되지 않은 것 같아요',
  )
  await expect(inPanel(page, '비교하기')).toBeVisible()
})

test('a refused microphone offers the file upload instead', async ({
  page,
}) => {
  await openPanel(page, '&recording=denied')

  await inPanel(page, '녹음 시작').click()

  await expect(panel(page).getByRole('alert')).toContainText(
    '마이크를 쓸 수 없어요',
  )
  await expect(panel(page)).toContainText(
    '브라우저 주소창의 권한 설정에서 마이크를 허용하거나, 녹음해 둔 파일을 올려 주세요.',
  )
  expect(await held(page)).toBe(0)
  await expect(inPanel(page, '닫기')).toBeVisible()

  await inPanel(page, '파일 올리기').click()

  await expect(panel(page)).toBeHidden()
})

test('닫기 leaves a refused microphone without asking', async ({ page }) => {
  await openPanel(page, '&recording=denied')
  await inPanel(page, '녹음 시작').click()

  await inPanel(page, '닫기').click()

  await expect(panel(page)).toBeHidden()
  await expect(confirmation(page)).toBeHidden()
})

test('a missing microphone can be tried again once connected', async ({
  page,
}) => {
  await openPanel(page, '&recording=no-device')
  await inPanel(page, '녹음 시작').click()
  await expect(panel(page).getByRole('alert')).toContainText(
    '마이크를 찾지 못했어요',
  )

  await page.evaluate(() => window.recordingTest.answerNext('granted'))
  await inPanel(page, '다시 시도').click()

  await expect(panel(page).getByText('녹음 중', { exact: true })).toBeVisible()
})

test('a microphone in use says so', async ({ page }) => {
  await openPanel(page, '&recording=busy')

  await inPanel(page, '녹음 시작').click()

  await expect(panel(page).getByRole('alert')).toContainText(
    '마이크를 시작하지 못했어요',
  )
  expect(await held(page)).toBe(0)
})

test('a browser without recording says so', async ({ page }) => {
  await openPanel(page, '&recording=unsupported')

  await inPanel(page, '녹음 시작').click()

  await expect(panel(page).getByRole('alert')).toContainText(
    '이 브라우저에서는 녹음할 수 없어요',
  )
})

test('a microphone unplugged mid-take ends the take', async ({ page }) => {
  await startRecording(page)
  await advance(page, 5)

  await page.evaluate(() => window.recordingTest.disconnect())

  await expect(panel(page).getByRole('alert')).toContainText(
    '녹음이 중단됐어요',
  )
  expect(await held(page)).toBe(0)

  await inPanel(page, '다시 녹음').click()

  await expect(panel(page).getByText('녹음 중', { exact: true })).toBeVisible()
})

test('the wait for permission can be cancelled', async ({ page }) => {
  await openPanel(page, '&recording=held')
  await inPanel(page, '녹음 시작').click()
  await expect(panel(page)).toContainText('마이크를 허용해 주세요')
  expect(await held(page)).toBe(1)

  await inPanel(page, '취소').click()

  await expect(inPanel(page, '녹음 시작')).toBeVisible()
  expect(await held(page)).toBe(0)
})

test('a permission answered after closing changes nothing', async ({
  page,
}) => {
  await openPanel(page, '&recording=held')
  await inPanel(page, '녹음 시작').click()

  await panel(page).getByRole('button', { name: '녹음 닫기' }).click()
  await page.evaluate(() => window.recordingTest.grant())

  await expect(panel(page)).toBeHidden()
  await expect(confirmation(page)).toBeHidden()
  expect(await held(page)).toBe(0)
})

test('closing the ready panel asks nothing', async ({ page }) => {
  await openPanel(page)

  await panel(page).getByRole('button', { name: '녹음 닫기' }).click()

  await expect(panel(page)).toBeHidden()
  await expect(confirmation(page)).toBeHidden()
})

test('closing during a take asks first and can be declined', async ({
  page,
}) => {
  await startRecording(page)

  await panel(page).getByRole('button', { name: '녹음 닫기' }).click()
  await expect(confirmation(page)).toContainText('녹음을 그만둘까요?')

  await confirmation(page).getByRole('button', { name: '취소' }).click()

  await expect(confirmation(page)).toBeHidden()
  await expect(panel(page).getByText('녹음 중', { exact: true })).toBeVisible()
  expect(await held(page)).toBe(1)
})

test('confirming the close ends the take', async ({ page }) => {
  await startRecording(page)

  await panel(page).getByRole('button', { name: '녹음 닫기' }).click()
  await confirmation(page).getByRole('button', { name: '그만두기' }).click()

  await expect(panel(page)).toBeHidden()
  expect(await held(page)).toBe(0)
})

test('closing with an unsaved take asks first', async ({ page }) => {
  await trackWavUrls(page)
  await recordTake(page)

  await panel(page).getByRole('button', { name: '녹음 닫기' }).click()
  await expect(confirmation(page)).toBeVisible()
  await confirmation(page).getByRole('button', { name: '그만두기' }).click()

  await expect(panel(page)).toBeHidden()
  await expect(takes(page)).toHaveCount(0)
  expect(await liveWavUrls(page)).toBe(0)
})

test('the question goes away when the microphone does', async ({ page }) => {
  await startRecording(page)
  await panel(page).getByRole('button', { name: '녹음 닫기' }).click()
  await expect(confirmation(page)).toBeVisible()

  await page.evaluate(() => window.recordingTest.disconnect())

  await expect(confirmation(page)).toBeHidden()
  await expect(panel(page).getByRole('alert')).toContainText(
    '녹음이 중단됐어요',
  )
})

test('leaving the task during a take asks first and can be declined', async ({
  page,
}) => {
  await startRecording(page)

  // Safari gives a clicked button no focus to return to.
  await otherTask(page).focus()
  await page.keyboard.press('Enter')
  await expect(confirmation(page)).toContainText('녹음을 그만둘까요?')
  await confirmation(page).getByRole('button', { name: '취소' }).click()

  await expect(confirmation(page)).toBeHidden()
  await expect(panel(page).getByText('녹음 중', { exact: true })).toBeVisible()
  await expect(taskTitle(page, '벌스 1')).toBeVisible()
  await expect(otherTask(page)).toBeFocused()
  expect(await held(page)).toBe(1)
})

test('confirming the leave releases the microphone and goes', async ({
  page,
}) => {
  await startRecording(page)
  expect(await held(page)).toBe(1)

  await otherTask(page).click()
  await confirmation(page).getByRole('button', { name: '그만두기' }).click()

  await expect(taskTitle(page, '인트로')).toBeVisible()
  await expect(panel(page)).toBeHidden()
  expect(await held(page)).toBe(0)
})

test('leaving the task with a take frees its preview', async ({ page }) => {
  await trackWavUrls(page)
  await recordTake(page)

  await otherTask(page).click()
  await confirmation(page).getByRole('button', { name: '그만두기' }).click()

  await expect(panel(page)).toBeHidden()
  expect(await liveWavUrls(page)).toBe(0)
})

test('going back during a take asks before it leaves', async ({ page }) => {
  await page.goto(
    '/tests/browser/harness.html?view=task&task=task-verse&comparison=1',
  )
  await otherTask(page).click()
  await expect(taskTitle(page, '인트로')).toBeVisible()
  await page
    .getByRole('complementary')
    .getByRole('button', { name: /^벌스 1/ })
    .click()
  await expect(taskTitle(page, '벌스 1')).toBeVisible()
  await main(page).getByRole('button', { name: '녹음', exact: true }).click()
  await inPanel(page, '녹음 시작').click()
  await expect(panel(page).getByText('녹음 중', { exact: true })).toBeVisible()

  await page.goBack()
  await expect(confirmation(page)).toContainText('녹음을 그만둘까요?')
  await confirmation(page).getByRole('button', { name: '취소' }).click()
  await expect(taskTitle(page, '벌스 1')).toBeVisible()
  expect(await held(page)).toBe(1)

  await page.goBack()
  await expect(confirmation(page)).toBeVisible()
  const entries = await page.evaluate(() => history.length)
  await confirmation(page).getByRole('button', { name: '그만두기' }).click()
  await expect(taskTitle(page, '인트로')).toBeVisible()
  expect(await held(page)).toBe(0)
  // Going back again must not return to the screen just given up.
  expect(await page.evaluate(() => history.length)).toBe(entries)
})

test('leaving while the take is being saved asks first', async ({ page }) => {
  await recordTake(page, '&comparison-save=hangs')
  await inPanel(page, '비교하기').click()
  await expect(panel(page).getByRole('status')).toContainText(
    '연주를 저장하고 있어요.',
  )

  expect(await pageCloseIsHeld(page)).toBe(true)
  await otherTask(page).click()
  await expect(confirmation(page)).toContainText('녹음을 그만둘까요?')
  await expect(taskTitle(page, '벌스 1')).toBeVisible()
})

for (const [name, query] of [
  ['a task with no takes', ''],
  ['a task with saved takes', '&comparison-seed=saved'],
]) {
  test(`a file cannot replace the take under way on ${name}`, async ({
    page,
  }) => {
    await startRecording(page, query)

    await expect(
      main(page).getByRole('button', { name: '파일 올리기', exact: true }),
    ).toBeDisabled()
    await expect(
      panel(page).getByText('녹음 중', { exact: true }),
    ).toBeVisible()

    await advance(page, 12)
    await inPanel(page, '정지').click()
    await expect(inPanel(page, '비교하기')).toBeVisible()
    await expect(
      main(page).getByRole('button', { name: '파일 올리기', exact: true }),
    ).toBeDisabled()
  })
}

test('nothing to lose leaves without asking', async ({ page }) => {
  await openPanel(page)

  await otherTask(page).click()

  await expect(taskTitle(page, '인트로')).toBeVisible()
  await expect(confirmation(page)).toHaveCount(0)
})

test('closing the page asks only while a take is unsaved', async ({ page }) => {
  await openPanel(page)
  expect(await pageCloseIsHeld(page)).toBe(false)

  await inPanel(page, '녹음 시작').click()
  await expect(panel(page).getByText('녹음 중', { exact: true })).toBeVisible()
  expect(await pageCloseIsHeld(page)).toBe(true)

  await advance(page, 12)
  await inPanel(page, '정지').click()
  await expect(inPanel(page, '비교하기')).toBeVisible()
  expect(await pageCloseIsHeld(page)).toBe(true)

  await inPanel(page, '비교하기').click()
  await expect(panel(page)).toBeHidden()
  expect(await pageCloseIsHeld(page)).toBe(false)
})

test('the player bar rests on the panel instead of under it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  const bar = page.getByRole('region', { name: '구간 재생' })
  const overlap = async () => {
    const [barBox, panelBox] = await Promise.all([
      bar.boundingBox(),
      panel(page).boundingBox(),
    ])
    return (barBox?.y ?? 0) + (barBox?.height ?? 0) - (panelBox?.y ?? 0)
  }

  // A result is tall enough for the page to scroll.
  await startRecording(page, '&comparison-seed=compared')
  await expect(page.getByRole('region', { name: '구간 타임라인' })).toBeVisible(
    {
      timeout: 20_000,
    },
  )
  expect(
    await page.evaluate(
      () => document.documentElement.scrollHeight > window.innerHeight,
    ),
  ).toBe(true)
  // At the end of the page the two lie in order whatever their rules say.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0)
  expect(await overlap()).toBeLessThanOrEqual(1)

  await panel(page).getByRole('button', { name: '녹음 닫기' }).click()
  await confirmation(page).getByRole('button', { name: '그만두기' }).click()
  await expect(panel(page)).toBeHidden()
  await expect
    .poll(async () => {
      const box = await bar.boundingBox()
      return (box?.y ?? 0) + (box?.height ?? 0)
    })
    .toBeCloseTo(844, 0)
})

test('the panel stays in view on the 타브 view', async ({ page }) => {
  await startRecording(page)

  await main(page)
    .getByRole('tablist', { name: '작업 화면' })
    .getByRole('tab', { name: /^타브/ })
    .click()

  await expect(inPanel(page, '정지')).toBeVisible()
})

test.describe('what the panel reports to the screen around it', () => {
  const capturePanel = (page: Page) =>
    page.getByRole('region', { name: '캡처 녹음', exact: true })
  const button = (page: Page, name: string) =>
    capturePanel(page).getByRole('button', { name, exact: true })
  const changes = (page: Page) =>
    page.evaluate(() => window.recordingTest.captureChanges())

  async function startCapture(page: Page) {
    await page.goto(
      '/tests/browser/harness.html?view=task&task=task-verse&comparison=1',
    )
    await page.evaluate(() => window.recordingTest.mountPanel())
    await button(page, '녹음 시작').click()
    await expect(button(page, '정지')).toBeVisible()
  }

  test('nothing before the microphone is heard', async ({ page }) => {
    await page.goto(
      '/tests/browser/harness.html?view=task&task=task-verse&comparison=1&recording=held',
    )
    await page.evaluate(() => window.recordingTest.mountPanel())
    await button(page, '녹음 시작').click()
    await expect(button(page, '취소')).toBeVisible()

    expect(await changes(page)).toEqual([])
  })

  test('the take starting and stopping', async ({ page }) => {
    await startCapture(page)
    expect(await changes(page)).toEqual([true])

    await advance(page, 1)
    await button(page, '정지').click()

    await expect(button(page, '비교하기')).toBeVisible()
    expect(await changes(page)).toEqual([true, false])
  })

  test('the limit ending the take', async ({ page }) => {
    await startCapture(page)

    await advance(page, 20)

    await expect(button(page, '비교하기')).toBeVisible()
    expect(await changes(page)).toEqual([true, false])
  })

  test('처음부터 beginning a new take', async ({ page }) => {
    await startCapture(page)

    await button(page, '처음부터').click()

    expect(await changes(page)).toEqual([true, false, true])
  })

  test('the microphone going away', async ({ page }) => {
    await startCapture(page)

    await page.evaluate(() => window.recordingTest.disconnect())

    await expect(capturePanel(page).getByRole('alert')).toBeVisible()
    expect(await changes(page)).toEqual([true, false])
  })

  test('the panel going away mid-take', async ({ page }) => {
    await startCapture(page)

    await page.evaluate(() => window.recordingTest.unmountPanel())

    expect(await changes(page)).toEqual([true, false])
    expect(await held(page)).toBe(0)
  })
})

// The real microphone code against Chromium's synthesized input. It runs on
// the app's own page because the harness replaces window.AudioContext.
test.describe('the browser microphone', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium flags')
  const ENGINE_MODULE = '/src/features/recording/recorderEngine.ts'

  // Keeps what the engine opens within reach of the test.
  async function watchMicrophone(page: Page) {
    await page.addInitScript(() => {
      const watched: {
        streams: MediaStream[]
        contexts: AudioContext[]
        constraints: MediaStreamConstraints[]
      } = { streams: [], contexts: [], constraints: [] }
      const ask = navigator.mediaDevices.getUserMedia.bind(
        navigator.mediaDevices,
      )
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        watched.constraints.push(constraints ?? {})
        const stream = await ask(constraints)
        watched.streams.push(stream)
        return stream
      }
      const Native = window.AudioContext
      window.AudioContext = class extends Native {
        constructor(options?: AudioContextOptions) {
          super(options)
          watched.contexts.push(this)
        }
      }
      Object.assign(window, { watched })
    })
    await page.goto('/')
  }

  test('records, reports its settings and lets everything go', async ({
    page,
  }) => {
    await watchMicrophone(page)

    const result = await page.evaluate(async (path) => {
      const { browserRecorderEngine } = await import(/* @vite-ignore */ path)
      const { watched } = window as unknown as {
        watched: {
          streams: MediaStream[]
          contexts: AudioContext[]
          constraints: MediaStreamConstraints[]
        }
      }
      let progressed = 0
      const request = browserRecorderEngine.open({
        onProgress(seconds: number) {
          progressed = seconds
        },
        onInterrupted() {},
      })
      const capture = await request.capture
      await new Promise<void>((resolve) => {
        const check = () =>
          progressed >= 1.5 ? resolve() : setTimeout(check, 50)
        check()
      })
      const { samples, sampleRate } = capture.finish()
      const peakCount = capture.peaks().length
      request.release()
      await new Promise((resolve) => setTimeout(resolve, 100))
      return {
        audio: watched.constraints[0].audio,
        seconds: samples.length / sampleRate,
        elapsed: capture.elapsedSeconds(),
        peakCount,
        heard: samples.some((sample: number) => sample !== 0),
        label: capture.deviceLabel,
        tracks: watched.streams[0].getTracks().map((track) => track.readyState),
        context: watched.contexts[0].state,
      }
    }, ENGINE_MODULE)

    expect(result.audio).toEqual({
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    })
    expect(result.seconds).toBeGreaterThanOrEqual(1.5)
    expect(result.seconds).toBeCloseTo(result.elapsed, 3)
    expect(result.peakCount).toBeGreaterThan(0)
    expect(result.heard).toBe(true)
    expect(result.label).not.toBe('')
    expect(result.tracks).toEqual(['ended'])
    expect(result.context).toBe('closed')
  })

  test('a track that ends reports the take as interrupted', async ({
    page,
  }) => {
    await watchMicrophone(page)

    const interrupted = await page.evaluate(async (path) => {
      const { browserRecorderEngine } = await import(/* @vite-ignore */ path)
      const { watched } = window as unknown as {
        watched: { streams: MediaStream[] }
      }
      let count = 0
      const request = browserRecorderEngine.open({
        onProgress() {},
        onInterrupted() {
          count += 1
        },
      })
      await request.capture
      watched.streams[0].getTracks()[0].dispatchEvent(new Event('ended'))
      request.release()
      return count
    }, ENGINE_MODULE)

    expect(interrupted).toBe(1)
  })

  test('a release before the answer stops the late microphone', async ({
    page,
  }) => {
    await watchMicrophone(page)

    const result = await page.evaluate(async (path) => {
      const { browserRecorderEngine } = await import(/* @vite-ignore */ path)
      const { watched } = window as unknown as {
        watched: { streams: MediaStream[]; contexts: AudioContext[] }
      }
      const request = browserRecorderEngine.open({
        onProgress() {},
        onInterrupted() {},
      })
      request.release()
      const error = await request.capture.catch(
        (reason: DOMException) => reason.name,
      )
      await new Promise((resolve) => setTimeout(resolve, 100))
      return {
        error,
        tracks: watched.streams.flatMap((stream) =>
          stream.getTracks().map((track) => track.readyState),
        ),
        context: watched.contexts[0].state,
      }
    }, ENGINE_MODULE)

    expect(result.error).toBe('AbortError')
    expect(result.tracks).toEqual(['ended'])
    expect(result.context).toBe('closed')
  })

  test('a refused microphone rejects with the browser error', async ({
    page,
  }) => {
    await watchMicrophone(page)

    const result = await page.evaluate(async (path) => {
      const { browserRecorderEngine } = await import(/* @vite-ignore */ path)
      const { watched } = window as unknown as {
        watched: { contexts: AudioContext[] }
      }
      navigator.mediaDevices.getUserMedia = () =>
        Promise.reject(new DOMException('No', 'NotAllowedError'))
      const request = browserRecorderEngine.open({
        onProgress() {},
        onInterrupted() {},
      })
      const error = await request.capture.catch(
        (reason: DOMException) => reason.name,
      )
      await new Promise((resolve) => setTimeout(resolve, 100))
      return { error, context: watched.contexts[0].state }
    }, ENGINE_MODULE)

    expect(result).toEqual({ error: 'NotAllowedError', context: 'closed' })
  })
})
