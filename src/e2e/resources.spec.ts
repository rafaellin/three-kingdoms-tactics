import { expect, test } from '@playwright/test'
import { gotoAdventure } from './helpers'
import { generateMap } from '../core/map/MapGen'
import { computeVision, type Visibility } from '../core/fog/Fog'
import { findPath, reachableArea } from '../core/pathfinding/Pathfinding'
import { MapMovementCost } from '../core/pathfinding/MapMovementCost'
import { hexKey, HexLayout, type Axial } from '../core/hex/HexGrid'
import { BASE_MAX_MOVEMENT, BASE_SIGHT_RANGE } from '../core/state/GameState'
import { START_RESOURCES } from '../data/bootstrap'
import { RESOURCE_NODE_DEFS, type ResourceNodeType } from '../data/resourceNode'

/**
 * 大地图资源系统 e2e：资源条 / 宝箱拾取 / 占矿 / 结束回合 / 跨周结算。
 * 策略同 movement.spec：测试内用同一核心纯函数复算期望状态，与 window.__game.getState() 逐项断言。
 * 模型无多模态：断言一律程序化；截图仅供人工目检。
 *
 * 种子选择：seed 42（场景默认）下全部资源点初始在迷雾中，点击不可达；
 * seed 8 下宝箱 (0,2) 与木矿 (-3,0) 开局即已探索且可达，且两段路全在已探索格上，
 * 使 e2e 可一次点击直达。测试统一用 setSeed(8) 切换确定性地图。
 */

interface DebugGameState {
  ready?: boolean
  busy?: boolean
  seed?: number
  turn?: number
  week?: number
  currentFaction?: string
  currentPlayerId?: string | null
  hero?: { position: Axial; movementLeft: number; maxMovement: number }
  resources?: { gold: number; wood: number; stone: number; iron: number }
  /** HUD 显示的每日产出汇总（当前势力；城池+已占矿） */
  dailyIncome?: { gold: number; wood: number; stone: number; iron: number }
  /** HUD 流式布局：各资源列图标中心 x 与文本左沿 x（断言图标与 (+N) 文本不重叠） */
  hudLayout?: { resource: string; iconX: number; textX: number }[]
  nodeStates?: { picked: number; claimedMines: number }
  /** 当前渲染的资源点 hexKey（仅已探索区域；未探索资源不可见） */
  visibleNodes?: string[]
  towns?: { id: string; name: string; owner: string; level: number; position: Axial; garrison: { defId: string; count: number }[]; garrisonGeneralId: string | null; visitorGeneralId: string | null }[]
  /** 城池面板（打开时非空；点击城池格打开） */
  townPanel?: { open: boolean; name: string } | null
}

// ---- 与渲染层一致的常量 / core 复算工具 ----
const SEED = 8
const MAP_RADIUS = 6
const VIEW_W = 1920
const VIEW_H = 1080
const START: Axial = { q: 0, r: 0 }

const map = generateMap(SEED, MAP_RADIUS)
const terrainAt = (h: Axial) => map.terrain[hexKey(h)] ?? 'plain'
const layout = new HexLayout({ size: 36, origin: { x: 0, y: 0 } })

/** 开局视野（与 reducer setup 同口径：sight 3 从出生点 BFS） */
const initialFog = computeVision({
  sources: [{ position: START, sightRange: BASE_SIGHT_RANGE }],
  mapHexes: map.hexes,
  terrainAt,
  oldFog: {}
})

const costWithFog = (fog: Record<string, Visibility>) =>
  new MapMovementCost({ terrainAt, fogAt: (h) => fog[hexKey(h)] ?? 'unexplored' })

const parseKey = (k: string): Axial => {
  const m = /^(-?\d+),(-?\d+)$/.exec(k)
  if (!m) throw new Error(`bad key ${k}`)
  return { q: Number(m[1]), r: Number(m[2]) }
}

/** 开局已探索且可达的指定类型资源点（seed 8 必存在，见文件头注） */
const nodeOf = (kind: 'chest' | 'mine'): Axial => {
  const reachable = reachableArea(START, BASE_MAX_MOVEMENT, costWithFog(initialFog)).map(hexKey)
  for (const [k, type] of Object.entries(map.nodes)) {
    const isMine = kind === 'mine' ? type !== 'chest' : type === 'chest'
    if (!isMine) continue
    if (initialFog[k] !== 'explored') continue
    if (!reachable.includes(k)) continue
    return parseKey(k)
  }
  throw new Error(`seed ${SEED} 无可达 ${kind}`)
}

