import { expect, test, type Page } from '@playwright/test'
import { gotoBattle, gotoBooted, MENU_BATTLE } from './helpers'

/**
 * 战斗 e2e：主菜单入口 + startBattle 确定性交互（刀剑冲锋/反击、远程满额/半额、移动即行动、信息面板、胜负循环）。
 * 模型无多模态：断言一律程序化（window.__game.getState()）；截图仅供人工目检。
 */
const MODAL = { confirm: { x: 1090, y: 620 }, cancel: { x: 830, y: 620 }, close: { x: 960, y: 620 } }
const RETURN = { x: 960, y: 580 }

interface UnitState {
  id: string
  side: string
  defId: string
  gridLabel?: string
  count: number
  position: { q: number; r: number }
  size: number
  hpLeft: number
  maxHp: number
  hasActed: boolean
  hasMoved: boolean
  retaliated: boolean
  defending?: boolean
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
  reachableFootprint?: { q: number; r: number }[]
  hover?: {
    ghostHex?: { q: number; r: number } | null
    cursorKind?: string
    swordTargetId?: string | null
    swordHex?: { q: number; r: number } | null
    swordAdjHex?: { q: number; r: number } | null
    blinkId?: string | null
  }
  infoPanelText?: string | null
  menu?: { buttonsEnabled?: boolean }
  log?: string[]
  camera?: { scrollX?: number; scrollY?: number }
  animating?: boolean
  actionGapMs?: number
  hitFlashCount?: number
  textOk?: boolean
  units?: UnitState[]
  normalQueue?: string[]
  waitQueue?: string[]
  completedQueue?: string[]
  turnQueue?: { unitId: string; side: string; defId: string; hasActed: boolean; segment: 'done' | 'normal' | 'wait' }[]
  modal?: { open: boolean; title: string; message: string } | null
  battleResult?: { outcome: string } | null
  actionButtons?: Record<string, { x: number; y: number }>
}

const getState = (page: Page): Promise<DebugGameState> =>
  page.evaluate(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState() ?? {})

/** 点击底部行动条按钮：坐标从 debug state 的 actionButtons 读（方形按钮放大后中心位移，不硬编码） */
const clickAction = async (page: Page, key: string): Promise<void> => {
  const ab = (await getState(page)).actionButtons!
  const c = ab[key]!
  await page.mouse.click(c.x, c.y)
}

const waitBattleReady = (page: Page) =>
  page.waitForFunction(() => {
    const s = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return s?.ready === true && s?.scene === 'battle' && s?.phase === 'combat'
  })

type Army = { side: 'player' | 'enemy'; generalName: string; atkBonus: number; defBonus: number; units: { defId: string; count: number; speed?: number }[] }

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
  expect(s.grid).toEqual(expect.objectContaining({ cols: 15, rows: 11 }))
  expect(s.obstacles).toHaveLength(6)
  expect(s.actionGapMs).toBe(700) // 每步行动间隔默认 700ms（setAnimationSpeed(0) 时归零）
  expect(s.units).toHaveLength(8) // 玩家4 + 敌方4
  expect(s.units?.find((u) => u.defId === 'cavalry')?.size).toBe(2)
  // 敌方刀兵放在骑兵右侧 4 格 (5,3)：speed3 骑兵主格到 (3,3)、东邻格 (4,3) 贴它可攻击（测东邻格贴敌）
  const enemySword = s.units!.find((u) => u.defId === 'swordsman' && u.side === 'enemy')!
  expect(enemySword.position).toEqual({ q: 5, r: 3 })
  // 格上中央大字来自配置 gridLabel（民/刀/弓/枪/骑兵）
  const labels = Object.fromEntries(s.units!.map((u) => [u.id, u.gridLabel]))
  expect(labels.p0).toBe('民')
  expect(labels.p1).toBe('刀')
  expect(labels.p2).toBe('弓')
  expect(labels.p3).toBe('骑兵')
  expect(labels.e1).toBe('枪')
  await page.screenshot({ path: 'screenshots/battle-field-rect.png' })
})

