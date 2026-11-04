import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEMO_ACCESS_CODES, readAppMode } from '../src/app/demoConfig.ts'
import { createMockAccessRepository } from '../src/features/access/mockRepository.ts'

const signal = () => new AbortController().signal

test('only fixture codes enter; cancellation never creates a usable session', async () => {
  const repository = createMockAccessRepository()
  await assert.rejects(repository.enter('unknown-code', signal()), {
    code: 'invalid',
  })
  const controller = new AbortController()
  const pending = repository.enter(
    DEMO_ACCESS_CODES.newWorkspace,
    controller.signal,
  )
  controller.abort()
  await assert.rejects(pending, { name: 'AbortError' })
  assert.throws(() => repository.workspaceFor('mock-session-1'), {
    code: 'session-expired',
  })
  const result = await repository.enter(
    DEMO_ACCESS_CODES.newWorkspace,
    signal(),
  )
  assert.equal(result.onboardingCompleted, false)
  assert.equal(result.consentChoice, 'undecided')
})

test('all three explicit onboarding choices persist on same-code reentry', async () => {
  await Promise.all(
    ['accepted', 'declined', 'undecided'].map(async (choice) => {
      const repository = createMockAccessRepository()
      const first = await repository.enter(
        DEMO_ACCESS_CODES.newWorkspace,
        signal(),
      )
      const workspace = repository.workspaceFor(first.sessionId)
      repository.acknowledgeNotice(first.sessionId)
      const completed = await repository.completeOnboarding(
        first.sessionId,
        choice,
        signal(),
      )
      const returning = await repository.enter(
        DEMO_ACCESS_CODES.newWorkspace,
        signal(),
      )
      assert.equal(completed.onboardingCompleted, true)
      assert.equal(returning.onboardingCompleted, true)
      assert.equal(returning.consentChoice, choice)
      assert.notEqual(first.sessionId, returning.sessionId)
      assert.equal(repository.workspaceFor(returning.sessionId), workspace)
      assert.equal(
        (await workspace.loadWorkspace(signal())).consentChoice,
        choice,
      )
    }),
  )
})

test('notice acknowledgement resumes only the remaining step without consenting or completing', async () => {
  const repository = createMockAccessRepository()
  const first = await repository.enter(DEMO_ACCESS_CODES.newWorkspace, signal())
  repository.acknowledgeNotice(first.sessionId)
  const returning = await repository.enter(
    DEMO_ACCESS_CODES.newWorkspace,
    signal(),
  )
  assert.equal(returning.noticeAcknowledged, true)
  assert.equal(returning.onboardingCompleted, false)
  assert.equal(returning.consentChoice, 'undecided')
  assert.equal(
    (await repository.workspaceFor(returning.sessionId).loadWorkspace(signal()))
      .consentChoice,
    'undecided',
  )
})

test('workspace consent changes survive reentry and never leak to another code', async () => {
  const repository = createMockAccessRepository()
  const returning = await repository.enter(
    DEMO_ACCESS_CODES.returningWorkspace,
    signal(),
  )
  const firstWorkspace = repository.workspaceFor(returning.sessionId)
  assert.equal(returning.onboardingCompleted, true)
  assert.equal((await firstWorkspace.loadWorkspace(signal())).tasks.length, 4)
  await firstWorkspace.saveConsent('accepted', signal())
  assert.equal(
    (await repository.enter(DEMO_ACCESS_CODES.returningWorkspace, signal()))
      .consentChoice,
    'accepted',
  )
  const second = await repository.enter(
    DEMO_ACCESS_CODES.secondWorkspace,
    signal(),
  )
  const secondWorkspace = repository.workspaceFor(second.sessionId)
  assert.notEqual(second.workspace.id, returning.workspace.id)
  assert.notEqual(secondWorkspace, firstWorkspace)
  assert.equal(second.onboardingCompleted, false)
  assert.equal(second.consentChoice, 'undecided')
  assert.deepEqual((await secondWorkspace.loadWorkspace(signal())).tasks, [])
})

test('failed and cancelled consent cannot complete onboarding or imply acceptance', async () => {
  const failed = createMockAccessRepository('consent-error')
  const first = await failed.enter(DEMO_ACCESS_CODES.newWorkspace, signal())
  failed.acknowledgeNotice(first.sessionId)
  await assert.rejects(
    failed.completeOnboarding(first.sessionId, 'accepted', signal()),
    { code: 'consent-failed' },
  )
  const afterFailure = await failed.enter(
    DEMO_ACCESS_CODES.newWorkspace,
    signal(),
  )
  assert.equal(afterFailure.onboardingCompleted, false)
  assert.equal(afterFailure.consentChoice, 'undecided')
  assert.equal(
    (await failed.completeOnboarding(first.sessionId, 'undecided', signal()))
      .onboardingCompleted,
    true,
  )

  const cancelled = createMockAccessRepository()
  const next = await cancelled.enter(DEMO_ACCESS_CODES.newWorkspace, signal())
  cancelled.acknowledgeNotice(next.sessionId)
  const controller = new AbortController()
  const saving = cancelled.completeOnboarding(
    next.sessionId,
    'accepted',
    controller.signal,
  )
  controller.abort()
  await assert.rejects(saving, { name: 'AbortError' })
  const afterCancellation = await cancelled.enter(
    DEMO_ACCESS_CODES.newWorkspace,
    signal(),
  )
  assert.equal(afterCancellation.onboardingCompleted, false)
  assert.equal(afterCancellation.consentChoice, 'undecided')
  await assert.rejects(
    cancelled.completeOnboarding('another-session', 'accepted', signal()),
    { code: 'session-expired' },
  )
})

test('code failure fixtures remain distinct from an expired-session notice', async () => {
  await Promise.all(
    ['invalid', 'code-expired', 'revoked', 'limited', 'network'].map(
      async (code) => {
        const repository = createMockAccessRepository(code)
        await assert.rejects(
          repository.enter(DEMO_ACCESS_CODES.newWorkspace, signal()),
          { code },
        )
        if (code === 'limited') {
          assert.equal(
            (await repository.enter(DEMO_ACCESS_CODES.newWorkspace, signal()))
              .onboardingCompleted,
            false,
          )
        }
      },
    ),
  )
  assert.equal(
    (
      await createMockAccessRepository('session-expired').enter(
        DEMO_ACCESS_CODES.newWorkspace,
        signal(),
      )
    ).onboardingCompleted,
    false,
  )
})

test('unknown preview queries do not bypass code entry', () => {
  assert.deepEqual(readAppMode(''), { kind: 'access', scenario: 'default' })
  assert.deepEqual(readAppMode('?demo=anything&code=EM-NEW1-0001'), {
    kind: 'access',
    scenario: 'default',
  })
  assert.deepEqual(readAppMode('?demo=workspace'), {
    kind: 'workspace',
    scenario: 'default',
  })
  for (const scenario of ['empty', 'error', 'expired', 'consent-error']) {
    assert.deepEqual(readAppMode(`?demo=${scenario}`), {
      kind: 'workspace',
      scenario,
    })
  }
})