const CHEST = nodeOf('chest')
const MINE = nodeOf('mine')

/** 沿路径逐格折叠视野（复现 reducer 每步 computeVision），返回最终 fog */
const foldVision = (path: Axial[], startFog: Record<string, Visibility>): Record<string, Visibility> => {
  let fog = startFog
  for (let i = 1; i < path.length; i++) {
    fog = computeVision({
      sources: [{ position: path[i] as Axial, sightRange: BASE_SIGHT_RANGE }],
      mapHexes: map.hexes,
      terrainAt,
      oldFog: fog
    })
  }
  return fog
}

/**
 * 给定 fog 下应渲染的资源点 hexKey 集合。
 * 未探索区域不渲染；已拾取的宝箱从地图移除（一次性资源 visited → 不再渲染）。
 * @param picked 已拾取的一次性资源 hexKey（宝箱）
 */
const visibleNodesFor = (fog: Record<string, Visibility>, picked: Set<string> = new Set()): string[] =>
  Object.entries(map.nodes)
    .filter(([k]) => fog[k] !== 'unexplored')
    .filter(([k, type]) => !RESOURCE_NODE_DEFS[type].oneTime || !picked.has(k))
    .map(([k]) => k)
    .sort()

/** hex → 屏幕像素（世界原点在视口中心，1920×1080） */
const hexToScreen = (h: Axial): { x: number; y: number } => {
  const p = layout.hexToPixel(h)
  return { x: VIEW_W / 2 + p.x, y: VIEW_H / 2 + p.y }
}

const getState = (page: import('@playwright/test').Page): Promise<DebugGameState> =>
  page.evaluate(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState() ?? {})


const waitHeroAt = (page: import('@playwright/test').Page, pos: Axial) =>
  page.waitForFunction(
    (t) => {
      const s = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
      return s?.hero?.position?.q === t.q && s?.hero?.position?.r === t.r
    },
    pos
  )

/** 点击某 hex 并等待英雄抵达（动画加速到 0，断言用终态） */
const clickAndWait = async (page: import('@playwright/test').Page, pos: Axial) => {
  const p = hexToScreen(pos)
  await page.mouse.click(p.x, p.y)
  await waitHeroAt(page, pos)
}

/** 连续按 E 推进回合，直到 pred 满足；每次按键后等状态变化（防双按竞态跳回合）；超过 cap 则抛错 */
const pressUntil = async (
  page: import('@playwright/test').Page,
  pred: (s: DebugGameState) => boolean,
  cap: number
): Promise<DebugGameState> => {
  for (let i = 0; i < cap; i++) {
    const s = await getState(page)
    if (pred(s)) return s
    const before = { faction: s.currentFaction, turn: s.turn }
    await page.keyboard.press('E')
    await page.waitForFunction(
      (b) => {
        const st = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
        return st?.currentFaction !== b.faction || st?.turn !== b.turn
      },
      before
    )
  }
  throw new Error(`pressUntil 超过 ${cap} 次仍未满足条件`)
}

const chestReward = () => ({
  gold: RESOURCE_NODE_DEFS.chest.oneTime?.gold ?? 0,
  wood: RESOURCE_NODE_DEFS.chest.oneTime?.wood ?? 0
})

