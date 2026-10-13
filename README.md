# Capstone BU Frontend

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

| 명령어                 | 기능                     |
| ---------------------- | ------------------------ |
| `npm run dev`          | 개발 서버 실행           |
| `npm run typecheck`    | TypeScript 타입 검사     |
| `npm run lint`         | 코드 검사                |
| `npm run format`       | 코드 포맷 적용           |
| `npm run format:check` | 코드 포맷 검사           |
| `npm run build`        | 타입 검사 및 배포 빌드   |
| `npm run preview`      | 빌드 결과 확인           |
| `npm run check`        | 포맷·린트·타입·빌드 검사 |

빌드 결과는 `dist/`에 생성된다.

## 협업

Git Flow와 Conventional Commits를 사용한다. 브랜치·커밋·PR 규칙은 [CONTRIBUTING.md](CONTRIBUTING.md)에 정의한다.

## 오픈소스 고지

배포물의 라이선스 고지는 [THIRD_PARTY_NOTICES.txt](public/THIRD_PARTY_NOTICES.txt)에 기록한다. 이 파일은 빌드 시 `dist/`에 포함된다.
