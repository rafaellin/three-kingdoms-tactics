export type TerrainId = 'plain' | 'forest' | 'mountain' | 'water' | 'desert' | 'swamp'

export interface TerrainDef {
  id: TerrainId
  name: string
  passable: boolean
  /** 渲染颜色（渲染层直接使用） */
  color: number
  /** 移动消耗倍数；不可通行 = Infinity */
  moveCost: number
}

export const TERRAINS: readonly TerrainDef[] = [
  { id: 'plain', name: '平地', passable: true, color: 0x3a7d44, moveCost: 1 },
  { id: 'forest', name: '森林', passable: true, color: 0x2e6b34, moveCost: 1.5 },
  { id: 'mountain', name: '山脉', passable: false, color: 0x6b6b6b, moveCost: Number.POSITIVE_INFINITY },
  { id: 'water', name: '河流', passable: false, color: 0x2a5d8f, moveCost: Number.POSITIVE_INFINITY },
  { id: 'desert', name: '荒漠', passable: true, color: 0xc2a15b, moveCost: 1.5 },
  { id: 'swamp', name: '沼泽', passable: true, color: 0x5a6e2f, moveCost: 2 }
]

export function getTerrain(id: TerrainId): TerrainDef {
  const t = TERRAINS.find((x) => x.id === id)
  if (!t) throw new Error(`未知地形: ${id}`)
  return t
}
