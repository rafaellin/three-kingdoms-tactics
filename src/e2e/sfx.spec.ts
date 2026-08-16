import { expect, test } from '@playwright/test'
import { gotoAdventure } from './helpers'
import { generateMap } from '../core/map/MapGen'
import { computeVision, type Visibility } from '../core/fog/Fog'
import { reachableArea } from '../core/pathfinding/Pathfinding'
import { MapMovementCost } from '../core/pathfinding/MapMovementCost'
import { hexDistance, hexKey, HexLayout, type Axial } from '../core/hex/HexGrid'

/**
 * 移动音效 e2e 回归（渲染层）。
 *
 * 断言项：
 *  - assets/sound/ 音频就绪（ready）、默认音效音量（0.3）
 *  - 移动进行中：SFX 循环播放（loopPlaying=true）；且与 BGM **同时播放**（并发支持）
 *  - 移动结束：SFX 循环停止（loopPlaying=false），BGM 不受影响
 *
 * 无多模态：只断言状态流；实际听感由人工确认。
 */

interface SfxState {
  ready?: boolean
  volume?: number
  loopPlaying?: boolean
}

interface BgmState {
  playing?: boolean
}

interface DebugGameState {
  ready?: boolean
  hero?: { position?: Axial }
  bgm?: BgmState
  sfx?: SfxState
}

// ---- 与渲染层一致的常量 / core 复算工具（与 movement.spec 同口径） ----
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

/** 取一个距起点 ≥2 格、当前可达的目标格（确保多步移动、动画可观测） */
const pickTarget = (fog: Record<string, Visibility>): Axial => {
  const reachable = reachableArea(START, MAX_MOVEMENT, makeCosts(fog))
  const candidates = reachable.filter((h) => hexDistance(START, h) >= 2)
  expect(candidates.length).toBeGreaterThan(0)
  return candidates[0] as Axial
}

const hexToScreen = (h: Axial): { x: number; y: number } => {
  const p = layout.hexToPixel(h)
  return { x: VIEW_W / 2 + p.x, y: VIEW_H / 2 + p.y }
}

const getSfx = (page: import('@playwright/test').Page): Promise<SfxState> =>
  page.evaluate(() => {
    const g = (window as { __game?: { getState(): DebugGameState } }).__game
    return g?.getState()?.sfx ?? {}
  })

const getBgm = (page: import('@playwright/test').Page): Promise<BgmState> =>
  page.evaluate(() => {
    const g = (window as { __game?: { getState(): DebugGameState } }).__game
    return g?.getState()?.bgm ?? {}
  })


const waitSfxReady = (page: import('@playwright/test').Page) =>
  page.waitForFunction(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.sfx?.ready === true)

const waitBgmPlaying = (page: import('@playwright/test').Page) =>
  page.waitForFunction(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.bgm?.playing === true)

const waitLoopPlaying = (page: import('@playwright/test').Page) =>
  page.waitForFunction(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.sfx?.loopPlaying === true)

const waitHeroAt = (page: import('@playwright/test').Page, pos: Axial) =>
  page.waitForFunction(
    (t) => {
      const s = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
      return s?.hero?.position?.q === t.q && s?.hero?.position?.r === t.r
    },
    pos
  )

/** 探索测试现走 campaign/start explore（东岭关小地图）；本 spec 复算用随机地图（radius 6），
 *  故用 setSeed 强制切回 dev 随机地图路径（hero 出生点 (0,0)），与下方 core 复算口径一致 */
const setSeed = (page: import('@playwright/test').Page, seed: number) =>
  page.evaluate(
    (s) => (window as { __game?: { setSeed(seed: number): void } }).__game?.setSeed(s),
    seed
  )

test('移动音效：移动时循环播放、移动结束停止；与 BGM 同时播放', async ({ page }) => {
  await gotoAdventure(page)
  await setSeed(page, SEED)
  await waitSfxReady(page)

  // 未移动：音效就绪、默认音量 0.3、未在循环
  expect((await getSfx(page)).volume).toBeCloseTo(0.3)
  expect((await getSfx(page)).loopPlaying).toBe(false)

  // 首次交互（点击顶部 HUD 空白区，非地图格）→ 起播 BGM；
  // 不点地图中心：hero 出生点 (0,0) 是城池格，点它会打开城池面板（挡住后续地图点击）
  await page.mouse.click(VIEW_W / 2, 24)
  await waitBgmPlaying(page)

  // 放慢动画便于观测循环播放
  await page.evaluate(() => (window as { __game?: { setAnimationSpeed(n: number): void } }).__game?.setAnimationSpeed(300))

  // 点击可达目标 → 移动开始（SFX 循环 + BGM 并发）
  const startFog = visionFor(START, {})
  const target = pickTarget(startFog)
  const targetScreen = hexToScreen(target)
  await page.mouse.click(targetScreen.x, targetScreen.y)

  // 移动中：SFX 循环播放，且 BGM 仍在播（多声音并发）
  await waitLoopPlaying(page)
  expect((await getBgm(page)).playing).toBe(true)

  // 移动结束：SFX 停止循环、BGM 保持播放
  await waitHeroAt(page, target)
  await page.evaluate(() => (window as { __game?: { waitForMove(): Promise<void> } }).__game?.waitForMove())
  expect((await getSfx(page)).loopPlaying).toBe(false)
  expect((await getBgm(page)).playing).toBe(true)
})
