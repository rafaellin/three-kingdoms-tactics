import { expect, test } from '@playwright/test'
import { gotoAdventure } from './helpers'
import { generateMap } from '../core/map/MapGen'
import { computeVision, type Visibility } from '../core/fog/Fog'
import { findPath, reachableArea } from '../core/pathfinding/Pathfinding'
import { MapMovementCost } from '../core/pathfinding/MapMovementCost'
import { hexDistance, hexKey, HexLayout, type Axial } from '../core/hex/HexGrid'
import { getTerrain } from '../data/terrain'

/**
 * 大地图移动 + 战争迷雾 e2e 回归。
 * 策略：测试内用同一种子（42）跑 core 纯函数复算期望状态（视野/可达/路径/移动力），
 * 再与 window.__game.getState()（渲染层驱动同一 core 后的真实状态）逐项断言。
 * 模型无多模态：断言一律程序化；截图仅供人工目检。
 */

interface DebugGameState {
  ready?: boolean
  busy?: boolean
  hero?: { position: Axial; movementLeft: number; maxMovement: number }
  visibility?: { explored: number; unexplored: number }
}

// ---- 与渲染层一致的常量 / core 复算工具 ----
const SEED = 42
const MAP_RADIUS = 6
const SIGHT_RANGE = 3
const MAX_MOVEMENT = 6
const VIEW_W = 1920
const VIEW_H = 1080

const map = generateMap(SEED, MAP_RADIUS)
const terrainAt = (h: Axial) => map.terrain[hexKey(h)] ?? 'plain'
const layout = new HexLayout({ size: 36, origin: { x: 0, y: 0 } })
const START: Axial = { q: 0, r: 0 }

const visionFor = (pos: Axial, oldFog: Record<string, Visibility>): Record<string, Visibility> =>
  computeVision({
    sources: [{ position: pos, sightRange: SIGHT_RANGE }],
    mapHexes: map.hexes,
    terrainAt,
    oldFog
  })

const makeCosts = (fog: Record<string, Visibility>): MapMovementCost =>
  new MapMovementCost({ terrainAt, fogAt: (h) => fog[hexKey(h)] })

const countFog = (fog: Record<string, Visibility>): { explored: number; unexplored: number } => {
  const c = { explored: 0, unexplored: 0 }
  for (const v of Object.values(fog)) c[v]++
  return c
}

/** 路径总移动代价（与 reducer 扣减口径一致） */
const pathCost = (path: Axial[]): number => {
  let total = 0
  for (let i = 1; i < path.length; i++) total += getTerrain(terrainAt(path[i] as Axial)).moveCost
  return total
}

/** 沿路径逐步重算视野（复现 reducer 的逐格 computeVision） */
const fogAlong = (path: Axial[], startFog: Record<string, Visibility>): Record<string, Visibility> => {
  let fog = startFog
  for (let i = 1; i < path.length; i++) fog = visionFor(path[i] as Axial, fog)
  return fog
}

/** 地图中心（世界原点）在屏幕中心 1920×1080；hex → 屏幕像素 */
const hexToScreen = (h: Axial): { x: number; y: number } => {
  const p = layout.hexToPixel(h)
  return { x: VIEW_W / 2 + p.x, y: VIEW_H / 2 + p.y }
}

/** 取一个距起点 ≥2 格、且当前可达的目标格（确保多步移动 + 视野前推） */
const pickTarget = (fog: Record<string, Visibility>): Axial => {
  const reachable = reachableArea(START, MAX_MOVEMENT, makeCosts(fog))
  const candidates = reachable.filter((h) => hexDistance(START, h) >= 2)
  expect(candidates.length).toBeGreaterThan(0)
  return candidates[0] as Axial
}

const getState = (page: import('@playwright/test').Page): Promise<DebugGameState> =>
  page.evaluate(() => {
    const g = (window as { __game?: { getState(): DebugGameState } }).__game
    return g?.getState() ?? {}
  })


