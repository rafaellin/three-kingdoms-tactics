import { expect, test } from '@playwright/test'
import { gotoCampaign } from './helpers'

/**
 * 右侧武将/城池列表 e2e：RightPanel（Task 4）。
 * 流程全部程序化断言（window.__game.getState()）：
 * - 进战役 → 右侧面板列 3 武将（关羽/周仓/孙乾）+ 东岭小城；
 * - 点击周仓行 → selectedHeroId==='g-zhoucang'（选中高亮随行移动）；
 * - 点「下一个(h)」→ 切孙乾；按 h 键 → 循环回关羽；
 * - 点击城池行 → 打开城池面板。
 * 行/按钮坐标经 getDebugState().rightPanel 读取后点击（与 gotoBooted OK 按钮同模式）。
 * 截图仅供人工目检；断言一律程序化。
 */

interface RightPanelHeroRow {
  generalId: string
  name: string
  level: number
  armyCount: number
  selected: boolean
  x: number
  y: number
}

interface RightPanelTownRow {
  id: string
  name: string
  level: number
  x: number
  y: number
}

interface DebugGameState {
  ready?: boolean
  selectedHeroId?: string | null
  rightPanel?: {
    heroes?: RightPanelHeroRow[]
    towns?: RightPanelTownRow[]
    next?: { x: number; y: number; label: string } | null
  } | null
  townPanel?: { open: boolean } | null
}

type Page = import('@playwright/test').Page

const readState = (page: Page): Promise<DebugGameState> =>
  page.evaluate(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState() ?? {})

/** 等待选中英雄切换（dispatch hero/select 后断言） */
const waitSelected = async (page: Page, heroId: string): Promise<void> => {
  await page.waitForFunction(
    (h) => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.selectedHeroId === h,
    heroId
  )
}

test('右侧面板：武将列表点击切换 + 城池列表打开面板 + 下一个(h) 循环', async ({ page }) => {
  await gotoCampaign(page)

  // ① 右侧面板列出 3 武将（关羽/周仓/孙乾）+ 东岭小城；初始选中关羽
  let s = await readState(page)
  const heroRows = s.rightPanel?.heroes
  expect(heroRows).toHaveLength(3)
  expect(heroRows?.map((h) => h.name)).toEqual(['關羽', '周倉', '孫乾'])
  expect(heroRows?.find((h) => h.generalId === 'g-guan')?.selected).toBe(true)
  expect(s.selectedHeroId).toBe('g-guan')
  expect(s.rightPanel?.towns?.map((t) => `${t.name} Lv${t.level}`)).toEqual(['东岭小城 Lv1'])

  // ② 点击周仓行 → 选中切换到 g-zhoucang，选中高亮随行
  const zhou = heroRows!.find((h) => h.generalId === 'g-zhoucang')!
  expect(zhou).toBeDefined()
  await page.mouse.click(zhou.x, zhou.y)
  await waitSelected(page, 'g-zhoucang')
  s = await readState(page)
  expect(s.rightPanel?.heroes?.find((h) => h.generalId === 'g-zhoucang')?.selected).toBe(true)
  expect(s.rightPanel?.heroes?.find((h) => h.generalId === 'g-guan')?.selected).toBe(false)

  // ③ 点「下一个(h)」→ 孙乾（英雄序：关羽→周仓→孙乾→循环）
  const next = s.rightPanel?.next
  expect(next).toBeDefined()
  await page.mouse.click(next!.x, next!.y)
  await waitSelected(page, 'g-sunqian')
  s = await readState(page)

  // ④ 按 h 键 → 循环回关羽
  await page.keyboard.press('h')
  await waitSelected(page, 'g-guan')
  s = await readState(page)
  expect(s.rightPanel?.heroes?.find((h) => h.generalId === 'g-guan')?.selected).toBe(true)

  // ⑤ 点击城池行 → 打开城池面板
  const town = s.rightPanel?.towns?.find((t) => t.id === 't-dongling')
  expect(town).toBeDefined()
  await page.mouse.click(town!.x, town!.y)
  await page.waitForFunction(
    () => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.townPanel?.open === true
  )
  s = await readState(page)
  expect(s.townPanel?.open).toBe(true)

  // 截图交人工目检：右侧面板（3 武将选中关羽高亮 + 东岭小城 + 下一个(h) 按钮）+ 打开的城池面板
  await page.screenshot({ path: 'screenshots/right-panel.png' })
})
