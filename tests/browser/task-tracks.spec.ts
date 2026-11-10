import { expect, test, type Page } from '@playwright/test'
import type {} from './harness.tsx'

const main = (page: Page) => page.locator('#workspace-content')
const sidebar = (page: Page) =>
  page.getByRole('complementary', { name: '워크스페이스 탐색' })
const tracks = (page: Page) => main(page).getByRole('region', { name: '트랙' })
const rows = (page: Page) => tracks(page).getByRole('listitem')
const row = (page: Page, label: string) =>
  rows(page).filter({ hasText: new RegExp(`^${label}`) })
const lane = (page: Page, label: string) =>
  row(page, label).locator('[data-state]')
const player = (page: Page) =>
  main(page).getByRole('region', { name: '구간 재생' })
const playButton = (page: Page) =>
  player(page).getByRole('button', { name: '재생', exact: true })
const pauseButton = (page: Page) =>
  player(page).getByRole('button', { name: '일시정지' })
const source = (page: Page) =>
  player(page)
    .locator('p')
    .filter({ hasText: /^재생 트랙 / })

type Change = Parameters<Window['workspaceTest']['updateTaskOnServer']>[1]

const updateOnServer = (page: Page, taskId: string, change: Change) =>
  page.evaluate(
    ([id, next]) => window.workspaceTest.updateTaskOnServer(id, next),
    [taskId, change] as const,
  )
const separatedCalls = (page: Page) =>
  page.evaluate(() => window.workspaceTest.separatedCalls())
const audioSources = (page: Page) =>
  page.evaluate(() => window.workspaceTest.audioSources())
const sourceDurations = (page: Page) =>
  page.evaluate(() => window.workspaceTest.sourceDurations())
const audioContexts = (page: Page) =>
  page.evaluate(() => window.workspaceTest.audioContexts())

// Synthesis, decoding and peaks take a moment on a loaded machine.
const AUDIO_TIMEOUT = { timeout: 15_000 }

async function openTask(page: Page, taskId: string, query = '') {
  await page.goto(
    `/tests/browser/harness.html?view=task&task=${taskId}${query}`,
  )
  await expect(tracks(page)).toBeVisible()
}

// Opens the list first so the server can change the task before it opens.
async function openChangedTask(
  page: Page,
  taskName: RegExp,
  taskId: string,
  change: Change,
  query = '',
) {
  await page.goto(`/tests/browser/harness.html?${query}`)
  await expect(page.locator('tbody tr')).toHaveCount(4)
  await updateOnServer(page, taskId, change)
  await sidebar(page).getByRole('button', { name: taskName }).click()
  await expect(tracks(page)).toBeVisible()
}

test('an original song shows the separated guitar above the original and plays the guitar', async ({
  page,
}) => {
  await openTask(page, 'task-solo')
  await expect(rows(page)).toHaveCount(2)
  await expect(rows(page).nth(0)).toContainText('분리 기타')
  await expect(rows(page).nth(1)).toContainText('원곡')
  await expect(lane(page, '분리 기타')).toHaveAttribute(
    'data-state',
    'ready',
    AUDIO_TIMEOUT,
  )
  await expect(lane(page, '원곡')).toHaveAttribute(
    'data-state',
    'ready',
    AUDIO_TIMEOUT,
  )
  await expect(row(page, '분리 기타')).toHaveAttribute('data-playing', 'true')
  await expect(row(page, '원곡')).toHaveAttribute('data-playing', 'false')
  // The ruler counts song time across the section, 02:31.0–02:52.4.
  await expect(tracks(page)).toContainText('02:32')
  await expect(source(page)).toHaveText('재생 트랙 분리 기타')
  await expect(player(page)).toContainText('/ 00:21.4')

  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  // The separated guitar covers the section alone, from 0 s.
  const [played] = await audioSources(page)
  expect(played.loopStart).toBe(0)
  expect(played.loopEnd).toBeCloseTo(21.4, 5)
  expect((await sourceDurations(page))[0]).toBeCloseTo(21.4, 2)
  expect(await separatedCalls(page)).toContainEqual({
    taskId: 'task-solo',
    aborted: false,
  })
})

