import { Button } from '../../shared/ui/Button.tsx'
import type { ConsentChoice } from '../workspace/model.ts'
import type { SupportTopic } from '../support/SupportDialog.tsx'
import './settings.css'

export type SettingsPanelProps = {
  maskedTesterCode: string
  consentChoice: ConsentChoice
  onLeave: () => void
  onEditConsent: () => void
  onOpenSupport: (topic: Exclude<SupportTopic, 'faq'>) => void
}

const consentDescriptions: Record<ConsentChoice, string> = {
  undecided: '아직 정하지 않았어요. 정하지 않으면 쓰지 않아요.',
  accepted: '현재 선택: 동의',
  declined: '현재 선택: 동의하지 않음',
}

export function SettingsPanel({
  maskedTesterCode,
  consentChoice,
  onLeave,
  onEditConsent,
  onOpenSupport,
}: SettingsPanelProps) {
  return (
    <div className="settings-panel">
      <h1>설정</h1>
      <section
        className="settings-section"
        aria-labelledby="settings-workspace"
      >
        <h2 id="settings-workspace">워크스페이스</h2>
        <div className="settings-row">
          <div className="settings-row-copy">
            <h3>테스터 코드</h3>
            <p>코드는 다른 사람과 나누지 마세요.</p>
          </div>
          <span
            className="settings-code"
            aria-label={`테스터 코드 ${maskedTesterCode}`}
          >
            {maskedTesterCode}
          </span>
        </div>
        <div className="settings-row">
          <div className="settings-row-copy">
            <h3>이 기기에서 나가기</h3>
            <p>다시 들어올 때는 코드를 입력해야 해요.</p>
          </div>
          <Button compact onClick={onLeave}>
            나가기
          </Button>
        </div>
      </section>
      <section className="settings-section" aria-labelledby="settings-consent">
        <h2 id="settings-consent">AI 학습 활용</h2>
        <div className="settings-row">
          <div className="settings-row-copy">
            <h3>올린 음원을 AI 학습에 쓰기</h3>
            <p>{consentDescriptions[consentChoice]}</p>
          </div>
          <Button compact onClick={onEditConsent}>
            {consentChoice === 'undecided' ? '선택하기' : '변경하기'}
          </Button>
        </div>
      </section>
      <section
        className="settings-section"
        aria-labelledby="settings-information"
      >
        <h2 id="settings-information">안내</h2>
        <div className="settings-row">
          <div className="settings-row-copy">
            <h3>이용 안내</h3>
            <p>무엇이 남고 누가 볼 수 있는지 알려 드려요.</p>
          </div>
          <button
            type="button"
            className="settings-text-button"
            onClick={() => onOpenSupport('usage')}
            aria-label="이용 안내 보기"
          >
            보기
          </button>
        </div>
        <div className="settings-row">
          <div className="settings-row-copy">
            <h3>개인정보 처리방침</h3>
          </div>
          <button
            type="button"
            className="settings-text-button"
            disabled
            title="개인정보 처리방침은 준비 중이에요."
          >
            준비 중
          </button>
        </div>
      </section>
      <section className="settings-section" aria-labelledby="settings-support">
        <h2 id="settings-support">도움</h2>
        <div className="settings-row">
          <div className="settings-row-copy">
            <h3>문의하기</h3>
            <p>문의 방법과 채널 준비 상태를 확인해요.</p>
          </div>
          <Button compact onClick={() => onOpenSupport('contact')}>
            문의하기
          </Button>
        </div>
        <div className="settings-row">
          <div className="settings-row-copy">
            <h3>자료 삭제 요청 안내</h3>
            <p>자료 삭제 요청 절차를 확인해요.</p>
          </div>
          <button
            type="button"
            className="settings-text-button"
            onClick={() => onOpenSupport('deletion')}
          >
            요청 방법 보기
          </button>
        </div>
      </section>
    </div>
  )
}
