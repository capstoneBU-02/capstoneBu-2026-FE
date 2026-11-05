import fileIcon from '../../assets/figma/access/file.svg'
import keyIcon from '../../assets/figma/access/key.svg'
import lockIcon from '../../assets/figma/access/lock.svg'
import shieldIcon from '../../assets/figma/access/shield.svg'
import './onboarding.css'

export const USAGE_NOTICE_DESCRIPTION =
  '이 워크스페이스에 무엇이 남고 누가 볼 수 있는지 알려 드려요.'

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

export function UsageNoticeContent({
  headingLevel = 2,
}: {
  headingLevel?: 2 | 3
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3'
  return (
    <ul className="onboarding-notice-items">
      {noticeItems.map(({ icon, title, body }) => (
        <li className="onboarding-notice-item" key={title}>
          <span className="onboarding-icon-box" aria-hidden="true">
            <img src={icon} alt="" width={18} height={18} draggable="false" />
          </span>
          <div className="onboarding-item-copy">
            <Heading>{title}</Heading>
            <p>{body}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}
