import { expect, test } from '@playwright/test'
import { gotoCampaign } from './helpers'

/**
 * 右侧武将/城池列表 e2e：RightPanel（Task 4 + Task 3）。
 * 流程全部程序化断言（window.__game.getState()）：
 * - 进战役 → 右侧面板列 3 武将（关羽/周仓/孙乾）+ 东岭小城；
 * - 武将行 label 不含误导数字（`關羽 Lv5` 而非 `關羽 Lv5 32`，armyCount 兵力总数去掉）；
 * - 点击周仓行 → selectedHeroId==='g-zhoucang'（选中高亮随行移动）；
 * - 点「下一个(h)」→ 切孙乾；按 h 键 → 循环回关羽；
 * - 右侧「结束回合」按钮存在 → 点击 → turn+1（dispatch game/advanceTurn）；
 * - 点击城池行 → 打开城池面板。
 * 行/按钮坐标经 getDebugState().rightPanel 读取后点击（与 gotoBooted OK 按钮同模式）。
 * 截图仅供人工目检；断言一律程序化。
 */

interface RightPanelHeroRow {
  generalId: string
  name: string
  level: number
  /** 行显示 label（`關羽 Lv5`；Task 3 去掉 armyCount → 不含误导数字） */
  label: string
  /** 兵力总数（debug 兼容保留；不在行 label 中显示） */
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
  turn?: number
  selectedHeroId?: string | null
  rightPanel?: {
    heroes?: RightPanelHeroRow[]
    towns?: RightPanelTownRow[]
    next?: { x: number; y: number; label: string } | null
    endTurn?: { x: number; y: number; label: string } | null
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

  // ①′ 武将行 label 不含误导数字（Task 3：去掉 armyCount 兵力总数；`關羽 Lv5` 而非 `關羽 Lv5 32`）
  for (const h of heroRows!) {
    expect(h.label).toBe(`${h.name} Lv${h.level}`)
  }
  expect(heroRows!.find((h) => h.generalId === 'g-guan')!.label).toBe('關羽 Lv5')
  // armyCount 仍在 debug 暴露（e2e 兼容保留，仅显示去掉）
  expect(heroRows!.every((h) => h.armyCount > 0)).toBe(true)

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

  // ⑤ 右侧「结束回合」按钮存在 → 点击 → turn+1（dispatch game/advanceTurn；按钮在「下一个(h)」下方）
  const endTurn = s.rightPanel?.endTurn
  expect(endTurn).toBeDefined()
  expect(endTurn!.label).toBe('结束回合 [E]')
  // 在「下一个」按钮下方（y 更大）——移位自右下角到右侧面板
  expect(endTurn!.y).toBeGreaterThan(s.rightPanel!.next!.y)
  const turnBefore = s.turn
  expect(turnBefore).toBeDefined()
  await page.mouse.click(endTurn!.x, endTurn!.y)
  // 战役：p1（human）→ ai1（AI 自动行动 no-op）→ 回 p1 跨圈 → turn+1
  await page.waitForFunction(
    (t) => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.turn === t,
    (turnBefore ?? 0) + 1
  )
  s = await readState(page)
  expect(s.turn).toBe((turnBefore ?? 0) + 1)

  // ⑥ 点击城池行 → 打开城池面板
  const town = s.rightPanel?.towns?.find((t) => t.id === 't-dongling')
  expect(town).toBeDefined()
  await page.mouse.click(town!.x, town!.y)
  await page.waitForFunction(
    () => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.townPanel?.open === true
  )
  s = await readState(page)
  expect(s.townPanel?.open).toBe(true)

  // 截图交人工目检：右侧面板（3 武将选中关羽高亮 + 东岭小城 + 下一个(h)/结束回合 按钮）+ 打开的城池面板
  await page.screenshot({ path: 'screenshots/right-panel.png' })
})
