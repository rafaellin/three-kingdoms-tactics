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
import { START_FACTIONS, TURN_ORDER } from '../../data/bootstrap'
import type { CampaignConfig } from '../../data/campaigns'
import type { UnitDefId } from '../../data/units'
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

/** 战役启动：mode=campaign 放守将+胜利条件；mode=explore 不放守将（自由探索） */
export interface CampaignStartPayload {
  mode: 'campaign' | 'explore'
  campaign: CampaignConfig
}

/** 英雄移动：显式指定英雄 id（多英雄） */
export interface HeroMovePayload {
  heroId: string
  to: Axial
}

/** 选中英雄（null 清空选中） */
export interface HeroSelectPayload {
  heroId: string | null
}

/** 英雄进城：英雄在城格上 → 设访问武将、从 heroes 移除 */
export interface EnterTownPayload {
  heroId: string
  townId: string
}

/** 访问→驻守：访问武将转为驻城武将 */
export interface GarrisonPayload {
  heroId: string
  townId: string
}

/** 出城：驻守/访问武将回 heroes */
export interface LeaveTownPayload {
  heroId: string
  townId: string
}

/** 驻城↔访问互换 */
export interface SwapHeroesPayload {
  townId: string
}

/** 城与英雄部队之间移兵 */
export interface TransferTroopsPayload {
  townId: string
  from: 'hero' | 'garrison'
  defId: UnitDefId
  count: number
}

