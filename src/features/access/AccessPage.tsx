import { useEffect, useId, useRef, useState } from 'react'
import { BrandLogo } from '../../shared/ui/BrandLogo.tsx'
import { Button } from '../../shared/ui/Button.tsx'
import './access.css'

export type AccessPageProps = {
  code: string
  onCodeChange: (value: string) => void
  onSubmit: () => void
  status:
    | 'idle'
    | 'submitting'
    | 'invalid'
    | 'code-expired'
    | 'revoked'
    | 'limited'
    | 'error'
  notice?: 'expired' | null
  errorMessage?: string | null
}

const feedback = {
  invalid: '코드를 찾을 수 없어요. 숫자 1과 영문 I를 확인해 주세요.',
  'code-expired': '사용 기간이 지난 코드예요. 운영진에게 문의해 주세요.',
  revoked: '사용이 중지된 코드예요. 운영진에게 문의해 주세요.',
  limited: '코드를 여러 번 잘못 입력했어요. 잠시 후 다시 입력해 주세요.',
  error: '코드를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
} as const

export function AccessPage({
  code,
  onCodeChange,
  onSubmit,
  status,
  notice,
  errorMessage,
}: AccessPageProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const feedbackRef = useRef<HTMLParagraphElement>(null)
  const [rechecking, setRechecking] = useState(false)
  const fieldId = useId()
  const hintId = useId()
  const feedbackId = useId()
  const noticeId = useId()
  const pending = status === 'submitting'
  const locked = pending || status === 'limited'
  const hasFeedback = status in feedback
  const invalid =
    status === 'invalid' || status === 'code-expired' || status === 'revoked'
  const message = hasFeedback
    ? errorMessage || feedback[status as keyof typeof feedback]
    : null

  useEffect(() => {
    if (status === 'limited') {
      feedbackRef.current?.focus({ preventScroll: true })
    } else if (status !== 'idle' && status !== 'submitting') {
      inputRef.current?.focus({ preventScroll: true })
    }
  }, [status])

  useEffect(() => {
    if (notice === 'expired') inputRef.current?.focus({ preventScroll: true })
  }, [notice])

  return (
    <div className="access-page">
      <header className="access-nav">
        <BrandLogo />
        <Button
          compact
          onClick={() => inputRef.current?.focus()}
          disabled={locked}
        >
          테스터 코드 입력
        </Button>
      </header>
      <main className="access-hero">
        <span className="access-beta">비공개 베타</span>
        <h1>
          기타 카피를 위한
          <br />
          구간별 분리와 타브
        </h1>
        <p className="access-introduction">
          막힌 구간을 고르면 그 부분의 기타만 분리해 타브로 옮겨 드려요.
        </p>
        <form
          className="access-form"
          onSubmit={(event) => {
            event.preventDefault()
            if (!locked) {
              setRechecking(false)
              onSubmit()
            }
          }}
        >
          {notice === 'expired' && (
            <p id={noticeId} className="access-notice">
              오랫동안 사용하지 않아 연결이 끊겼어요. 코드를 다시 입력해 주세요.
            </p>
          )}
          <div className="access-fields">
            <label className="access-sr-only" htmlFor={fieldId}>
              테스터 코드
            </label>
            <input
              id={fieldId}
              ref={inputRef}
              type="text"
              value={code}
              onChange={(event) => {
                setRechecking(false)
                onCodeChange(event.currentTarget.value)
              }}
              placeholder="테스터 코드"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              required
              disabled={locked}
              aria-invalid={invalid || undefined}
              aria-describedby={[
                hintId,
                notice === 'expired' ? noticeId : null,
                message ? feedbackId : null,
              ]
                .filter(Boolean)
                .join(' ')}
            />
            <Button
              variant="primary"
              type="submit"
              className="access-submit"
              disabled={locked}
            >
              {pending ? '확인 중…' : '시작하기'}
            </Button>
          </div>
          {message && (
            <p
              id={feedbackId}
              ref={feedbackRef}
              className={`access-feedback${status !== 'limited' ? ' access-feedback-error' : ''}`}
              role="alert"
              tabIndex={-1}
            >
              {message}
            </p>
          )}
          {(status === 'limited' || (pending && rechecking)) && (
            <Button
              compact
              className="access-recheck"
              aria-disabled={pending}
              onClick={() => {
                if (pending) return
                setRechecking(true)
                onSubmit()
              }}
            >
              {pending ? '확인 중…' : '다시 확인'}
            </Button>
          )}
          <p id={hintId} className={message ? 'access-sr-only' : 'access-hint'}>
            베타 테스터 전용이에요. 코드는 운영진이 개별로 보내 드려요.
          </p>
          <span className="access-sr-only" role="status">
            {pending ? '테스터 코드를 확인하고 있어요.' : ''}
          </span>
        </form>
      </main>
    </div>
  )
}