test('初始化：资源条 = shu 初始资源、第1周第1天、成都城池位于 (0,0)、点城池不移动', async ({ page }) => {
  await gotoAdventure(page)
  await page.evaluate((seed) => (window as { __game?: { setSeed(seed: number): void } }).__game?.setSeed(seed), SEED)
  await page.evaluate(() => (window as { __game?: { setAnimationSpeed(ms: number): void } }).__game?.setAnimationSpeed(0))

  const s = await getState(page)
  expect(s.turn).toBe(1)
  expect(s.week).toBe(1)
  // 单玩家模型：currentPlayerId='p1'（蜀），无四势力轮转；currentFaction 为渲染派生
  expect(s.currentPlayerId).toBe('p1')
  expect(s.currentFaction).toBe('shu')
  // 资源条 = 蜀（关羽）初始资源
  expect(s.resources).toEqual(START_RESOURCES.p1!)
  // HUD 每日产出：成都 Lv1 → +10金/天；开局无占矿 → 木/石/铁 0
  expect(s.dailyIncome).toEqual({ gold: 10, wood: 0, stone: 0, iron: 0 })
  // HUD 流式布局：图标右沿（iconX+11）严格在文本左沿（textX）之前 → 图标不与 (+N) 文本重叠
  expect(s.hudLayout).toBeDefined()
  const hud = s.hudLayout!
  expect(hud).toHaveLength(4)
  for (const col of hud) expect(col.textX).toBeGreaterThan(col.iconX + 11)
  // 各列自左向右排布（后一列文本左沿在前一列之后）
  for (let i = 1; i < hud.length; i++) expect(hud[i]!.textX).toBeGreaterThan(hud[i - 1]!.textX)
  // 成都城池：属玩家 p1（蜀），Lv1，位于 (0,0)（与英雄出生点重合）；沙盒开局 garrisonGeneralId 指向关羽
  expect(s.towns).toEqual([
    { id: 't-chengdu', name: '成都', owner: 'p1', level: 1, position: { q: 0, r: 0 }, garrison: [], garrisonGeneralId: 'g-guan', visitorGeneralId: null }
  ])
  // 未探索区域资源不可见：渲染的资源点 = 仅开局已探索的那部分（与 core 复算一致）
  expect(s.visibleNodes).toEqual(visibleNodesFor(initialFog))
  // 点击城池格 → 打开城池面板（不触发移动），英雄仍在出生点
  const townScreen = hexToScreen({ q: 0, r: 0 })
  await page.mouse.click(townScreen.x, townScreen.y)
  await page.waitForFunction(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.townPanel?.open === true)
  expect((await getState(page)).hero?.position).toEqual({ q: 0, r: 0 })
  expect((await getState(page)).townPanel?.name).toBe('成都')

  // 截图交人工目检：顶部资源条 + 日期 + 成都城池方块（与 hero 圆点叠在 (0,0)）+ 打开的城池面板
  await page.screenshot({ path: 'screenshots/resources-hud.png' })
})

test('拾取宝箱：移动到宝箱格后一次性 +30金+5木，picked=1', async ({ page }) => {
  await gotoAdventure(page)
  await page.evaluate((seed) => (window as { __game?: { setSeed(seed: number): void } }).__game?.setSeed(seed), SEED)
  await page.evaluate(() => (window as { __game?: { setAnimationSpeed(ms: number): void } }).__game?.setAnimationSpeed(0))
  expect((await getState(page)).seed).toBe(SEED)

  await clickAndWait(page, CHEST)

  const s = await getState(page)
  expect(s.hero?.position).toEqual(CHEST)
  expect(s.resources).toEqual({
    gold: START_RESOURCES.p1!.gold + chestReward().gold,
    wood: START_RESOURCES.p1!.wood + chestReward().wood,
    stone: START_RESOURCES.p1!.stone,
    iron: START_RESOURCES.p1!.iron
  })
  expect(s.nodeStates?.picked).toBe(1)
  // 探索后新资源点变为可见：渲染集合 = 沿到达路径逐格折叠视野后的期望集合
  // （已拾宝箱从地图移除 → 从可见集合中排除）
  const leg1 = findPath(START, CHEST, costWithFog(initialFog))
  expect(leg1).not.toBeNull()
  expect(s.visibleNodes).toEqual(visibleNodesFor(foldVision(leg1!, initialFog), new Set([hexKey(CHEST)])))
})

test('占矿：走入无主矿格后 claimedMines=1、资源不变（未拾宝箱）', async ({ page }) => {
  await gotoAdventure(page)
  await page.evaluate((seed) => (window as { __game?: { setSeed(seed: number): void } }).__game?.setSeed(seed), SEED)
  await page.evaluate(() => (window as { __game?: { setAnimationSpeed(ms: number): void } }).__game?.setAnimationSpeed(0))

  await clickAndWait(page, MINE)

  const s = await getState(page)
  expect(s.hero?.position).toEqual(MINE)
  expect(s.nodeStates?.claimedMines).toBe(1)
  expect(s.nodeStates?.picked).toBe(0)
  expect(s.resources).toEqual(START_RESOURCES.p1!)
  // HUD 每日产出：成都 +10金/天 + 已占矿的 dailyBonus（按 seed 8 实际矿种算）
  const mineType = map.nodes[hexKey(MINE)] as ResourceNodeType
  const mineBonus = RESOURCE_NODE_DEFS[mineType].dailyBonus
  expect(s.dailyIncome).toEqual({ gold: 10, wood: 0, stone: 0, iron: 0, ...mineBonus })
  // 有 (+N) 时图标仍不与文本重叠（icon 右沿 < 文本左沿；该列文本带 +N 后缀仍不越界）
  const hud = s.hudLayout!
  expect(hud).toHaveLength(4)
  for (const col of hud) expect(col.textX).toBeGreaterThan(col.iconX + 11)
})