test('before separation the guitar row waits and the original plays', async ({
  page,
}) => {
  await openChangedTask(page, /^솔로/, 'task-solo', {
    processingStatus: 'queued',
    progressPercent: null,
    hasSeparatedAudio: false,
  })
  await expect(row(page, '분리 기타')).toContainText(
    '기타를 분리하면 여기에 표시돼요',
  )
  await expect(row(page, '분리 기타')).toHaveAttribute('data-playing', 'false')
  await expect(row(page, '원곡')).toHaveAttribute('data-playing', 'true')
  await expect(source(page)).toHaveText('재생 트랙 원곡')
  await expect(lane(page, '원곡')).toHaveAttribute(
    'data-state',
    'ready',
    AUDIO_TIMEOUT,
  )
  expect(await separatedCalls(page)).toEqual([])

  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  // The original plays the section within the whole song.
  const [played] = await audioSources(page)
  expect(played.loopStart).toBeCloseTo(151, 5)
  expect(played.loopEnd).toBeCloseTo(172.4, 5)
  expect((await sourceDurations(page))[0]).toBeCloseTo(252, 0)
})

test('separation finishing waits for playback to stop before the guitar plays', async ({
  page,
}) => {
  await openChangedTask(
    page,
    /^솔로/,
    'task-solo',
    {
      processingStatus: 'processing',
      progressPercent: 20,
      hasSeparatedAudio: false,
    },
    'refresh=150',
  )
  await expect(lane(page, '원곡')).toHaveAttribute(
    'data-state',
    'ready',
    AUDIO_TIMEOUT,
  )
  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()

  await updateOnServer(page, 'task-solo', {
    progressPercent: 64,
    hasSeparatedAudio: true,
  })
  await expect(lane(page, '분리 기타')).toHaveAttribute(
    'data-state',
    'ready',
    AUDIO_TIMEOUT,
  )
  // The original keeps playing; nothing restarted it.
  await expect(source(page)).toHaveText('재생 트랙 원곡')
  await expect(pauseButton(page)).toBeVisible()
  expect(await audioSources(page)).toHaveLength(1)

  await pauseButton(page).click()
  await expect(source(page)).toHaveText('재생 트랙 분리 기타')
  await expect(row(page, '분리 기타')).toHaveAttribute('data-playing', 'true')
  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()
  const played = (await audioSources(page)).at(-1)!
  expect(played.loopStart).toBe(0)
  expect(played.loopEnd).toBeCloseTo(21.4, 5)
})

test('finding no guitar while the guitar plays waits for playback to stop', async ({
  page,
}) => {
  await openTask(page, 'task-solo', '&refresh=150')
  await expect(lane(page, '분리 기타')).toHaveAttribute(
    'data-state',
    'ready',
    AUDIO_TIMEOUT,
  )
  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()

  await updateOnServer(page, 'task-solo', {
    processingStatus: 'failed',
    failureKind: 'no-guitar',
    progressPercent: null,
  })
  await expect(row(page, '분리 기타')).toContainText('기타 소리가 거의 없어요.')
  // The guitar keeps its audio and keeps playing.
  await expect(source(page)).toHaveText('재생 트랙 분리 기타')
  await expect(pauseButton(page)).toBeVisible()
  expect(await audioSources(page)).toHaveLength(1)

  await pauseButton(page).click()
  await expect(source(page)).toHaveText('재생 트랙 원곡')
  await expect(row(page, '원곡')).toHaveAttribute('data-playing', 'true')
})

test('no guitar leaves the guitar row flat and the original plays', async ({
  page,
}) => {
  await openTask(page, 'task-chorus')
  await expect(rows(page)).toHaveCount(2)
  await expect(row(page, '분리 기타')).toContainText('기타 소리가 거의 없어요.')
  await expect(row(page, '분리 기타').locator('canvas')).toHaveCount(1)
  await expect(row(page, '원곡')).toHaveAttribute('data-playing', 'true')
  await expect(source(page)).toHaveText('재생 트랙 원곡')
  await expect(lane(page, '원곡')).toHaveAttribute(
    'data-state',
    'ready',
    AUDIO_TIMEOUT,
  )
  expect(await separatedCalls(page)).toEqual([])
})