test('主菜单进入战斗：按钮点击的收尾 pointerup 不得触发误移动（防抖）', async ({ page }) => {
  // 回归：主菜单「战斗测试」按钮 pointerdown 切场后，同一次点击的收尾 pointerup 会泄漏进
  // 新 BattleScene 的全局 pointerup 监听 → 吞掉，不得触发任何行动。
  // 真实用户点击按下后保持若干帧再松开（Playwright 默认 click 同帧 down+up 不会复现），
  // 故显式 down → 保持 → up。
  await gotoBooted(page)
  await page.mouse.move(MENU_BATTLE.x, MENU_BATTLE.y)
  await page.mouse.down()
  await page.waitForTimeout(100)
  await page.mouse.up()
  await waitBattleReady(page)
  const s = await getState(page)
  // 骑兵 speed3 是唯一机动单位、最先行动；所有单位都应停留在出生位、未行动
  expect(s.currentUnitId).toBe('p3')
  for (const u of s.units!) {
    expect(u.hasActed).toBe(false) // 泄漏的 pointerup 被吞掉，无任何误行动
  }
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
  expect(e0a.hpLeft).toBe(366)    // 刀兵20×hp20=400 - 34
  expect(p0.hpLeft).toBe(116)     // 民兵20×hp10=200 - 84（反击）
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
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 3 }] },
    { cols: 3, rows: 3 }) // p0 (0,0) 与 e0 (1,0) 出生即贴身；e0 3×hp10=30 池
  const s = await getState(page)
  expect(s.currentUnitId).toBe('p0')
  const e0 = s.units!.find((u) => u.id === 'e0')!
  // 悬停敌军本体 → 刀剑（原地攻击光标）
  await page.mouse.move(e0.screen.x, e0.screen.y)
  expect((await getState(page)).hover?.cursorKind).toBe('sword')
  // 点击敌军本体 → 原地攻击：位置不变、民兵 20×hp10=200 池伤 40 → e0 3 池全灭
  await page.mouse.click(e0.screen.x, e0.screen.y)
  const after = await getState(page)
  const p0 = after.units!.find((u) => u.id === 'p0')!
  expect(p0.position).toEqual({ q: 0, r: 0 })
  expect(p0.hasActed).toBe(true)
  expect(after.units!.find((u) => u.id === 'e0')).toBeUndefined()
})

test('近战贴身（1×2 骑兵）：刀剑锚在「东邻格↔敌军」边界而非主体格内', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'cavalry', count: 8 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }] },
    { cols: 4, rows: 3 }) // 骑兵 p0 (0,0) 占 (0,0)+(1,0)，敌 e0 (2,0) 贴东邻格 (1,0)
  const s = await getState(page)
  expect(s.currentUnitId).toBe('p0')
  const e0 = s.units!.find((u) => u.id === 'e0')!
  await page.mouse.move(e0.screen.x, e0.screen.y)
  const hov = (await getState(page)).hover
  expect(hov?.cursorKind).toBe('sword')
  expect(hov?.swordHex).toEqual({ q: 0, r: 0 }) // 攻击落点=原地（主体格）
  expect(hov?.swordAdjHex).toEqual({ q: 1, r: 0 }) // 刀剑画在与目标相邻的东邻格边界上
})

