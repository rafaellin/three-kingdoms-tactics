/**
 * 战役专属 reducer 逻辑（core，纯 TS，无 Phaser）。
 * 从 core/state/reducer.ts 迁出，让战役有自己的代码逻辑，主 reducer 只做路由委托。
 * 确定性规则：只读配置、不改动共享战役数据（深拷贝）；禁止裸 Math.random / Date.now。
 */
import { START_RESOURCES } from '../../data/bootstrap'
import type { CampaignConfig } from '../../data/campaigns'
import type { UnitDefId } from '../../data/units'
import type { Visibility } from '../fog/Fog'
import type { Axial } from '../hex/HexGrid'
import {
  BASE_MAX_MOVEMENT,
  BASE_SIGHT_RANGE,
  ZERO_RESOURCES,
  type GameState,
  type HeroUnit,
  type Player,
  type Resources
} from '../state/GameState'
import { computeVisionFor, gainXp } from '../state/shared'

/** 战役启动：mode=campaign 放守将+胜利条件；mode=explore 不放守将（自由探索） */
export interface CampaignStartPayload {
  mode: 'campaign' | 'explore'
  campaign: CampaignConfig
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

/**
 * 战役启动：按 mode 填 守将（campaign）/中立（都放）/胜利（explore null）。
 * 武将/城池/英雄来自战役配置；英雄移动力/视野基准与 setup 一致；selectedHeroId = 第一英雄。
 * 确定性：只读配置、不改动共享战役数据（武将 army/守将 units 均深拷贝）。
 */
export function campaignStart(state: GameState, payload: CampaignStartPayload): GameState {
  const camp = payload.campaign
  // 探索模式 = 单人（Spec §3）：只保留 human 玩家（东岭关即 [p1]），AI 不参与回合轮转；
  // 战役模式 = 完整玩家序列（东岭关 [p1, ai1]）。
  const players: Player[] =
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
 * 战斗回流：把战斗结果写回大地图。
 * - 参战英雄（heroId = generalId）的 army = remainingTroops；
 * - expGained > 0 → 复用 general/gainXp 的升级逻辑；
 * - outcome === 'won' → 英雄胜利占格（position = targetPosition，已随移动到位），不清空剩余移动力；
 *   若 garrisonId → 该守将 alive=false；neutralId → 该中立 defeated=true；
 * - outcome === 'lost' → 英雄回最近己方城（MVP = 玩家第一城格）、行动力 = 0；
 * - 然后跑 campaignCheckVictory 胜利检查。
 */
export function campaignResolveBattle(state: GameState, payload: ResolveBattlePayload): GameState {
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
  return campaignCheckVictory(next)
}

/** 胜利检查：victory.kind==='defeatGarrison' 且目标守将已阵亡 → outcome='won' */
export function campaignCheckVictory(state: GameState): GameState {
  const v = state.victory
  if (v?.kind !== 'defeatGarrison') return state
  const target = state.garrisons.find((g) => g.id === v.targetId)
  if (target && !target.alive) return { ...state, outcome: 'won' }
  return state
}
