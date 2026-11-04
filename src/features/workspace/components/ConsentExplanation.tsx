import { DEMO_DISPLAY_CONFIG } from '../../../app/demoConfig.ts'

export const CONSENT_QUESTION = '올린 음원을 AI 학습에 써도 될까요?'

const details = [
  ['쓰는 자료', '올린 음원, 분리한 기타 음원, 타브, 녹음한 연주'],
  [
    '쓰는 목적',
    '타브 만들기와 연주 비교를 개선하는 AI 학습과 제품 개발. 홍보에는 쓰지 않아요.',
  ],
  ['보는 사람', '학습을 맡은 담당자만 봐요.'],
  ['기간', DEMO_DISPLAY_CONFIG.trainingRetentionLabel],
  [
    '거두기',
    '설정에서 언제든 바꿀 수 있어요. 거두면 그 뒤로는 학습에 쓰지 않아요.',
  ],
] as const

export function ConsentDescription({
  id,
  className,
  includeQuestion = false,
}: {
  id?: string
  className?: string
  includeQuestion?: boolean
}) {
  return (
    <p id={id} className={className}>
      {includeQuestion && `${CONSENT_QUESTION} `}
      동의하지 않아도 모든 기능을 똑같이 쓸 수 있어요.
    </p>
  )
}

export function ConsentDetails({ className }: { className?: string }) {
  return (
    <dl className={className}>
      {details.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}
