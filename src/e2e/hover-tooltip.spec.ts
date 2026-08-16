import { expect, test, type Page } from '@playwright/test'
import { gotoCampaign } from './helpers'
import { HexLayout, type Axial } from '../core/hex/HexGrid'
import { xpToNext } from '../core/growth'

/**
 * hover 格 tooltip + 升级提示 e2e（Task 5，spec §4/§8）。
 * - 悬停山脉格 → tooltip 含「不可通过」；悬停杂兵格 → 含逐兵种兵力「民兵 ×10」；悬停城池格 → 含城名；
 * - 升级提示接口：dev bridge `grantXp` 注入经验到「差一点升级」→ 打杂兵 → 返回 →
 *   `campaign/resolveBattle` 跨阈值升级 → `levelUpNotice` 出现（含新等级）→ 关闭弹窗后 shown 保持。
 * 断言一律程序化（window.__game.getState()）；截图仅供人工目检。
 */

interface DebugGameState {
  ready?: boolean
  scene?: string
  mode?: string | null
  outcome?: string | null
  hoverTooltip?: string | null
  levelUpNotice?: { heroId: string; name: string; level: number; shown: boolean } | null
  generals?: { id: string; name: string; level: number; xp: number }[]
  neutrals?: { id: string; position: Axial; defeated: boolean; screen?: { x: number; y: number } }[]
  garrisons?: { id: string; generalId: string; position: Axial; alive: boolean; screen?: { x: number; y: number } }[]
  // battle 状态
  phase?: string
  general?: { enemy?: { name?: string } }
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

/** 地图中心（世界原点）在屏幕中心 1920×1080；hex → 屏幕像素（与 AdventureScene camera.centerOn(0,0) 一致） */
const layout = new HexLayout({ size: 36, origin: { x: 0, y: 0 } })
const hexToScreen = (h: Axial): { x: number; y: number } => {
  const p = layout.hexToPixel(h)
  return { x: 1920 / 2 + p.x, y: 1080 / 2 + p.y }
}

test('hover 格 tooltip：悬停山脉 → 不可通过；杂兵 → 逐兵种兵力；城池 → 城名', async ({ page }) => {
  await gotoCampaign(page)
  await page.evaluate(() => (window as { __game?: { setAnimationSpeed(n: number): void } }).__game?.setAnimationSpeed(0))

  // ① 悬停山脉格 (-1,1)（关羽可见范围）→ tooltip 含「不可通过」
  const mountain = hexToScreen({ q: -1, r: 1 })
  await page.mouse.move(mountain.x, mountain.y)
  await page.waitForFunction(() => {
    const s = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return s?.hoverTooltip != null && s.hoverTooltip.includes('不可通过')
  })
  let s = await readState(page)
  expect(s.hoverTooltip).toContain('不可通过')

  // ② 悬停杂兵格（neu-1 未歼灭）→ tooltip 含逐兵种兵力「民兵 ×10」（neu-1 = 10 民兵）
  const neutral = s.neutrals!.find((n) => n.id === 'neu-1')!
  expect(neutral.defeated).toBe(false)
  await page.mouse.move(neutral.screen!.x, neutral.screen!.y)
  await page.waitForFunction(() => {
    const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return st?.hoverTooltip != null && st.hoverTooltip.includes('民兵 ×10')
  })
  s = await readState(page)
  expect(s.hoverTooltip).toContain('民兵 ×10')

  // ③ 悬停城池格 (0,0) → tooltip 含城名
  const town = hexToScreen({ q: 0, r: 0 })
  await page.mouse.move(town.x, town.y)
  await page.waitForFunction(() => {
    const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return st?.hoverTooltip != null && st.hoverTooltip.includes('东岭小城')
  })
  s = await readState(page)
  expect(s.hoverTooltip).toContain('东岭小城')

  // ④ 悬停守将格 (0,1)（gar-kongxiu 孔秀 2队）→ tooltip 含「守将」「孔秀」
  // （守将不在 state.generals → 走 GENERAL_BASES fallback 名）
  const garrison = s.garrisons!.find((g) => g.id === 'gar-kongxiu')!
  expect(garrison.alive).toBe(true)
  await page.mouse.move(garrison.screen!.x, garrison.screen!.y)
  await page.waitForFunction(() => {
    const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return st?.hoverTooltip != null && st.hoverTooltip.includes('守将') && st.hoverTooltip.includes('孔秀')
  })
  s = await readState(page)
  expect(s.hoverTooltip).toContain('守将')
  expect(s.hoverTooltip).toContain('孔秀')

  // ⑤ 悬停未探索迷雾格 (0,3)（孔秀南侧，山 (0,2) 阻挡视野外）→ tooltip 不显示（hoverTooltip null）
  const fog = hexToScreen({ q: 0, r: 3 })
  await page.mouse.move(fog.x, fog.y)
  await page.waitForFunction(() => {
    const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return st?.hoverTooltip == null
  })
  s = await readState(page)
  expect(s.hoverTooltip).toBeNull()

  // 截图交人工目检：格 tooltip（地形/消耗/驻军/城名/守将；迷雾不显示）
  await page.screenshot({ path: 'screenshots/hover-tooltip.png' })
})

test('升级提示接口：战斗返回后参战英雄升级 → 弹「升級！」提示（含新等级）', async ({ page }) => {
  await gotoCampaign(page)
  await page.evaluate(() => (window as { __game?: { setAnimationSpeed(n: number): void } }).__game?.setAnimationSpeed(0))

  // 开局：关羽 Lv5（xp 0）；dev bridge 注入经验到「差一点升级」（差 5 点）
  let s = await readState(page)
  let guan = s.generals!.find((g) => g.id === 'g-guan')!
  expect(guan.level).toBe(5)
  const grant = xpToNext(guan.level) - guan.xp - 5
  await page.evaluate((amount) => {
    const bridge = (window as { __game?: { grantXp?(generalId: string, amount: number): void } }).__game
    bridge?.grantXp?.('g-guan', amount)
  }, grant)

  s = await readState(page)
  guan = s.generals!.find((g) => g.id === 'g-guan')!
  expect(guan.level).toBe(5) // 未跨阈值 → 保持 Lv5
  expect(guan.xp).toBe(xpToNext(5) - 5)

  // 打杂兵 neu-1（10 民兵 = 100 hp = 100 经验）→ 战胜 → 返回 → resolveBattle 跨阈值升级
  const neutral = s.neutrals!.find((n) => n.id === 'neu-1')!
  await page.mouse.click(neutral.screen!.x, neutral.screen!.y)
  await waitBattleReady(page)
  expect((await readState(page)).general?.enemy?.name).toBe('野怪')
  expect(await defendToEnd(page)).toBe('won')
  await clickReturn(page)
  await waitAdventure(page)

  // 升级提示：levelUpNotice 暴露 { heroId, name, level:6, shown:true }（弹窗已打开）
  s = await readState(page)
  expect(s.generals!.find((g) => g.id === 'g-guan')!.level).toBe(6)
  expect(s.levelUpNotice).toMatchObject({ heroId: 'g-guan', name: '關羽', level: 6, shown: true })
  await page.screenshot({ path: 'screenshots/level-up-notice.png' })

  // 关闭弹窗（openInfo 单按钮在 (960, 620)）→ shown 保持 true；无胜利面板（打的杂兵，outcome 非 won）
  await page.mouse.click(960, 620)
  await page.waitForTimeout(150)
  s = await readState(page)
  expect(s.levelUpNotice?.shown).toBe(true)
  expect(s.outcome).toBeNull()
})
