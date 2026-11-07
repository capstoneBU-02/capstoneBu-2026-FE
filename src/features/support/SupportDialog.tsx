import { useEffect, useId, useRef, type RefObject } from 'react'
import { Button } from '../../shared/ui/Button.tsx'
import { isOutside, restoreFocus } from '../../shared/ui/dialogFocus.ts'
import { Icon } from '../../shared/ui/Icon.tsx'
import {
  USAGE_NOTICE_DESCRIPTION,
  UsageNoticeContent,
} from '../onboarding/UsageNoticeContent.tsx'
import './support.css'

export type SupportTopic = 'faq' | 'usage' | 'contact' | 'deletion'

export type SupportDialogProps = {
  topic: SupportTopic
  onClose: () => void
  returnFocusRef: RefObject<HTMLElement | null>
  fallbackFocusRef?: RefObject<HTMLElement | null>
}

const titles: Record<SupportTopic, string> = {
  faq: '자주 묻는 질문',
  usage: '이용 안내',
  contact: '문의하기',
  deletion: '자료 삭제 요청 안내',
}

const questions = [
  [
    '타브는 얼마나 정확한가요?',
    '타브는 자동으로 만든 초안이에요. 원음과 함께 음과 리듬을 확인해 주세요. 타브 생성과 카피 완료는 별개예요.',
  ],
  [
    '올린 음원은 누가 볼 수 있나요?',
    '자료는 기본 비공개이며 코드에 연결된 워크스페이스에서 확인해요. AI 학습·제품 개발 활용은 별도 선택 동의가 필요해요. 동의하지 않아도 기본 기능을 이용할 수 있어요.',
  ],
  [
    '녹음은 꼭 해야 하나요?',
    '녹음은 선택 기능이에요. 타브를 이용하기 위해 녹음할 필요는 없어요.',
  ],
  [
    '코드를 잃어버렸어요.',
    '코드를 받은 안내를 먼저 확인해 주세요. 코드 재발급 절차와 문의 채널은 준비 중이에요.',
  ],
] as const

export function SupportDialog({
  topic,
  onClose,
  returnFocusRef,
  fallbackFocusRef,
}: SupportDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const pointerStartedOutside = useRef(false)
  const titleId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    const target = returnFocusRef.current
    const fallback = fallbackFocusRef?.current
    dialog?.showModal()
    titleRef.current?.focus({ preventScroll: true })
    return () => {
      dialog?.close()
      restoreFocus(target, fallback)
    }
  }, [returnFocusRef, fallbackFocusRef])

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true })
  }, [topic])

  return (
    <dialog
      ref={dialogRef}
      className="support-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
      onClose={(event) => {
        if (!event.currentTarget.open) onClose()
      }}
      onPointerDown={(event) => {
        pointerStartedOutside.current =
          event.target === event.currentTarget &&
          isOutside(event, event.currentTarget.getBoundingClientRect())
      }}
      onPointerCancel={() => {
        pointerStartedOutside.current = false
      }}
      onClick={(event) => {
        const outside = pointerStartedOutside.current
        pointerStartedOutside.current = false
        if (
          outside &&
          event.target === event.currentTarget &&
          isOutside(event, event.currentTarget.getBoundingClientRect())
        )
          onClose()
      }}
    >
      <div className="support-dialog-header">
        <h2 ref={titleRef} id={titleId} tabIndex={-1}>
          {titles[topic]}
        </h2>
        <button
          type="button"
          className="support-dialog-close"
          aria-label={`${titles[topic]} 닫기`}
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      <div className="support-dialog-body">
        {topic === 'usage' && (
          <>
            <p className="support-description">{USAGE_NOTICE_DESCRIPTION}</p>
            <UsageNoticeContent headingLevel={3} />
          </>
        )}
        {topic === 'faq' && (
          <dl className="support-faq">
            {questions.map(([question, answer]) => (
              <div key={question}>
                <dt>{question}</dt>
                <dd>{answer}</dd>
              </div>
            ))}
          </dl>
        )}
        {topic === 'contact' && (
          <p className="support-description">
            문의 채널을 준비하고 있어요. 아직 문의를 보내거나 접수할 수 없어요.
          </p>
        )}
        {topic === 'deletion' && (
          <>
            <p className="support-description">
              자료 삭제 요청 절차와 문의 채널은 준비 중이에요. 지금은 요청을
              보내거나 접수할 수 없어요.
            </p>
            <p className="support-description">
              요청 접수와 실제 자료 삭제 완료는 서로 다른 단계예요.
            </p>
          </>
        )}
      </div>
      <div className="support-dialog-footer">
        <Button onClick={onClose}>닫기</Button>
      </div>
    </dialog>
  )
}
