import { test as base, expect } from '@playwright/test'

// The http specs answer the API with page.route. A request no route answers
// would reach the dev server, so it is refused here, and the test fails at
// its end naming each one. Routes a test adds take precedence over this one.
export const test = base.extend<{ unansweredApi: readonly string[] }>({
  unansweredApi: [
    async ({ page }, provide) => {
      const unanswered: string[] = []
      await page.route('**/api/v1/**', (route) => {
        const request = route.request()
        const { pathname } = new URL(request.url())
        unanswered.push(`${request.method()} ${pathname}`)
        return route.abort()
      })
      await provide(unanswered)
      expect(unanswered, 'API requests no route answered').toEqual([])
    },
    { auto: true },
  ],
})

export { expect }
