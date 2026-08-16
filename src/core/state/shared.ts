/**
 * 共享 reducer 纯函数（reducer.ts 与 core/campaign 模块共用）。
 * 独立成模块以避免 reducer ↔ campaignReducer 循环 import。
 * 确定性规则：本模块禁止裸 Math.random / Date.now。
 */
import { computeVision, type FogMap } from '../fog/Fog'
import { hexKey } from '../hex/HexGrid'
import type { MapData } from '../map/MapGen'
import { GENERAL_BASES } from '../../data/generals'
import { deriveStats } from '../generals'
import { MAX_LEVEL, xpToNext } from '../growth'
import type { GameState, HeroUnit } from './GameState'

/** 为该势力重算视野（旧 fog 决定 explored 持久化） */
export function computeVisionFor(map: MapData, hero: HeroUnit, oldFog: FogMap): FogMap {
  return computeVision({
    sources: [{ position: hero.position, sightRange: hero.sightRange }],
    mapHexes: map.hexes,
    terrainAt: (h) => map.terrain[hexKey(h)] ?? 'plain',
    oldFog
  })
}

export interface GainXpPayload {
  generalId: string
  amount: number
}

/**
 * 武将获得经验（确定性，无随机）：
 * xp 累加 → 连升（while 足够则扣 xpToNext、level+1）→ 重算 stats/skillSlots。
 * 达到 MAX_LEVEL 后不再升级（xp 仍可累积，不再扣减）；找不到武将/基础配置 → no-op。
 */
export function gainXp(state: GameState, { generalId, amount }: GainXpPayload): GameState {
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
