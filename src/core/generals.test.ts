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
