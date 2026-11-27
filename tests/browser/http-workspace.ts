import { readFileSync } from 'node:fs'
import {
  expect,
  type FileChooser,
  type Page,
  type Route,
} from '@playwright/test'

// Shared by the specs that drive the http repositories against a faked API.
export const HARNESS = '/tests/browser/http-harness.html'
export const API = '**/api/v1'
export const fixture = (path: string) => `tests/fixtures/api/${path}`

type Json = Record<string, unknown>

export const load = (name: string): unknown =>
  JSON.parse(
    readFileSync(
      new URL(`../fixtures/api/workspace/${name}.json`, import.meta.url),
      'utf8',
    ),
  )

// The data inside a workspace fixture's envelope.
export const fixtureData = (name: string) => (load(name) as { data: Json }).data

export function answer(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  })
}

export const TONE = {
  name: 'tone-2s.mp3',
  mimeType: 'audio/mpeg',
  buffer: readFileSync(
    new URL('../fixtures/media/tone-2s.mp3', import.meta.url),
  ),
}

export const main = (page: Page) => page.locator('#workspace-content')
export const sidebar = (page: Page) =>
  page.getByRole('complementary', { name: '워크스페이스 탐색' })
export const addSongDialog = (page: Page) =>
  page.getByRole('dialog', { name: '곡 추가' })
export const addSongNext = (page: Page) =>
  addSongDialog(page).getByRole('button', { name: '다음', exact: true })

// What the faked server lists for a page: its tracks, newest first, and the
// sections of each. Uploads and new sections join them, and a spec may fill
// them before signing in.
interface ServerLists {
  readonly tracks: readonly Json[]
  readonly segments: ReadonlyMap<number, readonly Json[]>
}

const serverLists = new WeakMap<Page, ServerLists>()
const listsOf = (page: Page): ServerLists =>
  serverLists.get(page) ?? { tracks: [], segments: new Map() }

export function listTrack(page: Page, track: Json) {
  const lists = listsOf(page)
  const others = lists.tracks.filter((item) => item.track_id !== track.track_id)
  serverLists.set(page, { ...lists, tracks: [track, ...others] })
}

// A changed section replaces the one listed before it.
export function listSegment(page: Page, segment: Json) {
  const lists = listsOf(page)
  const trackId = Number(segment.track_id)
  const listed = lists.segments.get(trackId) ?? []
  const known = listed.some((item) => item.segment_id === segment.segment_id)
  const segments = known
    ? listed.map((item) =>
        item.segment_id === segment.segment_id ? segment : item,
      )
    : [...listed, segment]
  serverLists.set(page, {
    ...lists,
    segments: new Map([...lists.segments, [trackId, segments]]),
  })
}

async function serveLists(page: Page) {
  await page.route(`${API}/tracks`, (route) => {
    const { tracks, segments } = listsOf(page)
    const items = tracks.map((track) => ({
      ...track,
      segment_count: segments.get(Number(track.track_id))?.length ?? 0,
    }))
    return answer(route, { success: true, data: { items } })
  })
  await page.route(`${API}/tracks/*/segments`, (route) => {
    const path = new URL(route.request().url()).pathname.split('/')
    const items = listsOf(page).segments.get(Number(path.at(-2))) ?? []
    return answer(route, { success: true, data: { items } })
  })
  // A finished task lists its takes. Without this the request would reach the
  // dev server's proxy; a spec that saves takes routes its own section later.
  await page.route(`${API}/segments/*/performances`, (route) => {
    const path = new URL(route.request().url()).pathname.split('/')
    return answer(route, {
      success: true,
      data: { segment_id: Number(path.at(-2)), performances: [] },
    })
  })
}

// Signs in with a tester code and passes the first-run notices.
export async function signIn(page: Page) {
  await page.route(`${API}/auth/tester-login`, (route) =>
    route.fulfill({ path: fixture('access/tester-login.json') }),
  )
  await page.route(`${API}/workspaces/me`, (route) =>
    route.fulfill({ path: fixture('workspace/me.json') }),
  )
  await serveLists(page)
  await page.goto(HARNESS)
  await page
    .getByRole('textbox', { name: '테스터 코드', exact: true })
    .fill('TESTER-2026-A1B2')
  await page.getByRole('button', { name: '시작하기', exact: true }).click()
  await page.getByRole('button', { name: '확인했어요', exact: true }).click()
  await page
    .getByRole('button', { name: '동의하지 않아요', exact: true })
    .click()
}

// Signs in to a workspace the server lists nothing for.
export async function openWorkspace(page: Page) {
  await signIn(page)
  await expect(
    main(page).getByRole('heading', { name: '첫 곡을 올려 주세요' }),
  ).toBeVisible()
}

export async function chooseSongFile(
  page: Page,
  file: Parameters<FileChooser['setFiles']>[0],
) {
  const chooser = page.waitForEvent('filechooser')
  await addSongDialog(page)
    .getByRole('button', {
      name: /^(파일을 끌어다 놓거나 선택하세요|파일 바꾸기)$/,
    })
    .click()
  await (await chooser).setFiles(file)
}

export async function chooseTone(page: Page) {
  await chooseSongFile(page, TONE)
  await expect(addSongNext(page)).toHaveAttribute('aria-disabled', 'false')
}

// Uploads the tone as track 7 (봄날 커버 v2), which the server lists from
// then on, and waits on its new-section screen.
export async function uploadSong(page: Page) {
  await page.route(`${API}/tracks/upload`, (route: Route) => {
    listTrack(page, fixtureData('track-upload'))
    return route.fulfill({
      status: 201,
      path: fixture('workspace/track-upload.json'),
    })
  })
  await main(page).getByRole('button', { name: '파일 선택' }).click()
  await chooseTone(page)
  await addSongNext(page).click()
  await expect(addSongDialog(page)).toHaveCount(0)
  await expect(main(page).getByRole('heading', { level: 1 })).toHaveText(
    '새 구간',
  )
}
