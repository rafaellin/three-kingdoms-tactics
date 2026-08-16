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
import { completeResources, RESOURCE_NODE_DEFS } from '../../data/resourceNode'
import { GENERAL_BASES } from '../../data/generals'
import { deriveStats } from '../generals'
import { MAX_LEVEL, xpToNext } from '../growth'
import {
  BASE_MAX_MOVEMENT,
  BASE_SIGHT_RANGE,
  addResources,
  applyDailyIncome,
  canAfford,
  currentHero,
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
  /** 多英雄初始位置（每武将一英雄；MVP 单英雄） */
  heroStarts: { generalId: string; position: Axial }[]
  /** 兼容旧单英雄 payload（旧 bootstrap/测试仍可传）；新代码统一用 heroStarts */
  heroStart?: Axial
  heroGeneralId?: string
  heroFaction?: FactionId
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

export interface GainXpPayload {
  generalId: string
  amount: number
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
  // 多英雄：优先 payload.heroStarts；缺省回退到旧单英雄字段（兼容旧 payload）
  const heroStarts =
    payload.heroStarts.length > 0
      ? payload.heroStarts
      : payload.heroGeneralId
        ? [{ generalId: payload.heroGeneralId, position: payload.heroStart ?? { q: 0, r: 0 } }]
        : []
  const heroes: HeroUnit[] = heroStarts.map((hs) => {
    const general = payload.generals.find((g) => g.id === hs.generalId)
    return {
      generalId: hs.generalId,
      faction: general?.faction ?? payload.heroFaction ?? (payload.turnOrder[0] as FactionId),
      position: { ...hs.position },
      movementLeft: BASE_MAX_MOVEMENT,
      maxMovement: BASE_MAX_MOVEMENT,
      sightRange: BASE_SIGHT_RANGE
    }
  })
  const selectedHeroId = heroes[0]?.generalId ?? null
  const selectedHero = heroes[0] ?? null
  // 初始化资源点状态：地图上每个资源点 → 无主、未拾取
  const nodeStates: Record<string, { owner: FactionId | null; visited: boolean }> = {}
  for (const hex of Object.keys(payload.map.nodes ?? {})) {
    nodeStates[hex] = { owner: null, visited: false }
  }
  return {
    ...state,
    turn: 1,
    currentFaction: (payload.turnOrder[0] as FactionId | undefined) ?? null,
    turnOrder: [...payload.turnOrder],
    resources,
    generals: payload.generals.map((g) => ({ ...g, army: g.army ?? [] })),
    towns: payload.towns.map((t) => ({ ...t, garrison: t.garrison ?? [], visitorGeneralId: t.visitorGeneralId ?? null })),
    map: payload.map,
    mapSeed: payload.mapSeed,
    heroes,
    selectedHeroId,
    visibility: selectedHero
      ? { ...state.visibility, [selectedHero.faction]: computeVisionFor(payload.map, selectedHero, {}) }
      : state.visibility,
    nodeStates,
    // 战役/守将/中立/胜负：MVP 空（非战役模式）
    campaignId: null,
    garrisons: [],
    neutrals: [],
    victory: null,
    outcome: null
  }
}

/** 轮到下一势力；一圈轮完则天数 +1；轮到当前操作英雄所属势力时重置其移动力；天数 +1 触发每日结算 */
function advanceTurn(state: GameState): GameState {
  const order = state.turnOrder
  if (order.length === 0) return state
  const idx = state.currentFaction === null ? -1 : order.indexOf(state.currentFaction)
  const next = (idx + 1) % order.length
  const hero = currentHero(state)
  const nextFaction = order[next] as FactionId
  // 只重置当前操作英雄（MVP 单英雄 → 与原单英雄语义一致）
  const heroes =
    hero && hero.faction === nextFaction
      ? state.heroes.map((h) => (h.generalId === hero.generalId ? { ...h, movementLeft: h.maxMovement } : h))
      : state.heroes
  const oldTurn = state.turn
  const newTurn = next === 0 ? oldTurn + 1 : oldTurn
  let nextState: GameState = {
    ...state,
    currentFaction: nextFaction,
    heroes,
    turn: newTurn
  }
  // 天数 +1（一圈轮完回第一势力）：每日结算（城池产金 + 矿产出）
  if (newTurn !== oldTurn) {
    nextState = applyDailyIncome(nextState)
  }
  // 跨周（第 N 周 → 第 N+1 周）的"产出预备役部队"依赖军制/招募系统，未实现（PRD 注明）
  return nextState
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

/**
 * 武将获得经验（确定性，无随机）：
 * xp 累加 → 连升（while 足够则扣 xpToNext、level+1）→ 重算 stats/skillSlots。
 * 达到 MAX_LEVEL 后不再升级（xp 仍可累积，不再扣减）；找不到武将/基础配置 → no-op。
 */
function gainXp(state: GameState, { generalId, amount }: GainXpPayload): GameState {
  const base = GENERAL_BASES[generalId as keyof typeof GENERAL_BASES]
  if (!base) return state
  const idx = state.generals.findIndex((g) => g.id === generalId)
  if (idx < 0) return state

  let xp = state.generals[idx]!.xp + amount
  let level = state.generals[idx]!.level
  while (xp >= xpToNext(level) && level < MAX_LEVEL) {
    xp -= xpToNext(level)
    level += 1
  }

  const generals = state.generals.map((g, i) =>
    i === idx
      ? { ...g, xp, level, stats: deriveStats(base, level), skillSlots: Math.floor(level / 3) }
      : g
  )
  return { ...state, generals }
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
 * 6. 抵达含资源点的格：宝箱一次性拾取；无主矿被占领
 */
function moveHero(state: GameState, { to }: MovePayload): GameState {
  const hero = currentHero(state)
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
  let next: GameState = {
    ...state,
    heroes: state.heroes.map((h) => (h.generalId === hero.generalId ? moved : h)),
    visibility: { ...state.visibility, [hero.faction]: computeVisionFor(map, moved, fog) }
  }
  // 资源点拾取 / 占领
  const nodeType = map.nodes?.[hexKey(to)]
  if (nodeType) {
    next = interactNode(next, hero.faction, hexKey(to), nodeType)
  }
  return next
}

/** 走到含资源点的格：宝箱一次性拾取（visited），无主矿占领（owner） */
function interactNode(
  state: GameState,
  faction: FactionId,
  hex: string,
  nodeType: string
): GameState {
  const nodeState = state.nodeStates[hex]
  if (!nodeState) return state
  const def = RESOURCE_NODE_DEFS[nodeType as keyof typeof RESOURCE_NODE_DEFS]
  if (!def) return state
  if (def.oneTime) {
    if (nodeState.visited) return state // 已拾取不重复
    return {
      ...state,
      resources: {
        ...state.resources,
        [faction]: addResources(state.resources[faction], completeResources(def.oneTime))
      },
      nodeStates: { ...state.nodeStates, [hex]: { ...nodeState, visited: true } }
    }
  }
  if (def.dailyBonus) {
    if (nodeState.owner) return state // 已有主不夺占（战斗留后续）
    return {
      ...state,
      nodeStates: { ...state.nodeStates, [hex]: { ...nodeState, owner: faction } }
    }
  }
  return state
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
    case 'general/gainXp':
      return gainXp(state, cmd.payload as GainXpPayload)
    default:
      return state
  }
}
