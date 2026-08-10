/**
 * 地图生成（确定性）：给定种子 + 半径，产出六角格地图（纯数据）。
 * 由游戏场景在 setup 时生成并存入 GameState；同种子 ⇒ 同地图。
 */
import { RNG } from '../rng'
import { hexDistance, hexKey, hexNeighbor, type Axial, type HexDir } from '../hex/HexGrid'
import { TERRAINS, type TerrainId } from '../../data/terrain'
import type { ResourceNodeType } from '../../data/resourceNode'

export interface MapData {
  hexes: Axial[]
  /** hexKey → 地形 */
  terrain: Record<string, TerrainId>
  /** hexKey → 资源点类型（矿/宝箱）；无资源点的格不在此表 */
  nodes: Record<string, ResourceNodeType>
}

export function generateMap(seed: number, radius: number): MapData {
  const rng = new RNG(seed)
  const terrainIds: readonly TerrainId[] = TERRAINS.map((t) => t.id)
  const center: Axial = { q: 0, r: 0 }
  const terrain: Record<string, TerrainId> = {}
  const seen = new Set<string>([hexKey(center)])
  const queue: Axial[] = [center]
  const hexes: Axial[] = []
  while (queue.length > 0) {
    const cur = queue.shift() as Axial
    hexes.push(cur)
    terrain[hexKey(cur)] = rng.pick(terrainIds)
    if (hexDistance(center, cur) >= radius) continue
    for (let d = 0; d < 6; d++) {
      const n = hexNeighbor(cur, d as HexDir)
      const k = hexKey(n)
      if (!seen.has(k)) {
        seen.add(k)
        queue.push(n)
      }
    }
  }
  // 出生点 clearing：中心 + 六邻居强制平地，保证英雄开局有立足点、可移动、
  // 且视野 BFS 不会在出生格被山脉/河流阻挡（否则游戏开局即卡死）。
  terrain[hexKey(center)] = 'plain'
  for (let d = 0; d < 6; d++) {
    terrain[hexKey(hexNeighbor(center, d as HexDir))] = 'plain'
  }
  return { hexes, terrain, nodes: placeNodes(rng, hexes, terrain, radius) }
}

/**
 * 确定性地放置资源点（木/石/铁矿 + 宝箱）。
 * - 候选格：所有平地 hex，排除出生 clearing（中心 + 六邻居）与已有资源点；
 * - 数量随地图规模缩放（半径 6 → 8 个）；
 * - 位置用 RNG 洗牌候选格后取前 N；类型按固定轮转分配（矿矿矿→宝箱→矿矿矿）。
 * 返回 hexKey → 类型。
 */
function placeNodes(
  rng: RNG,
  hexes: readonly Axial[],
  terrain: Record<string, TerrainId>,
  radius: number
): Record<string, ResourceNodeType> {
  const clearing = new Set<string>([hexKey({ q: 0, r: 0 })])
  for (let d = 0; d < 6; d++) {
    clearing.add(hexKey(hexNeighbor({ q: 0, r: 0 }, d as HexDir)))
  }
  const candidates: Axial[] = []
  for (const h of hexes) {
    if (clearing.has(hexKey(h))) continue
    if (terrain[hexKey(h)] !== 'plain') continue
    candidates.push(h)
  }
  // Fisher-Yates 洗牌（用 rng 的 int）
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = rng.int(0, i)
    const tmp = candidates[i] as Axial
    candidates[i] = candidates[j] as Axial
    candidates[j] = tmp
  }
  // 数量随规模：半径 6 → 8 个；至少 4 个（地图太小也保证有点可拾取）
  const count = Math.max(4, radius + 2)
  // 类型轮转：矿矿矿→宝箱（每 4 个一循环）
  const cycle: readonly ResourceNodeType[] = ['woodMine', 'stoneMine', 'ironMine', 'chest']
  const nodes: Record<string, ResourceNodeType> = {}
  for (let i = 0; i < Math.min(count, candidates.length); i++) {
    const hex = candidates[i] as Axial
    nodes[hexKey(hex)] = cycle[i % cycle.length] as ResourceNodeType
  }
  return nodes
}
