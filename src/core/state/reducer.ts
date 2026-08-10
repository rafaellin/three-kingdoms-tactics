/**
 * 游戏 reducer：纯函数，经 CommandLog 驱动 GameState。
 * 相同命令序列 + 相同初始状态 ⇒ 相同终态（确定性）。
 * 任何随机（如野怪/技能抽取）必须由调用方注入 RNG 后放进 payload，不得在本模块使用。
 */
import type { Command, Reducer } from '../events/CommandLog'
import { computeVision, type FogMap } from '../fog/Fog'
import { hexKey, hexNeighbor, type Axial, type HexDir } from '../hex/HexGrid'
import type { MapData } from '../map/MapGen'
import { getTerrain } from '../../data/terrain'
import {
  BASE_MAX_MOVEMENT,
  BASE_SIGHT_RANGE,
  addResources,
  canAfford,
  subResources,
  ZERO_RESOURCES,
  type FactionId,
  type General,
  type GameState,
  type HeroUnit,
  type Resources,
  type Town
} from './GameState'

export interface SetupPayload {
  turnOrder: FactionId[]
  factions: { id: FactionId; resources: Resources }[]
  generals: General[]
  towns: Town[]
  map: MapData
  mapSeed: number
  heroStart: Axial
  heroGeneralId: string
  heroFaction: FactionId
}

export interface FactionResourcesPayload {
  faction: FactionId
  amount: Resources
}

export interface SpendResourcesPayload {
  faction: FactionId
  cost: Resources
}

export interface MovePayload {
  to: Axial
}

/** 为该势力重算视野（旧 fog 决定 explored 持久化） */
function computeVisionFor(map: MapData, hero: HeroUnit, oldFog: FogMap): FogMap {
  return computeVision({
    sources: [{ position: hero.position, sightRange: hero.sightRange }],
    mapHexes: map.hexes,
    terrainAt: (h) => map.terrain[hexKey(h)] ?? 'plain',
    oldFog
  })
}

/** 初始化：填入势力/资源/武将/城池/地图/英雄，首次计算视野，回合重置到第 1 天 */
function setup(state: GameState, payload: SetupPayload): GameState {
  const resources: Record<FactionId, Resources> = {
    wei: { ...ZERO_RESOURCES },
    shu: { ...ZERO_RESOURCES },
    wu: { ...ZERO_RESOURCES },
    qun: { ...ZERO_RESOURCES }
  }
  for (const f of payload.factions) resources[f.id] = { ...f.resources }
  const hero: HeroUnit = {
    generalId: payload.heroGeneralId,
    faction: payload.heroFaction,
    position: { ...payload.heroStart },
    movementLeft: BASE_MAX_MOVEMENT,
    maxMovement: BASE_MAX_MOVEMENT,
    sightRange: BASE_SIGHT_RANGE
  }
  return {
    ...state,
    turn: 1,
    currentFaction: (payload.turnOrder[0] as FactionId | undefined) ?? null,
    turnOrder: [...payload.turnOrder],
    resources,
    generals: payload.generals.map((g) => ({ ...g })),
    towns: payload.towns.map((t) => ({ ...t })),
    map: payload.map,
    mapSeed: payload.mapSeed,
    hero,
    visibility: { ...state.visibility, [hero.faction]: computeVisionFor(payload.map, hero, {}) }
  }
}

/** 轮到下一势力；一圈轮完则天数 +1；轮到英雄所属势力时重置其移动力 */
function advanceTurn(state: GameState): GameState {
  const order = state.turnOrder
  if (order.length === 0) return state
  const idx = state.currentFaction === null ? -1 : order.indexOf(state.currentFaction)
  const next = (idx + 1) % order.length
  let hero = state.hero
  const nextFaction = order[next] as FactionId
  if (hero && hero.faction === nextFaction) {
    hero = { ...hero, movementLeft: hero.maxMovement }
  }
  return {
    ...state,
    currentFaction: nextFaction,
    hero,
    turn: next === 0 ? state.turn + 1 : state.turn
  }
}

function addRes(state: GameState, { faction, amount }: FactionResourcesPayload): GameState {
  return {
    ...state,
    resources: { ...state.resources, [faction]: addResources(state.resources[faction], amount) }
  }
}

function spend(state: GameState, { faction, cost }: SpendResourcesPayload): GameState {
  if (!canAfford(state, faction, cost)) return state
  return {
    ...state,
    resources: { ...state.resources, [faction]: subResources(state.resources[faction], cost) }
  }
}

function isNeighbor(a: Axial, b: Axial): boolean {
  for (let d = 0; d < 6; d++) {
    if (hexKey(hexNeighbor(a, d as HexDir)) === hexKey(b)) return true
  }
  return false
}

/**
 * 单步移动（动画由渲染层逐格驱动）：
 * 1. to 必须是当前格六邻居
 * 2. to 已探索（explored，永久可见才可走入；未探索格挡住）
 * 3. to 地形可通过
 * 4. 剩余移动力足够支付地形代价
 * 5. 扣移动力 → 更新位置 → 重算视野
 */
function moveHero(state: GameState, { to }: MovePayload): GameState {
  const hero = state.hero
  const map = state.map
  if (!hero || !map) return state
  if (hexKey(hero.position) === hexKey(to)) return state
  if (!isNeighbor(hero.position, to)) return state
  const fog = state.visibility[hero.faction] ?? {}
  if (fog[hexKey(to)] !== 'explored') return state
  const terrain = getTerrain(map.terrain[hexKey(to)] ?? 'plain')
  if (!Number.isFinite(terrain.moveCost)) return state
  if (hero.movementLeft < terrain.moveCost) return state
  const moved: HeroUnit = {
    ...hero,
    position: { ...to },
    movementLeft: hero.movementLeft - terrain.moveCost
  }
  return {
    ...state,
    hero: moved,
    visibility: { ...state.visibility, [hero.faction]: computeVisionFor(map, moved, fog) }
  }
}

/** 游戏 reducer：dispatch 的入口 */
export const gameReducer: Reducer<GameState> = (state, cmd: Command) => {
  switch (cmd.type) {
    case 'game/setup':
      return setup(state, cmd.payload as SetupPayload)
    case 'game/advanceTurn':
      return advanceTurn(state)
    case 'economy/add':
      return addRes(state, cmd.payload as FactionResourcesPayload)
    case 'economy/spend':
      return spend(state, cmd.payload as SpendResourcesPayload)
    case 'unit/move':
      return moveHero(state, cmd.payload as MovePayload)
    default:
      return state
  }
}
