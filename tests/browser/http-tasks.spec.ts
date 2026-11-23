import { expect, test, type Locator, type Page } from '@playwright/test'
import {
  API,
  answer,
  fixtureData,
  HARNESS,
  listSegment,
  listTrack,
  load,
  main,
  openWorkspace,
  sidebar,
  signIn,
  uploadSong,
} from './http-workspace.ts'

// A section made, followed and sent again through the http repositories
// against a faked API. Track 7, segment 31 and stem 54 match the fixtures.
const form = (page: Page) => main(page).getByRole('form', { name: '새 구간' })
const region = (page: Page, name: string) =>
  main(page).getByRole('region', { name })

// The body of PATCH /segments/31: a range, a server name or both.
interface SegmentChange {
  start_ms?: number
  end_ms?: number
  name?: string
}

// The server side of one section: what processing-status reports now, the
// failure GET /stems/54 explains, and the requests that changed something.
// The section joins the server's list once made, and its list entry follows
// each change.
async function serveSection(page: Page, failure: unknown) {
  let status = load('status-queued')
  const calls: string[] = []
  const created: unknown[] = []
  const patched: unknown[] = []
  let segment = fixtureData('segment-create')
  await page.route(`${API}/tracks/7/segments`, (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    calls.push('create segment')
    created.push(route.request().postDataJSON())
    listSegment(page, segment)
    return answer(route, load('segment-create'), 201)
  })
  // As on the server, a moved range raises the version and leaves the
  // segment without a stem for it, and any change moves updated_at.
  await page.route(`${API}/segments/31`, (route) => {
    const change = route.request().postDataJSON() as SegmentChange
    calls.push('patch segment')
    patched.push(change)
    const start = change.start_ms ?? Number(segment.start_ms)
    const end = change.end_ms ?? Number(segment.end_ms)
    const moved = start !== segment.start_ms || end !== segment.end_ms
    const renamed = change.name !== undefined && change.name !== segment.name
    if (moved) status = load('status-nothing-requested')
    segment = {
      ...segment,
      ...change,
      duration_ms: end - start,
      version: Number(segment.version) + (moved ? 1 : 0),
      updated_at:
        moved || renamed ? new Date().toISOString() : segment.updated_at,
    }
    listSegment(page, segment)
    return answer(route, { success: true, data: segment })
  })
  await page.route(`${API}/segments/31/processing-status`, (route) =>
    answer(route, status),
  )
  await page.route(`${API}/segments/31/stems`, (route) => {
    calls.push('request stem')
    status = load('status-queued')
    return answer(route, load('stem-created'), 201)
  })
  await page.route(`${API}/stems/54`, (route) => answer(route, failure))
  await page.route(`${API}/stems/54/retry`, (route) => {
    calls.push('retry stem')
    status = load('status-queued')
    return answer(route, load('stem-retry'))
  })
  return {
    calls,
    created,
    patched,
    show(name: string | unknown) {
      status = typeof name === 'string' ? load(name) : name
    },
  }
}

async function createChorus(page: Page) {
  await form(page).getByLabel('이름').selectOption('코러스')
  const start = form(page).getByLabel('시작', { exact: true })
  const end = form(page).getByLabel('끝', { exact: true })
  await start.fill('00:12.3')
  await start.press('Tab')
  await end.fill('00:27.8')
  await end.press('Tab')
  await main(page).getByRole('button', { name: '타브 만들기' }).click()
  await expect(page).toHaveURL(`${HARNESS}?view=task&task=31`)
}

// The open task refreshes every 3 s; focus on the window asks at once. A
// refresh already on its way skips that, so the focus is sent until it shows.
async function refreshUntilVisible(page: Page, target: Locator) {
  await expect(async () => {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(target).toBeVisible({ timeout: 500 })
  }).toPass()
}

