export type TaskView = 'tab' | 'comparison'

export function taskViewTabId(baseId: string, view: TaskView) {
  return `${baseId}-${view}-tab`
}

export function taskViewPanelId(baseId: string, view: TaskView) {
  return `${baseId}-${view}-panel`
}
