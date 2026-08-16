import { expect, test } from '@playwright/test'
import { gotoAdventure, gotoCampaign } from './helpers'

interface DebugState {
  ready?: boolean
  scene?: string
  mode?: string | null
  campaignId?: string | null
  heroes?: { generalId: string; faction: string; position: { q: number; r: number } }[]
  garrisons?: {
    id: string
    generalId: string
    name?: string
    label?: string
    position: { q: number; r: number }
    alive: boolean
  }[]
  neutrals?: { id: string; position: { q: number; r: number }; defeated: boolean }[]
}

const readState = (page: import('@playwright/test').Page): Promise<DebugState> =>
  page.evaluate(() => (window as { __game?: { getState(): DebugState } }).__game?.getState() ?? {})

/**
 * 战役地图 e2e：AdventureScene 读 CAMPAIGNS['dongling'] 配置。
 * - 开始战役（campaign mode）→ 3 英雄 + 1 守将（孔秀 @ 窄路 (0,1)）+ 2 组杂兵 + 胜利条件；
 * - 探索测试（explore mode）→ 同读东岭关配置，但不放守将（自由探索，杂兵仍在）。
 * 断言一律程序化（window.__game.getState()），不依赖看截图。
 */
test('战役模式：读东岭关配置，3 英雄 + 1 守将 + 2 杂兵，守将格存在（非随机地图）', async ({ page }) => {
  await gotoCampaign(page)
  const s = await readState(page)
  expect(s.mode).toBe('campaign')
  expect(s.campaignId).toBe('dongling')

  // 多英雄：关羽/周仓/孙乾 各一英雄（与战役 heroStarts 一致）
  expect(s.heroes?.map((h) => h.generalId).sort()).toEqual(['g-guan', 'g-sunqian', 'g-zhoucang'])
  expect(s.heroes?.every((h) => h.faction === 'shu')).toBe(true)

  // 守将：孔秀 1 个，位于窄路关卡 (0,1)（地图非随机 → 守将格存在）
  expect(s.garrisons).toHaveLength(1)
  const garrison = s.garrisons![0]!
  expect(garrison.alive).toBe(true)
  expect(garrison.generalId).toBe('g-kongxiu')
  expect(garrison.position).toEqual({ q: 0, r: 1 })
  // 守将格渲染姓氏大字：孔秀 → 白字「孔」（替代原金色旗标 + 12px 名字标签）
  expect(garrison.name).toBe('孔秀')
  expect(garrison.label).toBe('孔')

  // 杂兵：2 组（练级用），开局未歼灭
  expect(s.neutrals).toHaveLength(2)
  expect(s.neutrals?.every((n) => !n.defeated)).toBe(true)

  // 截图交人工目检：多英雄六角格边框 + 格内姓氏大字（选中关羽金字「關」/周仓孙乾浅字）、
  // 孔秀红城寨格 + 白字「孔」、两组深绿杂兵格 + 兵力数、东岭小城、窄路山封锁
  await page.screenshot({ path: 'screenshots/campaign-dongling.png' })
})

test('探索模式：同样读东岭关配置，但 explore 不放置守将（杂兵仍在）', async ({ page }) => {
  await gotoAdventure(page)
  const s = await readState(page)
  expect(s.mode).toBe('explore')
  expect(s.campaignId).toBe('dongling')
  // 探索测试也走 campaign/start explore → 多英雄 + 杂兵；守将为 []（explore 不放置）
  expect(s.heroes).toHaveLength(3)
  expect(s.garrisons).toHaveLength(0)
  expect(s.neutrals).toHaveLength(2)
})