test('1×2 骑兵：可达高亮覆盖完整占地 + 东邻格贴敌可攻击（不依赖主格相邻）', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  // 骑兵 p0 (0,0) speed4（与 militia 平速攻方先行）占 (0,0)+(1,0)；敌 e0 (5,0)。主格到 (3,0)、东邻格 (4,0) 贴 e0
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'cavalry', count: 50, speed: 4 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }] },
    { cols: 7, rows: 3 })
  const s = await getState(page)
  expect(s.currentUnitId).toBe('p0')
  // 可达高亮覆盖完整占地：(4,0) 是主格 (3,0) 的东邻格，应在高亮内（不是暗格）
  expect(s.reachableFootprint!.some((h) => h.q === 4 && h.r === 0)).toBe(true)
  // 悬停 (4,0)↔(5,0) 边界 → 刀剑指向 e0（东邻格贴敌，主格 (3,0) 不贴）
  const e0 = s.units!.find((u) => u.id === 'e0')!
  const ex = e0.screen.x - (36 * Math.sqrt(3)) / 2
  await page.mouse.move(ex, e0.screen.y)
  const hov = (await getState(page)).hover
  expect(hov?.cursorKind).toBe('sword')
  expect(hov?.swordTargetId).toBe('e0')
  expect(hov?.swordAdjHex).toEqual({ q: 4, r: 0 }) // 刀剑锚在贴敌的东邻格边界
  // 点击 → 攻击落点主格 (3,0)，灭 e0（骑兵50 伤 422 > militia50 血池）
  await page.mouse.click(ex, e0.screen.y)
  const after = await getState(page)
  expect(after.units!.find((u) => u.id === 'p0')!.position).toEqual({ q: 3, r: 0 })
  expect(after.units!.find((u) => u.id === 'e0')).toBeUndefined()
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
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'archer', count: 10 }, { defId: 'militia', count: 10 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }] },
    { cols: 5, rows: 3 }) // e0 (3,0)，距离 3 ≤ 6 → 满额；射完轮到己方 militia → 敌方不介入
  const s = await getState(page)
  expect(s.currentUnitId).toBe('p0')
  const e0 = s.units!.find((u) => u.id === 'e0')!
  await page.mouse.move(e0.screen.x, e0.screen.y)
  expect((await getState(page)).hover?.cursorKind).toBe('bow')
  await page.mouse.click(e0.screen.x, e0.screen.y)
  await page.waitForTimeout(80)
  expect((await getState(page)).units!.find((u) => u.id === 'e0')!.hpLeft).toBe(467) // 民兵50×hp10=500-33
  await page.screenshot({ path: 'screenshots/battle-bow-full.png' })
  // 断箭：e0 距离 7（另一场 startBattle 重置）
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'archer', count: 10 }, { defId: 'militia', count: 10 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }] },
    { cols: 9, rows: 3 }) // e0 (7,0)，距离 7 > 6 → 半额
  const s2 = await getState(page)
  const e0b = s2.units!.find((u) => u.id === 'e0')!
  await page.mouse.move(e0b.screen.x, e0b.screen.y)
  expect((await getState(page)).hover?.cursorKind).toBe('broken-arrow')
  await page.mouse.click(e0b.screen.x, e0b.screen.y)
  await page.waitForTimeout(80)
  expect((await getState(page)).units!.find((u) => u.id === 'e0')!.hpLeft).toBe(483) // 500-17
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

test('标准化 battle log：getLog / exportState（后台日志 + 状态导出）', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  await startBattle(page,
    { side: 'player', generalName: '关羽', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }] },
    { side: 'enemy', generalName: '吕布', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }] },
    { cols: 7, rows: 3 })
  const s = await getState(page)
  const reach1 = s.reachable!.find((h) => h.q === 1 && h.r === 0)!
  await page.mouse.click(reach1.screen.x, reach1.screen.y) // 移动
  // 后台 log（标准化格式：回合·武将·兵种·位置）
  const log = await page.evaluate(() => (window as { __game?: { getLog(): string } }).__game?.getLog() ?? '')
  expect(log).toContain('第1回合 关羽的民兵 移动到 (1,0)')
  // 导出状态为 JSON（复现 / debug）
  const exp = await page.evaluate(() => (window as { __game?: { exportState(): string } }).__game?.exportState() ?? '{}')
  const parsed = JSON.parse(exp) as { units?: unknown[]; log?: string[] }
  expect(parsed.units).toBeDefined()
  expect(parsed.log?.length).toBeGreaterThan(0)
})

test('拖拽可平移战场相机（且不误触点击移动）', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }] },
    { cols: 7, rows: 3 })
  const before = (await getState(page)).camera!
  // 拖拽：按住并向右下移动一段距离
  await page.mouse.move(960, 540)
  await page.mouse.down()
  await page.mouse.move(1100, 640, { steps: 5 })
  await page.mouse.up()
  const after = (await getState(page)).camera!
  expect(after.scrollX).not.toBe(before.scrollX)
  expect(after.scrollY).not.toBe(before.scrollY)
  // 拖拽后点击可达格移动仍有效（screen 坐标已含相机偏移）
  const s = await getState(page)
  const reach1 = s.reachable!.find((h) => h.q === 1 && h.r === 0)!
  await page.mouse.click(reach1.screen.x, reach1.screen.y)
  expect((await getState(page)).units!.find((u) => u.id === 'p0')!.position).toEqual({ q: 1, r: 0 })
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

