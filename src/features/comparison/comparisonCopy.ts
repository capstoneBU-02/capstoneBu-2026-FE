import type {
  ComparisonFailure,
  ComparisonRegion,
  ComparisonRegionKind,
  ComparisonResult,
  ComparisonStageId,
  ComparisonStatus,
} from './model.ts'

// Copy describes what sounded different and never grades the take (COPY-04).

type Baseline = ComparisonResult['baseline']

interface TitledCopy {
  readonly title: string
  readonly description: string
}

interface FailureCopy extends TitledCopy {
  readonly canRetry: boolean
}

const stageLabels: Readonly<Record<ComparisonStageId, string>> = {
  align: '연주와 기준 음원을 맞추고 있어요',
  transcription: '연주한 음을 읽고 있어요',
  compare: '다르게 들리는 곳을 찾고 있어요',
}

const failureTitle = '비교를 끝내지 못했어요'
const nextTake = '다시 녹음하거나 다른 파일을 올려 주세요.'

export function baselineLabel(baseline: Baseline): string {
  return baseline === 'original-song' ? '원곡' : '올린 음원'
}

export function comparisonProgressLabel(
  status: Pick<ComparisonStatus, 'state' | 'currentStage'>,
): string {
  return status.currentStage === null
    ? '비교 순서를 기다리고 있어요'
    : stageLabels[status.currentStage]
}

// The server's reasons (B28). REFERENCE_LOW_CONFIDENCE is about the
// baseline's own notes, so it sends the player to another section rather
// than another take.
export function notComparableCopy(
  reason: string | null,
  baseline: Baseline,
): TitledCopy {
  const label = baselineLabel(baseline)
  const notLinedUp = `${label}과 맞춰 보지 못했어요`
  switch (reason) {
    case 'RERECORD_TOO_SHORT':
      return { title: notLinedUp, description: '연주가 구간보다 많이 짧아요.' }
    case 'RERECORD_TOO_LONG':
      return { title: notLinedUp, description: '연주가 구간보다 많이 길어요.' }
    case 'RERECORD_TOO_QUIET':
    case 'RERECORD_FEW_NOTES':
      return {
        title: '소리가 거의 녹음되지 않았어요',
        description: '입력 장치와 볼륨을 확인해 주세요.',
      }
    case 'LOW_MATCH_RATE':
      return {
        title: notLinedUp,
        description: '같은 구간을 연주했는지 확인해 주세요.',
      }
    case 'TEMPO_OUT_OF_RANGE':
      return {
        title: notLinedUp,
        description: `연주 빠르기가 ${label}과 많이 달라요.`,
      }
    case 'REFERENCE_LOW_CONFIDENCE':
      return {
        title: `${label}의 기타 음을 또렷하게 읽지 못했어요`,
        description: '연주 때문은 아니에요. 다른 구간을 골라 비교해 보세요.',
      }
    default:
      return { title: '이 연주는 비교하지 못했어요', description: nextTake }
  }
}

// Whatever the code, the wording must not blame accompaniment bleed.
export function unavailableRegionCopy(
  reason: string | null,
  baseline: Baseline,
): string {
  switch (reason) {
    case 'LOW_CONFIDENCE':
      return '소리가 또렷하지 않아 비교하지 못했어요'
    case 'UNCLEAR_ALIGNMENT':
      return `${baselineLabel(baseline)}과 위치를 맞추기 어려워 비교하지 못했어요`
    default:
      return '이 부분은 비교하지 못했어요'
  }
}

export function regionTagLabel(kind: ComparisonRegionKind): string {
  return kind === 'unavailable' ? '비교 못 함' : '다르게 들림'
}

export function comparisonFailureCopy(
  failure: ComparisonFailure | null,
): FailureCopy {
  const retry = failure?.retry ?? null
  if (retry === null) {
    return {
      title: failureTitle,
      description: `이 연주는 다시 시도할 수 없어요. ${nextTake}`,
      canRetry: false,
    }
  }
  if (retry.left > 0) {
    return {
      title: failureTitle,
      description: `다시 시도할 수 있어요. 남은 횟수 ${retry.left}회`,
      canRetry: true,
    }
  }
  return {
    title: failureTitle,
    description: `다시 시도할 수 있는 횟수를 모두 사용했어요. ${nextTake}`,
    canRetry: false,
  }
}

// Null when the differences themselves are the summary. Places left uncompared
// must not read as a clean result, so they get their own wording.
export function comparisonSummaryCopy(
  regions: readonly Pick<ComparisonRegion, 'kind'>[],
  baseline: Baseline,
): TitledCopy | null {
  if (regions.some((region) => region.kind !== 'unavailable')) return null
  if (regions.length === 0) {
    return {
      title: '다르게 들리는 곳이 없어요',
      description: `${baselineLabel(baseline)}과 번갈아 들으며 한 번 더 확인해 보세요.`,
    }
  }
  return {
    title: '비교하지 못한 곳이 있어요',
    description: `${regions.length}곳은 비교하지 못했어요. 나머지 부분에서는 다르게 들리는 곳을 찾지 못했어요.`,
  }
}

export function tempoNote(
  overallTempo: ComparisonResult['overallTempo'],
): string | null {
  return overallTempo?.isSlow ? '전체적으로 느린 연주예요' : null
}
