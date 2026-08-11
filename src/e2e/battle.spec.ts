import { expect, test, type Page } from '@playwright/test'

/**
 * 战斗 e2e：主菜单入口 + startBattle 确定性交互（刀剑冲锋/反击、远程满额/半额、移动即行动、信息面板、胜负循环）。
 * 模型无多模态：断言一律程序化（window.__game.getState()）；截图仅供人工目检。
 */
const MENU_BATTLE = { x: 960, y: 734 }
const SKIP = { x: 1880, y: 1040 }
const RETURN = { x: 960, y: 580 }

interface UnitState {
  id: string
  side: string
  defId: string
  count: number
  position: { q: number; r: number }
  size: number
  hpLeft: number
  maxHp: number
  hasActed: boolean
  hasMoved: boolean
  retaliated: boolean
  woundedHp: number
  screen: { x: number; y: number }
}
interface DebugGameState {
  ready?: boolean
  scene?: string
  phase?: string
  turn?: number
  currentUnitId?: string | null
  selectedUnitId?: string | null
  grid?: { cols: number; rows: number }
  obstacles?: { q: number; r: number }[]
  reachable?: { q: number; r: number; screen: { x: number; y: number } }[]
  hover?: {
    ghostHex?: { q: number; r: number } | null
    cursorKind?: string
    swordTargetId?: string | null
    blinkId?: string | null
  }
  infoPanelText?: string | null
  units?: UnitState[]
}

const getState = (page: Page): Promise<DebugGameState> =>
  page.evaluate(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState() ?? {})

const waitBattleReady = (page: Page) =>
  page.waitForFunction(() => {
    const s = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return s?.ready === true && s?.scene === 'battle' && s?.phase === 'combat'
  })

type Army = { side: 'player' | 'enemy'; generalName: string; atkBonus: number; defBonus: number; units: { defId: string; count: number }[] }

const startBattle = (page: Page, player: Army, enemy: Army, grid: { cols: number; rows: number }) =>
  page.evaluate(({ p, e, g }) => {
    const bridge = (window as { __game?: { startBattle(p: unknown, e: unknown, g: unknown): void } }).__game
    bridge?.startBattle(p, e, g)
  }, { p: player, e: enemy, g: grid })

const setAnimationSpeed = (page: Page, ms: number) =>
  page.evaluate((v) => (window as { __game?: { setAnimationSpeed(n: number): void } }).__game?.setAnimationSpeed(v), ms)

test('主菜单 → 战斗测试：矩形战场 + 障碍物 + 7 单位', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('canvas', { state: 'attached' })
  await page.mouse.click(MENU_BATTLE.x, MENU_BATTLE.y)
  await waitBattleReady(page)
  const s = await getState(page)
  expect(s.grid).toEqual(expect.objectContaining({ cols: 13, rows: 9 }))
  expect(s.obstacles).toHaveLength(6)
  expect(s.units).toHaveLength(7)
  expect(s.units?.find((u) => u.defId === 'cavalry')?.size).toBe(2)
  await page.screenshot({ path: 'screenshots/battle-field-rect.png' })
})

test('近战：边界刀剑 → 点击冲锋 + 全伤反击', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('canvas', { state: 'attached' })
  await page.mouse.click(MENU_BATTLE.x, MENU_BATTLE.y)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }, { defId: 'militia', count: 20 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'swordsman', count: 20 }] },
    { cols: 5, rows: 3 })
  // p0 (0,0) vs e0 刀兵 (3,0)；悬停 (2,0)↔(3,0) 边界中点 → 刀剑指向 e0
  const s = await getState(page)
  expect(s.currentUnitId).toBe('p0')
  const e0 = s.units!.find((u) => u.id === 'e0')!
  const ex = e0.screen.x - (30 * Math.sqrt(3)) / 2
  const ey = e0.screen.y
  await page.mouse.move(ex, ey)
  const hov = (await getState(page)).hover
  expect(hov?.cursorKind).toBe('sword')
  expect(hov?.swordTargetId).toBe('e0')
  await page.mouse.click(ex, ey)
  const after = await getState(page)
  const p0 = after.units!.find((u) => u.id === 'p0')!
  const e0a = after.units!.find((u) => u.id === 'e0')!
  expect(p0.position).toEqual({ q: 2, r: 0 })
  expect(e0a.hpLeft).toBe(6)      // 40 - 34
  expect(p0.hpLeft).toBe(7)       // 20 - 13（反击）
  expect(e0a.retaliated).toBe(true)
  expect(after.currentUnitId).toBe('p1') // 反击后 advance 到 p1（无 AI 介入）
  await page.screenshot({ path: 'screenshots/battle-sword-attack.png' })
})