test('远程攻击：攻方与被攻击方都闪烁（hitFlashCount +2）', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'archer', count: 10 }, { defId: 'militia', count: 10 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }] },
    { cols: 5, rows: 3 }) // archer p0 (0,0) 距 e0 (3,0) 3 ≤ 射程 6；射击后轮到 p1（玩家）→ 无敌方介入
  const before = (await getState(page)).hitFlashCount ?? 0
  const e0 = (await getState(page)).units!.find((u) => u.id === 'e0')!
  await page.mouse.move(e0.screen.x, e0.screen.y)
  await page.mouse.click(e0.screen.x, e0.screen.y) // 远程射击
  const after = await getState(page)
  expect(after.hitFlashCount ?? 0).toBe(before + 2) // 攻方 + 目标各闪一次（550ms）
})

test('近战反击：目标存活反击时攻守双方都闪（hitFlashCount +2）', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }, { defId: 'militia', count: 20 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }] },
    { cols: 3, rows: 3 }) // p0 (0,0) 与 e0 (1,0) 贴身；主攻 40 → e0 160；反击 16×2=32 → p0 168；打完后轮到己方 p1
  const before = (await getState(page)).hitFlashCount ?? 0
  const e0 = (await getState(page)).units!.find((u) => u.id === 'e0')!
  await page.mouse.click(e0.screen.x, e0.screen.y) // 原地近战 → 双方都掉血
  const after = await getState(page)
  expect(after.hitFlashCount ?? 0).toBe(before + 2) // 主攻目标 + 反击方各闪一次（敌方不再介入）
  expect(after.units!.find((u) => u.id === 'p0')!.hpLeft).toBe(168)
  expect(after.units!.find((u) => u.id === 'e0')!.hpLeft).toBe(160)
})

test('AI 攻击被我方反击打死：反击段结算前敌方仍存活（分段不提前消失）', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  // 不设 setAnimationSpeed(0)：保留 700ms 行动间隔，可捕捉"敌攻击后→反击前"的中间状态
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'swordsman', count: 20 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 4 }] },
    { cols: 3, rows: 3 }) // p0 刀兵 (0,0) 与 e0 民兵 (1,0) 贴身
  await clickAction(page, 'defend') // 守结束玩家行动 → 敌方贴身攻击 → 我方反击秒杀敌方
  // 敌方主攻已 dispatch、反击还没结算：敌方应仍存活（分段结算）
  await page.waitForFunction(() => {
    const s = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return s?.log?.some((l) => l.includes('E的民兵 攻击 P的刀兵'))
  })
  expect((await getState(page)).units!.find((u) => u.id === 'e0')).toBeDefined()
  // 反击段结算后：敌方被消灭
  await page.waitForFunction(() => {
    const s = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return s?.log?.some((l) => l.includes('P的刀兵 反击 E的民兵'))
  })
  expect((await getState(page)).units!.find((u) => u.id === 'e0')).toBeUndefined()
})

test('冲锋动画期间鼠标移开：攻击仍应命中（不还原）', async ({ page }) => {
  // 回归：旧逻辑在 await 冲锋动画后才读 this.hover.swordTargetId，动画期间鼠标移动会改写 hover
  // → dispatch 用失效 targetId 被拒绝 → 动画播放后状态还原（骑兵回原位、敌方无伤）。
  await gotoBattle(page)
  await waitBattleReady(page)
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'swordsman', count: 20 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 8 }] },
    { cols: 5, rows: 3 }) // p0 刀兵 (0,0) 距 e0 (3,0)，冲锋到 (2,0) 约 300ms；88 伤 > 民兵8×hp10=80 灭 e0，自身存活
  const s = await getState(page)
  const e0 = s.units!.find((u) => u.id === 'e0')!
  const ex = e0.screen.x - (36 * Math.sqrt(3)) / 2 // (2,0)↔(3,0) 共享边界
  await page.mouse.move(ex, e0.screen.y)
  expect((await getState(page)).hover?.cursorKind).toBe('sword')
  await page.mouse.click(ex, e0.screen.y) // 触发冲锋
  await page.waitForTimeout(100) // 冲锋动画进行中
  await page.mouse.move(100, 100) // 移到空地，改写 hover（swordTargetId → null）
  await page.evaluate(() => (window as { __game?: { waitForMove(): Promise<void> } }).__game?.waitForMove())
  const after = await getState(page)
  const p0 = after.units!.find((u) => u.id === 'p0')!
  expect(p0.position).toEqual({ q: 2, r: 0 }) // 冲锋落点，不还原
  expect(after.units!.find((u) => u.id === 'e0')).toBeUndefined() // 造成伤害（灭 e0）
})

