import { useCallback, type Ref } from 'react'
import type { SectionPlayback } from '../../player/useSectionPlayer.ts'
import { TabPanel, type TabSource } from '../../tab/TabPanel.tsx'

// The tab of a finished task, following the task's player. The player counts
// from where its track starts; the tab counts from the section start.
export function TaskTab({
  tab,
  svgRef,
  player,
  lead,
}: {
  tab: TabSource
  // The drawn tab, for the PNG download.
  svgRef: Ref<SVGSVGElement>
  player: SectionPlayback
  // Seconds from the section start to where the player counts from.
  lead: number
}) {
  const { elapsed: playerElapsed, playing, subscribeSeek } = player
  const elapsed = useCallback(
    () => playerElapsed() + lead,
    [playerElapsed, lead],
  )
  return (
    <TabPanel
      tab={tab}
      svgRef={svgRef}
      playing={playing}
      elapsed={elapsed}
      subscribeSeek={subscribeSeek}
    />
  )
}