test('远程：弓（满额）/ 断箭（半额）', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('canvas', { state: 'attached' })
  await page.mouse.click(MENU_BATTLE.x, MENU_BATTLE.y)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'archer', count: 10 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }] },
    { cols: 5, rows: 3 }) // e0 (3,0)，距离 3 ≤ 6 → 满额
  const s = await getState(page)
  expect(s.currentUnitId).toBe('p0')
  const e0 = s.units!.find((u) => u.id === 'e0')!
  await page.mouse.move(e0.screen.x, e0.screen.y)
  expect((await getState(page)).hover?.cursorKind).toBe('bow')
  await page.mouse.click(e0.screen.x, e0.screen.y)
  await page.waitForTimeout(80)
  expect((await getState(page)).units!.find((u) => u.id === 'e0')!.hpLeft).toBe(17)
  await page.screenshot({ path: 'screenshots/battle-bow-full.png' })
  // 断箭：e0 距离 7（另一场 startBattle 重置）
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'archer', count: 10 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }] },
    { cols: 9, rows: 3 }) // e0 (7,0)，距离 7 > 6 → 半额
  const s2 = await getState(page)
  const e0b = s2.units!.find((u) => u.id === 'e0')!
  await page.mouse.move(e0b.screen.x, e0b.screen.y)
  expect((await getState(page)).hover?.cursorKind).toBe('broken-arrow')
  await page.mouse.click(e0b.screen.x, e0b.screen.y)
  await page.waitForTimeout(80)
  expect((await getState(page)).units!.find((u) => u.id === 'e0')!.hpLeft).toBe(33)
  await page.screenshot({ path: 'screenshots/battle-broken-arrow.png' })
})

test('移动即行动：移动后 hasActed 且轮到下一单位（AI 不介入）', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('canvas', { state: 'attached' })
  await page.mouse.click(MENU_BATTLE.x, MENU_BATTLE.y)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }, { defId: 'militia', count: 50 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }] },
    { cols: 7, rows: 3 })
  const s = await getState(page)
  expect(s.currentUnitId).toBe('p0')
  const reach1 = s.reachable!.find((h) => h.q === 1 && h.r === 0)!
  await page.mouse.click(reach1.screen.x, reach1.screen.y)
  const after = await getState(page)
  const p0 = after.units!.find((u) => u.id === 'p0')!
  expect(p0.position).toEqual({ q: 1, r: 0 })
  expect(p0.hasActed).toBe(true)
  expect(p0.hasMoved).toBe(true)
  expect(after.currentUnitId).toBe('p1') // 移动即行动 → advance 到下一个玩家单位
})

test('信息面板：hover 部队 → 兵种/数量/伤兵剩余血', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('canvas', { state: 'attached' })
  await page.mouse.click(MENU_BATTLE.x, MENU_BATTLE.y)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'swordsman', count: 12 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }] },
    { cols: 5, rows: 3 })
  const s = await getState(page)
  const p0 = s.units!.find((u) => u.id === 'p0')!
  await page.mouse.move(p0.screen.x, p0.screen.y)
  await page.waitForTimeout(50)
  const panel = (await getState(page)).infoPanelText
  expect(panel).toContain('刀兵')
  expect(panel).toContain('数量：12')
  expect(panel).toContain('伤兵剩余：2') // swordsman hp2，12 满编 → 末位 24-11×2=2
  await page.screenshot({ path: 'screenshots/battle-info-panel.png' })
})

test('默认战斗：反复跳过 → AI 冲锋/射击 → 战败 → 返回主菜单', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('canvas', { state: 'attached' })
  await page.mouse.click(MENU_BATTLE.x, MENU_BATTLE.y)
  await waitBattleReady(page)
  let guard = 0
  let s: DebugGameState = await getState(page)
  while (s.phase === 'combat' && guard++ < 120) {
    await page.mouse.click(SKIP.x, SKIP.y)
    await page.waitForTimeout(80)
    s = await getState(page)
  }
  expect(s.phase).toBe('lost')
  await page.screenshot({ path: 'screenshots/battle-result-lost.png' })
  await page.mouse.click(RETURN.x, RETURN.y)
  await page.waitForFunction(
    () => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.ready === false
  )
})
