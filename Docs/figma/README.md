# Earmark Figma 시안 보관

수집일: **2026-11-04 (Asia/Seoul)** · [Figma 원본 파일](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ) · 파일 키: `87W9ZPWGTWqNHX7HTfQ1kZ`

사용자가 지정한 **Earmark — 기타 카피 보조 서비스 디자인 v2** 파일의 현재 시안 스냅샷이다. 원본 표지는 **UI 디자인 v3 · 2026.10.28**로 표시되어 있으며 이 현재 내용을 그대로 수집했다. **기능 구현 완료나 확정 정책을 뜻하지 않는다.** PoC2 녹음·비교 및 미정 정책 문구도 원문 그대로 보관했다. 실제 FE 구현 범위는 저장소의 구현 문서와 PR에서 확인한다.

전체 4페이지의 최상위 노드 **42개(프레임 40개·컴포넌트 2개)**를 빠짐없이 저장했다. Figma 원본은 수정하지 않았으며 HTML로 재구현하거나 임의 시안을 생성하지 않았다.

## 페이지 목차

| 페이지                                  | 노드 ID | 보관 수 | 포함 범위                                                         |
| --------------------------------------- | ------- | ------: | ----------------------------------------------------------------- |
| [00 Cover](#page-00)                    | `0:1`   |       1 | 표지                                                              |
| [01 Foundations · Components](#page-01) | `2:2`   |       3 | 브랜드, 색상·타입·컴포넌트 보드, 사이드바                         |
| [02 PoC 1 — 카피 지원](#page-02)        | `2:3`   |      29 | 랜딩·코드·온보딩·작업 목록·업로드·구간·타브·오류·모달·설정·도움말 |
| [03 PoC 2 — 연주 확인](#page-03)        | `2:4`   |       9 | 녹음·권한·비교 패널 상태·연주 파일 업로드 변형                    |

표의 로컬 원본 링크를 열면 각 시안을 볼 수 있다. [manifest.json](manifest.json)은 각 파일의 출처·크기·포맷·수집 방법·시각·SHA-256을 담는다. [상태·토큰 보드 원문](board-text.md)에서 여러 변형이 한 이미지 안에 있는 보드의 문구를 검색할 수 있다.

## 보관 기준과 한계

- 페이지에 직접 놓인 42개 FRAME/COMPONENT가 모두 표시 상태였고 별도 export 설정은 없었다. 전체 노드를 포함했으며 제외된 최상위 시안과 최종 누락은 없다.
- 기본 화면뿐 아니라 오류·빈 상태·처리 중·완료·다운로드·파일 선택·모달·권한 및 비교 변형도 각 최상위 시안으로 포함했다.
- 코드 입력 상태(`34:986`), 비교 패널 상태(`33:130`), Foundations(`34:1651`)는 여러 상태와 토큰을 담은 보드 전체를 보관했다. 그 내부의 중복 레이어·아이콘·raw image는 별도 export하지 않았다.
- 시안은 원본 1배 export로 보관하며 축소 미리보기로 대체하지 않았다. Foundations PNG는 1600×3130px, 랜딩 PNG는 1440×3350px이다. 글자가 작게 보이면 원본을 열어 확대할 수 있다.
- 독립 업로드 모달 5개(`29:955`, `29:992`, `81:2258`, `90:4048`, `90:4085`)는 공식 export의 그림자 여백이 포함되어 PNG 폭·높이가 노드보다 각각 80px 크다. 이를 자르지 않고 원본 export 그대로 보존했다. 나머지 37개는 노드와 PNG 크기가 일치한다. manifest는 노드 크기와 실제 export 크기를 분리한다.
- 이 파일에서 발견한 최상위 시안 중 별도 모바일 시안은 없었다. 보관 이미지에는 실제 앱의 반응형 구현이나 화면 동작을 덧붙이지 않았다.
- 정적 시각 자료의 보관이므로 편집 가능한 `.fig` 파일, 실제 프로토타입 실행, Figma 변수 API 전체, 댓글·버전 이력을 복제하지 않는다.
- `exportedAt`은 도구 응답 수신·수집 시점의 UTC 기록이다. 임시 다운로드 URL·인증 토큰은 보관 문서와 manifest에 넣지 않았다.

## 수집 방법과 검증

공식 Figma connector로 페이지·최상위 노드·크기를 읽었다. `download_assets`로 36개를 저장했고, 내부 오류가 반복된 6개는 공식 `get_screenshot` 2개와 읽기 전용 `use_figma`의 `node.screenshot({ scale: 1, contentsOnly: true })` 4개로 복구했다. 노드별 실제 방법·포맷·배율은 manifest에 기록했다. 대체 과정에서도 디자인을 수정하거나 시안을 다시 그리지 않았다.

42개 모두 PNG 시그니처·IHDR의 실제 크기·파일 SHA-256을 검증했다. 위 효과 여백 5개를 포함해 원본 노드와 대응시켰고, 42개 노드 ID와 로컬 파일 경로는 각각 고유하며 manifest와 1:1로 대응한다.

### 수집 형식

- PNG: 42개

<a id="page-00"></a>

## 00 Cover

페이지: [0:1](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=0-1) · 수집일: 2026-11-04 · 1개

| 시안 이름 | 노드 ID / 원본                                                                 | 크기(px)  | 로컬 원본                          |
| --------- | ------------------------------------------------------------------------------ | --------- | ---------------------------------- |
| Cover     | [`35:100`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=35-100) | 1920×1080 | [PNG](exports/00-cover/35-100.png) |

<a id="page-01"></a>

## 01 Foundations · Components

페이지: [2:2](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=2-2) · 수집일: 2026-11-04 · 3개

| 시안 이름   | 노드 ID / 원본                                                                   | 크기(px)  | 로컬 원본                                            |
| ----------- | -------------------------------------------------------------------------------- | --------- | ---------------------------------------------------- |
| App/Sidebar | [`39:66`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=39-66)     | 248×900   | [PNG](exports/01-foundations-components/39-66.png)   |
| brand/logo  | [`3:177`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=3-177)     | 99×22     | [PNG](exports/01-foundations-components/3-177.png)   |
| Foundations | [`34:1651`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=34-1651) | 1600×3130 | [PNG](exports/01-foundations-components/34-1651.png) |

<a id="page-02"></a>

## 02 PoC 1 — 카피 지원

페이지: [2:3](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=2-3) · 수집일: 2026-11-04 · 29개

| 시안 이름                              | 노드 ID / 원본                                                                   | 크기(px)              | 로컬 원본                          |
| -------------------------------------- | -------------------------------------------------------------------------------- | --------------------- | ---------------------------------- |
| P1-01 랜딩                             | [`34:312`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=34-312)   | 1440×3350             | [PNG](exports/02-poc1/34-312.png)  |
| P1-01b 코드 입력 상태                  | [`34:986`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=34-986)   | 1729×201              | [PNG](exports/02-poc1/34-986.png)  |
| P1-01c 처음 들어왔을 때 · 이용 안내    | [`75:1215`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=75-1215) | 1440×900              | [PNG](exports/02-poc1/75-1215.png) |
| P1-01d 처음 들어왔을 때 · AI 학습 활용 | [`75:1279`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=75-1279) | 1440×900              | [PNG](exports/02-poc1/75-1279.png) |
| P1-02 내 작업                          | [`29:139`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=29-139)   | 1440×900              | [PNG](exports/02-poc1/29-139.png)  |
| P1-02b 내 작업 · 비어 있음             | [`29:511`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=29-511)   | 1440×900              | [PNG](exports/02-poc1/29-511.png)  |
| P1-02c 내 작업 · AI 학습 활용 선택     | [`75:1329`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=75-1329) | 1440×900              | [PNG](exports/02-poc1/75-1329.png) |
| P1-03 곡 추가                          | [`29:812`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=29-812)   | 1440×900              | [PNG](exports/02-poc1/29-812.png)  |
| P1-03b 곡 추가 · 파일 선택됨           | [`29:955`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=29-955)   | 520×285 (PNG 600×365) | [PNG](exports/02-poc1/29-955.png)  |
| P1-03c 곡 추가 · 파일 오류             | [`29:992`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=29-992)   | 520×319 (PNG 600×399) | [PNG](exports/02-poc1/29-992.png)  |
| P1-03d 곡 추가 · 형식 오류             | [`81:2258`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=81-2258) | 520×319 (PNG 600×399) | [PNG](exports/02-poc1/81-2258.png) |
| P1-04 새 구간                          | [`30:273`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=30-273)   | 1440×900              | [PNG](exports/02-poc1/30-273.png)  |
| P1-04b 새 구간 · 길이 초과             | [`81:1378`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=81-1378) | 1440×900              | [PNG](exports/02-poc1/81-1378.png) |
| P1-04c 새 구간 · 시간 입력 오류        | [`81:1627`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=81-1627) | 1440×900              | [PNG](exports/02-poc1/81-1627.png) |
| P1-04d 구간 수정                       | [`81:1874`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=81-1874) | 1440×900              | [PNG](exports/02-poc1/81-1874.png) |
| P1-04e 새 구간 · 파일 바꾸기 확인      | [`81:2121`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=81-2121) | 1440×900              | [PNG](exports/02-poc1/81-2121.png) |
| P1-05 작업 공간 · 처리 중              | [`27:49`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=27-49)     | 1440×900              | [PNG](exports/02-poc1/27-49.png)   |
| P1-05b 작업 공간 · 대기 중             | [`84:3197`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=84-3197) | 1440×900              | [PNG](exports/02-poc1/84-3197.png) |
| P1-06 작업 공간 · 타브                 | [`25:2`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=25-2)       | 1440×900              | [PNG](exports/02-poc1/25-2.png)    |
| P1-06b 작업 공간 · 카피 완료           | [`84:1867`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=84-1867) | 1440×900              | [PNG](exports/02-poc1/84-1867.png) |
| P1-06c 작업 공간 · 내려받기            | [`84:2226`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=84-2226) | 1440×900              | [PNG](exports/02-poc1/84-2226.png) |
| P1-06d 작업 공간 · 재생 실패           | [`84:2598`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=84-2598) | 1440×900              | [PNG](exports/02-poc1/84-2598.png) |
| P1-06e 작업 공간 · 내려받기 실패       | [`84:2952`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=84-2952) | 1440×900              | [PNG](exports/02-poc1/84-2952.png) |
| P1-07 작업 공간 · 타브 실패            | [`27:398`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=27-398)   | 1440×900              | [PNG](exports/02-poc1/27-398.png)  |
| P1-07b 작업 공간 · 기타를 찾지 못함    | [`84:3389`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=84-3389) | 1440×900              | [PNG](exports/02-poc1/84-3389.png) |
| P1-07c 작업 공간 · 다시 시도 횟수 소진 | [`84:3778`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=84-3778) | 1440×900              | [PNG](exports/02-poc1/84-3778.png) |
| P1-08 작업을 찾을 수 없음              | [`86:2698`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=86-2698) | 1440×900              | [PNG](exports/02-poc1/86-2698.png) |
| P1-09 설정                             | [`86:2926`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=86-2926) | 1440×900              | [PNG](exports/02-poc1/86-2926.png) |
| P1-09b 도움말                          | [`86:3169`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=86-3169) | 1440×900              | [PNG](exports/02-poc1/86-3169.png) |

<a id="page-03"></a>

## 03 PoC 2 — 연주 확인

페이지: [2:4](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=2-4) · 수집일: 2026-11-04 · 9개

| 시안 이름                               | 노드 ID / 원본                                                                   | 크기(px)              | 로컬 원본                          |
| --------------------------------------- | -------------------------------------------------------------------------------- | --------------------- | ---------------------------------- |
| P2-01 녹음                              | [`31:2`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=31-2)       | 1440×900              | [PNG](exports/03-poc2/31-2.png)    |
| P2-01b 마이크 권한 없음                 | [`31:371`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=31-371)   | 1192×126              | [PNG](exports/03-poc2/31-371.png)  |
| P2-01c 녹음 준비                        | [`31:393`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=31-393)   | 1192×126              | [PNG](exports/03-poc2/31-393.png)  |
| P2-02 비교                              | [`32:66`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=32-66)     | 1440×900              | [PNG](exports/03-poc2/32-66.png)   |
| P2-02b 비교 · 올린 음원 기준            | [`90:4125`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=90-4125) | 1440×900              | [PNG](exports/03-poc2/90-4125.png) |
| P2-03 비교 패널 상태                    | [`33:130`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=33-130)   | 1416×224              | [PNG](exports/03-poc2/33-130.png)  |
| P2-04 연주 파일 올리기                  | [`90:3616`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=90-3616) | 1440×900              | [PNG](exports/03-poc2/90-3616.png) |
| P2-04b 연주 파일 올리기 · 파일 선택됨   | [`90:4048`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=90-4048) | 520×235 (PNG 600×315) | [PNG](exports/03-poc2/90-4048.png) |
| P2-04c 연주 파일 올리기 · 구간보다 짧음 | [`90:4085`](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=90-4085) | 520×269 (PNG 600×349) | [PNG](exports/03-poc2/90-4085.png) |
