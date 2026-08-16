/**
 * 游戏状态模块（core 地基收尾）。
 * 定义核心领域实体（势力/资源/武将/城池/英雄/视野/资源点）与回合推进、序列化。
 * 所有状态都是纯数据（可直接 JSON 序列化），由 reducer 经 CommandLog 驱动。
 * 确定性规则：本模块禁止裸 Math.random / Date.now。
 */
import type { Visibility } from '../fog/Fog'
import type { MapData } from '../map/MapGen'
import type { Axial } from '../hex/HexGrid'
import { completeResources, isMine, RESOURCE_NODE_DEFS } from '../../data/resourceNode'
import type { UnitDefId } from '../../data/units'

/** 4 大势力：魏 / 蜀 / 吴 / 群 */
export type FactionId = 'wei' | 'shu' | 'wu' | 'qun'

/** 英雄基准：视野半径（PRD-SUPPLEMENT §1.1）与移动力（速度公式未定，先定值） */
export const BASE_SIGHT_RANGE = 3
export const BASE_MAX_MOVEMENT = 6

/** 资源：金 / 木 / 石 / 铁 */
export interface Resources {
  gold: number
  wood: number
  stone: number
  iron: number
}

export const ZERO_RESOURCES: Resources = { gold: 0, wood: 0, stone: 0, iron: 0 }

/** 当前属性值（动态层：基础 + 成长 + 装备/技能加成；随升级变化） */
export interface GeneralStats {
  atk: number   // 武力
  def: number   // 统御
  int: number   // 智力
  pol: number   // 政治
  cha: number   // 魅力
}

/** 武将（P0 逐步补充属性/技能/装备/宝物） */
export interface General {
  id: string
  name: string
  faction: FactionId
  /** 战将 / 智将 / 全能，决定升级属性与技能池 */
  type: '战将' | '智将' | '全能'
  level: number
  xp: number
  /** 当前六维（战斗展示/攻防/蓝量都读这里，不读基础配置） */
  stats: GeneralStats
  /** 已解锁技能槽数 = floor(level/3)（技能系统未来按它出槽位；本期只维护计数，不实现技能池） */
  skillSlots: number
  /** 已生效被动技能（展示） */
  passives: { name: string; level: number }[]
  /** 武将携带的部队（军队本体，跟人走；战斗时从这读，≤7 支部队） */
  army: { defId: UnitDefId; count: number }[]
}

/** 城池（P0 补充建筑/驻军/等级解锁） */
export interface Town {
  id: string
  name: string
  owner: FactionId
  level: number
  /** 所在地图格 */
  position: Axial
  /** 驻城武将，决定政治/魅力产出；同一时刻一个武将只有一种状态（地图移动 or 城池） */
  garrisonGeneralId: string | null
  /** 驻军槽（≤7 支部队；无驻将时的城防部队） */
  garrison: { defId: UnitDefId; count: number }[]
  /** 访问英雄（军队也参与防御） */
  visitorGeneralId: string | null
}

/** 守将驻点状态（战役：敌方武将把守的要塞） */
export interface GarrisonState {
  id: string
  generalId: string
  level: number
  position: Axial
  units: { defId: UnitDefId; count: number }[]
  alive: boolean
}

/** 中立杂兵状态（战役：地图上可主动攻击的野怪） */
export interface NeutralState {
  id: string
  position: Axial
  units: { defId: UnitDefId; count: number }[]
  defeated: boolean
}

/** 单个资源点状态：占领方 / 是否已拾取 */
export interface NodeState {
  owner: FactionId | null
  visited: boolean
}

/** 大地图上的英雄（每武将一英雄；MVP 1 主英雄 + 2 副在外并行） */
export interface HeroUnit {
  generalId: string
  faction: FactionId
  position: Axial
  /** 剩余移动力（含小数地形代价，如森林 1.5） */
  movementLeft: number
  maxMovement: number
  sightRange: number
}

export interface GameState {
  schemaVersion: number
  /** 当前天数（1 回合 = 1 天），从 1 起 */
  turn: number
  /** 当前行动方；setup 前为 null */
  currentFaction: FactionId | null
  /** 回合轮转顺序（setup 决定，如 [wei, shu, wu, qun]） */
  turnOrder: FactionId[]
  /** 各势力资源，key = FactionId（未参与对局的一律为 0） */
  resources: Record<FactionId, Resources>
  generals: General[]
  towns: Town[]
  /** 地图数据；setup 前为 null */
  map: MapData | null
  /** 地图生成种子（确定性重放） */
  mapSeed: number
  /** 多英雄（每武将一英雄；MVP 单英雄），setup 前为空数组 */
  heroes: HeroUnit[]
  /** 当前操作英雄 id（渲染高亮/移动目标/视野基准）；无选中时回退到 heroes[0] */
  selectedHeroId: string | null
  /** 战役 id（非战役模式为 null） */
  campaignId: string | null
  /** 守将驻点状态 */
  garrisons: GarrisonState[]
  /** 中立杂兵状态 */
  neutrals: NeutralState[]
  /** 胜利条件（配置） */
  victory: { kind: 'defeatGarrison'; targetId: string } | null
  /** 战役结局（达成胜利 → 'won'） */
  outcome: 'won' | null
  /** 按势力的战争迷雾（两态：explored 已探索永久可见 / unexplored 未探索；hexKey → 状态） */
  visibility: Record<FactionId, Record<string, Visibility>>
  /** 资源点状态（hexKey → 占领方/已拾取）；setup 时按 map.nodes 初始化 */
  nodeStates: Record<string, NodeState>
}

