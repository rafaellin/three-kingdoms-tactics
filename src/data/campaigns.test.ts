import { describe, expect, test } from 'vitest'
import { CAMPAIGNS } from './campaigns'
import { hexKey } from '../core/hex/HexGrid'

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

  test('武将初始兵力非空', () => {
    for (const g of CAMPAIGNS.dongling.startGenerals) {
      expect(g.army.length).toBeGreaterThan(0)
    }
  })

  test('地图无资源点（杂兵充当关卡内容）', () => {
    expect(Object.keys(CAMPAIGNS.dongling.map.nodes)).toHaveLength(0)
  })
})
