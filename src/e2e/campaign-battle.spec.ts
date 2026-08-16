import { expect, test, type Page } from '@playwright/test'
import { gotoCampaign } from './helpers'

/**
 * 战斗回流 e2e（Task 8）：大地图触发战斗 + BattleResult 写回。
 * - 战役进 → 点杂兵格 → 进 Battle → defend 循环取胜 → 返回 → 断言 杂兵 defeated + 经验增加；
 * - 战役进 → 点孔秀守将格 → 进 Battle（敌方=孔秀）→ 用小阵容（dev bridge startBattle）确保必胜
 *   → defend 循环取胜 → 返回 → 断言 孔秀 alive=false + outcome won（胜利判定）。
 * 断言一律程序化（window.__game.getState()）；截图仅供人工目检。
 */
interface DebugGameState {
  ready?: boolean
  scene?: string
  mode?: string | null
  campaignId?: string | null
  outcome?: string | null
  heroes?: { generalId: string; position: { q: number; r: number } }[]
  garrisons?: { id: string; generalId: string; position: { q: number; r: number }; alive: boolean; screen?: { x: number; y: number } }[]
  neutrals?: { id: string; position: { q: number; r: number }; defeated: boolean; screen?: { x: number; y: number } }[]
  generals?: { id: string; name: string; level: number; xp: number; army: { defId: string; count: number }[] }[]
  // battle 状态
  phase?: string
  general?: { player?: { name?: string }; enemy?: { name?: string } }
  actionButtons?: Record<string, { x: number; y: number }>
  result?: {
    button?: { bounds?: { x: number; y: number; width: number; height: number } }
  }
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

test('战役：点杂兵格 → 进战斗 → 打胜 → 返回 → 杂兵被歼 + 经验增加', async ({ page }) => {
  await gotoCampaign(page)
  await page.evaluate(() => (window as { __game?: { setAnimationSpeed(n: number): void } }).__game?.setAnimationSpeed(0))
  // 战役就绪：当前选中英雄=关羽（heroStarts 第一个），杂兵 neu-1 未歼灭
  let s = await readState(page)
  expect(s.mode).toBe('campaign')
  expect(s.outcome).toBeNull()
  const neutral = s.neutrals!.find((n) => n.id === 'neu-1')!
  expect(neutral.defeated).toBe(false)
  const guanXpBefore = s.generals!.find((g) => g.id === 'g-guan')!.xp

  // 点杂兵格 → 进战斗（敌方=野怪，无武将）
  await page.mouse.click(neutral.screen!.x, neutral.screen!.y)
  await waitBattleReady(page)
  s = await readState(page)
  expect(s.general?.enemy?.name).toBe('野怪')
  await page.screenshot({ path: 'screenshots/campaign-battle-neutral.png' })

  // defend 循环自然取胜（我方 关羽 vs 1 队民兵，必胜）
  const phase = await defendToEnd(page)
  expect(phase).toBe('won')
  await page.screenshot({ path: 'screenshots/campaign-battle-neutral-won.png' })

  // 点返回 → 回大地图，结算写回：杂兵被歼 + 关羽经验增加
  await clickReturn(page)
  await waitAdventure(page)
  s = await readState(page)
  expect(s.neutrals!.find((n) => n.id === 'neu-1')!.defeated).toBe(true)
  expect(s.generals!.find((g) => g.id === 'g-guan')!.xp).toBeGreaterThan(guanXpBefore)
})

test('战役：点孔秀守将格 → 进战斗（敌方=孔秀）→ 打胜 → 返回 → 守将阵亡 + 胜利判定', async ({ page }) => {
  await gotoCampaign(page)
  await page.evaluate(() => (window as { __game?: { setAnimationSpeed(n: number): void } }).__game?.setAnimationSpeed(0))
  let s = await readState(page)
  const garrison = s.garrisons!.find((g) => g.id === 'gar-kongxiu')!
  expect(garrison.alive).toBe(true)

  // 点守将格 → 进战斗（敌方=孔秀；我方=关羽 army）
  await page.mouse.click(garrison.screen!.x, garrison.screen!.y)
  await waitBattleReady(page)
  s = await readState(page)
  expect(s.general?.enemy?.name).toBe('孔秀')
  await page.screenshot({ path: 'screenshots/campaign-battle-garrison.png' })

  // 用小阵容确保必胜：dev bridge 重开一场（enemy 弱 → defend 循环必胜）。
  // battleReturn（回流上下文）不受影响，结算仍写回孔秀守将。
  await page.evaluate(() => {
    const bridge = (window as { __game?: { startBattle?(p: unknown, e: unknown, g: unknown): void } }).__game
    bridge?.startBattle?.(
      { side: 'player', generalName: '关羽', atkBonus: 11, defBonus: 9, units: [{ defId: 'swordsman', count: 20 }, { defId: 'archer', count: 12 }] },
      { side: 'enemy', generalName: '孔秀', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 10 }] },
      { cols: 15, rows: 11 }
    )
  })
  await page.waitForTimeout(100)
  expect((await readState(page)).phase).toBe('combat')

  const phase = await defendToEnd(page)
  expect(phase).toBe('won')
  await page.screenshot({ path: 'screenshots/campaign-battle-garrison-won.png' })

  // 点返回 → 回大地图，结算写回：孔秀 alive=false + outcome won（胜利判定）
  await clickReturn(page)
  await waitAdventure(page)
  s = await readState(page)
  expect(s.garrisons!.find((g) => g.id === 'gar-kongxiu')!.alive).toBe(false)
  expect(s.outcome).toBe('won')
})
