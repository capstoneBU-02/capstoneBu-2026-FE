// The browser tests on Playwright WebKit, run by hand with
// `npm run test:browser:webkit`, or in CI by selecting webkit for a manual
// run. Push and PR checks stay on Chromium. A headless build does not stand
// in for real Safari or iOS.
import { defineConfig, devices } from '@playwright/test'
import base from './playwright.config.ts'

export default defineConfig({
  ...base,
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report/webkit' }],
  ],
  outputDir: 'test-results/webkit',
  projects: [{ name: 'webkit', use: { ...devices['Desktop Safari'] } }],
})
