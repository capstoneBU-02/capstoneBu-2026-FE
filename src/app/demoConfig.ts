import type { DemoScenario } from '../features/workspace/model.ts'
import type { AccessScenario } from '../features/access/model.ts'

// Provisional Figma copy for the mock preview, not finalized product policies.
export const DEMO_DISPLAY_CONFIG = {
  trainingRetentionLabel: '베타가 끝나고 90일까지',
  testerCode: 'EM-7K2P-9Q4M',
} as const

// Explicit demo allowlist; not a server-side code format or issuing policy.
export const DEMO_ACCESS_CODES = {
  newWorkspace: 'EM-NEW1-0001',
  returningWorkspace: DEMO_DISPLAY_CONFIG.testerCode,
  secondWorkspace: 'EM-NEW2-0002',
} as const

export type AppMode =
  | { readonly kind: 'workspace'; readonly scenario: DemoScenario }
  | { readonly kind: 'access'; readonly scenario: AccessScenario }

export function readAppMode(search: string): AppMode {
  const params = new URLSearchParams(search)
  const demo = params.get('demo')
  if (
    demo === 'workspace' ||
    demo === 'default' ||
    demo === 'empty' ||
    demo === 'error' ||
    demo === 'expired' ||
    demo === 'consent-error'
  ) {
    return { kind: 'workspace', scenario: readDemoScenario(search) }
  }
  const access = params.get('access')
  switch (access) {
    case 'invalid':
    case 'code-expired':
    case 'revoked':
    case 'limited':
    case 'network':
    case 'session-expired':
    case 'consent-error':
      return { kind: 'access', scenario: access }
    default:
      return { kind: 'access', scenario: 'default' }
  }
}

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