const waitHeroAt = (page: import('@playwright/test').Page, pos: Axial) =>
  page.waitForFunction(
    (t) => {
      const s = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
      return s?.hero?.position?.q === t.q && s?.hero?.position?.r === t.r
    },
    pos
  )

test('初始化：hero 就位 (0,0)、移动力 6、视野 = 同种子 core 复算（无阻挡 BFS 半径 3）', async ({ page }) => {
  await gotoAdventure(page)

  const s = await getState(page)
  expect(s.hero?.position).toEqual({ q: 0, r: 0 })
  expect(s.hero?.movementLeft).toBe(MAX_MOVEMENT)
  // 初始视野 = 同种子 core 复算（起点周围已探索、远处未探索）
  expect(s.visibility?.explored).toBeGreaterThan(0)
  expect(s.visibility?.unexplored).toBeGreaterThan(0)
  expect(s.visibility).toEqual(countFog(visionFor(START, {})))
})

test('点击可达格：A* 路径逐格移动、移动力扣除、迷雾逐步揭开、未探索格不可入', async ({ page }) => {
  await gotoAdventure(page)
  await page.evaluate(() => (window as { __game?: { setAnimationSpeed(n: number): void } }).__game?.setAnimationSpeed(0))

  const startFog = visionFor(START, {})
  const target = pickTarget(startFog)
  const path = findPath(START, target, makeCosts(startFog))
  expect(path).not.toBeNull()
  expect(path!.length).toBeGreaterThan(1)

  const targetScreen = hexToScreen(target)
  await page.mouse.click(targetScreen.x, targetScreen.y)
  await waitHeroAt(page, target)

  const s = await getState(page)
  // 位置与移动力（含小数地形代价）
  expect(s.hero?.position).toEqual(target)
  expect(s.hero?.movementLeft).toBeCloseTo(MAX_MOVEMENT - pathCost(path!))
  // 迷雾 = 逐格重算期望；且移动后探索范围必然扩大（前方新格揭开为 explored）
  const newFog = fogAlong(path!, startFog)
  expect(s.visibility).toEqual(countFog(newFog))
  expect(s.visibility?.explored ?? 0).toBeGreaterThan(countFog(startFog).explored ?? 0)

  // 迷雾边界：点击未探索格不应移动
  const unexploredKey = Object.entries(newFog).find(([, v]) => v === 'unexplored')?.[0]
  expect(unexploredKey).toBeDefined()
  const [eq, er] = unexploredKey!.split(',').map(Number) as [number, number]
  const before = s.hero?.position
  const unexploredScreen = hexToScreen({ q: eq, r: er })
  await page.mouse.click(unexploredScreen.x, unexploredScreen.y)
  await page.waitForFunction(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.busy === false)
  expect((await getState(page)).hero?.position).toEqual(before)

  // 截图供人工目检：迷雾两态（黑=未探索 / 正常渲染=已探索永久可见）+ 移动后视野前推 + hero 位置
  await page.screenshot({ path: 'screenshots/movement.png' })
})

test('移动动画：默认步进耗时下 busy 期间移动，动画结束后状态一致', async ({ page }) => {
  await gotoAdventure(page)

  const startFog = visionFor(START, {})
  const target = pickTarget(startFog)
  const path = findPath(START, target, makeCosts(startFog))
  expect(path).not.toBeNull()

  const targetScreen = hexToScreen(target)
  await page.mouse.click(targetScreen.x, targetScreen.y)
  // 动画播放中 busy=true
  await page.waitForFunction(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.busy === true)
  // 等待动画完成
  await page.evaluate(() => (window as { __game?: { waitForMove(): Promise<void> } }).__game?.waitForMove())

  const s = await getState(page)
  expect(s.hero?.position).toEqual(target)
  expect(s.hero?.movementLeft).toBeCloseTo(MAX_MOVEMENT - pathCost(path!))
  expect(s.busy).toBe(false)
})