test('a new section asks the server for its guitar, fails and goes again on 다시 시도', async ({
  page,
}) => {
  await openWorkspace(page)
  await uploadSong(page)
  const server = await serveSection(page, load('stem-failed'))

  await createChorus(page)
  expect(server.created).toEqual([
    { start_ms: 12300, end_ms: 27800, name: 'CHORUS' },
  ])
  // The server separates only what it is asked for.
  expect(server.calls).toEqual(['create segment', 'request stem'])
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
    '코러스 1',
  )
  await expect(region(page, '순서를 기다리고 있어요')).toBeVisible()
  await expect(
    sidebar(page).getByRole('button', { name: /^코러스 1/ }),
  ).toContainText('대기')

  server.show('status-separating')
  await refreshUntilVisible(page, region(page, '기타 분리 중'))

  server.show('status-stem-failed')
  const failed = region(page, '기타를 분리하지 못했어요')
  await refreshUntilVisible(page, failed)
  await expect(failed.getByText('2회 남음')).toBeVisible()

  await failed.getByRole('button', { name: '다시 시도' }).click()
  await expect(region(page, '순서를 기다리고 있어요')).toBeVisible()
  expect(server.calls).toEqual(['create segment', 'request stem', 'retry stem'])
})

// PREPROCESS_INVALID_AUDIO as the server reports it: failed in preprocess,
// with no retry left to offer.
function showUnreadable(server: Awaited<ReturnType<typeof serveSection>>) {
  const failedStatus = load('status-stem-failed') as {
    data: { stem: Record<string, unknown> }
  }
  server.show({
    ...failedStatus,
    data: {
      ...failedStatus.data,
      stem: {
        ...failedStatus.data.stem,
        current_stage: 'preprocess',
        retryable: false,
      },
    },
  })
}

const UNREADABLE_ADVICE =
  '고른 구간에서 소리를 읽지 못했어요. 소리가 나는 구간을 다시 고르거나 다른 MP3, MP4 파일을 올려 보세요.'

test('a range the server could not read offers a new range or another file without 다시 시도', async ({
  page,
}) => {
  await openWorkspace(page)
  await uploadSong(page)
  const server = await serveSection(page, load('stem-invalid-audio'))
  await createChorus(page)

  showUnreadable(server)
  const failed = region(page, '음원을 읽지 못했어요')
  await refreshUntilVisible(page, failed)
  await expect(failed).toContainText(UNREADABLE_ADVICE)
  await expect(main(page).getByText('음원 읽기 실패')).toBeVisible()
  // The server gives one code for a silent range, a range past the end and
  // a file that would not decode, so both ways out stay open.
  await expect(failed.getByRole('button')).toHaveText([
    '구간 다시 정하기',
    '다른 파일 올리기',
  ])
  await expect(
    main(page).getByRole('button', { name: '다시 시도' }),
  ).toHaveCount(0)

  await failed.getByRole('button', { name: '다른 파일 올리기' }).click()
  await expect(
    page.getByRole('dialog', { name: '다른 파일 올리기' }),
  ).toBeVisible()
  expect(server.calls).toEqual(['create segment', 'request stem'])
})

test('구간 다시 정하기 moves an unreadable range and asks for its guitar again', async ({
  page,
}) => {
  await openWorkspace(page)
  await uploadSong(page)
  const server = await serveSection(page, load('stem-invalid-audio'))
  await createChorus(page)
  showUnreadable(server)
  const failed = region(page, '음원을 읽지 못했어요')
  await refreshUntilVisible(page, failed)

  await failed.getByRole('button', { name: '구간 다시 정하기' }).click()
  await expect(page).toHaveURL(`${HARNESS}?view=edit-section&task=31`)
  const editor = main(page).getByRole('form', { name: '구간 다시 정하기' })
  await expect(editor).toHaveAccessibleDescription(
    '소리가 나는 구간으로 바꾸면 기타 분리부터 다시 시작해요.',
  )
  const end = editor.getByLabel('끝', { exact: true })
  await end.fill('00:25.0')
  await end.press('Tab')
  await main(page).getByRole('button', { name: '타브 만들기' }).click()

  await expect(page).toHaveURL(`${HARNESS}?view=task&task=31`)
  // The name stays, so only the range is sent.
  expect(server.patched).toEqual([{ start_ms: 12300, end_ms: 25000 }])
  expect(server.calls).toEqual([
    'create segment',
    'request stem',
    'patch segment',
    'request stem',
  ])
  await expect(region(page, '순서를 기다리고 있어요')).toBeVisible()
  await expect(
    main(page).getByText('00:12.3–00:25.0', { exact: true }),
  ).toBeVisible()
})

const tabPanel = (page: Page) =>
  main(page).getByRole('region', { name: '타브', exact: true })

