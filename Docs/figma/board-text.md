# 상태·토큰 보드 원문

수집일: 2026-11-04 · [전체 시안 목차](README.md)

여러 상태나 디자인 토큰이 한 이미지에 포함된 3개 보드의 TEXT 레이어 문자열을 읽기 전용으로 추출했다. 아래 문자열은 원문이며 오탈자·예시 코드·임시 정책을 고치지 않았다. 섹션은 원본 자식 노드 순서로 나열했고, 시각적 배치는 각 PNG가 기준이다. 구현 완료나 정책 확정을 의미하지 않는다.

## Foundations

[Figma 원본 34:1651](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=34-1651) · [전체 PNG](exports/01-foundations-components/34-1651.png)

### 1. Frame · 34:1652

[원본 섹션](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=34-1652)

```text
earmark
Foundations
```

### 2. Frame · 34:1663

[원본 섹션](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=34-1663)

```text
Color
Surface
surface/canvas
#F6F5F2
surface/default
#FFFFFF
surface/subtle
#EFEEEA
Border
border/default
#E0DDD6
border/strong
#C9C5BC
Ink
ink/primary
#141412
ink/secondary
#4D4B46
ink/tertiary
#75726B
ink/inverse
#FFFFFF
Console
console/base
#161614
console/raised
#22211E
console/line
#3A3834
console/text
#F2F1EC
console/muted
#A3A098
Accent
accent/default
#FF5A1F
accent/strong
#D9470E
accent/soft
#FFE9DF
Marker
marker/diff
#FFEA9B
marker/diff-soft
#FFF3C8
marker/skip
#96938C
marker/skip-soft
#EDEBE6
State
state/done
#1F8A4C
state/done-soft
#E1F2E7
state/alert
#D7322A
state/alert-soft
#FBE3E1
```

### 3. Frame · 34:1780

[원본 섹션](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=34-1780)

```text
Type
Display/XL
Noto Sans KR Bold 72/84
구간별 분리와 타브
Display/L
Noto Sans KR Bold 48/60
시간으로 짚어 줘요
Heading/H1
Noto Sans KR Bold 28/38
지원 범위
Heading/H2
Noto Sans KR Bold 20/28
벌스 1
Heading/H3
Noto Sans KR Medium 16/24
구간만 처리해요
Body/L
Noto Sans KR Regular 18/30
막힌 구간을 고르면 그 부분의 기타만 분리해 타브로 옮겨 드려요.
Body/M
Noto Sans KR Regular 14/22
분리된 기타 소리와 타브를 한 화면에서 반복해서 들어요.
Body/S
Noto Sans KR Regular 13/20
창을 닫아도 계속 진행돼요.
Label/M
Noto Sans KR Medium 13/18
타브 만들기
Label/S
Noto Sans KR Medium 12/16
다르게 들림
Mono/Display
JetBrains Mono Medium 24/28
00:06.1
Mono/Data
JetBrains Mono Regular 12/16
00:42.1–01:05.8
Mono/Tab
JetBrains Mono Bold 13/16
0 2 2 0 3 5 5 3
Mono/Label
JetBrains Mono Medium 12/16
00:44
```

### 4. Frame · 34:1853

[원본 섹션](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=34-1853)

```text
Components
Button
버튼
버튼
버튼
버튼
버튼
버튼
버튼
버튼
버튼
버튼
Status
완료
진행 중
일부 완료
실패
대기
Tag
E 표준
리듬 기타
초안
다르게 들림
비교 못 함
벌스 1
Field
테스터 코드
EM-7Q2K-91XD
운영진에게 받은 코드
테스터 코드
EM-7Q2K-91XD
운영진에게 받은 코드
테스터 코드
EM-7Q2K-91XD
코드를 다시 확인해 주세요
Icon
```

## P1-01b 코드 입력 상태

[Figma 원본 34:986](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=34-986) · [전체 PNG](exports/02-poc1/34-986.png)

### 1. Frame · 34:987

[원본 섹션](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=34-987)

```text
EM-7Q2K-9IXD
시작하기
코드를 찾을 수 없어요. 숫자 1과 영문 I를 확인해 주세요.
```

### 2. Frame · 34:997

[원본 섹션](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=34-997)

```text
오랫동안 사용하지 않아 연결이 끊겼어요. 코드를 다시 입력해 주세요.
EM-
시작하기
베타 테스터 전용이에요. 코드는 운영진이 개별로 보내 드려요.
```

### 3. Frame · 34:1009

[원본 섹션](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=34-1009)

```text
EM-7Q2K-9IXD
시작하기
사용이 중지된 코드예요. 운영진에게 문의해 주세요.
```

### 4. Frame · 75:1435

[원본 섹션](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=75-1435)

```text
EM-7Q2K-9IXD
시작하기
코드를 여러 번 잘못 입력했어요. 잠시 후 다시 입력해 주세요.
```

## P2-03 비교 패널 상태

[Figma 원본 33:130](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=33-130) · [전체 PNG](exports/03-poc2/33-130.png)

### 1. Frame · 33:131

[원본 섹션](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=33-131)

```text
비교하는 중
녹음 #3 · 72%
```

### 2. Frame · 33:147

[원본 섹션](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=33-147)

```text
다르게 들리는 곳이 없어요
원곡과 번갈아 들으며 한 번 더 확인해 보세요.
번갈아 듣기
```

### 3. Frame · 33:161

[원본 섹션](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=33-161)

```text
원곡과 맞춰 보지 못했어요
녹음이 구간보다 많이 짧아요.
녹음 00:08.2 · 구간 00:23.7
다시 녹음
```

### 4. Frame · 33:174

[원본 섹션](https://www.figma.com/design/87W9ZPWGTWqNHX7HTfQ1kZ?node-id=33-174)

```text
소리가 거의 녹음되지 않았어요
입력 장치와 볼륨을 확인해 주세요.
다시 녹음
```
