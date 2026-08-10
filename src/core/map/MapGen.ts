/**
 * 地图生成（确定性）：给定种子 + 半径，产出六角格地图（纯数据）。
 * 由游戏场景在 setup 时生成并存入 GameState；同种子 ⇒ 同地图。
 */
import { RNG } from '../rng'
import { hexDistance, hexKey, hexNeighbor, type Axial, type HexDir } from '../hex/HexGrid'
import { TERRAINS, type TerrainId } from '../../data/terrain'

export interface MapData {
  hexes: Axial[]
  /** hexKey → 地形 */
  terrain: Record<string, TerrainId>
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
  return { hexes, terrain }
}
