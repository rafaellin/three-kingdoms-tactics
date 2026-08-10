/**
 * 测试工具：构造确定性的纯地形地图（可覆盖指定 hex 地形）。
 * 仅测试使用，不属于游戏逻辑。
 */
import { hexKey, type Axial } from '../hex/HexGrid'
import { generateMap, type MapData } from '../map/MapGen'
import type { TerrainId } from '../../data/terrain'

/** 全平地地图，可用 overrides 覆盖个别 hex 地形（如造墙测视野阻挡） */
export function makePlainMap(radius: number, overrides: Record<string, TerrainId> = {}): MapData {
  const { hexes } = generateMap(1, radius)
  const terrain: Record<string, TerrainId> = {}
  for (const h of hexes) terrain[hexKey(h)] = 'plain'
  for (const [k, v] of Object.entries(overrides)) terrain[k] = v
  return { hexes, terrain }
}

/** 起一个 hexKey 别名便于测试书写 */
export const key = (h: Axial): string => hexKey(h)
