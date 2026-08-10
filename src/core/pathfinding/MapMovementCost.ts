/**
 * 寻路代价适配器：把「地形移动代价」×「战争迷雾」组合成 MovementCost。
 * 迷雾边界规则：只允许走入已探索（explored，永久可见）的格子；
 * unexplored / 无记录 视为不可通行（Infinity）。
 * 纯 core、确定性，供 findPath / reachableArea 使用。
 */
import { type Axial } from '../hex/HexGrid'
import { getTerrain } from '../../data/terrain'
import type { TerrainId } from '../../data/terrain'
import type { Visibility } from '../fog/Fog'
import type { MovementCost } from './Pathfinding'

export interface MapMovementCostInput {
  /** 查询某格地形（不在表内视为平地） */
  terrainAt: (hex: Axial) => TerrainId
  /** 查询某格迷雾状态（undefined = 无记录） */
  fogAt: (hex: Axial) => Visibility | undefined
}

export class MapMovementCost implements MovementCost {
  constructor(private readonly input: MapMovementCostInput) {}

  cost(_from: Axial, to: Axial): number {
    if (this.input.fogAt(to) !== 'explored') return Number.POSITIVE_INFINITY
    return getTerrain(this.input.terrainAt(to)).moveCost
  }
}