test('连续动画行动后所有单位格上文本仍在（textOk）', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }, { defId: 'militia', count: 50 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }] },
    { cols: 7, rows: 3 })
  // 默认动画速度，先后移动 p0 / p1（各两步），检查文本对象仍存活
  let s = await getState(page)
  const t0 = s.reachable!.find((h) => h.q === 2 && h.r === 0)!
  await page.mouse.click(t0.screen.x, t0.screen.y)
  await page.evaluate(() => (window as { __game?: { waitForMove(): Promise<void> } }).__game?.waitForMove())
  s = await getState(page)
  expect(s.currentUnitId).toBe('p1')
  const t1 = s.reachable!.find((h) => h.q === 2 && h.r === 1)!
  await page.mouse.click(t1.screen.x, t1.screen.y)
  await page.evaluate(() => (window as { __game?: { waitForMove(): Promise<void> } }).__game?.waitForMove())
  expect((await getState(page)).textOk).toBe(true)
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
  expect(panel).toContain('伤兵剩余：20') // swordsman hp20，12 满编 → 末位 240-11×20=20
  expect(panel).toContain('单兵血量：20') // swordsman hp20
  await page.screenshot({ path: 'screenshots/battle-info-panel.png' })
})

test('默认战斗：反复跳过 → AI 冲锋/射击 → 战败 → 返回主菜单', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0) // 固定瞬时动画，聚焦 AI 行为结果（新默认 150ms 会让本测变慢）
  let guard = 0
  let s: DebugGameState = await getState(page)
  while (s.phase === 'combat' && guard++ < 120) {
    await clickAction(page, 'defend')
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

test('降后重新进入：战斗状态/相机/拖拽状态全部重置（无跨场景残留）', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  const initial = (await getState(page)).camera!
  // 移动一个单位 + 拖拽相机，制造状态
  let s = await getState(page)
  const reach1 = s.reachable!.find((h) => h.q === 1 && h.r === 0)!
  await page.mouse.click(reach1.screen.x, reach1.screen.y)
  await page.mouse.move(960, 540)
  await page.mouse.down()
  await page.mouse.move(1100, 640, { steps: 5 })
  await page.mouse.up()
  // 降 → 确认弹窗 → 确认 → 结果界面 → 返回主菜单
  await clickAction(page, 'surrender')
  await page.waitForFunction(() => {
    const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return st?.modal?.open === true && st?.modal?.title === '确认'
  })
  await page.mouse.click(MODAL.confirm.x, MODAL.confirm.y)
  await page.waitForFunction(() => {
    const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return st?.phase === 'lost' && st?.battleResult?.outcome === 'surrendered'
  })
  // 先移动指针到返回按钮上：弹窗关闭后返回按钮是「新显示」的，Phaser 输入系统要等一次
  // pointermove 才会把它登记进当前指针命中列表，直接 click（move+down+up 同帧）会漏点（down 未命中）。
  await page.mouse.move(RETURN.x, RETURN.y)
  await page.mouse.click(RETURN.x, RETURN.y)
  await page.waitForFunction(() => {
    const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return st?.scene === 'menu' && st?.menu?.buttonsEnabled === true
  })
  await page.waitForTimeout(1500) // 等场景切换完全稳定（否则紧贴的点击可能落在切换中的输入上）
  // 重新进入战斗
  await page.mouse.click(MENU_BATTLE.x, MENU_BATTLE.y)
  await waitBattleReady(page)
  const fresh = await getState(page)
  // 状态重置：p0 回出生位、未行动；当前单位 = 骑兵（速度 9 最先）
  expect(fresh.currentUnitId).toBe('p3')
  expect(fresh.units!.find((u) => u.id === 'p0')!.position).toEqual({ q: 0, r: 0 })
  expect(fresh.units!.find((u) => u.id === 'p0')!.hasActed).toBe(false)
  // 相机重置回初始（无残留偏移）
  expect(fresh.camera!.scrollX).toBe(initial.scrollX)
  expect(fresh.camera!.scrollY).toBe(initial.scrollY)
  // 拖拽状态重置：轻微移动鼠标不应平移相机（若 dragging 残留则会平移）
  const camBefore = (await getState(page)).camera!
  await page.mouse.move(900, 500)
  const camAfter = (await getState(page)).camera!
  expect(camAfter.scrollX).toBe(camBefore.scrollX)
  expect(camAfter.scrollY).toBe(camBefore.scrollY)
})

