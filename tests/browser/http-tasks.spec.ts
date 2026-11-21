import { readFileSync } from 'node:fs'
import {
  expect,
  test,
  type Locator,
  type Page,
  type Route,
} from '@playwright/test'
import {
  API,
  HARNESS,
  main,
  openWorkspace,
  sidebar,
  uploadSong,
} from './http-workspace.ts'

// A section made, followed and sent again through the http repositories
// against a faked API. Track 7, segment 31 and stem 54 match the fixtures.
const load = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../fixtures/api/workspace/${name}.json`, import.meta.url),
      'utf8',
    ),
  )

const form = (page: Page) => main(page).getByRole('form', { name: '새 구간' })
const region = (page: Page, name: string) =>
  main(page).getByRole('region', { name })

function answer(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

// The server side of one section: what processing-status reports now, the
// failure GET /stems/54 explains, and the requests that changed something.
async function serveSection(page: Page, failure: unknown) {
  let status = load('status-queued')
  const calls: string[] = []
  const created: unknown[] = []
  await page.route(`${API}/tracks/7/segments`, (route) => {
    calls.push('create segment')
    created.push(route.request().postDataJSON())
    return answer(route, load('segment-create'), 201)
  })
  await page.route(`${API}/segments/31/processing-status`, (route) =>
    answer(route, status),
  )
  await page.route(`${API}/segments/31/stems`, (route) => {
    calls.push('request stem')
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

test('a song the server could not read offers another file without 다시 시도', async ({
  page,
}) => {
  await openWorkspace(page)
  await uploadSong(page)
  const server = await serveSection(page, load('stem-invalid-audio'))
  await createChorus(page)

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
  const failed = region(page, '음원을 읽지 못했어요')
  await refreshUntilVisible(page, failed)
  await expect(failed).toContainText(
    '올린 파일에서 소리를 읽지 못했어요. 다른 MP3, MP4 파일로 다시 올려 보세요.',
  )
  await expect(main(page).getByText('음원 읽기 실패')).toBeVisible()
  await expect(
    main(page).getByRole('button', { name: '다시 시도' }),
  ).toHaveCount(0)

  await failed.getByRole('button', { name: '다른 파일 올리기' }).click()
  await expect(
    page.getByRole('dialog', { name: '다른 파일 올리기' }),
  ).toBeVisible()
  expect(server.calls).toEqual(['create segment', 'request stem'])
})
