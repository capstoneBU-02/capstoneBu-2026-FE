import { useEffect, useRef } from 'react'
import fileIcon from '../../assets/figma/access/file.svg'
import keyIcon from '../../assets/figma/access/key.svg'
import lockIcon from '../../assets/figma/access/lock.svg'
import shieldIcon from '../../assets/figma/access/shield.svg'
import { BrandLogo } from '../../shared/ui/BrandLogo.tsx'
import { Button } from '../../shared/ui/Button.tsx'
import {
  CONSENT_QUESTION,
  ConsentDescription,
  ConsentDetails,
} from '../workspace/components/ConsentExplanation.tsx'
import './onboarding.css'

export type OnboardingPageProps = {
  step: 'notice' | 'consent'
  status: 'idle' | 'saving' | 'error'
  errorMessage?: string | null
  onAcknowledge: () => void
  onChoose: (choice: 'accepted' | 'declined' | 'undecided') => void
}

const noticeItems = [
  {
    icon: fileIcon,
    title: '남는 자료',
    body: '올린 음원, 분리한 기타 음원, 타브, 녹음한 연주, 작업 기록이 남아요.',
  },
  {
    icon: lockIcon,
    title: '볼 수 있는 사람',
    body: '이 코드로 들어온 사람만 볼 수 있어요. 코드는 다른 사람과 나누지 마세요.',
  },
  {
    icon: shieldIcon,
    title: '받지 않는 정보',
    body: '이름, 이메일, 연락처는 받지 않아요.',
  },
  {
    icon: keyIcon,
    title: '다시 들어올 때',
    body: '같은 코드를 입력하면 하던 작업이 그대로 열려요.',
  },
] as const

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
                이 워크스페이스에 무엇이 남고 누가 볼 수 있는지 알려 드려요.
              </p>
            ) : (
              <ConsentDescription className="onboarding-description" />
            )}
          </div>
          {step === 'notice' ? (
            <ul className="onboarding-notice-items">
              {noticeItems.map(({ icon, title, body }) => (
                <li className="onboarding-notice-item" key={title}>
                  <span className="onboarding-icon-box" aria-hidden="true">
                    <img
                      src={icon}
                      alt=""
                      width={18}
                      height={18}
                      draggable="false"
                    />
                  </span>
                  <div className="onboarding-item-copy">
                    <h2>{title}</h2>
                    <p>{body}</p>
                  </div>
                </li>
              ))}
            </ul>
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
