import { expect, test, type Page } from '@playwright/test'
import { gotoCampaign } from './helpers'
import { HexLayout, type Axial } from '../core/hex/HexGrid'

/**
 * 战斗交互 e2e（Task 5）：直接移动上去交战 + 胜利占格/失败回城 + 不能穿过/重叠武将 + 悬停刀剑。
 * - 点杂兵格 → 英雄**移动到杂兵格** → 进 Battle → defend 循环取胜 → 返回 → 英雄 position=杂兵格 + 行动力保留；
 * - 悬停守将格 → cursorKind==='sword'（刀剑光标 + 交战高亮）；点孔秀守将格 → 英雄移到孔秀格 → 进 Battle
 *   → 用小阵容（dev bridge startBattle）确保必胜 → defend 循环取胜 → 返回 → 孔秀 alive=false + outcome won + 英雄占孔秀格；
 * - 不能重叠/穿过：点另一英雄占据格不移动；点需穿过武将的格不进战斗。
 * 断言一律程序化（window.__game.getState()）；截图仅供人工目检。
 */
interface DebugGameState {
  ready?: boolean
  scene?: string
  mode?: string | null
  campaignId?: string | null
  outcome?: string | null
  cursorKind?: string
  heroes?: { generalId: string; position: { q: number; r: number }; movementLeft: number; screen?: { x: number; y: number } }[]
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

/** 任意 hex → 屏幕坐标（1920×1080 视口、相机 centerOn(0,0) → scroll=-960,-540） */
const layout = new HexLayout({ size: 36, origin: { x: 0, y: 0 } })
const hexToScreen = (h: Axial): { x: number; y: number } => {
  const p = layout.hexToPixel(h)
  return { x: 1920 / 2 + p.x, y: 1080 / 2 + p.y }
}

test('战役：点杂兵格 → 英雄移动到杂兵格 → 打胜 → 返回 → 英雄占杂兵格 + 行动力保留', async ({ page }) => {
  await gotoCampaign(page)
  await page.evaluate(() => (window as { __game?: { setAnimationSpeed(n: number): void } }).__game?.setAnimationSpeed(0))
  // 战役就绪：当前选中英雄=关羽（heroStarts 第一个），杂兵 neu-1 未歼灭
  let s = await readState(page)
  expect(s.mode).toBe('campaign')
  expect(s.outcome).toBeNull()
  const neutral = s.neutrals!.find((n) => n.id === 'neu-1')!
  expect(neutral.defeated).toBe(false)
  const guanXpBefore = s.generals!.find((g) => g.id === 'g-guan')!.xp

  // 点杂兵格 → 英雄先移动到杂兵格 (0,-2)，再进战斗（敌方=野怪，无武将）
  await page.mouse.click(neutral.screen!.x, neutral.screen!.y)
  await waitBattleReady(page)
  s = await readState(page)
  expect(s.general?.enemy?.name).toBe('野怪')
  await page.screenshot({ path: 'screenshots/campaign-battle-neutral.png' })

  // defend 循环自然取胜（我方 关羽 vs 1 队民兵，必胜）
  const phase = await defendToEnd(page)
  expect(phase).toBe('won')
  await page.screenshot({ path: 'screenshots/campaign-battle-neutral-won.png' })

  // 点返回 → 回大地图：英雄 position=杂兵格 (0,-2)（胜利占格）+ 行动力保留（走进去扣 1 格平地）
  await clickReturn(page)
  await waitAdventure(page)
  s = await readState(page)
  const guanAfter = s.heroes!.find((h) => h.generalId === 'g-guan')!
  expect(guanAfter.position).toEqual({ q: 0, r: -2 })
  expect(guanAfter.movementLeft).toBe(5)
  expect(s.neutrals!.find((n) => n.id === 'neu-1')!.defeated).toBe(true)
  expect(s.generals!.find((g) => g.id === 'g-guan')!.xp).toBeGreaterThan(guanXpBefore)
})

test('战役：悬停守将 → 刀剑光标；点孔秀格 → 英雄移到孔秀格 → 打胜 → 守将阵亡 + 胜利判定', async ({ page }) => {
  await gotoCampaign(page)
  await page.evaluate(() => (window as { __game?: { setAnimationSpeed(n: number): void } }).__game?.setAnimationSpeed(0))
  let s = await readState(page)
  const garrison = s.garrisons!.find((g) => g.id === 'gar-kongxiu')!
  expect(garrison.alive).toBe(true)

  // 悬停守将格（关羽可达 (0,-1)→(0,0)→(0,1)）→ 刀剑光标（cursorKind==='sword'）
  await page.mouse.move(garrison.screen!.x, garrison.screen!.y)
  await page.waitForFunction(() => {
    const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return st?.cursorKind === 'sword'
  })
  await page.screenshot({ path: 'screenshots/campaign-battle-garrison-hover-sword.png' })

  // 点守将格 → 英雄移动到守将格 (0,1) → 进战斗（敌方=孔秀；我方=关羽 army）
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
  // 胜利占格：英雄 position = 守将格 (0,1)（已随移动到位）+ 行动力保留（走进去扣 2 格平地）
  const guanAfter = s.heroes!.find((h) => h.generalId === 'g-guan')!
  expect(guanAfter.position).toEqual({ q: 0, r: 1 })
  expect(guanAfter.movementLeft).toBe(4)
})

test('战役：不能重叠/穿过武将格——点其他英雄格不移动；点被武将挡住的格不进战斗', async ({ page }) => {
  await gotoCampaign(page)
  await page.evaluate(() => (window as { __game?: { setAnimationSpeed(n: number): void } }).__game?.setAnimationSpeed(0))
  let s = await readState(page)
  const guan = s.heroes!.find((h) => h.generalId === 'g-guan')!
  const zhou = s.heroes!.find((h) => h.generalId === 'g-zhoucang')!
  const guanPos = { ...guan.position }

  // ① 重叠：关羽点周仓占据格 (-1,-1) → 不移动（其他英雄格不可重叠）
  await page.mouse.click(zhou.screen!.x, zhou.screen!.y)
  await page.waitForTimeout(150)
  s = await readState(page)
  expect(s.heroes!.find((h) => h.generalId === 'g-guan')!.position).toEqual(guanPos)

  // ② 穿过：关羽点需穿过武将的格 (2,-2)——所有路径都经过孙乾 (1,-1)/杂兵 neu-2 (1,-2)/山 → 不可达
  const blockedScreen = hexToScreen({ q: 2, r: -2 })
  await page.mouse.click(blockedScreen.x, blockedScreen.y)
  await page.waitForTimeout(200)
  s = await readState(page)
  expect(s.scene).toBe('adventure') // 未进战斗
  expect(s.heroes!.find((h) => h.generalId === 'g-guan')!.position).toEqual(guanPos)
  await page.screenshot({ path: 'screenshots/campaign-battle-blocked-path.png' })
})
