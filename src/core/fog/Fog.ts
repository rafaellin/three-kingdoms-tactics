/**
 * 战争迷雾（两态简化）。
 * 两种状态：
 * - 'explored'    已探索：被看到过 → 永久全亮可见、可通行
 * - 'unexplored'  未探索：从未见过 → 全黑、不可通行
 *
 * 视野规则：
 * - 以每个可见源（英雄）为起点做 BFS，最大深度 = sightRange；
 * - 山脉/河流本身进入视野，但视线不穿透（不再向相邻格扩展）；
 * - 已探索永久保持（explored 不回退成 unexplored）。
 *
 * 纯函数、确定性：结果只依赖输入，可序列化、可回放。
 */
import { hexKey, hexNeighbor, type Axial, type HexDir } from '../hex/HexGrid'
import type { TerrainId } from '../../data/terrain'

export type Visibility = 'explored' | 'unexplored'

/** hexKey → 迷雾状态；完整覆盖地图全部格子 */
export type FogMap = Record<string, Visibility>

export interface VisionSource {
  position: Axial
  sightRange: number
}

export interface VisionInput {
  sources: readonly VisionSource[]
  mapHexes: readonly Axial[]
  terrainAt: (hex: Axial) => TerrainId
  /** 上一帧迷雾：决定 explored 持久化（探索不可逆） */
  oldFog: FogMap
}

/** 该格是否已探索（移动规则：仅 explored 可进入，unexplored 挡住） */
export function isExplored(fog: FogMap, hex: Axial): boolean {
  return fog[hexKey(hex)] === 'explored'
}

/** 该地形是否阻挡视线（本身可见但不穿透） */
export function blocksVision(terrain: TerrainId): boolean {
  return terrain === 'mountain' || terrain === 'water'
}

export function computeVision(input: VisionInput): FogMap {
  const inMap = new Set(input.mapHexes.map(hexKey))
  const currentVisible = new Set<string>()

  for (const src of input.sources) {
    const dist = new Map<string, number>([[hexKey(src.position), 0]])
    const queue: Axial[] = [src.position]
    while (queue.length > 0) {
      const cur = queue.shift() as Axial
      const d = dist.get(hexKey(cur)) as number
      currentVisible.add(hexKey(cur))
      if (d >= src.sightRange) continue
      if (blocksVision(input.terrainAt(cur))) continue // 阻挡：不继续扩展
      for (let dir = 0; dir < 6; dir++) {
        const n = hexNeighbor(cur, dir as HexDir)
        const key = hexKey(n)
        if (!inMap.has(key) || dist.has(key)) continue
        dist.set(key, d + 1)
        queue.push(n)
      }
    }
  }

  const fog: FogMap = {}
  for (const h of input.mapHexes) {
    const key = hexKey(h)
    if (currentVisible.has(key) || input.oldFog[key] === 'explored') fog[key] = 'explored'
    else fog[key] = 'unexplored'
  }
  return fog
}
