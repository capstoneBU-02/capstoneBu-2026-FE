# Earmark Frontend

음원 기반 기타 카피 보조 서비스의 프론트엔드.

## 개발환경

- Node.js 24 LTS
- npm 11
- React, TypeScript, Vite
- Oxlint, Prettier
- Husky, commitlint

의존성 버전은 `package-lock.json`으로 관리한다. 린트는 Vite 공식 템플릿의 Oxlint 구성을 사용한다.

## 실행

```bash
nvm use
npm ci
npm run dev
```

## 명령어

| 명령어                 | 기능                            |
| ---------------------- | ------------------------------- |
| `npm run dev`          | 개발 서버 실행                  |
| `npm run typecheck`    | TypeScript 타입 검사            |
| `npm run lint`         | 코드 검사                       |
| `npm run format`       | 코드 포맷 적용                  |
| `npm run format:check` | 코드 포맷 검사                  |
| `npm test`             | 목업 저장소 회귀 테스트         |
| `npm run build`        | 타입 검사 및 배포 빌드          |
| `npm run preview`      | 빌드 결과 확인                  |
| `npm run check`        | 포맷·린트·테스트·타입·빌드 검사 |

빌드 결과는 `dist/`에 생성된다.

## 첫 번째 구현: 내 작업 화면

Figma의 `Earmark — 기타 카피 보조 서비스 디자인 v2`를 기준으로, 작업 공간에 진입한 이후의 **내 작업 목록·빈 상태·선택 AI 활용 동의**를 구현한다. 처리 상태 필터와 곡별 목록 펼치기·접기, 동의 저장·변경을 확인할 수 있다. 생성 완료와 사용자가 확인한 카피 완료는 별도로 표시한다.

테스터 코드 진입, 새 카피 만들기, 작업 상세, 삭제, 오디오·악보·녹음·비교는 후속 범위다. 아직 구현하지 않은 이동·작업 버튼은 비활성화되어 있다. 구현 순서와 근거는 [구현 계획](documentation/implementation-plan.md), [요구사항 검토](documentation/requirements-audit.md)를 참고한다.

### 목업 상태 확인

`npm run dev` 실행 후 개발 서버 주소에 다음 쿼리를 붙인다.

| URL 쿼리              | 상태                                           |
| --------------------- | ---------------------------------------------- |
| 없음                  | 작업 4개와 미선택 동의 배너                    |
| `?demo=empty`         | 작업이 없는 상태                               |
| `?demo=error`         | 첫 목록 조회 실패, 다시 시도하면 정상 목록     |
| `?demo=expired`       | 작업 공간 이용 종료, 작업 내용은 표시하지 않음 |
| `?demo=consent-error` | 동의 저장 실패, 기존 선택을 유지               |

조회·저장에는 짧은 고정 지연을 두어 로딩과 저장 중 상태도 확인할 수 있다. 목업은 네트워크 요청이나 브라우저 저장소를 사용하지 않는다. 동의 선택은 현재 앱의 메모리에만 남고 새로고침하면 미선택으로 돌아온다. 동의를 거부해도 목록 사용을 제한하지 않는다. 처리 진행률과 시간 표시는 고정 예시이며 실제 AI 처리를 수행하지 않는다.

`src/app/demoConfig.ts`의 5분 제한·보관 기간·테스터 코드 형식은 디자인 확인을 위한 임시 문구다. 제품 정책이나 API 명세의 확정값이 아니다. 디자인 폰트 파일은 아직 포함하지 않았으며 시스템 글꼴로 대체한다.

### API 연결 경계

`src/features/workspace/repository.ts`의 `WorkspaceRepository`가 목록 조회와 동의 저장 경계다. 현재 `App.tsx`에서 `createMockWorkspaceRepository`를 주입한다. API 확정 후 이 인터페이스를 구현하는 실제 저장소와 응답 변환을 연결한다. `model.ts`는 화면 도메인 모델이며 서버 DTO가 아니다. 조회·저장은 `AbortSignal`을 받고, 훅은 취소되거나 이전 작업 공간에서 늦게 도착한 응답을 반영하지 않는다.

목록의 표시 상태는 기능 훅에, 필터·곡별 펼침 여부·다이얼로그 표시 여부는 화면에 둔다. 미디어 렌더러와 전역 상태 라이브러리는 이번 범위에 추가하지 않는다.

## 협업

Git Flow와 Conventional Commits를 사용한다. 브랜치·커밋·PR 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md)에 정의한다.

## 오픈소스 고지

배포물의 라이선스 고지는 [THIRD_PARTY_NOTICES.txt](public/THIRD_PARTY_NOTICES.txt)에 기록한다. 이 파일은 빌드 시 `dist/`에 포함된다.
