import type { DemoScenario } from '../features/workspace/model.ts'

// Provisional Figma copy for the mock preview, not finalized product policies.
export const DEMO_DISPLAY_CONFIG = {
  uploadHintLabel: 'MP3, MP4 · 최대 5분',
  trainingRetentionLabel: '베타가 끝나고 90일까지',
  testerCode: 'EM-7K2P-9Q4M',
} as const

export function readDemoScenario(search: string): DemoScenario {
  const scenario = new URLSearchParams(search).get('demo')

  switch (scenario) {
    case 'empty':
    case 'error':
    case 'expired':
    case 'consent-error':
      return scenario
    default:
      return 'default'
  }
}
