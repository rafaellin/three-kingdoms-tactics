/**
 * 游戏 reducer：纯函数，经 CommandLog 驱动 GameState。
 * 相同命令序列 + 相同初始状态 ⇒ 相同终态（确定性）。
 * 任何随机（如野怪/技能抽取）必须由调用方注入 RNG 后放进 payload，不得在本模块使用。
 */
import type { Command, Reducer } from '../events/CommandLog'
import { computeVision, type FogMap, type Visibility } from '../fog/Fog'
import { hexKey, hexNeighbor, type Axial, type HexDir } from '../hex/HexGrid'
import type { MapData } from '../map/MapGen'
import { getTerrain } from '../../data/terrain'
import { completeResources, RESOURCE_NODE_DEFS } from '../../data/resourceNode'
import { START_RESOURCES } from '../../data/bootstrap'
import type { CampaignConfig } from '../../data/campaigns'
import type { UnitDefId } from '../../data/units'
import { GENERAL_BASES } from '../../data/generals'
import { deriveStats } from '../generals'
import { MAX_LEVEL, xpToNext } from '../growth'
import { aiAct, spawnNeutrals } from './ai'
import {
  BASE_MAX_MOVEMENT,
  BASE_SIGHT_RANGE,
  addResources,
  applyDailyIncome,
  canAfford,
  currentHero,
  subResources,
  ZERO_RESOURCES,
  type General,
  type GameState,
  type HeroUnit,
  type Player,
  type Resources,
  type Town
} from './GameState'

export interface SetupPayload {
  /** 参与回合的玩家序列（顺序 = 轮转顺序） */
  players: Player[]
  generals: General[]
  towns: Town[]
  map: MapData
  mapSeed: number
  /** 多英雄初始位置（每武将一英雄；MVP 单英雄），每项带归属玩家 */
  heroStarts: { generalId: string; playerId: string; position: Axial }[]
}

export interface FactionResourcesPayload {
  playerId: string
  amount: Resources
}

