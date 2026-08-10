/**
 * 寻路模块（纯 core，零渲染依赖、确定性）。
 * findPath 采用 A*（heuristic = hexDistance，可接纳且一致 ⇒ 首次弹出终点即最优）；
 * reachableArea 保持 Dijkstra（按累计距离展开到移动力上限）。
 * 支持地形代价（cost 可为正数）+ 不可通行（Infinity）。
 * 返回值顺序确定：reachableArea 按 (q, r) 排序，路径从起点到终点。
 */
import { hexDistance, hexKey, hexNeighbor, type Axial, type HexDir } from '../hex/HexGrid'

/**
 * 移动代价接口：计算从 from 到 to 的单步代价。
 * 返回 Infinity 表示不可通行；返回负数视为非法（会被忽略）。
 */
export interface MovementCost {
  cost(from: Axial, to: Axial): number
}

interface HeapEntry {
  hex: Axial
  /** 出队优先级：Dijkstra = 起点累计距离 g；A* = g + heuristic */
  priority: number
}

/** 二叉最小堆，按 priority 出队（Dijkstra / A* 共用待扩展队列） */
class MinHeap {
  private data: HeapEntry[] = []

  get size(): number {
    return this.data.length
  }

  push(entry: HeapEntry): void {
    this.data.push(entry)
    this.bubbleUp(this.data.length - 1)
  }

  pop(): HeapEntry | undefined {
    const { data } = this
    if (data.length === 0) return undefined
    const top = data[0]
    const last = data.pop() as HeapEntry
    if (data.length > 0) {
      data[0] = last
      this.sinkDown(0)
    }
    return top
  }

  private bubbleUp(i: number): void {
    const { data } = this
    while (i > 0) {
      const parent = (i - 1) >> 1
      if ((data[parent] as HeapEntry).priority <= (data[i] as HeapEntry).priority) break
      const tmp = data[parent] as HeapEntry
      data[parent] = data[i] as HeapEntry
      data[i] = tmp
      i = parent
    }
  }

  private sinkDown(i: number): void {
    const { data } = this
    const n = data.length
    for (;;) {
      const left = 2 * i + 1
      const right = left + 1
      let smallest = i
      if (left < n && (data[left] as HeapEntry).priority < (data[smallest] as HeapEntry).priority) smallest = left
      if (right < n && (data[right] as HeapEntry).priority < (data[smallest] as HeapEntry).priority) smallest = right
      if (smallest === i) break
      const tmp = data[smallest] as HeapEntry
      data[smallest] = data[i] as HeapEntry
      data[i] = tmp
      i = smallest
    }
  }
}

interface DijkstraResult {
  /** hexKey → 前驱（重建路径用）；起点无前驱 */
  prev: Map<string, Axial>
  /** 所有被访问到的格子（含起点），均不超过 limit */
  visited: Axial[]
}

interface SearchOptions {
  /** 超过该累计距离的格子不再展开（reachableArea 用，等于 movement）；必须给 limit 或 goal 之一 */
  limit?: number
  /** 找到即返回（findPath 用） */
  goal?: Axial
  /** 启发式（A* 用）；缺省恒 0 即退化为 Dijkstra */
  heuristic?: (hex: Axial) => number
}

/**
 * 从 start 出发的统一搜索，含剪枝防无限扩展：
 * - limit：超过该距离的格子不再展开（reachableArea 用，等于 movement）；
 * - goal：找到即返回（findPath 用；heuristic 可接纳且一致 ⇒ 首次弹出 goal 即最优）；
 * 两者至少给其一，否则在无限六角平面上会永远向外搜索。
 * 过期条目判定：priority 须等于当前累计距离 + 启发式（否则是已更新的旧条目，跳过）。
 */
function search(start: Axial, costs: MovementCost, opts: SearchOptions): DijkstraResult {
  const { limit, goal } = opts
  const h = opts.heuristic ?? (() => 0)
  const dist = new Map<string, number>()
  const prev = new Map<string, Axial>()
  const visited: Axial[] = []
  const heap = new MinHeap()

  dist.set(hexKey(start), 0)
  heap.push({ hex: start, priority: h(start) })

  while (heap.size > 0) {
    const { hex, priority } = heap.pop() as HeapEntry
    const g = dist.get(hexKey(hex)) ?? Number.POSITIVE_INFINITY
    if (priority !== g + h(hex)) continue
    if (limit !== undefined && g > limit) break
    visited.push(hex)
    if (goal !== undefined && hexKey(hex) === hexKey(goal)) break
    for (let dir = 0; dir < 6; dir++) {
      const next = hexNeighbor(hex, dir as HexDir)
      const step = costs.cost(hex, next)
      if (!Number.isFinite(step) || step < 0) continue
      const nd = g + step
      const key = hexKey(next)
      if (nd < (dist.get(key) ?? Number.POSITIVE_INFINITY)) {
        dist.set(key, nd)
        prev.set(key, hex)
        heap.push({ hex: next, priority: nd + h(next) })
      }
    }
  }
  return { prev, visited }
}

const compareHex = (a: Axial, b: Axial): number => a.q - b.q || a.r - b.r

/**
 * 起点周围 movement 点移动力内可达的全部格子（含起点）。
 * 返回结果按 (q, r) 升序排列，保证确定性（可哈希、可快照）。
 */
export function reachableArea(start: Axial, movement: number, costs: MovementCost): Axial[] {
  const { visited } = search(start, costs, { limit: movement })
  return [...visited].sort(compareHex)
}

/**
 * start → goal 的最短路径（含两端），返回 null 表示不可达。
 * A*：优先级 = 累计代价 + hexDistance 启发式（可接纳且一致 ⇒ 首次弹出 goal 即最优）。
 * 起点即终点时返回单元素 [start]。
 */
export function findPath(start: Axial, goal: Axial, costs: MovementCost): Axial[] | null {
  if (hexKey(start) === hexKey(goal)) return [start]
  const { prev } = search(start, costs, { goal, heuristic: (hex) => hexDistance(hex, goal) })
  const goalKey = hexKey(goal)
  if (!prev.has(goalKey)) return null
  const path: Axial[] = []
  let cur: Axial = goal
  for (;;) {
    path.push(cur)
    const p = prev.get(hexKey(cur))
    if (p === undefined) break
    cur = p
  }
  path.reverse()
  return path
}