test('结束回合（E 键）：单玩家 p1 每按一次下一天（无四势力轮转），天数 +1、周不变', async ({ page }) => {
  await gotoAdventure(page)

  const s0 = await getState(page)
  expect(s0.turn).toBe(1)
  expect(s0.currentPlayerId).toBe('p1')
  expect(s0.currentFaction).toBe('shu')

  // 单玩家模型（players=[p1]）：圈回自己即进 system → 天数 +1，currentPlayerId 恒为 p1
  await page.keyboard.press('E')
  await page.waitForFunction(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.turn === 2)

  const s = await getState(page)
  expect(s.currentFaction).toBe('shu')
  expect(s.currentPlayerId).toBe('p1')
  expect(s.turn).toBe(2)
  expect(s.week).toBe(1)
})

test('每日结算：拾取宝箱 + 占矿后推进到第2周，城池每日产金 + 矿每日产出', async ({ page }) => {
  await gotoAdventure(page)
  await page.evaluate((seed) => (window as { __game?: { setSeed(seed: number): void } }).__game?.setSeed(seed), SEED)
  await page.evaluate(() => (window as { __game?: { setAnimationSpeed(ms: number): void } }).__game?.setAnimationSpeed(0))

  // ① 拾取宝箱（leg1 路径 0,0>0,1>0,2，cost 2）
  await clickAndWait(page, CHEST)
  expect((await getState(page)).nodeStates?.picked).toBe(1)
  // ② 过回合下一天（单玩家 p1 结束回合 = 下一天 + 移动力回满），再占木矿（leg2 路径 cost 5）
  await page.keyboard.press('E')
  await page.waitForFunction(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.turn === 2)
  await clickAndWait(page, MINE)
  expect((await getState(page)).nodeStates?.claimedMines).toBe(1)

  const noChest = (r: DebugGameState['resources']) => ({
    gold: (r?.gold ?? 0) - chestReward().gold,
    wood: (r?.wood ?? 0) - chestReward().wood
  })

  // ③ 推进到 turn=7（第1周）：每日结算已到账 6 次（单玩家每按 E 结算一次：turn 2..7）
  //    成都 Lv1 +10金/天 → +60金；木矿 +2木/天 → +10木（矿在 turn2 占领，结算自 turn3 起共 5 次）
  const s7 = await pressUntil(page, (s) => s.turn === 7, 40)
  expect(s7.week).toBe(1)
  expect(noChest(s7.resources)).toEqual({
    gold: START_RESOURCES.p1!.gold + 6 * 10,
    wood: START_RESOURCES.p1!.wood + 5 * 2
  })
  expect(s7.resources?.stone).toBe(START_RESOURCES.p1!.stone)
  expect(s7.resources?.iron).toBe(START_RESOURCES.p1!.iron)

  // ④ 再推进到 turn=8（第2周）：每日结算累计 7 次，成都 +70金、木矿 +12木（矿结算 6 次）
  const s8 = await pressUntil(page, (s) => s.turn === 8, 10)
  expect(s8.week).toBe(2)
  expect(noChest(s8.resources)).toEqual({
    gold: START_RESOURCES.p1!.gold + 7 * 10,
    wood: START_RESOURCES.p1!.wood + 6 * 2
  })
  expect(s8.resources?.stone).toBe(START_RESOURCES.p1!.stone)
  expect(s8.resources?.iron).toBe(START_RESOURCES.p1!.iron)

  // ⑤ 截图交人工目检：资源点渲染（宝箱/矿）、HUD 资源条、右侧面板「结束回合」按钮
  await page.screenshot({ path: 'screenshots/resources-crossweek.png' })
})
