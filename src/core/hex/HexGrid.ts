/**
 * 六角格纯数学（轴向坐标 + 像素换算）。
 * 零 Phaser 依赖、不感知分辨率：核心逻辑只操作抽象坐标 (q, r)，
 * 分辨率/缩放决策完全属于渲染层。
 */

/** 轴向坐标（pointy-top，尖顶朝上） */
export interface Axial {
  q: number
  r: number
}

export type HexDir = 0 | 1 | 2 | 3 | 4 | 5

/** pointy-top 六邻居方向向量 */
const NEIGHBORS: readonly Axial[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 }
]

/** 返回指定方向的邻居坐标 */
export function hexNeighbor(h: Axial, dir: HexDir): Axial {
  const n = NEIGHBORS[dir] as Axial
  return { q: h.q + n.q, r: h.r + n.r }
}

/** 两个六角格之间的轴向距离 */
export function hexDistance(a: Axial, b: Axial): number {
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r))
}

/** hex → 字符串键（用于 Set/Map 查找，如地图哈希表） */
export function hexKey(h: Axial): string {
  return `${h.q},${h.r}`
}

export interface HexLayoutParams {
  /** 六角格半径（中心到顶点），像素 */
  size: number
  /** 世界原点（坐标为 {q:0,r:0} 的 hex 中心像素位置） */
  origin: { x: number; y: number }
}

export class HexLayout {
  readonly size: number
  readonly origin: { x: number; y: number }

  constructor(params: HexLayoutParams) {
    this.size = params.size
    this.origin = params.origin
  }

  /** 轴向坐标 → 像素中心（pointy-top 布局） */
  hexToPixel(h: Axial): { x: number; y: number } {
    const s = this.size
    return {
      x: this.origin.x + s * Math.sqrt(3) * (h.q + h.r / 2),
      y: this.origin.y + s * 1.5 * h.r
    }
  }

  /** 像素 → 最近的整数轴向坐标（cube 舍入，保证往返一致） */
  pixelToHex(x: number, y: number): Axial {
    const dx = x - this.origin.x
    const dy = y - this.origin.y
    const s = this.size
    const fq = (Math.sqrt(3) / 3) * (dx / s) - (1 / 3) * (dy / s)
    const fr = (2 / 3) * (dy / s)
    return axialRound(fq, fr)
  }

  /** 第 corner 个顶点像素坐标（pointy-top：首点在 -30°） */
  cornerAt(h: Axial, corner: number): { x: number; y: number } {
    const c = this.hexToPixel(h)
    const angle = (Math.PI / 180) * (60 * corner - 30)
    return {
      x: c.x + this.size * Math.cos(angle),
      y: c.y + this.size * Math.sin(angle)
    }
  }
}

/** 分数轴向坐标 → 最近整数（cube 舍入法） */
function axialRound(fq: number, fr: number): Axial {
  let x = fq
  const z = fr
  let y = -x - z
  let rx = Math.round(x)
  const ry = Math.round(y)
  let rz = Math.round(z)
  const dx = Math.abs(rx - x)
  const dy = Math.abs(ry - y)
  const dz = Math.abs(rz - z)
  if (dx > dy && dx > dz) {
    rx = -ry - rz
  } else if (dy > dz) {
    rz = -rx - ry
  }
  return { q: rx, r: rz }
}
