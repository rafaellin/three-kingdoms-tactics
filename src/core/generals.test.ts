import { describe, expect, test } from 'vitest'
import { deriveStats } from './generals'
import { GENERAL_BASES } from '../data/generals'

describe('deriveStats 当前属性值推导', () => {
  test('Lv1 = 基础值', () => {
    expect(deriveStats(GENERAL_BASES['g-guan'], 1)).toEqual({ atk: 90, def: 70, int: 50, pol: 60, cha: 80 })
    expect(deriveStats(GENERAL_BASES['g-lvbu'], 1)).toEqual({ atk: 100, def: 80, int: 30, pol: 20, cha: 40 })
  })
  test('每级线性成长：当前 = 基础 + (level-1)×成长', () => {
    const s = deriveStats(GENERAL_BASES['g-guan'], 3)
    expect(s).toEqual({ atk: 90 + 2 * 3, def: 70 + 2 * 2, int: 50 + 2 * 2, pol: 60 + 2 * 1, cha: 80 + 2 * 2 })
  })
  test('Lv < 1 按 Lv1 处理（成长不倒退）', () => {
    expect(deriveStats(GENERAL_BASES['g-guan'], 0)).toEqual(deriveStats(GENERAL_BASES['g-guan'], 1))
  })
})
