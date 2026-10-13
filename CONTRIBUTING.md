# 기여 규칙

## 브랜치

| 브랜치              | 기준      | 병합 대상         | 용도                |
| ------------------- | --------- | ----------------- | ------------------- |
| `main`              | 초기 커밋 | —                 | 배포 기준           |
| `develop`           | `main`    | —                 | 개발 통합           |
| `feature/<name>`    | `develop` | `develop`         | 기능 개발·일반 수정 |
| `release/<version>` | `develop` | `main`, `develop` | 배포 준비           |
| `hotfix/<name>`     | `main`    | `main`, `develop` | 배포 버전 긴급 수정 |

브랜치 이름은 소문자 영문과 하이픈을 사용한다. 초기 구성 이후 `main`과 `develop`의 변경은 PR로 반영한다. Release와 hotfix는 `main` 병합 후 `develop`에도 반영하며, 배포 커밋에 `v<version>` 태그를 생성한다. 장기 브랜치의 강제 푸시는 사용하지 않는다.

```bash
git switch develop
git pull --ff-only origin develop
git switch -c feature/audio-upload
```

## 커밋

[Conventional Commits 1.0.0](https://www.conventionalcommits.org/ko/v1.0.0/)을 따른다.

```text
<type>[(scope)][!]: <description>
```

| 타입       | 용도                     |
| ---------- | ------------------------ |
| `feat`     | 기능 추가                |
| `fix`      | 오류 수정                |
| `refactor` | 동작 변경 없는 구조 개선 |
| `perf`     | 성능 개선                |
| `style`    | 코드 형식 변경           |
| `test`     | 테스트 추가·수정         |
| `docs`     | 문서 변경                |
| `build`    | 빌드·의존성 변경         |
| `ci`       | CI 설정 변경             |
| `chore`    | 기타 유지보수            |
| `revert`   | 변경 되돌림              |

설명은 변경 대상을 명시한 간결한 서술로 작성한다. 대화체, 감탄 표현, 작업 과정의 나열은 사용하지 않는다. 본문은 변경 이유나 호환성 정보가 필요한 경우에만 작성한다. 코드 주석은 동작만으로 드러나지 않는 제약이나 의도를 설명할 때 사용한다.

```text
chore: 프론트엔드 개발환경 구성
feat(upload): 음원 파일 업로드 기능 추가
fix(recording): 녹음 종료 후 마이크 해제
```

호환성을 깨는 변경은 `!` 또는 `BREAKING CHANGE:` 꼬리말로 표시한다. `npm ci` 실행 시 커밋 메시지 검사 훅이 설정된다. Git Flow 병합 커밋은 commitlint의 기본 예외 규칙을 적용한다.

## PR

- 제목은 Conventional Commits 형식을 사용한다.
- 변경 내용과 검증 결과를 작성한다.
- 요청 범위와 관련 없는 변경은 분리한다.
- 병합 전에 `npm run check`와 CI 통과를 확인한다.
- Release·hotfix의 양방향 반영은 merge commit으로 이력을 유지한다.
