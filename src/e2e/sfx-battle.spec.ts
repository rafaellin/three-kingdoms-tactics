import { expect, test, type Page } from '@playwright/test'
import { gotoBattle } from './helpers'

/**
 * 战斗音效 e2e 回归（渲染层）。
 *
 * 断言项（状态流，听感由人工确认）：
 *  - 步兵移动：循环播放 infantry move，移动结束停止
 *  - 骑兵移动：循环播放 horse move
 *  - 近战攻击（含远程兵近战）：一次性 melee attack
 *  - 远程攻击：一次性 range attack
 *  - 敌方行动同样触发（共享代码路径）
 */

interface SfxState {
  ready?: boolean
  volume?: number
  loopPlaying?: boolean
  loopKey?: string | null
  lastOnceKey?: string | null
}

interface UnitState {
  id: string
  position: { q: number; r: number }
  screen: { x: number; y: number }
}
interface DebugGameState {
  ready?: boolean
  scene?: string
  phase?: string
  sfx?: SfxState
  reachable?: { q: number; r: number; screen: { x: number; y: number } }[]
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

const waitSfxReady = (page: Page) =>
  page.waitForFunction(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.sfx?.ready === true)

const SKIP = { x: 1880, y: 1040 }

test('步兵移动：循环播放 infantry move，移动结束停止', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  await waitSfxReady(page)
  // 两民兵 vs 一民兵：p0 移动后轮到 p1（玩家），无 AI 介入 → 循环停止可断言
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }, { defId: 'militia', count: 50 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }] },
    { cols: 7, rows: 3 })
  const s = await getState(page)
  expect(s.currentUnitId).toBe('p0')
  const target = s.reachable!.filter((h) => h.q >= 2)[0]!
  await page.mouse.click(target.screen.x, target.screen.y)
  // 移动中：步兵循环音效
  await page.waitForFunction(() => {
    const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return st?.sfx?.loopPlaying === true && st?.sfx?.loopKey === 'infantry move'
  })
  // 移动结束：循环停止
  await page.evaluate(() => (window as { __game?: { waitForMove(): Promise<void> } }).__game?.waitForMove())
  expect((await getState(page)).sfx?.loopPlaying).toBe(false)
})

test('骑兵移动：循环播放 horse move', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  await waitSfxReady(page)
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 10 }, { defId: 'cavalry', count: 8 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }] },
    { cols: 7, rows: 3 }) // 骑兵 p1 (0,1) speed9 最先行动
  const s = await getState(page)
  expect(s.currentUnitId).toBe('p1')
  const target = s.reachable!.filter((h) => h.q >= 3)[0]!
  await page.mouse.click(target.screen.x, target.screen.y)
  await page.waitForFunction(() => {
    const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return st?.sfx?.loopPlaying === true && st?.sfx?.loopKey === 'horse move'
  })
})

test('近战攻击：一次性 melee attack（含远程兵近战路径同一音效）', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }] },
    { cols: 3, rows: 3 }) // p0 (0,0) 与 e0 (1,0) 贴身
  const e0 = (await getState(page)).units!.find((u) => u.id === 'e0')!
  await page.mouse.click(e0.screen.x, e0.screen.y) // 原地近战
  await page.waitForFunction(() => {
    const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return st?.sfx?.lastOnceKey === 'melee attack'
  })
})

test('远程攻击：一次性 range attack', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'archer', count: 10 }, { defId: 'militia', count: 10 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }] },
    { cols: 5, rows: 3 }) // archer p0 (0,0) 距 e0 (3,0) 3 ≤ 射程 6；射击后轮到 p1（玩家）→ 无敌方覆盖
  const e0 = (await getState(page)).units!.find((u) => u.id === 'e0')!
  await page.mouse.move(e0.screen.x, e0.screen.y)
  await page.mouse.click(e0.screen.x, e0.screen.y) // 远程射击
  await page.waitForFunction(() => {
    const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return st?.sfx?.lastOnceKey === 'range attack'
  })
})

test('敌方行动触发音效：贴身敌方近战 → melee attack', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }] },
    { cols: 3, rows: 3 }) // p0 (0,0) 与 e0 (1,0) 贴身
  await page.mouse.click(SKIP.x, SKIP.y) // 跳过玩家回合 → 敌方贴身攻击
  await page.waitForFunction(() => {
    const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return st?.sfx?.lastOnceKey === 'melee attack'
  })
})