test('separated-guitar input has one row for the uploaded audio', async ({
  page,
}) => {
  await openTask(page, 'task-intro')
  await expect(rows(page)).toHaveCount(1)
  await expect(rows(page)).toContainText('올린 음원')
  await expect(row(page, '올린 음원')).toHaveAttribute('data-playing', 'true')
  await expect(source(page)).toHaveText('재생 트랙 올린 음원')
  await expect(lane(page, '올린 음원')).toHaveAttribute(
    'data-state',
    'ready',
    AUDIO_TIMEOUT,
  )
  expect(await separatedCalls(page)).toEqual([])
})

test('a waveform that fails to load can be tried again', async ({ page }) => {
  await openTask(page, 'task-solo', '&scenario=separated-error')
  const guitar = lane(page, '분리 기타')
  await expect(guitar).toHaveAttribute('data-state', 'failed', AUDIO_TIMEOUT)
  await expect(guitar.getByRole('status')).toHaveText(
    '분리 기타 파형을 불러오지 못했어요.',
  )
  await expect(guitar).toContainText('파형을 불러오지 못했어요.')
  // The original still loads; the guitar that should play does not.
  await expect(lane(page, '원곡')).toHaveAttribute(
    'data-state',
    'ready',
    AUDIO_TIMEOUT,
  )
  await expect(playButton(page)).toHaveAttribute('aria-disabled', 'true')

  await page.evaluate(() => window.workspaceTest.healAudio())
  await guitar.getByRole('button', { name: '분리 기타 다시 시도' }).click()
  await expect(guitar).toHaveAttribute('data-state', 'ready', AUDIO_TIMEOUT)
  await expect(guitar).toBeFocused()
  await expect(playButton(page)).toHaveAttribute('aria-disabled', 'false')
})

test('leaving the task cancels loading the separated guitar', async ({
  page,
}) => {
  await openTask(page, 'task-solo', '&scenario=pending-separated')
  await expect(lane(page, '분리 기타')).toHaveAttribute('data-state', 'loading')
  const soloCalls = async () =>
    (await separatedCalls(page)).filter((call) => call.taskId === 'task-solo')
  await expect
    .poll(async () => (await soloCalls()).some((call) => !call.aborted))
    .toBe(true)

  await sidebar(page)
    .getByRole('button', { name: /^벌스 1/ })
    .click()
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
    '벌스 1',
  )
  expect((await soloCalls()).every((call) => call.aborted)).toBe(true)
})

test('leaving the task stops playback and closes the output', async ({
  page,
}) => {
  await openTask(page, 'task-solo')
  await expect(lane(page, '분리 기타')).toHaveAttribute(
    'data-state',
    'ready',
    AUDIO_TIMEOUT,
  )
  await playButton(page).click()
  await expect(pauseButton(page)).toBeVisible()

  await sidebar(page)
    .getByRole('button', { name: /^벌스 1/ })
    .click()
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
    '벌스 1',
  )
  await expect.poll(() => audioContexts(page)).toEqual(['closed'])
})

test('the player fits its controls and names the track where there is room', async ({
  page,
}) => {
  await openTask(page, 'task-solo')
  // The bar is the main column: 720px and 800px keep the sidebar beside it.
  const sizes = [
    { width: 1280, named: true },
    { width: 900, named: true },
    { width: 800, named: false },
    { width: 720, named: false },
    { width: 390, named: false },
  ]
  for (const size of sizes) {
    await page.setViewportSize({ width: size.width, height: 800 })
    const layout = await player(page).evaluate((bar) => {
      const row = bar.firstElementChild!
      const shown = [...row.children].filter(
        (child) => child.getBoundingClientRect().width > 2,
      )
      const boxes = shown.map((child) => child.getBoundingClientRect())
      return {
        // Text running past its own box, such as the time under the name.
        overflow: Math.max(
          ...shown.map((child) => child.scrollWidth - child.clientWidth),
        ),
        room: Math.min(
          ...boxes.slice(1).map((box, i) => box.left - boxes[i].right),
        ),
        named: shown.some((child) =>
          child.textContent?.startsWith('재생 트랙'),
        ),
      }
    })
    expect(layout.overflow, `${size.width}px`).toBe(0)
    expect(layout.room, `${size.width}px`).toBeGreaterThanOrEqual(12)
    expect(layout.named, `${size.width}px`).toBe(size.named)
    // Screen readers hear the name at every width.
    await expect(source(page)).toHaveText('재생 트랙 분리 기타')
  }
})
