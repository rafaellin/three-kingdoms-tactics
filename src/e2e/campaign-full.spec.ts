import { expect, test, type Page } from '@playwright/test'
import { gotoCampaign } from './helpers'

/**
 * 战役全流程闭环 e2e（Task 9）：开始战役 → 打杂兵练级 → 挑战孔秀 → 胜利面板 → 返回主菜单。
 *
 * 已知 MVP 缺口（Task 8 文档化）：每次战斗返回都会重建 Adventure（世界状态重置，仅
 * `campaign/resolveBattle` 写回持久化——杂兵 defeated / 守将 alive / 经验 / outcome）。
 * 流程因此线性可重走：清一个杂兵 → 挑战孔秀 → 胜利。测试容忍重建（每次返回后重新读坐标再点）。
 *
 * 断言一律程序化（window.__game.getState()），不依赖看截图；截图仅供人工目检。
 */
interface DebugGameState {
  ready?: boolean
  scene?: string
  mode?: string | null
  campaignId?: string | null
  outcome?: string | null
  victoryPanel?: { shown?: boolean; open?: boolean }
  heroes?: { generalId: string; position: { q: number; r: number } }[]
  garrisons?: { id: string; generalId: string; position: { q: number; r: number }; alive: boolean; screen?: { x: number; y: number } }[]
  neutrals?: { id: string; position: { q: number; r: number }; defeated: boolean; screen?: { x: number; y: number } }[]
  generals?: { id: string; name: string; level: number; xp: number }[]
  // battle 状态
  phase?: string
  general?: { player?: { name?: string }; enemy?: { name?: string } }
  actionButtons?: Record<string, { x: number; y: number }>
  result?: { button?: { bounds?: { x: number; y: number; width: number; height: number } } }
}

const readState = (page: Page): Promise<DebugGameState> =>
  page.evaluate(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState() ?? {})

const waitBattleReady = (page: Page) =>
  page.waitForFunction(() => {
    const s = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return s?.ready === true && s?.scene === 'battle' && s?.phase === 'combat'
  })

const waitAdventure = (page: Page) =>
  page.waitForFunction(() => {
    const s = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return s?.ready === true && s?.scene === 'adventure'
  })

const waitMenu = (page: Page) =>
  page.waitForFunction(() => {
    const s = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return s?.ready === true && s?.scene === 'menu'
  })

/** 点底部行动条按钮（坐标从 debug state 读） */
const clickAction = async (page: Page, key: string): Promise<void> => {
  const ab = (await readState(page)).actionButtons!
  const c = ab[key]!
  await page.mouse.click(c.x, c.y)
}

/** 点结算返回按钮（从 debug state 读渲染盒中心） */
const clickReturn = async (page: Page): Promise<void> => {
  const s = await readState(page)
  const b = s.result?.button?.bounds
  expect(b, '结算返回按钮应存在').toBeDefined()
  await page.mouse.click(b!.x + b!.width / 2, b!.y + b!.height / 2)
}

/** defend 循环直到战斗终态（won/lost）；返回终态 phase */
const defendToEnd = async (page: Page): Promise<string> => {
  let guard = 0
  let s = await readState(page)
  while (s.phase === 'combat' && guard++ < 200) {
    await clickAction(page, 'defend')
    await page.waitForTimeout(80)
    s = await readState(page)
  }
  return s.phase ?? 'unknown'
}

/**
 * 胜利面板「返回主菜单」按钮中心（openModal 居中面板：cx=cam.width/2、cy=cam.height/2，
 * 单按钮在 cy+80；1920×1080 视口 → (960, 620)）。
 */
const VICTORY_RETURN_BTN = { x: 960, y: 620 }