/** 战斗回流：写回参战英雄 army + 经验 + 击败守将/中立 + 胜利检查 */
export interface ResolveBattlePayload {
  result: {
    outcome: 'won' | 'lost'
    remainingTroops: { defId: UnitDefId; count: number }[]
    expGained: number
  }
  /** 打的是守将 → 胜利时标记 alive=false */
  garrisonId?: string
  /** 打的是中立杂兵 → 胜利时标记 defeated=true */
  neutralId?: string
  /** 参战英雄（heroId = generalId） */
  heroId: string
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
  // 多英雄：直接读 payload.heroStarts（每武将一英雄）
  const heroes: HeroUnit[] = payload.heroStarts.map((hs) => {
    const general = payload.generals.find((g) => g.id === hs.generalId)
    return {
      generalId: hs.generalId,
      faction: general?.faction ?? (payload.turnOrder[0] as FactionId),
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

/**
 * 战役启动：按 mode 填 守将（campaign）/中立（都放）/胜利（explore null）。
 * 武将/城池/英雄来自战役配置；英雄移动力/视野基准与 setup 一致；selectedHeroId = 第一英雄。
 * 确定性：只读配置、不改动共享战役数据（武将 army/守将 units 均深拷贝）。
 */
function campaignStart(state: GameState, payload: CampaignStartPayload): GameState {
  const camp = payload.campaign
  const turnOrder: FactionId[] = [...TURN_ORDER]
  // 战役沿用沙盒初始资源（MVP；campaign 配置未定义资源）
  const resources: Record<FactionId, Resources> = {
    wei: { ...ZERO_RESOURCES },
    shu: { ...ZERO_RESOURCES },
    wu: { ...ZERO_RESOURCES },
    qun: { ...ZERO_RESOURCES }
  }
  for (const f of START_FACTIONS) resources[f.id] = { ...f.resources }
  // 英雄：每武将一英雄，从 heroStarts 构造（移动力/视野基准与 setup 一致）
  const heroes: HeroUnit[] = camp.heroStarts.map((hs) => {
    const general = camp.startGenerals.find((g) => g.id === hs.generalId)
    return {
      generalId: hs.generalId,
      faction: general?.faction ?? (turnOrder[0] ?? 'shu'),
      position: { ...hs.position },
      movementLeft: BASE_MAX_MOVEMENT,
      maxMovement: BASE_MAX_MOVEMENT,
      sightRange: BASE_SIGHT_RANGE
    }
  })
  const selectedHeroId = heroes[0]?.generalId ?? null
  const selectedHero = heroes[0] ?? null
  // 资源点状态：地图上每个资源点 → 无主、未拾取
  const nodeStates: Record<string, { owner: FactionId | null; visited: boolean }> = {}
  for (const hex of Object.keys(camp.map.nodes ?? {})) {
    nodeStates[hex] = { owner: null, visited: false }
  }
  return {
    ...state,
    turn: 1,
    currentFaction: turnOrder[0] ?? null,
    turnOrder,
    resources,
    generals: camp.startGenerals.map((g) => ({ ...g, army: (g.army ?? []).map((u) => ({ ...u })) })),
    towns: camp.startTowns.map((t) => ({
      ...t,
      garrison: (t.garrison ?? []).map((u) => ({ ...u })),
      visitorGeneralId: t.visitorGeneralId ?? null
    })),
    map: camp.map,
    mapSeed: 0,
    heroes,
    selectedHeroId,
    visibility: selectedHero
      ? { ...state.visibility, [selectedHero.faction]: computeVisionFor(camp.map, selectedHero, {}) }
      : state.visibility,
    nodeStates,
    campaignId: camp.id,
    garrisons:
      payload.mode === 'campaign'
        ? camp.garrisons.map((g) => ({
            ...g,
            position: { ...g.position },
            units: g.units.map((u) => ({ ...u })),
            alive: true
          }))
        : [],
    neutrals: camp.neutrals.map((n) => ({
      ...n,
      position: { ...n.position },
      units: n.units.map((u) => ({ ...u })),
      defeated: false
    })),
    victory: payload.mode === 'campaign' ? camp.victory : null,
    outcome: null
  }
}

/** 轮到下一势力；一圈轮完则天数 +1；轮到某势力时该势力所有英雄移动力重置；天数 +1 触发每日结算 */
function advanceTurn(state: GameState): GameState {
  const order = state.turnOrder
  if (order.length === 0) return state
  const idx = state.currentFaction === null ? -1 : order.indexOf(state.currentFaction)
  const next = (idx + 1) % order.length
  const nextFaction = order[next] as FactionId
  // 轮到某势力 → 该势力 ALL 英雄移动力全恢复（多英雄并行：同势力多个英雄都要回满，
  // 不能只重置当前选中的英雄，否则其他英雄动过后会一直 spent）
  const heroes = state.heroes.map((h) =>
    h.faction === nextFaction ? { ...h, movementLeft: h.maxMovement } : h
  )
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

/** 选中英雄：heroId 必须在 heroes 中存在或是 null（无效 id → no-op） */
function selectHero(state: GameState, { heroId }: HeroSelectPayload): GameState {
  if (heroId === null) return { ...state, selectedHeroId: null }
  if (state.heroes.some((h) => h.generalId === heroId)) return { ...state, selectedHeroId: heroId }
  return state
}

/**
 * 单步移动核心（unit/move 与 hero/move 共用）：
 * 1. to 必须是当前格六邻居
 * 2. to 已探索（explored，永久可见才可走入；未探索格挡住）
 * 3. to 地形可通过
 * 4. to 不是存活守将驻点（需先击败守将才可通行）
 * 5. 剩余移动力足够支付地形代价
 * 6. 扣移动力 → 更新位置 → 重算视野
 * 7. 抵达含资源点的格：宝箱一次性拾取；无主矿被占领
 */
function moveHeroTo(state: GameState, hero: HeroUnit, to: Axial): GameState {
  const map = state.map
  if (!map) return state
  if (hexKey(hero.position) === hexKey(to)) return state
  if (!isNeighbor(hero.position, to)) return state
  // 守将驻点（存活）不可通行：需先击败守将
  if (state.garrisons.some((g) => g.alive && hexKey(g.position) === hexKey(to))) return state
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

/** 单步移动（unit/move 向后兼容：操作当前选中英雄） */
function moveHero(state: GameState, { to }: MovePayload): GameState {
  const hero = currentHero(state)
  if (!hero) return state
  return moveHeroTo(state, hero, to)
}

/** 单步移动（hero/move：显式指定英雄 id，多英雄并行） */
function moveHeroById(state: GameState, { heroId, to }: HeroMovePayload): GameState {
  const hero = state.heroes.find((h) => h.generalId === heroId)
  if (!hero) return state
  return moveHeroTo(state, hero, to)
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

/** 向 army/garrison 栈表加数（已存在则累加，否则追加） */
function addUnitStack(
  stacks: { defId: UnitDefId; count: number }[],
  defId: UnitDefId,
  count: number
): { defId: UnitDefId; count: number }[] {
  const existing = stacks.find((u) => u.defId === defId)
  if (existing) return stacks.map((u) => (u.defId === defId ? { ...u, count: u.count + count } : u))
  return [...stacks, { defId, count }]
}

/** 英雄进城：英雄在城格上时 → 设为访问武将、从 heroes 移除（同一时刻英雄要么在地图要么在城） */
function enterTown(state: GameState, { heroId, townId }: EnterTownPayload): GameState {
  const hero = state.heroes.find((h) => h.generalId === heroId)
  const town = state.towns.find((t) => t.id === townId)
  if (!hero || !town) return state
  if (town.visitorGeneralId) return state // 访问槽被占：拒绝第二英雄进城（防静默覆盖丢失武将）
  if (hexKey(hero.position) !== hexKey(town.position)) return state
  return {
    ...state,
    towns: state.towns.map((t) => (t.id === townId ? { ...t, visitorGeneralId: heroId } : t)),
    heroes: state.heroes.filter((h) => h.generalId !== heroId)
  }
}

/** 访问→驻守：仅当英雄是该城访问武将时，转入驻守槽 */
function garrisonTown(state: GameState, { heroId, townId }: GarrisonPayload): GameState {
  const town = state.towns.find((t) => t.id === townId)
  if (!town || town.visitorGeneralId !== heroId) return state
  return {
    ...state,
    towns: state.towns.map((t) =>
      t.id === townId ? { ...t, garrisonGeneralId: heroId, visitorGeneralId: null } : t
    )
  }
}

/** 出城：清空驻守/访问槽 → 英雄回 heroes（位置=城格、满移动力、视野基准与 setup 一致） */
function leaveTown(state: GameState, { heroId, townId }: LeaveTownPayload): GameState {
  const town = state.towns.find((t) => t.id === townId)
  if (!town) return state
  const asGarrison = town.garrisonGeneralId === heroId
  const asVisitor = town.visitorGeneralId === heroId
  if (!asGarrison && !asVisitor) return state
  const general = state.generals.find((g) => g.id === heroId)
  if (!general) return state
  const hero: HeroUnit = {
    generalId: heroId,
    faction: general.faction,
    position: { ...town.position },
    movementLeft: BASE_MAX_MOVEMENT,
    maxMovement: BASE_MAX_MOVEMENT,
    sightRange: BASE_SIGHT_RANGE
  }
  return {
    ...state,
    towns: state.towns.map((t) =>
      t.id === townId
        ? {
            ...t,
            garrisonGeneralId: asGarrison ? null : t.garrisonGeneralId,
            visitorGeneralId: asVisitor ? null : t.visitorGeneralId
          }
        : t
    ),
    heroes: [...state.heroes, hero]
  }
}

/** 驻城↔访问互换（两个槽都非空才换） */
function swapHeroes(state: GameState, { townId }: SwapHeroesPayload): GameState {
  const town = state.towns.find((t) => t.id === townId)
  if (!town || !town.garrisonGeneralId || !town.visitorGeneralId) return state
  return {
    ...state,
    towns: state.towns.map((t) =>
      t.id === townId
        ? { ...t, garrisonGeneralId: town.visitorGeneralId, visitorGeneralId: town.garrisonGeneralId }
        : t
    )
  }
}

/**
 * 城与英雄部队之间移兵（数量增减，>=0）。
 * from='hero' → 英雄 army 减、城 garrison 加；from='garrison' 反向。
 * 可移动数 clamp 到持有方现有数量；数量归零的条目删除。
 * 操作对象 = 该城的驻守武将（无驻守则访问武将）。
 */
function transferTroops(state: GameState, { townId, from, defId, count }: TransferTroopsPayload): GameState {
  if (count <= 0) return state
  const town = state.towns.find((t) => t.id === townId)
  if (!town) return state
  const actorGeneralId = town.garrisonGeneralId ?? town.visitorGeneralId
  if (!actorGeneralId) return state
  const general = state.generals.find((g) => g.id === actorGeneralId)
  if (!general) return state

  if (from === 'hero') {
    // 英雄 army 失去、城 garrison 获得
    const src = general.army.find((u) => u.defId === defId)
    if (!src || src.count <= 0) return state
    const actual = Math.min(count, src.count)
    return {
      ...state,
      generals: state.generals.map((g) =>
        g.id === actorGeneralId
          ? {
              ...g,
              army: general.army
                .map((u) => (u.defId === defId ? { ...u, count: u.count - actual } : u))
                .filter((u) => u.count > 0)
            }
          : g
      ),
      towns: state.towns.map((t) =>
        t.id === townId ? { ...t, garrison: addUnitStack(town.garrison, defId, actual) } : t
      )
    }
  }
  // from === 'garrison'：城 garrison 失去、英雄 army 获得
  const src = town.garrison.find((u) => u.defId === defId)
  if (!src || src.count <= 0) return state
  const actual = Math.min(count, src.count)
  return {
    ...state,
    generals: state.generals.map((g) =>
      g.id === actorGeneralId ? { ...g, army: addUnitStack(general.army, defId, actual) } : g
    ),
    towns: state.towns.map((t) =>
      t.id === townId
        ? {
            ...t,
            garrison: town.garrison
              .map((u) => (u.defId === defId ? { ...u, count: u.count - actual } : u))
              .filter((u) => u.count > 0)
          }
        : t
    )
  }
}

/**
 * 战斗回流：把战斗结果写回大地图。
 * - 参战英雄（heroId = generalId）的 army = remainingTroops；
 * - expGained > 0 → 复用 general/gainXp 的升级逻辑；
 * - outcome === 'won' 且 garrisonId → 该守将 alive=false；neutralId → 该中立 defeated=true；
 * - 然后跑 campaign/checkVictory 胜利检查。
 */
function resolveBattle(state: GameState, payload: ResolveBattlePayload): GameState {
  const { result, garrisonId, neutralId, heroId } = payload
  if (!state.generals.some((g) => g.id === heroId)) return state
  let next: GameState = {
    ...state,
    generals: state.generals.map((g) =>
      g.id === heroId ? { ...g, army: result.remainingTroops.map((r) => ({ ...r })) } : g
    )
  }
  if (result.expGained > 0) {
    next = gainXp(next, { generalId: heroId, amount: result.expGained })
  }
  if (result.outcome === 'won') {
    if (garrisonId) {
      next = {
        ...next,
        garrisons: next.garrisons.map((g) => (g.id === garrisonId ? { ...g, alive: false } : g))
      }
    }
    if (neutralId) {
      next = {
        ...next,
        neutrals: next.neutrals.map((n) => (n.id === neutralId ? { ...n, defeated: true } : n))
      }
    }
  }
  return checkVictory(next)
}

/** 胜利检查：victory.kind==='defeatGarrison' 且目标守将已阵亡 → outcome='won' */
function checkVictory(state: GameState): GameState {
  const v = state.victory
  if (v?.kind !== 'defeatGarrison') return state
  const target = state.garrisons.find((g) => g.id === v.targetId)
  if (target && !target.alive) return { ...state, outcome: 'won' }
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
    case 'campaign/start':
      return campaignStart(state, cmd.payload as CampaignStartPayload)
    case 'hero/select':
      return selectHero(state, cmd.payload as HeroSelectPayload)
    case 'hero/move':
      return moveHeroById(state, cmd.payload as HeroMovePayload)
    case 'hero/enterTown':
      return enterTown(state, cmd.payload as EnterTownPayload)
    case 'hero/garrison':
      return garrisonTown(state, cmd.payload as GarrisonPayload)
    case 'hero/leaveTown':
      return leaveTown(state, cmd.payload as LeaveTownPayload)
    case 'town/swapHeroes':
      return swapHeroes(state, cmd.payload as SwapHeroesPayload)
    case 'town/transferTroops':
      return transferTroops(state, cmd.payload as TransferTroopsPayload)
    case 'campaign/resolveBattle':
      return resolveBattle(state, cmd.payload as ResolveBattlePayload)
    case 'campaign/checkVictory':
      return checkVictory(state)
    default:
      return state
  }
}
