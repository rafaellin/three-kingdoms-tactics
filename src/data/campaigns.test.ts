import { describe, expect, test } from 'vitest'
import { CAMPAIGNS } from './campaigns'
import { hexKey, hexNeighbor, type Axial, type HexDir } from '../core/hex/HexGrid'

describe('CampaignConfig 东岭关', () => {
  test('配置存在：1城/3将/3出生点/1守将/2杂兵/胜利条件', () => {
    const c = CAMPAIGNS.dongling
    expect(c.startTowns).toHaveLength(1)
    expect(c.startGenerals).toHaveLength(3)
    expect(c.heroStarts).toHaveLength(3)
    expect(c.garrisons).toHaveLength(1)
    expect(c.neutrals.length).toBeGreaterThanOrEqual(2)
    expect(c.victory.kind).toBe('defeatGarrison')
    expect(c.victory.targetId).toBe('gar-kongxiu')
  })

  test('孔秀站窄路：两侧为 mountain（不可通行）', () => {
    const c = CAMPAIGNS.dongling
    const kongxiuPos = c.garrisons[0]!.position
    // 孔秀格可通行（唯一通道）
    expect(c.map.terrain[hexKey(kongxiuPos)]).toBe('plain')
    // 两侧封死
    expect(c.map.terrain[hexKey({ q: kongxiuPos.q - 1, r: kongxiuPos.r })]).toBe('mountain')
    expect(c.map.terrain[hexKey({ q: kongxiuPos.q + 1, r: kongxiuPos.r })]).toBe('mountain')
  })

  test('窄路关卡真·唯一通道：封死侧翼，孔秀格 (0,1) 是城通往关后的唯一可通行格', () => {
    const c = CAMPAIGNS.dongling
    const map = c.map
    const isPassable = (h: Axial) => map.terrain[hexKey(h)] !== 'mountain'
    // 从城 (0,0) 出发 flood-fill 可通行格；blocked 为「不可穿过的格」
    const reach = (blocked: string | null): Set<string> => {
      const visited = new Set<string>([hexKey({ q: 0, r: 0 })])
      const queue: Axial[] = [{ q: 0, r: 0 }]
      while (queue.length > 0) {
        const cur = queue.shift() as Axial
        for (let d = 0; d < 6; d++) {
          const n = hexNeighbor(cur, d as HexDir)
          const k = hexKey(n)
          if (k === blocked) continue
          if (!map.terrain[k]) continue // 地图外
          if (!isPassable(n)) continue
          if (visited.has(k)) continue
          visited.add(k)
          queue.push(n)
        }
      }
      return visited
    }
    // 绕过孔秀格 (0,1) → 关后不可达：唯一通道就是孔秀格
    const noKongxiu = reach(hexKey({ q: 0, r: 1 }))
    expect(noKongxiu.has(hexKey({ q: 0, r: 2 }))).toBe(false)
    expect(noKongxiu.has(hexKey({ q: 1, r: 2 }))).toBe(false)
    // 侧翼绕关路径必须封死：东翼 (2,1)、西翼 (-2,2)（修复前是 plain 可绕过）
    expect(noKongxiu.has(hexKey({ q: 2, r: 1 }))).toBe(false)
    expect(noKongxiu.has(hexKey({ q: -2, r: 2 }))).toBe(false)
  })

  test('武将初始兵力非空', () => {
    for (const g of CAMPAIGNS.dongling.startGenerals) {
      expect(g.army.length).toBeGreaterThan(0)
    }
  })

  test('地图无资源点（杂兵充当关卡内容）', () => {
    expect(Object.keys(CAMPAIGNS.dongling.map.nodes)).toHaveLength(0)
  })
})
