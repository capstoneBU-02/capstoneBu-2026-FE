import { useEffect, useRef } from 'react'
import { BrandLogo } from '../../shared/ui/BrandLogo.tsx'
import { Button } from '../../shared/ui/Button.tsx'
import {
  CONSENT_QUESTION,
  ConsentDescription,
  ConsentDetails,
} from '../workspace/components/ConsentExplanation.tsx'
import './onboarding.css'
import {
  USAGE_NOTICE_DESCRIPTION,
  UsageNoticeContent,
} from './UsageNoticeContent.tsx'

export type OnboardingPageProps = {
  step: 'notice' | 'consent'
  status: 'idle' | 'saving' | 'error'
  errorMessage?: string | null
  onAcknowledge: () => void
  onChoose: (choice: 'accepted' | 'declined' | 'undecided') => void
}

export function OnboardingPage({
  step,
  status,
  errorMessage,
  onAcknowledge,
  onChoose,
}: OnboardingPageProps) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  const errorRef = useRef<HTMLParagraphElement>(null)
  const busy = status === 'saving'

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true })
  }, [step])

  useEffect(() => {
    if (status === 'error') errorRef.current?.focus({ preventScroll: true })
  }, [status, errorMessage])

  return (
    <div className="onboarding-page">
      <header className="onboarding-header">
        <BrandLogo />
      </header>
      <main className="onboarding-main">
        <section className="onboarding-card">
          <div className="onboarding-heading">
            <p className="onboarding-step">{step === 'notice' ? 1 : 2} / 2</p>
            <h1 ref={titleRef} tabIndex={-1}>
              {step === 'notice'
                ? '시작하기 전에 확인해 주세요'
                : CONSENT_QUESTION}
            </h1>
            {step === 'notice' ? (
              <p className="onboarding-description">
                {USAGE_NOTICE_DESCRIPTION}
              </p>
            ) : (
              <ConsentDescription className="onboarding-description" />
            )}
          </div>
          {step === 'notice' ? (
            <UsageNoticeContent />
          ) : (
            <ConsentDetails className="onboarding-consent-details" />
          )}
          {status === 'error' && (
            <p
              ref={errorRef}
              className="onboarding-error"
              role="alert"
              tabIndex={-1}
            >
              {errorMessage || '선택을 저장하지 못했어요. 다시 시도해 주세요.'}
            </p>
          )}
          <span className="onboarding-sr-only" role="status">
            {busy ? '선택을 저장하고 있어요.' : ''}
          </span>
          {step === 'notice' ? (
            <div className="onboarding-footer">
              <button
                type="button"
                className="onboarding-quiet-button"
                disabled
                title="개인정보 처리방침은 준비 중이에요."
              >
                개인정보 처리방침 (준비 중)
              </button>
              <Button variant="primary" onClick={onAcknowledge} disabled={busy}>
                확인했어요
              </Button>
            </div>
          ) : (
            <div className="onboarding-footer onboarding-consent-footer">
              <button
                type="button"
                className="onboarding-quiet-button"
                onClick={() => onChoose('undecided')}
                disabled={busy}
              >
                나중에 정할게요
              </button>
              <div className="onboarding-choices">
                <Button
                  className="onboarding-choice"
                  onClick={() => onChoose('declined')}
                  disabled={busy}
                >
                  동의하지 않아요
                </Button>
                <Button
                  className="onboarding-choice"
                  onClick={() => onChoose('accepted')}
                  disabled={busy}
                >
                  동의해요
                </Button>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
