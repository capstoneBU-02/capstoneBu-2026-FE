import { useCallback } from 'react'
import type { SectionPlayback } from '../../player/useSectionPlayer.ts'
import { TabPanel } from '../../tab/TabPanel.tsx'
import { useTaskTab, type TaskTabSource } from '../useTaskTab.ts'

// The tab of a finished task, following the task's player. The player counts
// from where its track starts; the tab counts from the section start.
export function TaskTab({
  taskId,
  source,
  player,
  lead,
}: {
  taskId: string
  source: TaskTabSource
  player: SectionPlayback
  // Seconds from the section start to where the player counts from.
  lead: number
}) {
  const tab = useTaskTab(taskId, source)
  const { elapsed: playerElapsed, playing, subscribeSeek } = player
  const elapsed = useCallback(
    () => playerElapsed() + lead,
    [playerElapsed, lead],
  )
  return (
    <TabPanel
      tab={tab}
      playing={playing}
      elapsed={elapsed}
      subscribeSeek={subscribeSeek}
    />
  )
}
