import { expect, test, type Page } from '@playwright/test'

/**
 * 主菜单 + 战斗系统 e2e：主菜单两入口、战斗内 选中→移动、跳过回合→AI 行动→胜负→返回主菜单。
 * 模型无多模态：断言一律程序化（window.__game.getState()）；截图仅供人工目检。
 * 点击约定（1920×1080 设计基准）：主菜单 开始游戏(960,594) / 战斗测试(960,734)；
 * 战斗「跳过行动」(1880,1040)、结果「返回主菜单」(960,580)。
 */
const MENU_START = { x: 960, y: 594 }
const MENU_BATTLE = { x: 960, y: 734 }
const SKIP = { x: 1880, y: 1040 }
const RETURN = { x: 960, y: 580 }

interface BattleUnitState {
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
  screen: { x: number; y: number }
}
interface DebugGameState {
  ready?: boolean
  scene?: string
  phase?: string
  turn?: number
  currentUnitId?: string | null
  selectedUnitId?: string | null
  units?: BattleUnitState[]
  reachable?: { q: number; r: number; screen: { x: number; y: number } }[]
}

const getState = (page: Page): Promise<DebugGameState> =>
  page.evaluate(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState() ?? {})

const waitBattleReady = (page: Page) =>
  page.waitForFunction(() => {
    const s = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return s?.ready === true && s?.scene === 'battle' && s?.phase === 'combat'
  })

const waitAdventureReady = (page: Page) =>
  page.waitForFunction(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.ready === true)

const clickUnit = async (page: Page, unitId: string) => {
  const u = (await getState(page)).units?.find((x) => x.id === unitId)
  expect(u).toBeDefined()
  await page.mouse.click(u!.screen.x, u!.screen.y)
}

test('主菜单 → 开始游戏 → 进入大地图', async ({ page }) => {
  await page.goto('/')
  await page.mouse.click(MENU_START.x, MENU_START.y)
  await waitAdventureReady(page)
  const s = await getState(page)
  expect(s.turn).toBe(1)
  expect(s.scene).not.toBe('battle')
  await page.screenshot({ path: 'screenshots/battle-menu-start-adventure.png' })
})

test('主菜单 → 战斗测试 → 进入战斗（7 单位、含 1×2 骑兵）', async ({ page }) => {
  await page.goto('/')
  await page.mouse.click(MENU_BATTLE.x, MENU_BATTLE.y)
  await waitBattleReady(page)
  const s = await getState(page)
  expect(s.units).toHaveLength(7) // 玩家4 + 敌方3
  expect(s.units?.filter((u) => u.side === 'player')).toHaveLength(4)
  expect(s.units?.find((u) => u.defId === 'cavalry')?.size).toBe(2) // 1×2 支持
  await page.screenshot({ path: 'screenshots/battle-field.png' })
})

test('战斗内：选中 → 移动；跳过全回合 → AI 行动 → 战败 → 返回主菜单', async ({ page }) => {
  await page.goto('/')
  await page.mouse.click(MENU_BATTLE.x, MENU_BATTLE.y)
  await waitBattleReady(page)

  // ① 选中当前单位（玩家骑兵 speed9 最先动）
  const curId = (await getState(page)).currentUnitId!
  await clickUnit(page, curId)
  expect((await getState(page)).selectedUnitId).toBe(curId)

  // ② 点击一个可达非自身格 → 移动
  const s = await getState(page)
  const cur = s.units!.find((u) => u.id === curId)!
  const target = s.reachable!.find((h) => !(h.q === cur.position.q && h.r === cur.position.r))!
  await page.mouse.click(target.screen.x, target.screen.y)
  const moved = (await getState(page)).units!.find((u) => u.id === curId)!
  expect(moved.position).toEqual({ q: target.q, r: target.r })

  // ③ 反复「跳过行动」直到战斗结束（敌方 AI 自动行动、玩家全跳过 → 战败）
  let guard = 0
  let s2: DebugGameState = await getState(page)
  while (s2.phase === 'combat' && guard++ < 120) {
    await page.mouse.click(SKIP.x, SKIP.y)
    s2 = await getState(page)
  }
  expect(s2.phase).toBe('lost')
  await page.screenshot({ path: 'screenshots/battle-result-lost.png' })

  // ④ 点「返回主菜单」→ 回主菜单（无激活场景 → ready=false）
  await page.mouse.click(RETURN.x, RETURN.y)
  await page.waitForFunction(
    () => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.ready === false
  )
})