test('行动顺序条：队列 = state.normalQueue 派生，首格=当前单位，开局全员未行动', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  const s = await getState(page)
  const q = s.turnQueue!
  expect(q.map((e) => e.unitId)).toEqual(s.normalQueue)
  expect(q[0]!.unitId).toBe(s.currentUnitId) // 骑兵 speed9 最先行动
  expect(q.filter((e) => e.side === 'player')).toHaveLength(4)
  expect(q.every((e) => !e.hasActed)).toBe(true)
  await page.screenshot({ path: 'screenshots/battle-turn-order-bar.png' })
})

test('行动顺序条：行动后该格灰掉（hasActed），高亮移到下一单位', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }, { defId: 'militia', count: 50 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }] },
    { cols: 7, rows: 3 }) // 同速 → order=[p0,p1,e0]，p0 先动
  let s = await getState(page)
  expect(s.currentUnitId).toBe('p0')
  const reach = s.reachable!.find((h) => h.q === 1 && h.r === 0)!
  await page.mouse.click(reach.screen.x, reach.screen.y) // p0 移动即行动
  s = await getState(page)
  const q = s.turnQueue!
  expect(q.map((e) => e.unitId)).toEqual(['p0', 'p1', 'e0']) // 本回合 order 不变
  expect(q.find((e) => e.unitId === 'p0')!.hasActed).toBe(true) // 灰掉
  expect(s.currentUnitId).toBe('p1') // 高亮移到下一格
})

test('行动顺序条：整回合结束按剩余部队当前速度重排', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'cavalry', count: 8 }, { defId: 'militia', count: 10 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }] },
    { cols: 7, rows: 3 }) // p0 骑兵 speed9、p1 民兵 speed4、e0 民兵 speed4（同速玩家先行）
  let s = await getState(page)
  expect(s.currentUnitId).toBe('p0')
  expect(s.turnQueue!.map((e) => e.unitId)).toEqual(['p0', 'p1', 'e0'])
  await clickAction(page, 'defend') // 守结束 p0
  await clickAction(page, 'defend') // 守结束 p1 → 轮到 e0（AI 自动行动）
  await page.waitForFunction(() => {
    const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return st?.turn === 2
  })
  s = await getState(page)
  expect(s.turn).toBe(2)
  expect(s.turnQueue!.map((e) => e.unitId)).toEqual(['p0', 'p1', 'e0']) // 按速度重排，骑兵仍居首
  expect(s.turnQueue!.every((e) => !e.hasActed)).toBe(true)
  expect(s.currentUnitId).toBe('p0') // 高亮回到队首
})

test('行动顺序条不拦截地图交互：横条上拖拽平移相机、点击不触发行动', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  const cam0 = (await getState(page)).camera!
  const barY = 1080 - 44 // 通栏条中心（BAR_H=88）
  // 在横条上起手拖拽 → 相机仍平移（横条非 interactive）
  await page.mouse.move(960, barY)
  await page.mouse.down()
  await page.mouse.move(1040, barY + 20, { steps: 5 })
  await page.mouse.up()
  const cam1 = (await getState(page)).camera!
  expect(cam1.scrollX).not.toBe(cam0.scrollX)
  expect(cam1.scrollY).not.toBe(cam0.scrollY)
  // 点击横条 → 无移动/选中/行动（底部坐标换算为界外 hex → 自然 no-op）
  const before = await getState(page)
  await page.mouse.click(960, barY)
  const after = await getState(page)
  expect(after.currentUnitId).toBe(before.currentUnitId)
  expect(after.selectedUnitId).toBeNull()
  for (const u of after.units!) expect(u.hasActed).toBe(false)
})

