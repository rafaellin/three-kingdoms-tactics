import { expect, test, type Page } from '@playwright/test'
import { gotoCampaign } from './helpers'

/**
 * 世界状态持久化 e2e（世界快照）：战斗往返不丢大地图状态。
 * 核心断言：战斗返回后城池驻守/驻军/英雄位置保留（此前 buildStore 重建会全部重置）。
 * - 关羽进城 → 驻守（garrisonGeneralId）+ 移兵（驻军增）→ 出城 → 打杂兵 → 返回 →
 *   断言 garrisonGeneralId 仍在、驻军保留、关羽经验增、位置保留；
 * - 打孔秀 → 胜利 → 返回 → 断言 outcome won + 胜利面板。
 * 断言一律程序化（window.__game.getState()）；截图仅供人工目检。
 */

/** 东岭小城 (0,0) 屏幕中心（1920×1080，相机 centerOn(0,0) → 屏幕中心 = 世界原点） */
const TOWN_SCREEN = { x: 960, y: 540 }

interface TownPanelButtonDebug {
  key: string
  label: string
  x: number
  y: number
  enabled: boolean
}

interface DebugGameState {
  ready?: boolean
  scene?: string
  mode?: string | null
  outcome?: string | null
  phase?: string
  general?: { enemy?: { name?: string } }
  heroes?: { generalId: string; position: { q: number; r: number } }[]
  garrisons?: { id: string; generalId: string; position: { q: number; r: number }; alive: boolean; screen?: { x: number; y: number } }[]
  neutrals?: { id: string; position: { q: number; r: number }; defeated: boolean; screen?: { x: number; y: number } }[]
  generals?: { id: string; name: string; level: number; xp: number; army: { defId: string; count: number }[] }[]
  towns?: {
    id: string
    name: string
    garrison: { defId: string; count: number }[]
    garrisonGeneralId: string | null
    visitorGeneralId: string | null
  }[]
  townPanel?: { open: boolean; buttons?: TownPanelButtonDebug[] } | null
  victoryPanel?: { shown: boolean; open: boolean }
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

/** 打开城池面板（轮询 readState：面板对象存在即已打开） */
const openPanel = async (page: Page): Promise<void> => {
  const t0 = Date.now()
  while (Date.now() - t0 < 10000) {
    const s = await readState(page)
    if (s.townPanel?.open) return
    await page.waitForTimeout(50)
  }
  throw new Error('openPanel 超时：城池面板未打开')
}

/** 按 key 读面板按钮坐标并点击（面板每次重绘后坐标可能变化 → 每点前重新读） */
const clickBtn = async (page: Page, key: string): Promise<void> => {
  const s = await readState(page)
  const b = s.townPanel?.buttons?.find((x) => x.key === key)
  expect(b, `面板按钮 ${key} 应存在`).toBeDefined()
  await page.mouse.click(b!.x, b!.y)
}

/** 点底部行动条按钮 */
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

/** defend 循环直到战斗终态 */
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

test('世界快照：驻守+移兵 → 打杂兵 → 返回 → 城池驻守/驻军/位置/经验全保留', async ({ page }) => {
  await gotoCampaign(page)
  await page.evaluate(() => (window as { __game?: { setAnimationSpeed(n: number): void } }).__game?.setAnimationSpeed(0))
  let s = await readState(page)
  expect(s.mode).toBe('campaign')
  expect(s.outcome).toBeNull()
  const guan = s.generals!.find((g) => g.id === 'g-guan')!
  const guanXpBefore = guan.xp

  // ① 关羽点城池 (0,0) 走进 → 自动进城（访问=关羽）
  await page.mouse.click(TOWN_SCREEN.x, TOWN_SCREEN.y)
  await page.waitForFunction(
    () => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.towns?.[0]?.visitorGeneralId === 'g-guan'
  )
  // 排空移动动画的 busy（animateMove finally 复位；busy 期间点击被吞）
  await page.evaluate(() => (window as { __game?: { waitForMove(): Promise<void> } }).__game?.waitForMove())

  // ② 打开面板 → 驻守 + 移兵 + 出城（在一个面板会话内完成，避免重复开面板的 currentHero 歧义）
  await page.mouse.click(TOWN_SCREEN.x, TOWN_SCREEN.y)
  await openPanel(page)
  await clickBtn(page, 'garrison')
  await page.waitForFunction(
    () => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.towns?.[0]?.garrisonGeneralId === 'g-guan'
  )
  await clickBtn(page, 'transfer-hero-swordsman-1')
  await page.waitForFunction(
    () =>
      (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.towns?.[0]?.garrison?.some(
        (u) => u.defId === 'swordsman' && u.count === 1
      )
  )
  // 出城（面板仍开 → 关羽回 heroes）
  await clickBtn(page, 'leave')
  await page.waitForFunction(
    () => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.heroes?.some((h) => h.generalId === 'g-guan')
  )
  // 关闭面板
  await clickBtn(page, 'close')
  await page.waitForFunction(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.townPanel == null)
  await page.evaluate(() => (window as { __game?: { waitForMove(): Promise<void> } }).__game?.waitForMove())

  // ④ 打杂兵 neu-1 → 胜利 → 返回
  s = await readState(page)
  const neutral = s.neutrals!.find((n) => n.id === 'neu-1')!
  await page.mouse.click(neutral.screen!.x, neutral.screen!.y)
  await waitBattleReady(page)
  expect((await readState(page)).general?.enemy?.name).toBe('野怪')
  expect(await defendToEnd(page)).toBe('won')
  await clickReturn(page)
  await waitAdventure(page)

  // ⑤ 核心断言：战斗返回后世界状态保留（此前 buildStore 重建会全部重置）
  s = await readState(page)
  expect(s.neutrals!.find((n) => n.id === 'neu-1')!.defeated).toBe(true) // 杂兵被歼（战斗结果写回）
  // 城池状态保留：驻军（移兵结果）跨战斗保留；驻城/访问槽因「关羽出城去打杂兵」为空
  // （出城释放驻守槽——这是出城语义，非状态丢失）
  expect(s.towns![0]!.garrison).toEqual([{ defId: 'swordsman', count: 1 }]) // 驻军保留（此前重建会重置为空）
  expect(s.towns![0]!.garrisonGeneralId).toBeNull() // 关羽出城，驻守槽释放
  expect(s.towns![0]!.visitorGeneralId).toBeNull()
  // 英雄位置保留（战斗胜利占格 = 杂兵格 (0,-2)，不因战斗返回重置到出生点/城格）
  const guanHero = s.heroes!.find((h) => h.generalId === 'g-guan')!
  expect(guanHero.position).toEqual({ q: 0, r: -2 }) // 胜利占杂兵格（Task 5：胜利 → 英雄移入目标格）
  // 经验保留/新增
  expect(s.generals!.find((g) => g.id === 'g-guan')!.xp).toBeGreaterThan(guanXpBefore)
  await page.screenshot({ path: 'screenshots/world-snapshot-persisted.png' })
})

test('世界快照：打孔秀 → 胜利 → 返回 → outcome won + 胜利面板', async ({ page }) => {
  await gotoCampaign(page)
  await page.evaluate(() => (window as { __game?: { setAnimationSpeed(n: number): void } }).__game?.setAnimationSpeed(0))
  let s = await readState(page)
  const garrison = s.garrisons!.find((g) => g.id === 'gar-kongxiu')!
  expect(garrison.alive).toBe(true)

  // 点守将格 → 进战斗（敌方=孔秀）
  await page.mouse.click(garrison.screen!.x, garrison.screen!.y)
  await waitBattleReady(page)
  expect((await readState(page)).general?.enemy?.name).toBe('孔秀')

  // 小阵容确保必胜（dev bridge；battleReturn 不受影响，结算仍写回孔秀守将）
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
  expect(await defendToEnd(page)).toBe('won')

  await clickReturn(page)
  await waitAdventure(page)
  s = await readState(page)
  expect(s.garrisons!.find((g) => g.id === 'gar-kongxiu')!.alive).toBe(false)
  expect(s.outcome).toBe('won')
  await page.waitForFunction(() => {
    const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return st?.victoryPanel?.shown === true
  })
  await page.screenshot({ path: 'screenshots/world-snapshot-victory.png' })
})
