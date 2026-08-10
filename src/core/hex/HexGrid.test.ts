import { describe, expect, test } from 'vitest'
import { hexDistance, hexNeighbor, HexLayout, type Axial } from './HexGrid'

describe('hex 轴向坐标', () => {
  test('hexDistance 正确', () => {
    expect(hexDistance({ q: 0, r: 0 }, { q: 2, r: -1 })).toBe(2)
    expect(hexDistance({ q: 0, r: 0 }, { q: 3, r: -3 })).toBe(3)
    expect(hexDistance({ q: 0, r: 0 }, { q: 0, r: 0 })).toBe(0)
    expect(hexDistance({ q: 2, r: -1 }, { q: -1, r: 3 })).toBe(4)
  })

  test('hexNeighbor 六个方向返回正确邻居', () => {
    const h: Axial = { q: 0, r: 0 }
    const expected = [
      { q: 1, r: 0 },
      { q: 1, r: -1 },
      { q: 0, r: -1 },
      { q: -1, r: 0 },
      { q: -1, r: 1 },
      { q: 0, r: 1 }
    ]
    for (let d = 0; d < 6; d++) {
      expect(hexNeighbor(h, d as 0 | 1 | 2 | 3 | 4 | 5)).toEqual(expected[d])
    }
  })

  test('邻居距离恒为 1', () => {
    for (let d = 0; d < 6; d++) {
      expect(hexDistance({ q: 0, r: 0 }, hexNeighbor({ q: 0, r: 0 }, d as 0 | 1 | 2 | 3 | 4 | 5))).toBe(1)
    }
  })
})

describe('HexLayout（纯数学像素换算，不依赖 Phaser）', () => {
  const layout = new HexLayout({ size: 32, origin: { x: 100, y: 200 } })

  test('pixelToHex(hexToPixel(h)) 还原 h', () => {
    const samples: Axial[] = [
      { q: 0, r: 0 },
      { q: 3, r: -2 },
      { q: -5, r: 7 },
      { q: 1, r: 4 }
    ]
    for (const s of samples) {
      const p = layout.hexToPixel(s)
      const back = layout.pixelToHex(p.x, p.y)
      expect(back).toEqual(s)
    }
  })

  test('pixelToHex 对靠近中心的整数点击不产生 -0 坐标', () => {
    const layout = new HexLayout({ size: 36, origin: { x: 0, y: 0 } })
    // 世界点 (62,108) 是 hex(0,2) 中心 (62.35,108) 的整数取整——e2e 鼠标点击即如此舍入，
    // fq = 0.9944 - 1.0 = -0.0056 → Math.round → -0（sign 位为负），会污染 core 状态。
    const back = layout.pixelToHex(62, 108)
    expect(back).toEqual({ q: 0, r: 2 })
    expect(Object.is(back.q, -0)).toBe(false)
  })

  test('相邻 hex 中心间距（pointy-top 水平方向）= sqrt(3) × size', () => {
    const a = layout.hexToPixel({ q: 0, r: 0 })
    const b = layout.hexToPixel({ q: 1, r: 0 })
    expect(b.x - a.x).toBeCloseTo(Math.sqrt(3) * 32, 5)
    expect(b.y - a.y).toBeCloseTo(0, 5)
  })

  test('角点数量为 6 且首点位于 -30°（pointy-top）', () => {
    const c0 = layout.cornerAt({ q: 0, r: 0 }, 0)
    const center = layout.hexToPixel({ q: 0, r: 0 })
    // 首角 (-30°)：x 偏移 +size·cos(30°)，y 偏移 -size·sin(30°)
    expect(c0.x).toBeCloseTo(center.x + layout.size * Math.cos(Math.PI / 6), 5)
    expect(c0.y).toBeCloseTo(center.y - layout.size * Math.sin(Math.PI / 6), 5)
  })
})
