# 기여 규칙

## 이슈에서 PR까지

1. 구현 전에 기능 구현 또는 버그 리포트 양식으로 이슈를 등록한다. 작업 범위, 완료 조건, 참고 Figma·기능 ID와 선행 결정을 적는다.
2. 이슈 번호가 포함된 작업 브랜치를 만든다. 일반 기능·버그 수정은 `develop`에서 분기하고, 운영 배포의 긴급 수정만 `main`에서 hotfix로 분기한다.
3. 작은 검증 가능한 단위로 구현하고 `npm run check`를 실행한다.
4. 아래 GitFlow 표에 맞는 대상 브랜치로 PR을 열고 관련 이슈, 변경 사항, 검증 결과를 작성한다. `develop` 대상 PR에는 `Refs #번호`를 적고, 필요하면 Development에서 이슈와 PR을 수동 연결한다.
5. 리뷰와 CI 통과 후 병합하고, 담당자가 완료 조건을 확인해 이슈를 닫는다. Release·hotfix는 `develop` 반영까지 추적한다.

기본 브랜치는 `main`이므로 `develop` 대상 PR의 `Closes #번호`만으로는 이슈가 자동 종료되지 않는다. `main` 대상 PR에서 이슈를 최종 완료할 때는 `Closes #번호`로 병합 시 자동 종료할 수 있다.

이슈·PR 양식은 `mio` 프로젝트의 구조를 바탕으로 FE 화면, API/목업, 브라우저 검증에 맞췄다. 저장소에 존재하는 라벨에 맞춰 기능 이슈에는 `enhancement`, 버그에는 `bug`를 붙인다.

## 브랜치

| 브랜치                   | 기준      | 병합 대상         | 용도                |
| ------------------------ | --------- | ----------------- | ------------------- |
| `main`                   | 초기 커밋 | —                 | 배포 기준           |
| `develop`                | `main`    | —                 | 개발 통합           |
| `feature/<issue>-<name>` | `develop` | `develop`         | 기능 개발·일반 수정 |
| `release/<version>`      | `develop` | `main`, `develop` | 배포 준비           |
| `hotfix/<issue>-<name>`  | `main`    | `main`, `develop` | 배포 버전 긴급 수정 |

작업 브랜치 이름은 이슈 번호, 소문자 영문과 하이픈을 사용한다. 초기 구성 이후 `main`과 `develop`의 변경은 PR로 반영한다. Release와 hotfix는 `main` 병합 후 `develop`에도 반영하며, 배포 커밋에 `v<version>` 태그를 생성한다. 장기 브랜치의 강제 푸시는 사용하지 않는다.

```bash
git switch develop
git pull --ff-only origin develop
git switch -c feature/42-audio-upload
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
- PR 양식에 관련 이슈, 변경 사항, 영향 범위와 검증 결과를 작성한다.
- 화면 변경은 브라우저·화면 크기·키보드 조작 결과를 남긴다. 목업 확인과 실제 API 통합 확인을 구분한다.
- 요청 범위와 관련 없는 변경은 분리한다.
- 병합 전에 `npm run check`와 CI 통과를 확인한다.
- Release·hotfix의 양방향 반영은 merge commit으로 이력을 유지한다.

## CI와 빌드 결과

GitHub Actions의 `CI`는 push, `main`·`develop`·`release/**` 대상 PR, 수동 실행을 지원한다. `.nvmrc`의 Node 버전으로 `npm ci`, `npm run check`, Conventional Commits 검사를 실행한다. `check`에 포함된 검사가 실패하면 빌드 결과를 업로드하지 않는다.

모든 검사가 성공하면 `dist/`를 `frontend-dist-<commit SHA>` artifact로 7일 보관한다. `dist/`가 없으면 업로드 단계가 실패한다. Actions 실행의 artifact에서 내려받아 결과를 확인할 수 있으며, artifact 업로드는 사이트 배포가 아니다.

이번 범위는 CI까지다. CD는 배포 대상이 결정된 뒤 별도 이슈로 진행한다. Vercel은 검토 중인 후보이며 이번에는 CD 워크플로·배포 토큰·자동 배포를 추가하지 않는다.