// A finished section reads its tab result; the guitar is left unready so
// the test stays on the tab.
async function serveResult(page: Page, answers: (() => [unknown, number])[]) {
  const asked: string[] = []
  await page.route(`${API}/tabs/88/result`, (route) => {
    const [body, status] = answers[Math.min(asked.length, answers.length - 1)]()
    asked.push(route.request().method())
    return answer(route, body, status)
  })
  await page.route(`${API}/stems/54/playback`, (route) =>
    answer(route, load('stem-not-ready'), 409),
  )
  return asked
}

test('a finished section draws its tab from the result notes', async ({
  page,
}) => {
  await openWorkspace(page)
  await uploadSong(page)
  const server = await serveSection(page, load('stem-failed'))
  const asked = await serveResult(page, [() => [load('tab-result'), 200]])
  await createChorus(page)

  server.show('status-completed')
  const staff = tabPanel(page).getByRole('img', { name: /^타브 악보/ })
  await refreshUntilVisible(page, staff)
  // Eight notes on two bars of 4/4.
  await expect(staff).toHaveAccessibleName('타브 악보 2마디')
  await expect(tabPanel(page)).toContainText('초안 · 자동 생성')
  expect(asked).toEqual(['GET'])
  expect(server.calls).toEqual(['create segment', 'request stem'])
})

test('a tab result that fails offers 다시 시도 and draws on the next answer', async ({
  page,
}) => {
  await openWorkspace(page)
  await uploadSong(page)
  const server = await serveSection(page, load('stem-failed'))
  const asked = await serveResult(page, [
    () => [load('tab-not-ready'), 409],
    () => [load('tab-result'), 200],
  ])
  await createChorus(page)

  server.show('status-completed')
  const failure = tabPanel(page).getByRole('alert')
  await refreshUntilVisible(page, failure)
  await expect(failure).toContainText(
    '타브를 불러오지 못했어요. 다시 시도해 주세요.',
  )

  await tabPanel(page).getByRole('button', { name: '다시 시도' }).click()
  await expect(
    tabPanel(page).getByRole('img', { name: '타브 악보 2마디' }),
  ).toBeVisible()
  expect(asked).toEqual(['GET', 'GET'])
})

test('a workspace entered again lists its sections from the server and opens one', async ({
  page,
}) => {
  // Track 7 with 코러스 (31) finished and an unnamed section (33) separating.
  const listed = (name: string) =>
    fixtureData(name).items as Record<string, unknown>[]
  listTrack(page, listed('tracks')[1])
  for (const segment of listed('segments')) listSegment(page, segment)
  await page.route(`${API}/segments/31/processing-status`, (route) =>
    answer(route, load('status-completed')),
  )
  await page.route(`${API}/segments/33/processing-status`, (route) =>
    answer(route, load('status-separating')),
  )
  await serveResult(page, [() => [load('tab-result'), 200]])
  // Requests that would change something on the server, past the sign-in.
  const changes: string[] = []
  page.on('request', (request) => {
    const { pathname } = new URL(request.url())
    if (
      pathname.startsWith('/api/v1/') &&
      pathname !== '/api/v1/auth/tester-login' &&
      request.method() !== 'GET'
    )
      changes.push(`${request.method()} ${pathname}`)
  })

  await signIn(page)
  const song = sidebar(page).getByRole('button', {
    name: '봄날 커버 v2',
    exact: true,
  })
  await expect(song).toHaveAttribute('aria-expanded', 'true')
  const rows = sidebar(page).getByRole('button', { name: /^(코러스|솔로)/ })
  await expect(rows).toHaveCount(2)
  await expect(rows.first()).toHaveAccessibleName(/^코러스/)
  await expect(rows.last()).toHaveAccessibleName(/^솔로/)

  await rows.first().click()
  await expect(page).toHaveURL(`${HARNESS}?view=task&task=31`)
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
    '코러스',
  )
  // The server keeps no part, so the task says so.
  await expect(main(page).getByText('파트 미정', { exact: true })).toBeVisible()
  await expect(
    tabPanel(page).getByRole('img', { name: '타브 악보 2마디' }),
  ).toBeVisible()
  // Only a song chosen on this page has audio to draw.
  const original = main(page)
    .getByRole('region', { name: '트랙' })
    .getByRole('listitem')
    .filter({ hasText: /^원곡/ })
    .locator('[data-state]')
  await expect(original).toHaveAttribute('data-state', 'failed', {
    timeout: 15_000,
  })
  await expect(original).toContainText('파형을 불러오지 못했어요.')
  // Entering again only reads.
  expect(changes).toEqual([])
})