test('战役全流程：清杂兵练级 → 挑战孔秀 → 胜利面板 → 返回主菜单', async ({ page }) => {
  await gotoCampaign(page)
  await page.evaluate(() => (window as { __game?: { setAnimationSpeed(n: number): void } }).__game?.setAnimationSpeed(0))

  // 开局断言：东岭关战役、3 英雄、1 存活守将、2 组杂兵、无胜负
  let s = await readState(page)
  expect(s.mode).toBe('campaign')
  expect(s.campaignId).toBe('dongling')
  expect(s.heroes).toHaveLength(3)
  expect(s.garrisons!.filter((g) => g.alive)).toHaveLength(1)
  expect(s.neutrals!.filter((n) => !n.defeated)).toHaveLength(2)
  expect(s.outcome).toBeNull()

  // ---- 1. 清杂兵练级：点 neu-1 → Battle（敌方=野怪）→ defend 取胜 → 返回 → 杂兵被歼 + 关羽经验 > 0 ----
  const guanXpBefore = s.generals!.find((g) => g.id === 'g-guan')!.xp
  const neu1 = s.neutrals!.find((n) => n.id === 'neu-1')!
  expect(neu1.defeated).toBe(false)
  await page.mouse.click(neu1.screen!.x, neu1.screen!.y)
  await waitBattleReady(page)
  s = await readState(page)
  expect(s.general?.enemy?.name).toBe('野怪')
  const phaseNeutral = await defendToEnd(page)
  expect(phaseNeutral).toBe('won')
  await clickReturn(page)
  await waitAdventure(page)

  // 返回后（世界状态重建，resolveBattle 写回）：杂兵被歼 + 关羽经验增加
  s = await readState(page)
  expect(s.neutrals!.find((n) => n.id === 'neu-1')!.defeated).toBe(true)
  expect(s.generals!.find((g) => g.id === 'g-guan')!.xp).toBeGreaterThan(guanXpBefore)
  await page.screenshot({ path: 'screenshots/campaign-full-after-neutral.png' })

  // ---- 2. 挑战孔秀：点守将格 → Battle（敌方=孔秀）→ 小阵容确保必胜 → 返回 ----
  const garrison = s.garrisons!.find((g) => g.id === 'gar-kongxiu')!
  expect(garrison.alive).toBe(true)
  await page.mouse.click(garrison.screen!.x, garrison.screen!.y)
  await waitBattleReady(page)
  s = await readState(page)
  expect(s.general?.enemy?.name).toBe('孔秀')
  // 小阵容确保必胜（dev bridge 重开一场；battleReturn 回流上下文不受影响，结算仍写回孔秀守将）
  await page.evaluate(() => {
    const bridge = (window as { __game?: { startBattle?(p: unknown, e: unknown, g: unknown): void } }).__game
    bridge?.startBattle?.(
      { side: 'player', generalName: '關羽', atkBonus: 11, defBonus: 9, units: [{ defId: 'swordsman', count: 20 }, { defId: 'archer', count: 12 }] },
      { side: 'enemy', generalName: '孔秀', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 10 }] },
      { cols: 15, rows: 11 }
    )
  })
  await page.waitForTimeout(100)
  expect((await readState(page)).phase).toBe('combat')
  const phaseGarrison = await defendToEnd(page)
  expect(phaseGarrison).toBe('won')
  await clickReturn(page)
  await waitAdventure(page)

  // ---- 3. 胜利面板：守将阵亡 + outcome won + 胜利弹层出现 ----
  s = await readState(page)
  expect(s.garrisons!.find((g) => g.id === 'gar-kongxiu')!.alive).toBe(false)
  expect(s.outcome).toBe('won')
  expect(s.victoryPanel?.shown).toBe(true)
  await page.screenshot({ path: 'screenshots/campaign-full-victory.png' })

  // 点「返回主菜单」→ 回主菜单
  await page.mouse.click(VICTORY_RETURN_BTN.x, VICTORY_RETURN_BTN.y)
  await waitMenu(page)
  expect((await readState(page)).scene).toBe('menu')
})
