import { readObject, type ObjectReader } from '../../api/guards.ts'
import { updatedAtLabel } from '../workspace/format.ts'
import type {
  PerformanceListResponse,
  PerformanceResponse,
  PerformanceSourceCode,
} from './apiTypes.ts'
import type { PerformanceSource, SavedPerformance } from './model.ts'

const SOURCE_CODES = ['RECORDING', 'UPLOAD'] as const

const SOURCES: Readonly<Record<PerformanceSourceCode, PerformanceSource>> = {
  RECORDING: 'recording',
  UPLOAD: 'upload',
}

export function sourceCodeOf(source: PerformanceSource): PerformanceSourceCode {
  return source === 'recording' ? 'RECORDING' : 'UPLOAD'
}

function readPerformanceFields(item: ObjectReader): PerformanceResponse {
  return {
    performance_id: item.integer('performance_id'),
    source: item.oneOf('source', SOURCE_CODES),
    start_ms: item.integer('start_ms'),
    end_ms: item.integer('end_ms'),
    created_at: item.string('created_at'),
  }
}

export function readPerformanceCreate(data: unknown): PerformanceResponse {
  return readPerformanceFields(readObject(data))
}

export function readPerformanceList(data: unknown): PerformanceListResponse {
  return {
    performances: readObject(data).array('performances', (value, path) =>
      readPerformanceFields(readObject(value, path)),
    ),
  }
}

// Seconds, as on every other screen, and the save time worded as the task
// list words its change time. The server reports no length: only a take
// saved from this page has one. The latest comparison stays null until the
// server lists one with the take.
export function toSavedPerformance(
  performance: PerformanceResponse,
  {
    taskId,
    durationSeconds,
    now,
  }: { taskId: string; durationSeconds: number | null; now: Date },
): SavedPerformance {
  return {
    id: String(performance.performance_id),
    taskId,
    source: SOURCES[performance.source],
    rangeStartSeconds: performance.start_ms / 1000,
    rangeEndSeconds: performance.end_ms / 1000,
    createdAtLabel: updatedAtLabel(performance.created_at, now),
    durationSeconds,
    latestComparison: null,
  }
}