export interface SpendResourcesPayload {
  playerId: string
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
  /** 参战英雄所属玩家 id（失败回城找最近己方城用） */
  playerId?: string
  /** 战斗发生的目标格（胜利 → 英雄占格，已随移动到位） */
  targetPosition?: Axial
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

/** 初始化：填入玩家/资源/武将/城池/地图/英雄，首次计算视野，回合重置到第 1 天 */
function setup(state: GameState, payload: SetupPayload): GameState {
  // 资源/迷雾按玩家初始化（key = PlayerId；起始资源取 START_RESOURCES，未配置的一律 0）
  const resources: Record<string, Resources> = {}
  const visibility: Record<string, Record<string, Visibility>> = {}
  for (const player of payload.players) {
    resources[player.id] = { ...(START_RESOURCES[player.id] ?? ZERO_RESOURCES) }
    visibility[player.id] = {}
  }
  // 多英雄：直接读 payload.heroStarts（每武将一英雄），playerId 取自 payload
  const heroes: HeroUnit[] = payload.heroStarts.map((hs) => {
    const general = payload.generals.find((g) => g.id === hs.generalId)
    const player = payload.players.find((p) => p.id === hs.playerId)
    return {
      generalId: hs.generalId,
      playerId: hs.playerId,
      faction: general?.faction ?? player?.faction ?? 'shu',
      position: { ...hs.position },
      movementLeft: BASE_MAX_MOVEMENT,
      maxMovement: BASE_MAX_MOVEMENT,
      sightRange: BASE_SIGHT_RANGE
    }
  })
  const selectedHeroId = heroes[0]?.generalId ?? null
  const selectedHero = heroes[0] ?? null
  // 初始化资源点状态：地图上每个资源点 → 无主、未拾取
  const nodeStates: Record<string, { owner: string | null; visited: boolean }> = {}
  for (const hex of Object.keys(payload.map.nodes ?? {})) {
    nodeStates[hex] = { owner: null, visited: false }
  }
  return {
    ...state,
    turn: 1,
    players: payload.players.map((p) => ({ ...p })),
    currentPlayerId: payload.players[0]?.id ?? null,
    resources,
    generals: payload.generals.map((g) => ({ ...g, army: g.army ?? [] })),
    towns: payload.towns.map((t) => ({ ...t, garrison: t.garrison ?? [], visitorGeneralId: t.visitorGeneralId ?? null })),
    map: payload.map,
    mapSeed: payload.mapSeed,
    heroes,
    selectedHeroId,
    visibility: selectedHero
      ? { ...visibility, [selectedHero.playerId]: computeVisionFor(payload.map, selectedHero, {}) }
      : visibility,
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
  // 探索模式 = 单人（Spec §3）：只保留 human 玩家（东岭关即 [p1]），AI 不参与回合轮转；
  // 战役模式 = 完整玩家序列（东岭关 [p1, ai1]）。
  const players =
    payload.mode === 'explore' ? camp.players.filter((p) => p.kind === 'human') : camp.players
  // 资源/迷雾按 players 初始化（key = PlayerId；AI 玩家无沙盒起始资源 → 0）
  const resources: Record<string, Resources> = {}
  const visibility: Record<string, Record<string, Visibility>> = {}
  for (const player of players) {
    resources[player.id] = { ...(START_RESOURCES[player.id] ?? ZERO_RESOURCES) }
    visibility[player.id] = {}
  }
  // 英雄：每武将一英雄，从 heroStarts 构造（移动力/视野基准与 setup 一致），playerId 取自配置
  const heroes: HeroUnit[] = camp.heroStarts.map((hs) => {
    const general = camp.startGenerals.find((g) => g.id === hs.generalId)
    const player = players.find((p) => p.id === hs.playerId)
    return {
      generalId: hs.generalId,
      playerId: hs.playerId,
      faction: general?.faction ?? player?.faction ?? 'shu',
      position: { ...hs.position },
      movementLeft: BASE_MAX_MOVEMENT,
      maxMovement: BASE_MAX_MOVEMENT,
      sightRange: BASE_SIGHT_RANGE
    }
  })
  const selectedHeroId = heroes[0]?.generalId ?? null
  const selectedHero = heroes[0] ?? null
  // 资源点状态：地图上每个资源点 → 无主、未拾取
  const nodeStates: Record<string, { owner: string | null; visited: boolean }> = {}
  for (const hex of Object.keys(camp.map.nodes ?? {})) {
    nodeStates[hex] = { owner: null, visited: false }
  }
  return {
    ...state,
    turn: 1,
    players: players.map((p) => ({ ...p })),
    currentPlayerId: players[0]?.id ?? null,
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
      ? { ...visibility, [selectedHero.playerId]: computeVisionFor(camp.map, selectedHero, {}) }
      : visibility,
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

/**
 * 按玩家序列推进回合（Task 2 将正式重写；此处为类型适配的最小实现）：
 * - 从当前玩家推进到「下一个 human 玩家」；AI 玩家自动执行回合（aiAct，MVP no-op）后继续推进；
 * - 轮到 human：重置该玩家 ALL 英雄移动力（多英雄并行，不能只重置选中的），currentPlayerId = 该玩家；
 * - 圈回起点（经历整圈）→ system 结算：天数 +1 + 每日结算（按玩家循环）+ 野怪生成（MVP no-op）。
 * 探索模式（单玩家 p1）：结束回合 = 下一天 + 行动力回满。
 */
function advanceTurn(state: GameState): GameState {
  const players = state.players
  if (players.length === 0) return state
  let idx = state.currentPlayerId === null
    ? players.length - 1
    : players.findIndex((p) => p.id === state.currentPlayerId)
  if (idx < 0) idx = players.length - 1
  let nextState = state
  let wrapped = false
  let humanFound = false
  // 至多一整圈：推进到下一个 human（AI 自动行动后继续推进）
  for (let step = 0; step <= players.length; step++) {
    const next = (idx + 1) % players.length
    idx = next
    const p = players[next]
    if (!p) break
    if (next === 0) wrapped = true
    if (p.kind === 'ai') {
      nextState = aiAct(nextState, p.id) // MVP no-op；AI 自动结束回合
      continue
    }
    // human：重置该玩家所有英雄移动力 + 置 currentPlayerId
    const heroes = nextState.heroes.map((h) =>
      h.playerId === p.id ? { ...h, movementLeft: h.maxMovement } : h
    )
    nextState = { ...nextState, currentPlayerId: p.id, heroes }
    humanFound = true
    break
  }
  if (!humanFound) return nextState
  // 圈回起点 → system 结算（天数 +1 + 每日结算 + 野怪生成）
  if (wrapped) {
    nextState = { ...nextState, turn: nextState.turn + 1 }
    nextState = applyDailyIncome(nextState)
    nextState = spawnNeutrals(nextState)
  }
  // 跨周（第 N 周 → 第 N+1 周）的"产出预备役部队"依赖军制/招募系统，未实现（PRD 注明）
  return nextState
}

function addRes(state: GameState, { playerId, amount }: FactionResourcesPayload): GameState {
  return {
    ...state,
    resources: { ...state.resources, [playerId]: addResources(state.resources[playerId] ?? ZERO_RESOURCES, amount) }
  }
}

function spend(state: GameState, { playerId, cost }: SpendResourcesPayload): GameState {
  if (!canAfford(state, playerId, cost)) return state
  return {
    ...state,
    resources: { ...state.resources, [playerId]: subResources(state.resources[playerId] ?? ZERO_RESOURCES, cost) }
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
 * 4. to 不是其他英雄占据格（不能重叠）；存活守将/未歼灭杂兵格可作为移动终点（走进触发战斗）
 * 5. 剩余移动力足够支付地形代价
 * 6. 扣移动力 → 更新位置 → 重算视野
 * 7. 抵达含资源点的格：宝箱一次性拾取；无主矿被占领
 */
function moveHeroTo(state: GameState, hero: HeroUnit, to: Axial): GameState {
  const map = state.map
  if (!map) return state
  if (hexKey(hero.position) === hexKey(to)) return state
  if (!isNeighbor(hero.position, to)) return state
  // 目标格被其他英雄占据 → 拒绝（问题2：不能重叠/穿过，含己方英雄）
  if (state.heroes.some((h) => h.generalId !== hero.generalId && hexKey(h.position) === hexKey(to))) return state
  // 存活守将 / 未歼灭杂兵格：可作为移动终点放行（英雄走进该格即触发战斗，问题5 用户确认修订）。
  // 原「守将驻点不可通行」拒绝移除——走进守将/杂兵格 = 走进战斗目标；
  // 「不能穿过」由渲染层寻路 makeMapCosts 阻挡（路径中间不经过武将格）。
  const fog = state.visibility[hero.playerId] ?? {}
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
    visibility: { ...state.visibility, [hero.playerId]: computeVisionFor(map, moved, fog) }
  }
  // 访问武将移动离开城格 → 结束访问（清空该城 visitorGeneralId，英雄仍在 heroes 可继续走）
  next = clearVisitorOnLeaveTown(next, hero, to)
  // 资源点拾取 / 占领（owner 按 hero.playerId）
  const nodeType = map.nodes?.[hexKey(to)]
  if (nodeType) {
    next = interactNode(next, hero.playerId, hexKey(to), nodeType)
  }
  return next
}

/** 若移动的英雄当前是某城访问武将且移动离开城格 → 清空该城访问槽（离开即结束访问） */
function clearVisitorOnLeaveTown(state: GameState, hero: HeroUnit, to: Axial): GameState {
  const town = state.towns.find((t) => t.visitorGeneralId === hero.generalId)
  if (!town) return state
  if (hexKey(to) === hexKey(town.position)) return state
  return {
    ...state,
    towns: state.towns.map((t) => (t.id === town.id ? { ...t, visitorGeneralId: null } : t))
  }
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

/** 走到含资源点的格：宝箱一次性拾取（visited），无主矿占领（owner=PlayerId） */
function interactNode(
  state: GameState,
  playerId: string,
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
        [playerId]: addResources(state.resources[playerId] ?? ZERO_RESOURCES, completeResources(def.oneTime))
      },
      nodeStates: { ...state.nodeStates, [hex]: { ...nodeState, visited: true } }
    }
  }
  if (def.dailyBonus) {
    if (nodeState.owner) return state // 已有主不夺占（战斗留后续）
    return {
      ...state,
      nodeStates: { ...state.nodeStates, [hex]: { ...nodeState, owner: playerId } }
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

/** 在城格位置构建满移动力的英雄单位（驻城出城/交换用）；武将配置缺失 → null */
function heroAtTown(state: GameState, town: Town, generalId: string): HeroUnit | null {
  const general = state.generals.find((g) => g.id === generalId)
  if (!general) return null
  return {
    generalId,
    playerId: town.owner, // 出城英雄归属城主玩家
    faction: general.faction,
    position: { ...town.position },
    movementLeft: BASE_MAX_MOVEMENT,
    maxMovement: BASE_MAX_MOVEMENT,
    sightRange: BASE_SIGHT_RANGE
  }
}

/** 英雄进城（访问）：英雄保留在 heroes（位置=城格，大地图叠城上可见），仅记录访问槽 */
function enterTown(state: GameState, { heroId, townId }: EnterTownPayload): GameState {
  const hero = state.heroes.find((h) => h.generalId === heroId)
  const town = state.towns.find((t) => t.id === townId)
  if (!hero || !town) return state
  if (town.visitorGeneralId) return state // 访问槽被占：拒绝第二英雄进城（防静默覆盖丢失武将）
  if (town.garrisonGeneralId === heroId) return state // 驻城武将不能再以访问身份进城
  if (hexKey(hero.position) !== hexKey(town.position)) return state
  return {
    ...state,
    towns: state.towns.map((t) => (t.id === townId ? { ...t, visitorGeneralId: heroId } : t))
  }
}

/** 访问→驻守：英雄移入 garrison 槽，从 heroes 移除（驻城武将大地图不可见） */
function garrisonTown(state: GameState, { heroId, townId }: GarrisonPayload): GameState {
  const town = state.towns.find((t) => t.id === townId)
  if (!town || town.visitorGeneralId !== heroId) return state
  if (town.garrisonGeneralId && town.garrisonGeneralId !== heroId) return state // 驻城槽被占：防覆盖丢失驻城武将
  return {
    ...state,
    towns: state.towns.map((t) =>
      t.id === townId ? { ...t, garrisonGeneralId: heroId, visitorGeneralId: null } : t
    ),
    heroes: state.heroes.filter((h) => h.generalId !== heroId)
  }
}

/** 出城：驻城英雄 → garrison 清空 + 加回 heroes（位置=城格、满移动力）；访问英雄 → 仅清访问槽（英雄本就在 heroes） */
function leaveTown(state: GameState, { heroId, townId }: LeaveTownPayload): GameState {
  const town = state.towns.find((t) => t.id === townId)
  if (!town) return state
  const asGarrison = town.garrisonGeneralId === heroId
  const asVisitor = town.visitorGeneralId === heroId
  if (!asGarrison && !asVisitor) return state
  let heroes = state.heroes
  if (asGarrison) {
    const hero = heroAtTown(state, town, heroId)
    if (!hero) return state
    heroes = [...state.heroes, hero]
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
    heroes
  }
}

/** 驻城↔访问「交换」双向切换：双槽都占 → 互换；只有驻城 → 驻城出城；只有访问 → 访问进驻 */
function swapHeroes(state: GameState, { townId }: SwapHeroesPayload): GameState {
  const town = state.towns.find((t) => t.id === townId)
  if (!town) return state
  const garrison = town.garrisonGeneralId
  const visitor = town.visitorGeneralId

  // 双槽都占：互换槽位 + heroes 成员切换（原驻城加回 heroes 位置=城格，原访问移入 garrison 移除）
  if (garrison && visitor) {
    const hero = heroAtTown(state, town, garrison)
    if (!hero) return state
    return {
      ...state,
      towns: state.towns.map((t) =>
        t.id === townId ? { ...t, garrisonGeneralId: visitor, visitorGeneralId: garrison } : t
      ),
      heroes: [...state.heroes.filter((h) => h.generalId !== visitor), hero]
    }
  }
  // 只有驻城、无访问：驻城武将出城（garrison 清空，加回 heroes 位置=城格）
  if (garrison) {
    const hero = heroAtTown(state, town, garrison)
    if (!hero) return state
    return {
      ...state,
      towns: state.towns.map((t) => (t.id === townId ? { ...t, garrisonGeneralId: null } : t)),
      heroes: [...state.heroes, hero]
    }
  }
  // 只有访问、无驻城：访问武将进驻（访问移入 garrison，从 heroes 移除）
  if (visitor) {
    return {
      ...state,
      towns: state.towns.map((t) =>
        t.id === townId ? { ...t, garrisonGeneralId: visitor, visitorGeneralId: null } : t
      ),
      heroes: state.heroes.filter((h) => h.generalId !== visitor)
    }
  }
  return state
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
 * - outcome === 'won' → 英雄胜利占格（position = targetPosition，已随移动到位），不清空剩余移动力；
 *   若 garrisonId → 该守将 alive=false；neutralId → 该中立 defeated=true；
 * - outcome === 'lost' → 英雄回最近己方城（MVP = 玩家第一城格）、行动力 = 0；
 * - 然后跑 campaign/checkVictory 胜利检查。
 */
function resolveBattle(state: GameState, payload: ResolveBattlePayload): GameState {
  const { result, garrisonId, neutralId, heroId } = payload
  const playerId = payload.playerId ?? state.heroes.find((h) => h.generalId === heroId)?.playerId
  const targetPosition = payload.targetPosition
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
    // 胜利：英雄已随移动到位占据目标格（胜利占格），不清空剩余移动力（已扣走进去的代价）
    if (targetPosition) {
      next = {
        ...next,
        heroes: next.heroes.map((h) => (h.generalId === heroId ? { ...h, position: { ...targetPosition } } : h))
      }
    }
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
  } else {
    // 失败：英雄回最近己方城（MVP = 玩家第一城格），行动力 = 0
    const town = playerId ? next.towns.find((t) => t.owner === playerId) : undefined
    if (town) {
      next = {
        ...next,
        heroes: next.heroes.map((h) =>
          h.generalId === heroId ? { ...h, position: { ...town.position }, movementLeft: 0 } : h
        )
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
