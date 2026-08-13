import { expect, test, type Page } from '@playwright/test'
import { gotoBattle, gotoBooted, MENU_BATTLE } from './helpers'

/**
 * 战斗 e2e：主菜单入口 + startBattle 确定性交互（刀剑冲锋/反击、远程满额/半额、移动即行动、信息面板、胜负循环）。
 * 模型无多模态：断言一律程序化（window.__game.getState()）；截图仅供人工目检。
 */
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
    swordHex?: { q: number; r: number } | null
    swordAdjHex?: { q: number; r: number } | null
    blinkId?: string | null
  }
  infoPanelText?: string | null
  animating?: boolean
  hitFlashCount?: number
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

test('主菜单 → 战斗测试：矩形战场 + 障碍物 + 8 单位', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  const s = await getState(page)
  expect(s.grid).toEqual(expect.objectContaining({ cols: 13, rows: 9 }))
  expect(s.obstacles).toHaveLength(6)
  expect(s.units).toHaveLength(8) // 玩家4 + 敌方4
  expect(s.units?.find((u) => u.defId === 'cavalry')?.size).toBe(2)
  // 敌方刀兵固定放在骑兵右侧 (2,3) 贴身，便于测试近战原地攻击
  const enemySword = s.units!.find((u) => u.defId === 'swordsman' && u.side === 'enemy')!
  expect(enemySword.position).toEqual({ q: 2, r: 3 })
  await page.screenshot({ path: 'screenshots/battle-field-rect.png' })
})

test('主菜单进入战斗：按钮点击的收尾 pointerup 不得触发误移动（防抖）', async ({ page }) => {
  // 回归：主菜单「战斗测试」按钮 pointerdown 切场后，同一次点击的收尾 pointerup 会泄漏进
  // 新 BattleScene 的全局 pointerup 监听 → 把当前行动单位移动到按钮所在格（hex (2,8)）。
  // 真实用户点击按下后保持若干帧再松开（Playwright 默认 click 同帧 down+up 不会复现），
  // 故显式 down → 保持 → up。
  await gotoBooted(page)
  await page.mouse.move(MENU_BATTLE.x, MENU_BATTLE.y)
  await page.mouse.down()
  await page.waitForTimeout(100)
  await page.mouse.up()
  await waitBattleReady(page)
  const s = await getState(page)
  const cavalry = s.units!.find((u) => u.defId === 'cavalry')!
  expect(s.currentUnitId).toBe('p3') // 骑兵 speed 9 最先行动
  expect(cavalry.position).toEqual({ q: 0, r: 3 }) // 出生位，不得被误移走
  expect(cavalry.hasActed).toBe(false)
})

test('近战：边界刀剑 → 点击冲锋 + 全伤反击', async ({ page }) => {
  await gotoBattle(page)
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
  const ex = e0.screen.x - (36 * Math.sqrt(3)) / 2 // 共享边界中点（layout size 36，与 Adventure 一致）
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

test('近战贴身：点击相邻敌军本体 → 原地攻击（无需找边界）', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }] },
    { cols: 3, rows: 3 }) // p0 (0,0) 与 e0 (1,0) 出生即贴身
  const s = await getState(page)
  expect(s.currentUnitId).toBe('p0')
  const e0 = s.units!.find((u) => u.id === 'e0')!
  // 悬停敌军本体 → 刀剑（原地攻击光标）
  await page.mouse.move(e0.screen.x, e0.screen.y)
  expect((await getState(page)).hover?.cursorKind).toBe('sword')
  // 点击敌军本体 → 原地攻击：位置不变、民兵 20 池被 68 伤全灭
  await page.mouse.click(e0.screen.x, e0.screen.y)
  const after = await getState(page)
  const p0 = after.units!.find((u) => u.id === 'p0')!
  expect(p0.position).toEqual({ q: 0, r: 0 })
  expect(p0.hasActed).toBe(true)
  expect(after.units!.find((u) => u.id === 'e0')).toBeUndefined()
})