/** 空壳初始状态：等待 game/setup 填充 */
export function createInitialState(): GameState {
  return {
    schemaVersion: 1,
    turn: 1,
    currentFaction: null,
    turnOrder: [],
    resources: { wei: ZERO_RESOURCES, shu: ZERO_RESOURCES, wu: ZERO_RESOURCES, qun: ZERO_RESOURCES },
    generals: [],
    towns: [],
    map: null,
    mapSeed: 0,
    heroes: [],
    selectedHeroId: null,
    campaignId: null,
    garrisons: [],
    neutrals: [],
    victory: null,
    outcome: null,
    visibility: { wei: {}, shu: {}, wu: {}, qun: {} },
    nodeStates: {}
  }
}

/**
 * 当前操作英雄（选中的英雄；无选中/找不到时回退到数组第一个，无英雄返回 null）。
 * 渲染层高亮、移动目标、视野重算都以它为基准；MVP 单英雄 → 退化为原单英雄语义。
 */
export function currentHero(state: GameState): HeroUnit | null {
  if (state.selectedHeroId) {
    const sel = state.heroes.find((h) => h.generalId === state.selectedHeroId)
    if (sel) return sel
  }
  return state.heroes[0] ?? null
}

/** 当天所在周：第 1~7 天为第 1 周，8~14 为第 2 周… */
export function weekOf(turn: number): number {
  return Math.floor((turn - 1) / 7) + 1
}

/** 资源相加（纯函数，不改入参） */
export function addResources(a: Resources, b: Resources): Resources {
  return {
    gold: a.gold + b.gold,
    wood: a.wood + b.wood,
    stone: a.stone + b.stone,
    iron: a.iron + b.iron
  }
}

/** 资源相减（纯函数，调用方需先 canAfford 保证非负） */
export function subResources(a: Resources, b: Resources): Resources {
  return {
    gold: a.gold - b.gold,
    wood: a.wood - b.wood,
    stone: a.stone - b.stone,
    iron: a.iron - b.iron
  }
}

/** 该势力是否支付得起 cost（每项资源都足够） */
export function canAfford(state: GameState, faction: FactionId, cost: Resources): boolean {
  const r = state.resources[faction]
  return r.gold >= cost.gold && r.wood >= cost.wood && r.stone >= cost.stone && r.iron >= cost.iron
}

/**
 * 某势力每日产出汇总（纯函数；供 HUD 显示 `当前值 (+N)` 与结算复用）。
 * - 城池：内政厅等级 ×10 金/天 → 所属势力（政治加成依赖武将六维属性，暂为 0，PRD 注明）
 * - 矿：按 RESOURCE_NODE_DEFS 的 dailyBonus 产出 → 占领方（用户确认：矿产出是每天）
 * - 宝箱（一次性）不计入；无主矿不计入
 * 不修改 state。
 */
export function computeDailyIncome(state: GameState, faction: FactionId): Resources {
  let income: Resources = { gold: 0, wood: 0, stone: 0, iron: 0 }
  // 城池收入（每天）
  for (const town of state.towns) {
    if (town.owner !== faction) continue
    income = addResources(income, { gold: town.level * 10, wood: 0, stone: 0, iron: 0 })
  }
  // 矿产出（每天）
  for (const [hexKeyStr, nodeState] of Object.entries(state.nodeStates)) {
    if (nodeState.owner !== faction) continue
    const nodeType = state.map?.nodes?.[hexKeyStr]
    if (!nodeType || !isMine(nodeType)) continue
    const bonus = RESOURCE_NODE_DEFS[nodeType].dailyBonus
    if (!bonus) continue
    income = addResources(income, completeResources(bonus))
  }
  return income
}

/**
 * 每日结算（纯函数）：城池收入 + 矿产出。
 * - 城池：内政厅等级 ×10 金/天 → 所属势力（政治加成依赖武将六维属性，暂为 0，PRD 注明）
 * - 矿：按 RESOURCE_NODE_DEFS 的 dailyBonus 产出 → 占领方（用户确认：矿产出是每天）
 * - 每周"产出预备役部队（需金钱/物资招募）"依赖军制/招募系统，未实现（PRD 注明）
 * 返回新 state，不就地修改。
 */
export function applyDailyIncome(state: GameState): GameState {
  let resources = state.resources
  // 各势力每日产出统一按 computeDailyIncome 汇总（城池 + 矿）
  for (const faction of Object.keys(resources) as FactionId[]) {
    const income = computeDailyIncome(state, faction)
    resources = { ...resources, [faction]: addResources(resources[faction], income) }
  }
  return { ...state, resources }
}

/** 序列化（存档 / e2e 断言 / 回放期望态比对） */
export function serializeState(state: GameState): string {
  return JSON.stringify(state)
}

/** 反序列化；传入非法 JSON 会抛出 */
export function deserializeState(json: string): GameState {
  return JSON.parse(json) as GameState
}