test('行动顺序条：中途减速/加速 → 队列重排（当前单位不被越过）', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  // p0 骑兵9 / p1 p2 民兵4 / e0 民兵4（同速玩家先行）
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'cavalry', count: 8 }, { defId: 'militia', count: 10 }, { defId: 'militia', count: 10 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }] },
    { cols: 7, rows: 3 })
  const applySpeedMod = (id: string, delta: number) =>
    page.evaluate(([unitId, d]) => (window as { __game?: { applySpeedMod?(unitId: string, delta: number): void } }).__game?.applySpeedMod?.(unitId, d), [id, delta] as const)
  let s = await getState(page)
  expect(s.currentUnitId).toBe('p0')
  expect(s.turnQueue!.map((e) => e.unitId)).toEqual(['p0', 'p1', 'p2', 'e0'])
  // 减速 e0 → e0 本就最后，序不动
  await applySpeedMod('e0', -2)
  expect((await getState(page)).turnQueue!.map((e) => e.unitId)).toEqual(['p0', 'p1', 'p2', 'e0'])
  // 减速 p1（现 2）→ p1 与 e0 同速，玩家先行 → 落到 e0 之后
  await applySpeedMod('p1', -2)
  expect((await getState(page)).turnQueue!.map((e) => e.unitId)).toEqual(['p0', 'p2', 'p1', 'e0'])
  // 加速 p1 +5（现 7）→ 上移到紧接当前 p0 之后
  await applySpeedMod('p1', 5)
  expect((await getState(page)).turnQueue!.map((e) => e.unitId)).toEqual(['p0', 'p1', 'p2', 'e0'])
  // 加速 p2 +5（现 9，与 p0 平速）→ 仍不能越过当前单位，紧接其后
  await applySpeedMod('p2', 5)
  expect((await getState(page)).turnQueue!.map((e) => e.unitId)).toEqual(['p0', 'p2', 'p1', 'e0'])
  await page.screenshot({ path: 'screenshots/battle-turn-order-speedmod.png' })
})

test('等待：点【候】→ 单位入 waitQueue（turnQueue 显示 wait 段，等待不算行动）', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  const before = await getState(page)
  const waited = before.currentUnitId!
  await clickAction(page, 'wait')
  const s = await getState(page)
  expect(s.waitQueue).toHaveLength(1)
  expect(s.waitQueue).toContain(waited)
  expect(s.turnQueue!.find((e) => e.unitId === waited)!.segment).toBe('wait')
  expect(s.completedQueue).toHaveLength(0) // 等待不算行动
})

test('防御：点【守】→ defending=true + hasActed + 落 completedQueue', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  const before = await getState(page)
  const defender = before.currentUnitId!
  await clickAction(page, 'defend')
  const s = await getState(page)
  const unit = s.units!.find((u) => u.id === defender)!
  expect(unit.defending).toBe(true)
  expect(unit.hasActed).toBe(true)
  expect(s.completedQueue).toContain(defender)
})

test('技能：点【技】→ 弹窗出现（modal.open=true），可关闭', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  await clickAction(page, 'skill')
  await page.waitForFunction(() => {
    const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return st?.modal?.open === true
  })
  await page.mouse.click(MODAL.close.x, MODAL.close.y) // 关闭按钮（openInfo 用居中 close 按钮）
  await page.waitForFunction(() => {
    const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return st?.modal == null
  })
})

test('议和：点【和】→ 弹窗文案含保释金 → 确认 → phase=negotiated + battleResult', async ({ page }) => {
  await gotoBattle(page)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  // 用最小阵容开局：保释金（仅我方部队 ×1.5）远低于 playerGold=10000，议和确定可执行
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 5 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 5 }] },
    { cols: 5, rows: 3 })
  await clickAction(page, 'negotiate')
  await page.waitForFunction(() => {
    const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return st?.modal?.open === true
  })
  const s = await getState(page)
  expect(s.modal?.message).toContain('支付')
  expect(s.modal?.message).toContain('议和')
  await page.mouse.click(MODAL.confirm.x, MODAL.confirm.y)
  await page.waitForFunction(() => {
    const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return st?.phase === 'negotiated'
  })
  expect((await getState(page)).battleResult?.outcome).toBe('negotiated')
})