test('近战贴身（1×2 骑兵）：刀剑锚在「东邻格↔敌军」边界而非主体格内', async ({ page }) => {
  // 标准战斗：骑兵 p3 (0,3) 占 (0,3)+(1,3)，敌方刀兵 e3 贴 (2,3) 东邻格
  await gotoBattle(page)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  const s = await getState(page)
  expect(s.currentUnitId).toBe('p3')
  const e3 = s.units!.find((u) => u.id === 'e3')!
  await page.mouse.move(e3.screen.x, e3.screen.y)
  const hov = (await getState(page)).hover
  expect(hov?.cursorKind).toBe('sword')
  expect(hov?.swordHex).toEqual({ q: 0, r: 3 }) // 攻击落点=原地（主体格）
  expect(hov?.swordAdjHex).toEqual({ q: 1, r: 3 }) // 刀剑画在与目标相邻的东邻格边界上
})

test('1×2 骑兵可左右平移一格：点击自身东邻格=右移、点击左侧格=左移', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  const army = { side: 'player' as const, generalName: 'P', atkBonus: 0, defBonus: 0,
    units: [{ defId: 'militia', count: 10 }, { defId: 'militia', count: 10 }, { defId: 'cavalry', count: 8 }] }
  const enemy = { side: 'enemy' as const, generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }] }
  // 骑兵 speed9 最先行动，位于 (0,2)（row2 锯齿左进 → 左侧格可走）
  await startBattle(page, army, enemy, { cols: 7, rows: 3 })
  let s = await getState(page)
  expect(s.currentUnitId).toBe('p2')
  let cav = s.units!.find((u) => u.id === 'p2')!
  expect(cav.position).toEqual({ q: 0, r: 2 })
  // 右移一格：点击自身东邻格 (1,2)（旧逻辑会误判为「选中自身」）
  const right = s.reachable!.find((h) => h.q === 1 && h.r === 2)!
  await page.mouse.click(right.screen.x, right.screen.y)
  let after = await getState(page)
  expect(after.units!.find((u) => u.id === 'p2')!.position).toEqual({ q: 1, r: 2 })
  // 重置后左移一格：点击 (0,2) 左侧 (-1,2)
  await startBattle(page, army, enemy, { cols: 7, rows: 3 })
  s = await getState(page)
  const left = s.reachable!.find((h) => h.q === -1 && h.r === 2)!
  await page.mouse.click(left.screen.x, left.screen.y)
  after = await getState(page)
  expect(after.units!.find((u) => u.id === 'p2')!.position).toEqual({ q: -1, r: 2 })
})

test('远程：弓（满额）/ 断箭（半额）', async ({ page }) => {
  await gotoBattle(page)
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
  await gotoBattle(page)
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

test('移动动画：默认速度先播动画、动画结束才落状态', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  // 不设 setAnimationSpeed → 默认 150ms/格
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }] },
    { cols: 7, rows: 3 })
  const s = await getState(page)
  const reach2 = s.reachable!.find((h) => h.q === 2 && h.r === 0)! // 2 格远，动画窗口 ~300ms
  await page.mouse.click(reach2.screen.x, reach2.screen.y)
  // 关键断言：p0 移动动画进行中，core 状态尚未更新（先动画、后 dispatch）
  await page.waitForFunction(() => {
    const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return st?.animating === true && st.units?.find((u) => u.id === 'p0')?.position.q === 0
  })
  const during = await getState(page)
  expect(during.units!.find((u) => u.id === 'p0')!.position).toEqual({ q: 0, r: 0 })
  // 动画结束 → 状态才更新到目标格
  await page.waitForFunction(() => {
    const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return st?.units?.find((u) => u.id === 'p0')?.position.q === 2
  })
  const after = await getState(page)
  expect(after.units!.find((u) => u.id === 'p0')!.position).toEqual({ q: 2, r: 0 })
})

test('攻击命中触发受击闪白（hitFlashCount 递增）', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }] },
    { cols: 3, rows: 3 }) // p0 (0,0) 与 e0 (1,0) 贴身
  const before = (await getState(page)).hitFlashCount ?? 0
  const e0 = (await getState(page)).units!.find((u) => u.id === 'e0')!
  await page.mouse.click(e0.screen.x, e0.screen.y) // 原地攻击
  const after = await getState(page)
  expect(after.hitFlashCount ?? 0).toBeGreaterThan(before)
})

test('信息面板：hover 部队 → 兵种/数量/伤兵剩余血', async ({ page }) => {
  await gotoBattle(page)
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
  await gotoBattle(page)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0) // 固定瞬时动画，聚焦 AI 行为结果（新默认 150ms 会让本测变慢）
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
  await page.waitForFunction(() => {
    const s = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return s?.scene === 'menu'
  })
})
