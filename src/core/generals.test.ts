import { describe, expect, test } from 'vitest'
import { ANCHOR_LEVEL, deriveStats } from './generals'
import { GENERAL_BASES } from '../data/generals'

const GUAN = GENERAL_BASES['g-guan']
const LVBU = GENERAL_BASES['g-lvbu']

describe('deriveStats 双锚点线性插值（base → lv20）', () => {
  test('成长锚定等级 = 20', () => {
    expect(ANCHOR_LEVEL).toBe(20)
  })

  test('Lv1 = 初始六维（低起步，名将略高）', () => {
    expect(deriveStats(GUAN, 1)).toEqual({ atk: 18, def: 16, int: 14, pol: 18, cha: 22 })
    expect(deriveStats(LVBU, 1)).toEqual({ atk: 20, def: 18, int: 10, pol: 8, cha: 12 })
  })

  test('Lv20 = 锚点六维（精确命中，无取整误差）', () => {
    expect(deriveStats(GUAN, 20)).toEqual({ atk: 96, def: 70, int: 50, pol: 60, cha: 80 })
    expect(deriveStats(LVBU, 20)).toEqual({ atk: 100, def: 80, int: 30, pol: 20, cha: 40 })
  })

  test('Lv10 中间线性：18+(96-18)×9/19=54.95→55', () => {
    expect(deriveStats(GUAN, 10)).toEqual({ atk: 55, def: 42, int: 31, pol: 38, cha: 49 })
  })

  test('Lv21 超过锚点斜率不变（不减速）：18+78×20/19=100.1→100', () => {
    expect(deriveStats(GUAN, 21)).toEqual({ atk: 100, def: 73, int: 52, pol: 62, cha: 83 })
  })

  test('Lv30 继续线性：18+78×29/19=137.05→137', () => {
    expect(deriveStats(GUAN, 30)).toEqual({ atk: 137, def: 98, int: 69, pol: 82, cha: 111 })
  })

  test('Lv<1 按 Lv1 处理（成长不倒退）', () => {
    expect(deriveStats(GUAN, 0)).toEqual(deriveStats(GUAN, 1))
    expect(deriveStats(GUAN, -5)).toEqual(deriveStats(GUAN, 1))
  })
})

describe('武将名繁体（Task 2：直接存繁体，地图/列表/战斗卡自动生效）', () => {
  test('GENERAL_BASES 各武将 name 为繁体', () => {
    expect(GENERAL_BASES['g-guan'].name).toBe('關羽')
    expect(GENERAL_BASES['g-lvbu'].name).toBe('呂布')
    expect(GENERAL_BASES['g-zhoucang'].name).toBe('周倉')
    expect(GENERAL_BASES['g-sunqian'].name).toBe('孫乾')
    expect(GENERAL_BASES['g-kongxiu'].name).toBe('孔秀')
  })
})

describe('新武将：周仓/孙乾/孔秀', () => {
  test('base/lv20 存在且 5 级可推导', () => {
    expect(GENERAL_BASES['g-zhoucang']).toBeDefined()
    expect(GENERAL_BASES['g-sunqian']).toBeDefined()
    expect(GENERAL_BASES['g-kongxiu']).toBeDefined()
    const zhou = deriveStats(GENERAL_BASES['g-zhoucang'], 5)
    expect(zhou.atk).toBeGreaterThan(0)
    expect(zhou.def).toBeGreaterThan(0)
  })

  test('周仓 Lv1/Lv20 精确命中双锚点', () => {
    expect(deriveStats(GENERAL_BASES['g-zhoucang'], 1)).toEqual({ atk: 14, def: 16, int: 6, pol: 6, cha: 10 })
    expect(deriveStats(GENERAL_BASES['g-zhoucang'], 20)).toEqual({ atk: 80, def: 78, int: 30, pol: 30, cha: 45 })
  })

  test('孙乾 Lv1/Lv20 精确命中双锚点', () => {
    expect(deriveStats(GENERAL_BASES['g-sunqian'], 1)).toEqual({ atk: 8, def: 10, int: 18, pol: 16, cha: 14 })
    expect(deriveStats(GENERAL_BASES['g-sunqian'], 20)).toEqual({ atk: 40, def: 45, int: 80, pol: 78, cha: 60 })
  })

  test('孔秀 Lv1/Lv20 精确命中双锚点', () => {
    expect(deriveStats(GENERAL_BASES['g-kongxiu'], 1)).toEqual({ atk: 12, def: 14, int: 8, pol: 8, cha: 8 })
    expect(deriveStats(GENERAL_BASES['g-kongxiu'], 20)).toEqual({ atk: 70, def: 68, int: 30, pol: 30, cha: 30 })
  })
})
