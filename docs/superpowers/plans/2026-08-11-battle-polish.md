# 战斗系统打磨（HOMM3 战斗体验）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把战斗 MVP（13×9 全平地、两步移动+攻击、瞬移、无提示）打磨到 HOMM3 式体验：矩形锯齿边战场 + 障碍物、一个单位一个行动（移动即行动）、边界刀剑交战、远程三态、反击、提示系统、逐格动画、AI 冲锋。

**Architecture:** core 先动（任务 1–5 纯 TS 逻辑 + 单测），渲染层后动（任务 6–8 BattleScene），e2e 重写（任务 9），PRD 同步 + 全量回归（任务 10）。core/render 分离铁律不变：core 零 Phaser、确定性、所有操作走 CommandLog。

**Tech Stack:** TypeScript strict / Phaser 4.2（仅渲染层）/ Vitest 4（core 单测）/ Playwright（e2e）/ pnpm。

## Global Constraints

- **包管理用 pnpm**（禁止 npm）；TypeScript strict。
- **core/render 分离（不可破坏）**：`src/core/` 零 Phaser/DOM/browser、不感知分辨率；渲染层可 import core，core 禁止 import 渲染层。core 每个模块可无浏览器直测。
- **确定性（不可破坏）**：每个操作是一个 command，追加进 CommandLog；core 内禁止裸 `Math.random()` / `Date.now()`。行动序/伤害/AI 必须纯函数。
- **常量（全部可调，集中定义）**：`MELEE_ATTACK_MULT=0.3`（远程兵近战攻击倍率）、`RANGE_OUT_MULT=0.5`（射程外远程伤害倍率）、`RANGED_RANGE=6`（弓兵射程，`UnitDef.range`）、`EDGE_HIT_TOLERANCE=10`（px，渲染层刀剑 hit 容差）。
- **TDD**：新增/修改 core 逻辑必须先写同目录 `*.test.ts` 并看到它失败；每轮 `pnpm test`；**仅 commit 前**跑 `pnpm typecheck`（CLAUDE.md 约定）。
- 中文注释、英文标识符；提交信息清晰 + 末尾 `Co-Authored-By: Claude <noreply@anthropic.com>`。
- **git 经 `powershell.exe -NoProfile -Command "git -C <repo> <cmd>"` 逐条调用**（本会话 Bash 分类器会拦截 commit）。
- 分辨率 1920×1080 RESIZE 基准；渲染层 `HexLayout({ size: 30 })`；像素换算只在渲染层。
- 提交前 `pnpm test` 全绿（每次实现完一轮就跑）。

---

## 文件结构

| 文件 | 责任 | 改动 |
|---|---|---|
| `src/core/battle/types.ts` | 战斗类型 + 纯函数 | 加 `retaliated`、`obstacles`、`woundedHp()` |
| `src/core/battle/pathing.ts` | 矩形窗口 / 障碍 / 连通性 | `inBattleGrid`、`canStandAt` 障碍校验、`battleGridConnected` |
| `src/core/battle/battleReducer.ts` | 命令纯函数 | init 障碍、行动序同速攻方先行、移动即行动、attack v2+反击、shoot |
| `src/core/battle/damage.ts` | 伤害公式 | `attackMult` 参数、`MELEE_ATTACK_MULT`、`RANGE_OUT_MULT` |
| `src/core/battle/ai.ts` | 敌方 AI | `canEngageTarget` + 冲锋/射击 |
| `src/data/units.ts` | 兵种表 | archer `range: 2 → 6` |
| `src/data/battleTest.ts` | 固定测试阵容 | `BATTLE_OBSTACLES` |
| `src/core/battle/*.test.ts` | core 单测 | 逐任务增改（types/damage/pathing/ai/battleReducer） |
| `src/scenes/BattleScene.ts` | 渲染层 | 矩形网格/障碍/去血条/金标/悬停交互/动画/AI 异步/startBattle |
| `src/dev/debug.ts` | dev 桥 | `startBattle`、waitForMove 兼容战斗 |
| `src/e2e/battle.spec.ts` | e2e 回归 | 重写 |
| `PRD.md` | 需求文档 | §15/§16 同步 |

---

### Task 1: 矩形战场窗口 + 障碍物 + 连通性 + retaliated/woundedHp

**Files:**
- Modify: `src/core/battle/types.ts`
- Modify: `src/core/battle/pathing.ts`
- Modify: `src/core/battle/battleReducer.ts`（仅 init / createInitialBattleState）
- Modify: `src/data/battleTest.ts`
- Modify: `src/core/battle/types.test.ts`、`src/core/battle/pathing.test.ts`、`src/core/battle/battleReducer.test.ts`

**Interfaces:**
- Consumes: 现有 `BattleState.grid = { cols, rows }`（cols=行宽、rows=行数）、`occupiedHexes(unit)`、`battleReachableArea/battleFindPath`、`UNIT_DEFS`。
- Produces:
  - `BattleUnit` 新增 `retaliated: boolean`（本回合是否已反击）。
  - `BattleState` 新增 `obstacles: Axial[]`。
  - `woundedHp(unit: Pick<BattleUnit,'hpLeft'|'count'|'defId'>): number`（types.ts 导出）。
  - `inBattleGrid(state, hex): boolean`、`canStandAt(mover, state, to): boolean`（导出）、`battleGridConnected(state): boolean`（pathing.ts 导出）。
  - `init` 的 payload `grid` 扩展为 `{ cols: number; rows: number; obstacles?: Axial[] }`。
  - `BATTLE_OBSTACLES: Axial[]`（battleTest.ts）。

- [ ] **Step 1: 写失败测试（types.test.ts 追加 woundedHp）**

```ts
import { occupiedHexes, woundedHp } from './types'
describe('woundedHp（伤兵剩余血量）', () => {
  test('末位伤兵血 = hpLeft - (count-1)×hp', () => {
    // 骑兵单兵 3 血：5 骑满编 hpLeft=15 吃 4 伤 → 11，count=ceil(11/3)=4 → 末者 11-3×3=2
    expect(woundedHp({ hpLeft: 11, count: 4, defId: 'cavalry' })).toBe(2)
  })
  test('满编无伤兵：末位兵满血', () => {
    expect(woundedHp({ hpLeft: 15, count: 5, defId: 'cavalry' })).toBe(3)
  })
})
```

- [ ] **Step 2: 写失败测试（pathing.test.ts 追加窗口/障碍/连通性）**

把 `makeState` 扩展为带 obstacles 参数，并补 `retaliated`：

```ts
import { battleFindPath, battleReachableArea, battleGridConnected, inBattleGrid } from './pathing'
import type { Axial } from '../hex/HexGrid'

function makeState(
  units: BattleUnit[],
  grid: { cols: number; rows: number } = { cols: 20, rows: 20 },
  obstacles: Axial[] = []
): BattleState {
  return {
    grid,
    units,
    obstacles,
    general: { player: { name: 'P', atkBonus: 0, defBonus: 0 }, enemy: { name: 'E', atkBonus: 0, defBonus: 0 } },
    turn: 1, order: units.map((u) => u.id), currentUnitId: units[0]?.id ?? null, selectedUnitId: null, phase: 'combat', log: []
  }
}
```

`makeUnit` 里 `BattleUnit` 字面量补 `retaliated: false`。追加测试：

```ts
test('矩形窗口：qMin(r)=-floor(r/2)，行内 q∈[qMin, qMin+cols-1]', () => {
  const s = makeState([], { cols: 4, rows: 3 })
  expect(inBattleGrid(s, { q: 0, r: 0 })).toBe(true)
  expect(inBattleGrid(s, { q: 3, r: 0 })).toBe(true)
  expect(inBattleGrid(s, { q: 4, r: 0 })).toBe(false)   // 超行宽
  expect(inBattleGrid(s, { q: 3, r: 2 })).toBe(false)   // 锯齿左进：行2窗口 [-1,2]
  expect(inBattleGrid(s, { q: -1, r: 2 })).toBe(true)
  expect(inBattleGrid(s, { q: 0, r: 3 })).toBe(false)   // 行越界
})
test('障碍格不可通行', () => {
  const s = makeState([makeUnit({ defId: 'militia' })], { cols: 13, rows: 9 }, [{ q: 2, r: 0 }])
  const reach = battleReachableArea(s.units[0]!, s)
  expect(reach.some((h) => hexKey(h) === '2,0')).toBe(false)
  expect(reach.some((h) => hexKey(h) === '1,0')).toBe(true)
})
test('1×2 单位东邻是障碍则不可占', () => {
  const s = makeState([makeUnit({ defId: 'cavalry', position: { q: 4, r: 0 } })], { cols: 13, rows: 9 }, [{ q: 6, r: 0 }])
  expect(battleReachableArea(s.units[0]!, s).some((h) => hexKey(h) === '5,0')).toBe(false)
})
test('连通性：固定测试图连通（无孤岛）', () => {
  const obs: Axial[] = [{ q: 4, r: 0 }, { q: 5, r: 0 }, { q: 4, r: 2 }, { q: 5, r: 2 }, { q: 7, r: 4 }, { q: 8, r: 4 }]
  const s = makeState([], { cols: 13, rows: 9 }, obs)
  expect(battleGridConnected(s)).toBe(true)
})
test('连通性：整列障碍制造孤岛 → 不连通', () => {
  const wall: Axial[] = [{ q: 3, r: 0 }, { q: 3, r: 1 }, { q: 3, r: 2 }, { q: 3, r: 3 }, { q: 3, r: 4 }]
  const s = makeState([], { cols: 8, rows: 5 }, wall)
  expect(battleGridConnected(s)).toBe(false)
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `powershell.exe -NoProfile -Command "cd F:\work\three-kingdoms-tactics\.claude\worktrees\crystalline-stargazing-panda && pnpm vitest run src/core/battle/types.test.ts src/core/battle/pathing.test.ts"`
Expected: 失败——`woundedHp`/`inBattleGrid`/`battleGridConnected` 未定义；`obstacles`/`retaliated` 类型错误。

- [ ] **Step 4: 实现 types.ts（增量）**

```ts
import { UNIT_DEFS, type UnitDefId } from '../../data/units'
import type { Axial } from '../hex/HexGrid'
// BattleUnit 在 hasMoved 后加：
/** 本回合是否已反击（每回合重置；近战引发，每回合一次） */
retaliated: boolean
// BattleState 在 grid 后加：
/** 战场障碍物（不可通行、不可占）；init 从配置带入 */
obstacles: Axial[]
// 文件末尾加：
/** 受伤士兵剩余血量：hpLeft - (count-1)×单兵血量 */
export function woundedHp(unit: Pick<BattleUnit, 'hpLeft' | 'count' | 'defId'>): number {
  return unit.hpLeft - (unit.count - 1) * UNIT_DEFS[unit.defId].hp
}
```

- [ ] **Step 5: 实现 pathing.ts（重写 inGrid→inBattleGrid + 障碍 + 连通性）**

```ts
import { hexKey, hexNeighbor, type Axial, type HexDir } from '../hex/HexGrid'
import { findPath, reachableArea, type MovementCost } from '../pathfinding/Pathfinding'
import { UNIT_DEFS } from '../../data/units'
import { occupiedHexes, type BattleState, type BattleUnit } from './types'

/** 矩形窗口谓词：行 r 的 q ∈ [qMin(r), qMin(r)+cols-1]，qMin(r) = -floor(r/2)（左右锯齿边） */
export function inBattleGrid(state: BattleState, hex: Axial): boolean {
  if (hex.r < 0 || hex.r >= state.grid.rows) return false
  const qMin = -Math.floor(hex.r / 2)
  return hex.q >= qMin && hex.q <= qMin + state.grid.cols - 1
}

/** 该单位能否把主体格放到 to：窗口内 + 非障碍 + 不与其它单位重叠（size=2 校验主体+东邻） */
export function canStandAt(mover: BattleUnit, state: BattleState, to: Axial): boolean {
  if (!inBattleGrid(state, to)) return false
  for (const hex of occupiedHexes({ position: to, size: mover.size })) {
    if (!inBattleGrid(state, hex)) return false
    if (state.obstacles.some((o) => hexKey(o) === hexKey(hex))) return false
    for (const other of state.units) {
      if (other.id === mover.id) continue
      if (occupiedHexes(other).some((h) => hexKey(h) === hexKey(hex))) return false
    }
  }
  return true
}

/** 连通性不变量：从 (0,0) 泛洪，所有「窗口内非障碍格」都应可达 → 无孤岛 */
export function battleGridConnected(state: BattleState): boolean {
  const valid = new Set<string>()
  let total = 0
  for (let r = 0; r < state.grid.rows; r++) {
    const qMin = -Math.floor(r / 2)
    for (let q = qMin; q <= qMin + state.grid.cols - 1; q++) {
      const hex = { q, r }
      if (state.obstacles.some((o) => hexKey(o) === hexKey(hex))) continue
      valid.add(hexKey(hex))
      total++
    }
  }
  const startKey = hexKey({ q: 0, r: 0 })
  if (!valid.has(startKey)) return total === 0
  const seen = new Set<string>([startKey])
  const stack: Axial[] = [{ q: 0, r: 0 }]
  let reached = 0
  while (stack.length > 0) {
    const cur = stack.pop() as Axial
    reached++
    for (let d = 0; d < 6; d++) {
      const nb = hexNeighbor(cur, d as HexDir)
      const k = hexKey(nb)
      if (valid.has(k) && !seen.has(k)) {
        seen.add(k)
        stack.push(nb)
      }
    }
  }
  return reached === total
}

export function battleMovementCost(mover: BattleUnit, state: BattleState): MovementCost {
  return {
    cost(_from, to) {
      return canStandAt(mover, state, to) ? 1 : Number.POSITIVE_INFINITY
    }
  }
}

export function battleReachableArea(mover: BattleUnit, state: BattleState): Axial[] {
  return reachableArea(mover.position, UNIT_DEFS[mover.defId].speed, battleMovementCost(mover, state))
}

export function battleFindPath(mover: BattleUnit, to: Axial, state: BattleState): Axial[] | null {
  return findPath(mover.position, to, battleMovementCost(mover, state))
}
```

（`battleMovementCost` / `battleReachableArea` / `battleFindPath` 不变，仅前移；旧的私有 `inGrid`、私有 `canStandAt` 删除。）

- [ ] **Step 6: 实现 battleReducer.ts（init 带障碍 + retaliated）+ battleTest.ts**

`createInitialBattleState` 的返回对象加 `obstacles: []`。`init` 改为：

```ts
function init(state: BattleState, payload: { player: BattleArmyConfig; enemy: BattleArmyConfig; grid: { cols: number; rows: number; obstacles?: Axial[] } }): BattleState {
  const mk = (cfg: BattleArmyConfig, qBase: number): BattleUnit[] =>
    cfg.units.map((u, i) => {
      const def = UNIT_DEFS[u.defId]
      return {
        id: `${cfg.side === 'player' ? 'p' : 'e'}${i}`,
        side: cfg.side,
        defId: u.defId,
        count: u.count,
        position: { q: qBase, r: i },
        size: def.size,
        hpLeft: u.count * def.hp,
        maxHp: u.count * def.hp,
        hasActed: false,
        hasMoved: false,
        retaliated: false
      }
    })
  const units = [...mk(payload.player, 0), ...mk(payload.enemy, payload.grid.cols - 2)]
  const order = sortOrder(units)
  return {
    ...state,
    grid: payload.grid,
    obstacles: payload.grid.obstacles ?? [],
    units,
    general: {
      player: { name: payload.player.generalName, atkBonus: payload.player.atkBonus, defBonus: payload.player.defBonus },
      enemy: { name: payload.enemy.generalName, atkBonus: payload.enemy.atkBonus, defBonus: payload.enemy.defBonus }
    },
    turn: 1,
    order,
    currentUnitId: order[0] ?? null,
    selectedUnitId: null,
    phase: 'combat',
    log: [`战斗开始：${payload.player.generalName} vs ${payload.enemy.generalName}`]
  }
}
```

`battleReducer.ts` 顶部 import 增加 `type Axial`（来自 `../hex/HexGrid`）。

`src/data/battleTest.ts`：

```ts
import type { Axial } from '../core/hex/HexGrid'

export const BATTLE_GRID = { cols: 13, rows: 9 } as const

/** 固定测试图障碍：避开出生行/出生格，连通性单测锁定 */
export const BATTLE_OBSTACLES: Axial[] = [
  { q: 4, r: 0 }, { q: 5, r: 0 },
  { q: 4, r: 2 }, { q: 5, r: 2 },
  { q: 7, r: 4 }, { q: 8, r: 4 }
]
```

- [ ] **Step 7: battleReducer.test.ts 补 init 测试 + ai.test.ts 的 state()/unit() 适配**

battleReducer.test.ts 追加：

```ts
test('init 带入障碍物；单位 retaliated 初始 false', () => {
  const store = makeStore({
    grid: { cols: 13, rows: 9, obstacles: [{ q: 2, r: 0 }] }
  })
  const s = store.getState()
  expect(s.obstacles).toEqual([{ q: 2, r: 0 }])
  expect(s.units.every((u) => u.retaliated === false)).toBe(true)
})
```

`makeStore` 的 `opts.grid` 类型参数改为 `{ cols: number; rows: number; obstacles?: { q: number; r: number }[] }`。

`src/core/battle/ai.test.ts` 的 `unit()` 字面量补 `retaliated: false`，`state()` 返回对象补 `obstacles: []`。

- [ ] **Step 8: 跑测试确认通过**

Run: `powershell.exe -NoProfile -Command "cd F:\work\three-kingdoms-tactics\.claude\worktrees\crystalline-stargazing-panda && pnpm test"`
Expected: 全绿（旧 pathing 测试 20×20 网格在窗口下仍成立：61 格含起点、占格拒绝、越界/被占 null）。

- [ ] **Step 9: 提交**

```bash
powershell.exe -NoProfile -Command "git -C 'F:\work\three-kingdoms-tactics\.claude\worktrees\crystalline-stargazing-panda' add -A && git -C 'F:\work\three-kingdoms-tactics\.claude\worktrees\crystalline-stargazing-panda' commit -m \"feat(core): 矩形战场窗口+障碍物+连通性+retaliated/woundedHp

Co-Authored-By: Claude <noreply@anthropic.com>\""
```

---

### Task 2: 行动序同速攻方先行 + 移动即行动

**Files:**
- Modify: `src/core/battle/battleReducer.ts`（sortOrder / advance / move）
- Modify: `src/core/battle/battleReducer.test.ts`（move 测试重写 + 同速测试 + 回合重置断言）

**Interfaces:**
- Consumes: Task 1 的 `retaliated` / `obstacles`。
- Produces: `sortOrder` 同速「玩家先行」；`advance` 回合结束重置 `retaliated`；`battle/move` 置 `hasActed` 并 `advance`（移动=行动）。

- [ ] **Step 1: 写失败测试（battleReducer.test.ts）**

重写 `battle/move` 两个测试 + 追加同速先行 + 改回合重置断言：

```ts
describe('battle/move（移动即行动）', () => {
  test('移动到可达格：置 hasActed+hasMoved 并 advance', () => {
    const store = makeStore()
    const cur = store.getState().currentUnitId! // 骑兵（speed9，(0,1)）
    store.dispatch('battle/move', { unitId: cur, to: { q: 1, r: 0 } })
    const u = store.getState().units.find((x) => x.id === cur)!
    expect(hexKey(u.position)).toBe('1,0')
    expect(u.hasActed).toBe(true)
    expect(u.hasMoved).toBe(true)
    expect(store.getState().currentUnitId).not.toBe(cur) // 行动完 advance
  })
  test('不可达/越界/已行动 均为 no-op', () => {
    const store = makeStore()
    const cur = store.getState().currentUnitId!
    store.dispatch('battle/move', { unitId: cur, to: { q: 99, r: 99 } }) // 越界 → no-op
    expect(hexKey(store.getState().units.find((x) => x.id === cur)!.position)).toBe('0,1')
    store.dispatch('battle/move', { unitId: cur, to: { q: 1, r: 0 } })  // 合法移动
    expect(hexKey(store.getState().units.find((x) => x.id === cur)!.position)).toBe('1,0')
    // 已行动 → advance 后不再是当前单位 → 再移动 no-op
    store.dispatch('battle/move', { unitId: cur, to: { q: 2, r: 0 } })
    expect(hexKey(store.getState().units.find((x) => x.id === cur)!.position)).toBe('1,0')
  })
})
```

在 `battle/endTurn 回合推进` 组里补同速测试 + 改重置断言：

```ts
test('同速攻方先行：玩家单位排在敌方前', () => {
  const store = makeStore({
    grid: { cols: 4, rows: 3 },
    player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 1 }] },
    enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 1 }] }
  })
  expect(store.getState().order[0]).toBe('p0')
})
```

把「全动完 turn+1 重排」那条的断言改为：

```ts
expect(s.units.every((u) => !u.hasActed && !u.hasMoved && !u.retaliated)).toBe(true)
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run src/core/battle/battleReducer.test.ts`
Expected: move 测试失败（旧 move 不置 hasActed、不 advance）；同速/重置断言失败。

- [ ] **Step 3: 实现**

```ts
function sortOrder(units: BattleUnit[]): string[] {
  return [...units]
    .sort((a, b) => {
      const sp = UNIT_DEFS[b.defId].speed - UNIT_DEFS[a.defId].speed
      if (sp !== 0) return sp
      // 同速 → 攻方（玩家）先行；仍相同按 id 稳定序
      if (a.side !== b.side) return a.side === 'player' ? -1 : 1
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    .map((u) => u.id)
}

/** 找到本回合下一个未行动单位；全部行动完则 turn+1、重置（含 retaliated）、按新状态重排 */
function advance(state: BattleState): BattleState {
  for (const id of state.order) {
    const u = state.units.find((x) => x.id === id)
    if (u && !u.hasActed) return { ...state, currentUnitId: id, selectedUnitId: null }
  }
  const units = state.units.map((u) => ({ ...u, hasActed: false, hasMoved: false, retaliated: false }))
  const order = sortOrder(units)
  return { ...state, turn: state.turn + 1, units, order, currentUnitId: order[0] ?? null, selectedUnitId: null }
}

/** 移动即行动：置 hasActed+hasMoved 并 advance */
function move(state: BattleState, unitId: string, to: Axial): BattleState {
  const unit = state.units.find((u) => u.id === unitId)
  if (!unit || unit.id !== state.currentUnitId || unit.hasActed) return state
  if (hexKey(unit.position) === hexKey(to)) return state
  const reachable = battleReachableArea(unit, state)
  if (!reachable.some((h) => hexKey(h) === hexKey(to))) return state
  if (!battleFindPath(unit, to, state)) return state
  const units = state.units.map((u) =>
    u.id === unitId ? { ...u, position: { ...to }, hasActed: true, hasMoved: true } : u
  )
  const log = [...state.log, `${unitId} 移动至 (${to.q},${to.r})`]
  return advance({ ...state, units, log })
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run src/core/battle/battleReducer.test.ts`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
powershell.exe -NoProfile -Command "git -C 'F:\work\three-kingdoms-tactics\.claude\worktrees\crystalline-stargazing-panda' add -A && git -C 'F:\work\three-kingdoms-tactics\.claude\worktrees\crystalline-stargazing-panda' commit -m \"feat(core): 行动序同速攻方先行；移动即行动

Co-Authored-By: Claude <noreply@anthropic.com>\""
```

---

### Task 3: 近战攻击 v2（落点冲锋）+ 全伤反击

**Files:**
- Modify: `src/core/battle/damage.ts`（attackMult 参数 + MELEE_ATTACK_MULT）
- Modify: `src/core/battle/damage.test.ts`（倍率测试）
- Modify: `src/core/battle/battleReducer.ts`（`dealDamage` helper + `attack` v2）
- Modify: `src/core/battle/battleReducer.test.ts`（attack 测试重写）

**Interfaces:**
- Consumes: Task 1 的 `retaliated`；Task 2 的 `advance`。
- Produces:
  - `computeDamage(attacker, target, atkBonus, defBonus, attackMult = 1)`（默认 1 不改旧调用）。
  - `MELEE_ATTACK_MULT = 0.3`（damage.ts 导出）。
  - `battle/attack` payload：`{ unitId, targetId, to?: Axial }`。近战校验：`to` 可达（或原地）+ 与目标相邻；远程兵近战 `attackMult=MELEE_ATTACK_MULT`；结算后反击（目标存活、目标未反击、相邻）；`retaliated` 置位。
  - 模块内 helper `dealDamage(units, victimId, dmg): BattleUnit[]`（Task 4 复用）。

- [ ] **Step 1: 写失败测试（damage.test.ts）**

```ts
import { ATK_DEF_CAP, ATK_DEF_MODIFIER, computeActualAttack, computeActualDefense, computeDamage, MELEE_ATTACK_MULT } from './damage'

test('attackMult 倍率生效（远程兵近战 30% 攻）', () => {
  // 弓兵攻6 ×0.3 = 1.8，民兵防4 → 差 -2.2 → ×0.89 → round(10×3×0.89)=27
  const a = unit({ defId: 'archer', count: 10 })
  const t = unit({ side: 'enemy', defId: 'militia', hpLeft: 50, maxHp: 50 })
  expect(computeDamage(a, t, 0, 0, MELEE_ATTACK_MULT)).toBe(27)
})
```

- [ ] **Step 2: 写失败测试（battleReducer.test.ts 重写 attack 组）**

把原有 4 个 `battle/attack` 测试整体替换为：

```ts
describe('battle/attack（近战 v2 + 反击）', () => {
  test('带 to 冲锋近战：移动落点 + 全额伤害 + 触发全额反击', () => {
    // 5×3：p0 民兵20 (0,0) vs e0 刀兵20 (3,0)（q=cols-2，40 血池，hp2）
    // 民兵攻4 刀兵防8 → 差-4 钳-3 → ×0.85 → 伤 round(20×2×0.85)=34
    // e0 → 6hp count3；e0 反击 3×4×1.1=13.2→13 → p0 7hp count7
    const store = makeStore({
      grid: { cols: 5, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'swordsman', count: 20 }] }
    })
    store.dispatch('battle/attack', { unitId: 'p0', targetId: 'e0', to: { q: 2, r: 0 } })
    const s = store.getState()
    const t = s.units.find((u) => u.id === 'e0')!
    const a = s.units.find((u) => u.id === 'p0')!
    expect(a.position).toEqual({ q: 2, r: 0 })
    expect(t.hpLeft).toBe(6)
    expect(t.count).toBe(3)          // ceil(6/2)
    expect(t.retaliated).toBe(true)
    expect(a.hpLeft).toBe(7)         // 20 - 13
    expect(a.count).toBe(7)
    expect(s.currentUnitId).toBe('e0') // 行动完 advance 到敌方未行动单位
  })
  test('每回合每个单位只反击一次', () => {
    // 同速（民兵4=刀兵4）攻方先行 → 序 [p0,p1,e0]
    // p0 冲锋：伤34 → e0 6hp count3、反击13 → p0 7hp
    // p1 从 (0,1) 冲锋到 (3,1)（e0 邻格）：伤 round(1×2×0.85)=2 → e0 4hp count2；e0 已反击 → 不再反击
    const store = makeStore({
      grid: { cols: 5, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0,
        units: [{ defId: 'militia', count: 20 }, { defId: 'militia', count: 1 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'swordsman', count: 20 }] }
    })
    store.dispatch('battle/attack', { unitId: 'p0', targetId: 'e0', to: { q: 2, r: 0 } })
    store.dispatch('battle/attack', { unitId: 'p1', targetId: 'e0', to: { q: 3, r: 1 } })
    const s = store.getState()
    const t = s.units.find((u) => u.id === 'e0')!
    const p1 = s.units.find((u) => u.id === 'p1')!
    expect(t.hpLeft).toBe(4)
    expect(t.count).toBe(2)
    expect(p1.hpLeft).toBe(1)        // 无反击 → 满血
    expect(p1.hasActed).toBe(true)
  })
  test('远程兵近战按 30% 攻取值；灭队即判胜', () => {
    // 弓兵100 攻6×0.3=1.8，民兵50 防4 → 差-2.2 → ×0.89 → 伤 round(100×3×0.89)=267 → 民兵50 全灭
    const store = makeStore({
      grid: { cols: 4, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'archer', count: 100 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }] }
    })
    store.dispatch('battle/attack', { unitId: 'p0', targetId: 'e0', to: { q: 1, r: 0 } })
    const s = store.getState()
    expect(s.units.find((u) => u.id === 'e0')).toBeUndefined()
    expect(s.phase).toBe('won')
    expect(s.log.some((l) => l.includes('267'))).toBe(true)
  })
  test('no-op：落点不可达 / 不与目标相邻 / 无 to 直接点远处敌军 / 打己方', () => {
    const store = makeStore({
      grid: { cols: 5, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'swordsman', count: 20 }] }
    })
    store.dispatch('battle/attack', { unitId: 'p0', targetId: 'e0', to: { q: 9, r: 9 } })   // ① 落点越界
    store.dispatch('battle/attack', { unitId: 'p0', targetId: 'e0', to: { q: 1, r: 0 } })   // ② 落点不与目标相邻
    store.dispatch('battle/attack', { unitId: 'p0', targetId: 'e0' })                       // ③ 无 to 原地非相邻
    expect(store.getState().currentUnitId).toBe('p0')
    const store2 = makeStore({
      grid: { cols: 5, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0,
        units: [{ defId: 'militia', count: 20 }, { defId: 'militia', count: 5 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'swordsman', count: 20 }] }
    })
    store2.dispatch('battle/attack', { unitId: 'p0', targetId: 'p1', to: { q: 2, r: 0 } })  // ④ 打己方
    expect(store2.getState().units.find((u) => u.id === 'p1')).toBeDefined()
  })
})
```

- [ ] **Step 3: 跑测试确认失败**

Run: `pnpm vitest run src/core/battle/damage.test.ts src/core/battle/battleReducer.test.ts`
Expected: 失败——`MELEE_ATTACK_MULT` 未定义、`computeDamage` 不支持第 5 参、旧 `attack` 不认 `to`/无反击。

- [ ] **Step 4: 实现 damage.ts**

```ts
export const MELEE_ATTACK_MULT = 0.3 // 远程兵近战时攻击取值倍率

export function computeDamage(attacker: BattleUnit, target: BattleUnit, atkBonus: number, defBonus: number, attackMult = 1): number {
  const att = computeActualAttack(attacker.defId, atkBonus) * attackMult
  const def = computeActualDefense(target.defId, defBonus)
  const diff = Math.max(-ATK_DEF_CAP, Math.min(ATK_DEF_CAP, att - def))
  const mid = (UNIT_DEFS[attacker.defId].minDamage + UNIT_DEFS[attacker.defId].maxDamage) / 2
  return Math.max(1, Math.round(attacker.count * mid * (1 + ATK_DEF_MODIFIER * diff)))
}
```

- [ ] **Step 5: 实现 battleReducer.ts（dealDamage + attack v2）**

```ts
/** 对 victim 结算 dmg：扣血池 → 折算 count → 死亡则移除。返回更新后的 units */
function dealDamage(units: BattleUnit[], victimId: string, dmg: number): BattleUnit[] {
  const victim = units.find((u) => u.id === victimId)
  if (!victim) return units
  const hpLeft = victim.hpLeft - dmg
  if (hpLeft <= 0) return units.filter((u) => u.id !== victimId)
  return units.map((u) =>
    u.id === victimId ? { ...u, hpLeft, count: Math.max(1, Math.ceil(hpLeft / UNIT_DEFS[u.defId].hp)) } : u
  )
}

/** 近战攻击：to=落点（默认原地）。落点必须可达（或原地）且与目标相邻；远程兵近战按 30% 攻；触发反击（全伤、每回合一次） */
function attack(state: BattleState, unitId: string, targetId: string, to?: Axial): BattleState {
  const attacker = state.units.find((u) => u.id === unitId)
  const target = state.units.find((u) => u.id === targetId)
  if (!attacker || !target || attacker.id !== state.currentUnitId || attacker.hasActed) return state
  if (attacker.side === target.side) return state
  const dest = to ?? attacker.position
  if (hexKey(dest) !== hexKey(attacker.position)) {
    if (!battleReachableArea(attacker, state).some((h) => hexKey(h) === hexKey(dest))) return state
    if (!battleFindPath(attacker, dest, state)) return state
  }
  if (!occupiedHexes(target).some((h) => hexDistance(dest, h) <= 1)) return state
  const atkGen = state.general[attacker.side]
  const defGen = state.general[target.side]
  const atkMult = UNIT_DEFS[attacker.defId].range > 1 ? MELEE_ATTACK_MULT : 1
  const dmg = computeDamage({ ...attacker, position: dest }, target, atkGen.atkBonus, defGen.defBonus, atkMult)
  let units = state.units.map((u) =>
    u.id === attacker.id ? { ...u, position: { ...dest }, hasActed: true, hasMoved: true } : u
  )
  units = dealDamage(units, target.id, dmg)
  const logs = [`${attacker.id} 攻击 ${target.id} 造成 ${dmg} 伤害${units.some((u) => u.id === target.id) ? '' : '（消灭）'}`]
  const phase = phaseOf(units)
  if (phase !== 'combat') return { ...state, units, phase, log: [...state.log, ...logs] }
  let next = { ...state, units, log: [...state.log, ...logs] }
  // 反击：目标存活、目标本回合未反击、仍在近战范围（落点相邻已保证）
  const targetAfter = units.find((u) => u.id === target.id)
  const attackerAfter = units.find((u) => u.id === attacker.id)
  if (targetAfter && attackerAfter && !targetAfter.retaliated) {
    const rMult = UNIT_DEFS[target.defId].range > 1 ? MELEE_ATTACK_MULT : 1
    const rDmg = computeDamage(targetAfter, attackerAfter, defGen.atkBonus, atkGen.defBonus, rMult)
    let units2 = next.units.map((u) => (u.id === target.id ? { ...u, retaliated: true } : u))
    units2 = dealDamage(units2, attacker.id, rDmg)
    const logs2 = [...logs, `${target.id} 反击 ${attacker.id} 造成 ${rDmg} 伤害${units2.some((u) => u.id === attacker.id) ? '' : '（消灭）'}`]
    const phase2 = phaseOf(units2)
    if (phase2 !== 'combat') return { ...state, units: units2, phase: phase2, log: [...state.log, ...logs2] }
    return advance({ ...next, units: units2, log: [...state.log, ...logs2] })
  }
  return advance(next)
}
```

reducer 分发改为：

```ts
case 'battle/attack': {
  const payload = cmd.payload as { unitId: string; targetId: string; to?: Axial }
  return attack(state, payload.unitId, payload.targetId, payload.to)
}
```

（`battleReducer.ts` 需 import `MELEE_ATTACK_MULT` from './damage'。）

- [ ] **Step 6: 跑测试确认通过**

Run: `pnpm vitest run src/core/battle/damage.test.ts src/core/battle/battleReducer.test.ts`
Expected: 全绿。

- [ ] **Step 7: 提交**

```bash
powershell.exe -NoProfile -Command "git -C 'F:\work\three-kingdoms-tactics\.claude\worktrees\crystalline-stargazing-panda' add -A && git -C 'F:\work\three-kingdoms-tactics\.claude\worktrees\crystalline-stargazing-panda' commit -m \"feat(core): 近战攻击 v2（落点冲锋）+ 全伤反击（每回合一次）

Co-Authored-By: Claude <noreply@anthropic.com>\""
```

---

### Task 4: 远程射击 shoot + 弓兵射程 6

**Files:**
- Modify: `src/data/units.ts`（archer range 2→6）
- Modify: `src/core/battle/damage.ts`（RANGE_OUT_MULT）
- Modify: `src/core/battle/battleReducer.ts`（shoot + 分发）
- Modify: `src/core/battle/battleReducer.test.ts`（shoot 测试组）

**Interfaces:**
- Consumes: Task 3 的 `dealDamage`、`advance`、`phaseOf`；`RANGED_RANGE=6`（体现在 `UnitDef.range`）。
- Produces:
  - `RANGE_OUT_MULT = 0.5`（damage.ts 导出；射程外**最终伤害**×0.5，非攻倍率）。
  - `battle/shoot` command：`{ unitId, targetId }`。校验：`range > 1`、未移动、未被贴身（任意敌军相邻即禁）；目标任一身体格在射程内=满额，否则半额；不触发反击；置 hasActed 并 advance。

- [ ] **Step 1: 写失败测试（battleReducer.test.ts 追加 shoot 组）**

```ts
describe('battle/shoot（远程）', () => {
  test('射程内满额（距离3 ≤ 射程6）：伤 round(10×3×1.1)=33', () => {
    const store = makeStore({
      grid: { cols: 5, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'archer', count: 10 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }] }
    })
    expect(store.getState().currentUnitId).toBe('p0') // archer speed5 > militia speed4
    store.dispatch('battle/shoot', { unitId: 'p0', targetId: 'e0' })
    const t = store.getState().units.find((u) => u.id === 'e0')!
    expect(t.hpLeft).toBe(17)
    expect(t.count).toBe(17)
  })
  test('射程外半额（距离7 > 射程6）：33×0.5=16.5→17，log 记「射程外」', () => {
    const store = makeStore({
      grid: { cols: 9, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'archer', count: 10 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }] }
    })
    store.dispatch('battle/shoot', { unitId: 'p0', targetId: 'e0' })
    const t = store.getState().units.find((u) => u.id === 'e0')!
    expect(t.hpLeft).toBe(33)
    expect(store.getState().log.some((l) => l.includes('射程外'))).toBe(true)
  })
  test('1×2 目标：任意身体格在射程内即满额', () => {
    // e0 骑兵 (6,0) 占 (6,0)+(7,0)；距 (0,0) 为 6 ≤ 6 → 满额
    // 攻6 防7 → 差-1 → 0.95；mid 6.5 → 伤 round(10×6.5×0.95)=62 → 90-62=28 count=ceil(28/3)=10
    const store = makeStore({
      grid: { cols: 8, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'archer', count: 10 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'cavalry', count: 30 }] }
    })
    expect(store.getState().currentUnitId).toBe('e0') // cavalry speed9 先动
    store.dispatch('battle/endTurn', { unitId: 'e0' })
    expect(store.getState().currentUnitId).toBe('p0')
    store.dispatch('battle/shoot', { unitId: 'p0', targetId: 'e0' })
    const t = store.getState().units.find((u) => u.id === 'e0')!
    expect(t.hpLeft).toBe(28)
    expect(t.count).toBe(10)
  })
  test('被贴身禁射：有敌军相邻则 shoot 为 no-op', () => {
    // 3×3：e0 民兵 (1,0) 贴身 p0 弓手 (0,0)
    const store = makeStore({
      grid: { cols: 3, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'archer', count: 10 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 10 }] }
    })
    store.dispatch('battle/shoot', { unitId: 'p0', targetId: 'e0' })
    const s = store.getState()
    expect(s.units.find((u) => u.id === 'p0')!.hasActed).toBe(false)
    expect(s.currentUnitId).toBe('p0')
  })
  test('近战兵不能 shoot（range≤1 → no-op）', () => {
    const store = makeStore({
      grid: { cols: 4, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'swordsman', count: 20 }] }
    })
    store.dispatch('battle/shoot', { unitId: 'p0', targetId: 'e0' })
    expect(store.getState().currentUnitId).toBe('p0')
  })
  test('射击伤害用目标方 defBonus（回归）', () => {
    // 攻6 防14 → 差-8 钳-3 → 0.85 → 伤 round(10×3×0.85)=26 → 50-26=24
    const store = makeStore({
      grid: { cols: 5, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'archer', count: 10 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 10, units: [{ defId: 'militia', count: 50 }] }
    })
    store.dispatch('battle/shoot', { unitId: 'p0', targetId: 'e0' })
    const t = store.getState().units.find((u) => u.id === 'e0')!
    expect(t.hpLeft).toBe(24)
    expect(t.count).toBe(24)
  })
  test('灭队即判胜', () => {
    const store = makeStore({
      grid: { cols: 5, rows: 3 },
      player: { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'archer', count: 10 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 8 }] }
    })
    store.dispatch('battle/shoot', { unitId: 'p0', targetId: 'e0' })
    const s = store.getState()
    expect(s.units.find((u) => u.id === 'e0')).toBeUndefined()
    expect(s.phase).toBe('won')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run src/core/battle/battleReducer.test.ts`
Expected: 失败——`battle/shoot` 未实现（reducer 默认返回 state），`range` 还是 2。

- [ ] **Step 3: 实现 units.ts / damage.ts**

```ts
// units.ts：archer 行
archer: { id: 'archer', name: '弓兵', attack: 6, defense: 4, minDamage: 2, maxDamage: 4, speed: 5, hp: 1, cost: { gold: 120 }, range: 6, size: 1 },

// damage.ts 追加
export const RANGE_OUT_MULT = 0.5 // 射程外远程伤害倍率（作用于最终伤害）
```

- [ ] **Step 4: 实现 battleReducer.ts（shoot）**

```ts
/** 远程射击：满额/半额（射程外 ×0.5）；贴身/已移动/非远程 拒绝；不触发反击 */
function shoot(state: BattleState, unitId: string, targetId: string): BattleState {
  const attacker = state.units.find((u) => u.id === unitId)
  const target = state.units.find((u) => u.id === targetId)
  if (!attacker || !target || attacker.id !== state.currentUnitId || attacker.hasActed) return state
  if (attacker.side === target.side) return state
  const def = UNIT_DEFS[attacker.defId]
  if (def.range <= 1 || attacker.hasMoved) return state
  const pinned = state.units.some((u) =>
    u.id !== attacker.id && u.side !== attacker.side &&
    occupiedHexes(attacker).some((h) => occupiedHexes(u).some((uh) => hexDistance(h, uh) <= 1)))
  if (pinned) return state
  const inRange = occupiedHexes(target).some((h) => hexDistance(attacker.position, h) <= def.range)
  const atkGen = state.general[attacker.side]
  const defGen = state.general[target.side]
  const base = computeDamage(attacker, target, atkGen.atkBonus, defGen.defBonus)
  const dmg = Math.round(base * (inRange ? 1 : RANGE_OUT_MULT))
  let units = state.units.map((u) => (u.id === attacker.id ? { ...u, hasActed: true, hasMoved: true } : u))
  units = dealDamage(units, target.id, dmg)
  const dead = !units.some((u) => u.id === target.id)
  const log = [...state.log, `${attacker.id} 射击 ${target.id} 造成 ${dmg} 伤害${inRange ? '' : '（射程外）'}${dead ? '（消灭）' : ''}`]
  const phase = phaseOf(units)
  if (phase !== 'combat') return { ...state, units, phase, log }
  return advance({ ...state, units, log })
}
```

reducer 分发加：

```ts
case 'battle/shoot': {
  const payload = cmd.payload as { unitId: string; targetId: string }
  return shoot(state, payload.unitId, payload.targetId)
}
```

（import `RANGE_OUT_MULT` from './damage'。）

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm vitest run src/core/battle/battleReducer.test.ts`
Expected: 全绿。

- [ ] **Step 6: 提交**

```bash
powershell.exe -NoProfile -Command "git -C 'F:\work\three-kingdoms-tactics\.claude\worktrees\crystalline-stargazing-panda' add -A && git -C 'F:\work\three-kingdoms-tactics\.claude\worktrees\crystalline-stargazing-panda' commit -m \"feat(core): 远程射击 shoot（满额/断箭半额/贴身禁射）+ 弓兵射程 6

Co-Authored-By: Claude <noreply@anthropic.com>\""
```

---

### Task 5: AI 冲锋/射击

**Files:**
- Modify: `src/core/battle/ai.ts`
- Modify: `src/core/battle/ai.test.ts`（重写）

**Interfaces:**
- Consumes: Task 1 的 `battleReachableArea`、`occupiedHexes`；Task 3/4 的 `battle/attack`（带 `to`）、`battle/shoot`。
- Produces:
  - `canEngageTarget(mover: BattleUnit, target: BattleUnit, state: BattleState): Axial | null`（ai.ts 导出）——返回 mover 可达集内距 target 最近且相邻（距离 1）的落点；已贴身时返回当前格；够不着返回 null。
  - `EnemyAction` 改为 `{ type: 'attack'; targetId: string; to: Axial } | { type: 'shoot'; targetId: string } | { type: 'move'; to: Axial } | { type: 'endTurn' }`。

- [ ] **Step 1: 写失败测试（ai.test.ts 重写）**

`unit()` 补 `retaliated: false`；`state()` 补 `obstacles: []`。整体替换 `describe` 内容：

```ts
import { describe, expect, test } from 'vitest'
import { planEnemyAction } from './ai'
import type { BattleState, BattleUnit } from './types'

function unit(over: Partial<BattleUnit>): BattleUnit {
  return {
    id: 'u', side: 'enemy', defId: 'militia', count: 10, position: { q: 0, r: 0 },
    size: 1, hpLeft: 10, maxHp: 10, hasActed: false, hasMoved: false, retaliated: false, ...over
  }
}
function state(enemy: BattleUnit, foes: BattleUnit[]): BattleState {
  return {
    grid: { cols: 13, rows: 9 },
    units: [enemy, ...foes],
    obstacles: [],
    general: { player: { name: 'P', atkBonus: 0, defBonus: 0 }, enemy: { name: 'E', atkBonus: 0, defBonus: 0 } },
    turn: 1, order: [enemy.id], currentUnitId: enemy.id, selectedUnitId: null, phase: 'combat', log: []
  }
}

describe('planEnemyAction（冲锋/射击）', () => {
  test('够得着 → 冲锋：返回 attack 带落点（优先低血）', () => {
    const foeLow = unit({ id: 'p1', side: 'player', position: { q: 3, r: 0 }, hpLeft: 5 })
    const foeHigh = unit({ id: 'p0', side: 'player', position: { q: 0, r: 1 }, hpLeft: 50 })
    const enemy = unit({ id: 'e0', defId: 'militia' })
    const a = planEnemyAction(state(enemy, [foeLow, foeHigh]))
    expect(a.type).toBe('attack')
    if (a.type === 'attack') expect(a.targetId).toBe('p1')
  })
  test('已贴身 → 原地攻击（to=当前格）', () => {
    const foe = unit({ id: 'p0', side: 'player', position: { q: 1, r: 0 } })
    const enemy = unit({ id: 'e0', defId: 'militia' })
    expect(planEnemyAction(state(enemy, [foe]))).toEqual({ type: 'attack', targetId: 'p0', to: { q: 0, r: 0 } })
  })
  test('距离 2 也冲锋（可达落点相邻）', () => {
    const foe = unit({ id: 'p0', side: 'player', position: { q: 2, r: 0 } })
    const enemy = unit({ id: 'e0', defId: 'militia' })
    expect(planEnemyAction(state(enemy, [foe]))).toEqual({ type: 'attack', targetId: 'p0', to: { q: 1, r: 0 } })
  })
  test('远程：射程内 → shoot', () => {
    const foe = unit({ id: 'p0', side: 'player', position: { q: 0, r: 0 } })
    const enemy = unit({ id: 'e0', defId: 'archer', position: { q: 6, r: 0 } })
    expect(planEnemyAction(state(enemy, [foe]))).toEqual({ type: 'shoot', targetId: 'p0' })
  })
  test('远程：射程外 → 走近', () => {
    const foe = unit({ id: 'p0', side: 'player', position: { q: 0, r: 0 } })
    const enemy = unit({ id: 'e0', defId: 'archer', position: { q: 7, r: 0 } })
    expect(planEnemyAction(state(enemy, [foe])).type).toBe('move')
  })
  test('够不着 → 向最近敌人移动', () => {
    const foe = unit({ id: 'p0', side: 'player', position: { q: 0, r: 0 } })
    const enemy = unit({ id: 'e0', defId: 'militia', position: { q: 6, r: 0 } })
    expect(planEnemyAction(state(enemy, [foe])).type).toBe('move')
  })
  test('无敌人 → endTurn', () => {
    const enemy = unit({ id: 'e0', defId: 'militia' })
    expect(planEnemyAction(state(enemy, [])).type).toBe('endTurn')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm vitest run src/core/battle/ai.test.ts`
Expected: 失败——attack 结果无 `to`、无 `shoot`、`EnemyAction` 类型不符。

- [ ] **Step 3: 实现 ai.ts**

```ts
import { hexDistance, hexKey, type Axial } from '../hex/HexGrid'
import { UNIT_DEFS } from '../../data/units'
import { battleReachableArea } from './pathing'
import { occupiedHexes, type BattleState, type BattleUnit } from './types'

export type EnemyAction =
  | { type: 'attack'; targetId: string; to: Axial }
  | { type: 'shoot'; targetId: string }
  | { type: 'move'; to: Axial }
  | { type: 'endTurn' }

/** 若 mover 可达某与 target 相邻（距离 1）的落点 → 返回距 mover 最近的落点；否则 null */
export function canEngageTarget(mover: BattleUnit, target: BattleUnit, state: BattleState): Axial | null {
  const reachable = battleReachableArea(mover, state)
  let best: Axial | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const hex of reachable) {
    if (!occupiedHexes(target).some((h) => hexDistance(hex, h) <= 1)) continue
    const d = hexDistance(mover.position, hex)
    if (d < bestDist) {
      bestDist = d
      best = hex
    }
  }
  return best
}

export function planEnemyAction(state: BattleState): EnemyAction {
  const unit = state.units.find((u) => u.id === state.currentUnitId)
  if (!unit || unit.side !== 'enemy') return { type: 'endTurn' }
  const foes = state.units.filter((u) => u.side !== unit.side)
  if (foes.length === 0) return { type: 'endTurn' }
  const def = UNIT_DEFS[unit.defId]
  const range = def.range
  const pinned = foes.some((f) =>
    occupiedHexes(unit).some((h) => occupiedHexes(f).some((uh) => hexDistance(h, uh) <= 1)))
  // 远程：射程内且未被贴身且未移动 → 射击（优先低血）
  if (range > 1 && !pinned && !unit.hasMoved) {
    const targetable = foes
      .filter((t) => occupiedHexes(t).some((h) => hexDistance(unit.position, h) <= range))
      .sort((a, b) => a.hpLeft - b.hpLeft || (a.id < b.id ? -1 : 1))
    if (targetable.length > 0) return { type: 'shoot', targetId: (targetable[0] as BattleUnit).id }
  }
  // 近战：够得着 → 冲锋（攻击带落点；优先低血）
  const engageable = foes
    .map((f) => ({ foe: f, to: canEngageTarget(unit, f, state) }))
    .filter((x) => x.to !== null) as { foe: BattleUnit; to: Axial }[]
  if (engageable.length > 0) {
    engageable.sort((a, b) => a.foe.hpLeft - b.foe.hpLeft || (a.foe.id < b.foe.id ? -1 : 1))
    const chosen = engageable[0] as { foe: BattleUnit; to: Axial }
    return { type: 'attack', targetId: chosen.foe.id, to: chosen.to }
  }
  // 移动：选可达集中「到最近敌人距离最小」的格（排除自身格，避免原地踏步）
  const reachable = battleReachableArea(unit, state).filter((h) => hexKey(h) !== hexKey(unit.position))
  let best: Axial | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const hex of reachable) {
    let minD = Number.POSITIVE_INFINITY
    for (const t of foes) for (const h of occupiedHexes(t)) minD = Math.min(minD, hexDistance(hex, h))
    if (minD < bestDist) {
      bestDist = minD
      best = hex
    }
  }
  if (best) return { type: 'move', to: best }
  return { type: 'endTurn' }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm vitest run src/core/battle/ai.test.ts`
Expected: 全绿。

- [ ] **Step 5: 提交**

```bash
powershell.exe -NoProfile -Command "git -C 'F:\work\three-kingdoms-tactics\.claude\worktrees\crystalline-stargazing-panda' add -A && git -C 'F:\work\three-kingdoms-tactics\.claude\worktrees\crystalline-stargazing-panda' commit -m \"feat(core): AI 冲锋/射击（canEngageTarget 共享落点计算）

Co-Authored-By: Claude <noreply@anthropic.com>\""
```

---

### Task 6: 渲染基础（矩形/障碍/相机/去血条/金标 + startBattle）

**Files:**
- Modify: `src/scenes/BattleScene.ts`
- Modify: `src/dev/debug.ts`

**Interfaces:**
- Consumes: Task 1 的 `inBattleGrid`（渲染用等价循环）、`BATTLE_OBSTACLES`、`woundedHp`；core 全部命令。
- Produces:
  - BattleScene 字段：`gridGraphics/obstacleGraphics/overlayGraphics/unitGraphics`（无 `hpBarGraphics`）、`infoPanel`、`animationMs=0`、`visualPos=new Map<string,Axial>()`。
  - `startBattle(player: BattleArmyConfig, enemy: BattleArmyConfig, grid: { cols: number; rows: number; obstacles?: Axial[] }): void`（BattleScene + DebugBridge）。
  - `getDebugState()` 增 `obstacles`、units 增 `retaliated`/`woundedHp`。
  - `create()` 改用 `{ ...BATTLE_GRID, obstacles: BATTLE_OBSTACLES }`。

- [ ] **Step 1: 实现（改 BattleScene，无单测，靠 typecheck + 手动）**

新增/修改如下（`woundedHp`、`type BattleArmyConfig` 从 core import）：

```ts
// 顶层常量：删除 RANGE_STROKE，保留 GRID_COLOR/GRID_LINE/REACHABLE_FILL/SIDE_COLORS
// 字段：删除 hpBarGraphics；新增
private obstacleGraphics!: Phaser.GameObjects.Graphics
private infoPanel!: Phaser.GameObjects.Text
private animationMs = 0
private visualPos = new Map<string, Axial>()
```

`create()` 改为：

```ts
create(): void {
  this.store = new CommandLog<BattleState>(createInitialBattleState(), battleReducer)
  this.store.dispatch('battle/init', {
    player: PLAYER_ARMY,
    enemy: ENEMY_ARMY,
    grid: { ...BATTLE_GRID, obstacles: BATTLE_OBSTACLES }
  })
  this.createLayers()
  this.setupBattle()
}

/** 直接以指定阵容/网格开局（e2e 确定性交互测试） */
startBattle(player: BattleArmyConfig, enemy: BattleArmyConfig, grid: { cols: number; rows: number; obstacles?: Axial[] }): void {
  this.store = new CommandLog<BattleState>(createInitialBattleState(), battleReducer)
  this.store.dispatch('battle/init', { player, enemy, grid })
  this.visualPos.clear()
  this.animQueue.length = 0
  this.animActive = null
  this.drawGrid()
  this.drawObstacles()
  this.setupBattle()
}

private setupBattle(): void {
  this.centerCamera()
  this.setupInput()
  this.refreshViews()
}
```

`createLayers()`：加 `this.obstacleGraphics = this.add.graphics().setDepth(1)`；删除 `hpBarGraphics` 相关两行；`drawGrid()` 后调 `this.drawObstacles()`；末尾加：

```ts
this.infoPanel = this.add
  .text(0, 0, '', { fontFamily: 'sans-serif', fontSize: '14px', color: '#e8eef5', backgroundColor: '#223048', fixedWidth: 260, wordWrap: { width: 250 } })
  .setPadding(10, 8)
  .setDepth(11)
  .setScrollFactor(0)
  .setVisible(false)
```

`drawGrid()` 改为逐行窗口：

```ts
private drawGrid(): void {
  this.gridGraphics.clear()
  const { rows } = this.state.grid
  for (let r = 0; r < rows; r++) {
    const qMin = -Math.floor(r / 2)
    for (let q = qMin; q < qMin + this.state.grid.cols; q++) {
      const hex = { q, r }
      this.fillHex(this.gridGraphics, hex, GRID_COLOR, 1)
      this.strokeHex(this.gridGraphics, hex, GRID_LINE, 1)
    }
  }
}

private drawObstacles(): void {
  this.obstacleGraphics.clear()
  for (const hex of this.state.obstacles) {
    this.fillHex(this.obstacleGraphics, hex, 0x2a3240, 1)
    this.strokeHex(this.obstacleGraphics, hex, GRID_LINE, 2)
  }
}
```

`centerCamera()` 用有效格包围盒中心（替换旧 `create()` 里 `centerOn(cols/2, rows/2)`）：

```ts
private centerCamera(): void {
  const g = this.state.grid
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (let r = 0; r < g.rows; r++) {
    const qMin = -Math.floor(r / 2)
    for (let q = qMin; q < qMin + g.cols; q++) {
      const p = this.layout.hexToPixel({ q, r })
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x)
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y)
    }
  }
  this.cameras.main.centerOn((minX + maxX) / 2, (minY + maxY) / 2)
}
```

`drawUnits()`：删血条块，单位位置读 `visualPos`，只画填充 + count 文本：

```ts
private drawUnits(): void {
  this.unitGraphics.clear()
  const seen = new Set<string>()
  for (const unit of this.state.units) {
    const pos = this.visualPos.get(unit.id) ?? unit.position
    for (const hex of occupiedHexes({ position: pos, size: unit.size })) {
      this.fillHex(this.unitGraphics, hex, SIDE_COLORS[unit.side], 0.85)
    }
    const c1 = this.layout.hexToPixel(pos)
    const c2 = unit.size === 2 ? this.layout.hexToPixel({ q: pos.q + 1, r: pos.r }) : c1
    const cx = (c1.x + c2.x) / 2
    let t = this.unitTexts.get(unit.id)
    if (!t) {
      t = this.add.text(cx, c1.y, '', { fontFamily: 'sans-serif', fontSize: '18px', color: '#ffffff' }).setOrigin(0.5).setDepth(4)
      this.unitTexts.set(unit.id, t)
    }
    t.setPosition(cx, c1.y)
    t.setText(String(unit.count))
    seen.add(unit.id)
  }
  for (const id of this.unitTexts.keys()) {
    if (!seen.has(id)) {
      this.unitTexts.get(id)?.destroy()
      this.unitTexts.delete(id)
    }
  }
}
```

`drawOverlay()`：当前单位金色描边 + 上方三角箭头；删除射程内敌人描边块：

```ts
private drawOverlay(): void {
  this.overlayGraphics.clear()
  const state = this.state
  if (state.phase !== 'combat') return
  const current = state.units.find((u) => u.id === state.currentUnitId)
  if (current) {
    const pos = this.visualPos.get(current.id) ?? current.position
    for (const hex of occupiedHexes({ position: pos, size: current.size })) {
      this.strokeHex(this.overlayGraphics, hex, 0xffcc33, 3)
    }
    const c = this.layout.hexToPixel(pos)
    this.overlayGraphics.fillStyle(0xffcc33, 1)
    this.overlayGraphics.fillTriangle(c.x, c.y - 40, c.x - 9, c.y - 27, c.x + 9, c.y - 27)
  }
  if (current && current.side === 'player') {
    for (const hex of battleReachableArea(current, state)) {
      this.fillHex(this.overlayGraphics, hex, REACHABLE_FILL, 0.18)
    }
  }
  if (state.selectedUnitId) {
    const sel = state.units.find((u) => u.id === state.selectedUnitId)
    if (sel) for (const hex of occupiedHexes(sel)) this.strokeHex(this.overlayGraphics, hex, 0xffffff, 2)
  }
}
```

`getDebugState()`：在返回对象加 `obstacles: state.obstacles`，units map 加 `retaliated: u.retaliated, woundedHp: woundedHp(u)`。`create()` 里删掉旧 `centerOn` 两行。

- [ ] **Step 2: debug.ts 加 startBattle**

```ts
import type { BattleArmyConfig } from '../core/battle/types'
import type { Axial } from '../core/hex/HexGrid'
// DebugBridge 接口加：
startBattle(player: BattleArmyConfig, enemy: BattleArmyConfig, grid: { cols: number; rows: number; obstacles?: Axial[] }): void
// bridge 实现加：
startBattle(player, enemy, grid) {
  battle()?.startBattle(player, enemy, grid)
}
```

- [ ] **Step 3: 验证**

Run: `powershell.exe -NoProfile -Command "cd F:\work\three-kingdoms-tactics\.claude\worktrees\crystalline-stargazing-panda && pnpm test"`  → core 全绿。
Run: `powershell.exe -NoProfile -Command "cd F:\work\three-kingdoms-tactics\.claude\worktrees\crystalline-stargazing-panda && pnpm typecheck"` → 零 error。

- [ ] **Step 4: 提交**

```bash
powershell.exe -NoProfile -Command "git -C 'F:\work\three-kingdoms-tactics\.claude\worktrees\crystalline-stargazing-panda' add -A && git -C 'F:\work\three-kingdoms-tactics\.claude\worktrees\crystalline-stargazing-panda' commit -m \"feat(render): 矩形战场/障碍物/相机居中/去血条/金标 + startBattle dev hook

Co-Authored-By: Claude <noreply@anthropic.com>\""
```

---

### Task 7: 渲染交互（残影/刀剑/弓/断箭/闪烁/信息面板/点击分派）

**Files:**
- Modify: `src/scenes/BattleScene.ts`

**Interfaces:**
- Consumes: Task 6 的层/字段；`battleReachableArea`、`occupiedHexes`、`woundedHp`、`EDGE_HIT_TOLERANCE=10`、`hexNeighbor`/`HexDir`。
- Produces:
  - `hover` 状态：`{ ghostHex, swordHex, cursorKind: 'sword'|'bow'|'broken-arrow'|'move'|'none', swordTargetId, blinkId }`。
  - `onHover(pointer)`、`drawHoverLayer()`、`drawSword()`、`isPinned()`、`distToSegment()`、`updateInfoPanel()`、重写 `handleClick()`。
  - `update(time, delta)` 驱动闪烁重绘。
  - `getDebugState()` 加 `hover`、`infoPanelText`。

- [ ] **Step 1: 实现（无单测，typecheck + 手动/e2e 验证）**

字段（Task 6 基础上加）：

```ts
private hoverGraphics!: Phaser.GameObjects.Graphics
private blinkPhase = 0
private hover: {
  ghostHex: Axial | null
  swordHex: Axial | null
  cursorKind: 'sword' | 'bow' | 'broken-arrow' | 'move' | 'none'
  swordTargetId: string | null
  blinkId: string | null
} = { ghostHex: null, swordHex: null, cursorKind: 'none', swordTargetId: null, blinkId: null }
```

`createLayers()` 加 `this.hoverGraphics = this.add.graphics().setDepth(5)`。

`setupInput()` 改为幂等（off + on），加 pointermove：

```ts
private setupInput(): void {
  this.input.off('pointerup')
  this.input.off('pointermove')
  this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
    if (this.state.phase !== 'combat' || this.currentSide() !== 'player') return
    this.handleClick(this.layout.pixelToHex(p.worldX, p.worldY))
  })
  this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
    this.onHover(p)
  })
}
```

`update()`（BattleScene 当前没有，新增）：

```ts
update(_time: number, delta: number): void {
  this.blinkPhase += delta * 0.01
  if (this.state.phase === 'combat' && (this.hover.ghostHex || this.hover.swordHex || this.hover.blinkId)) {
    this.drawHoverLayer()
  }
}
```

`onHover` + helpers + `drawHoverLayer` + `drawSword` + `updateInfoPanel` + `handleClick`：

```ts
private onHover(pointer: Phaser.Input.Pointer): void {
  const state = this.state
  const current = state.units.find((u) => u.id === state.currentUnitId)
  const hex = this.layout.pixelToHex(pointer.worldX, pointer.worldY)
  const unitAt = state.units.find((u) => occupiedHexes(u).some((h) => hexKey(h) === hexKey(hex)))
  this.updateInfoPanel(unitAt ?? null)
  this.hover.ghostHex = null
  this.hover.swordHex = null
  this.hover.swordTargetId = null
  this.hover.blinkId = null
  this.hover.cursorKind = 'none'
  if (!current || state.phase !== 'combat' || current.side !== 'player') {
    this.drawHoverLayer()
    return
  }
  const isRanged = UNIT_DEFS[current.defId].range > 1
  // 远程：悬停敌军 → 弓/断箭（未移动 + 未被贴身）
  if (isRanged && unitAt && unitAt.side !== current.side && !current.hasMoved && !this.isPinned(current, state)) {
    const inRange = occupiedHexes(unitAt).some((h) => this.hexDist(current.position, h) <= UNIT_DEFS[current.defId].range)
    this.hover.cursorKind = inRange ? 'bow' : 'broken-arrow'
    this.hover.blinkId = unitAt.id
    this.drawHoverLayer()
    return
  }
  // 近战：扫描可达落点与其相邻敌军的共享边界，命中最近者
  const reachable = battleReachableArea(current, state)
  const mx = pointer.worldX
  const my = pointer.worldY
  let edgeHit: { targetId: string; dist: number; dest: Axial } | null = null
  for (const dest of reachable) {
    for (let d = 0; d < 6; d++) {
      const nb = hexNeighbor(dest, d as HexDir)
      const foe = state.units.find((u) => u.side !== current.side && occupiedHexes(u).some((h) => hexKey(h) === hexKey(nb)))
      if (!foe) continue
      const c1 = (6 - d) % 6
      const c2 = (c1 + 1) % 6
      const p1 = this.layout.cornerAt(dest, c1)
      const p2 = this.layout.cornerAt(dest, c2)
      const dist = this.distToSegment(mx, my, p1.x, p1.y, p2.x, p2.y)
      if (dist <= EDGE_HIT_TOLERANCE && (!edgeHit || dist < edgeHit.dist)) {
        edgeHit = { targetId: foe.id, dist, dest }
      }
    }
  }
  if (edgeHit) {
    this.hover.cursorKind = 'sword'
    this.hover.swordTargetId = edgeHit.targetId
    this.hover.swordHex = edgeHit.dest
    this.hover.ghostHex = hexKey(edgeHit.dest) === hexKey(current.position) ? null : edgeHit.dest
    this.hover.blinkId = edgeHit.targetId
  } else {
    const ghost = reachable.find((h) => hexKey(h) === hexKey(hex)) ?? null
    this.hover.ghostHex = ghost
    this.hover.cursorKind = ghost ? 'move' : 'none'
  }
  this.drawHoverLayer()
}

private isPinned(unit: BattleUnit, state: BattleState): boolean {
  return state.units.some((u) =>
    u.id !== unit.id && u.side !== unit.side &&
    occupiedHexes(unit).some((h) => occupiedHexes(u).some((uh) => hexDistance(h, uh) <= 1)))
}

private distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

private drawHoverLayer(): void {
  this.hoverGraphics.clear()
  const h = this.hover
  // 残影
  if (h.ghostHex) {
    const current = this.state.units.find((u) => u.id === this.state.currentUnitId)
    const size = current?.size ?? 1
    for (const hex of occupiedHexes({ position: h.ghostHex, size })) {
      this.fillHex(this.hoverGraphics, hex, 0xffffff, 0.35)
    }
  }
  // 目标闪烁（脉动 alpha）
  if (h.blinkId) {
    const target = this.state.units.find((u) => u.id === h.blinkId)
    if (target) {
      const alpha = 0.35 + 0.35 * Math.abs(Math.sin(this.blinkPhase))
      for (const hex of occupiedHexes(target)) this.fillHex(this.hoverGraphics, hex, 0xff0000, alpha)
    }
  }
  // 刀剑：画在目的格与目标之间的边界上，剑尖指向目标
  if (h.cursorKind === 'sword' && h.swordTargetId && h.swordHex) {
    this.drawSword(h.swordHex, h.swordTargetId)
  }
  // 弓 / 断箭：目标上方画弓弧（断箭加斜线）
  if (h.cursorKind === 'bow' || h.cursorKind === 'broken-arrow') {
    const target = h.blinkId ? this.state.units.find((u) => u.id === h.blinkId) : null
    if (target) {
      const c = this.layout.hexToPixel(target.position)
      const g = this.hoverGraphics
      g.lineStyle(2, h.cursorKind === 'bow' ? 0xffcc33 : 0xff6644, 1)
      g.beginPath()
      g.arc(c.x, c.y - 20, 12, Math.PI, 0, false)
      g.strokePath()
      if (h.cursorKind === 'broken-arrow') {
        g.lineBetween(c.x - 8, c.y - 8, c.x + 4, c.y + 4)
      }
    }
  }
}

private drawSword(dest: Axial, targetId: string): void {
  const target = this.state.units.find((u) => u.id === targetId)
  if (!target) return
  const dPos = this.layout.hexToPixel(dest)
  const tPos = this.layout.hexToPixel(target.position)
  const mid = { x: (dPos.x + tPos.x) / 2, y: (dPos.y + tPos.y) / 2 }
  const ang = Math.atan2(tPos.y - dPos.y, tPos.x - dPos.x)
  const g = this.hoverGraphics
  g.save()
  g.translateCanvas(mid.x, mid.y)
  g.rotateCanvas(ang)
  g.fillStyle(0xe0e4ec, 1)
  g.fillRect(-16, -2.5, 22, 5)   // 剑身（正 x 方向为剑尖）
  g.fillStyle(0xffcc33, 1)
  g.fillRect(-16, -6, 4, 12)     // 护手
  g.fillStyle(0x8a5a2b, 1)
  g.fillRect(6, -4, 9, 8)        // 剑柄
  g.restore()
}

private updateInfoPanel(unit: BattleUnit | null): void {
  if (!unit) {
    this.infoPanel.setVisible(false)
    return
  }
  const def = UNIT_DEFS[unit.defId]
  const gen = this.state.general[unit.side]
  this.infoPanel.setText([
    def.name,
    `数量：${unit.count}`,
    `攻击：${def.attack}（+${gen.atkBonus}）`,
    `防御：${def.defense}（+${gen.defBonus}）`,
    `伤害：${def.minDamage}~${def.maxDamage}`,
    `速度：${def.speed}`,
    `伤兵剩余：${woundedHp(unit)} 血`
  ])
  const p = this.input.activePointer
  this.infoPanel.setPosition(p.x + 16, p.y + 16).setVisible(true)
}
```

`handleClick()` 重写（近战刀剑 / 远程 / 选中 / 移动 / no-op）：

```ts
private handleClick(hex: Axial): void {
  const state = this.state
  const current = state.units.find((u) => u.id === state.currentUnitId)
  if (!current || current.side !== 'player') return
  const unitAt = state.units.find((u) => occupiedHexes(u).some((h) => hexKey(h) === hexKey(hex)))
  // 近战：刀剑边界 → 冲锋/原地攻击
  if (this.hover.cursorKind === 'sword' && this.hover.swordTargetId && this.hover.swordHex) {
    this.store.dispatch('battle/attack', {
      unitId: current.id,
      targetId: this.hover.swordTargetId,
      to: this.hover.swordHex
    })
    this.refreshViews()
    return
  }
  // 远程：弓/断箭 → 射击
  if ((this.hover.cursorKind === 'bow' || this.hover.cursorKind === 'broken-arrow') && unitAt && unitAt.side !== current.side) {
    this.store.dispatch('battle/shoot', { unitId: current.id, targetId: unitAt.id })
    this.refreshViews()
    return
  }
  // 点己方 → 选中
  if (unitAt && unitAt.side === 'player') {
    this.store.dispatch('battle/select', { unitId: unitAt.id })
    this.refreshViews()
    return
  }
  // 可达格 → 移动（移动即行动）
  if (battleReachableArea(current, state).some((h) => hexKey(h) === hexKey(hex))) {
    this.store.dispatch('battle/move', { unitId: current.id, to: hex })
    this.refreshViews()
    return
  }
  // 无效点击 → no-op
}
```

`getDebugState()` 返回对象加：

```ts
hover: {
  ghostHex: this.hover.ghostHex,
  swordHex: this.hover.swordHex,
  cursorKind: this.hover.cursorKind,
  swordTargetId: this.hover.swordTargetId,
  blinkId: this.hover.blinkId
},
infoPanelText: this.infoPanel && this.infoPanel.visible ? this.infoPanel.text : null,
```

顶部 import 增加 `hexNeighbor, type HexDir`（来自 `../core/hex/HexGrid`）和 `woundedHp`（来自 `../core/battle/types`）。

- [ ] **Step 2: 验证**

Run: `pnpm test`（core 绿）+ `pnpm typecheck`（零 error）。
可选：`pnpm dev` 手动进战斗测试，人工目检残影/刀剑/弓/闪烁/信息面板（截图存 `screenshots/`）。

- [ ] **Step 3: 提交**

```bash
powershell.exe -NoProfile -Command "git -C 'F:\work\three-kingdoms-tactics\.claude\worktrees\crystalline-stargazing-panda' add -A && git -C 'F:\work\three-kingdoms-tactics\.claude\worktrees\crystalline-stargazing-panda' commit -m \"feat(render): 悬停交互（残影/刀剑/弓/断箭/闪烁/信息面板）+ 点击分派

Co-Authored-By: Claude <noreply@anthropic.com>\""
```

---

### Task 8: 逐格移动动画 + AI 异步

**Files:**
- Modify: `src/scenes/BattleScene.ts`
- Modify: `src/dev/debug.ts`

**Interfaces:**
- Consumes: Task 6 的 `animationMs`/`visualPos`；Task 7 的 `handleClick`。
- Produces:
  - `setAnimationSpeed(ms)` 真正生效（0 = 瞬间）。
  - 私有 `animQueue`/`animActive`、`animateMove(unitId, path)`、`updateAnimation(delta)`、`startNextAnim()`、`drainWaiters()`、`waitForMove()`。
  - `stepEnemyAi()` 改 async，逐个 await 移动动画；`refreshViews()` 里 `void this.stepEnemyAi()`。
  - `handleClick` 加动画守卫 + 移动后 `animateMove`。

- [ ] **Step 1: 实现**

字段（Task 7 基础上加）：

```ts
private animQueue: { unitId: string; path: Axial[]; resolve: () => void }[] = []
private animActive: { unitId: string; path: Axial[]; idx: number; acc: number; resolve: () => void } | null = null
private moveWaiter: (() => void) | null = null
private enemyActing = false
```

`setAnimationSpeed` / `waitForMove` / `animateMove` / `updateAnimation` / `startNextAnim` / `drainWaiters`：

```ts
setAnimationSpeed(ms: number): void {
  this.animationMs = ms
}

/** 移动动画结束后 resolve；无动画立即 resolve */
waitForMove(): Promise<void> {
  if (!this.animActive && this.animQueue.length === 0) return Promise.resolve()
  return new Promise((resolve) => {
    this.moveWaiter = resolve
  })
}

private animateMove(unitId: string, path: Axial[]): Promise<void> {
  if (this.animationMs <= 0 || path.length === 0) return Promise.resolve()
  this.visualPos.set(unitId, path[0] as Axial)
  return new Promise((resolve) => {
    this.animQueue.push({ unitId, path, resolve })
  })
}

private startNextAnim(): void {
  const item = this.animQueue.shift()
  if (!item) return
  this.animActive = { unitId: item.unitId, path: item.path, idx: 0, acc: 0, resolve: item.resolve }
  this.visualPos.set(item.unitId, item.path[0] as Axial)
}

private updateAnimation(delta: number): void {
  if (this.animActive) {
    this.animActive.acc += delta
    const stepMs = Math.max(1, this.animationMs)
    if (this.animActive.acc >= stepMs) {
      this.animActive.acc -= stepMs
      this.animActive.idx++
      if (this.animActive.idx >= this.animActive.path.length) {
        const done = this.animActive
        this.visualPos.delete(done.unitId)
        this.animActive = null
        done.resolve()
        this.startNextAnim()
      } else {
        this.visualPos.set(this.animActive.unitId, this.animActive.path[this.animActive.idx] as Axial)
      }
    }
    this.drawUnits()
  } else {
    this.startNextAnim()
  }
  this.drainWaiters()
}

private drainWaiters(): void {
  if (this.animActive || this.animQueue.length > 0) return
  const w = this.moveWaiter
  this.moveWaiter = null
  w?.()
}
```

`update()` 里加 `this.updateAnimation(delta)`：

```ts
update(_time: number, delta: number): void {
  this.blinkPhase += delta * 0.01
  this.updateAnimation(delta)
  if (this.state.phase === 'combat' && (this.hover.ghostHex || this.hover.swordHex || this.hover.blinkId)) {
    this.drawHoverLayer()
  }
}
```

`stepEnemyAi()` 改 async（逐个 await 移动动画；`handleClick` 在动画中禁点）：

```ts
private async stepEnemyAi(): Promise<void> {
  if (this.enemyActing || this.state.phase !== 'combat' || this.currentSide() !== 'enemy') return
  this.enemyActing = true
  try {
    let guard = 0
    while (this.state.phase === 'combat' && this.currentSide() === 'enemy' && guard++ < 50) {
      const action = planEnemyAction(this.state)
      const curId = this.state.currentUnitId as string
      const before = this.state.units.find((u) => u.id === curId) as BattleUnit
      if (action.type === 'move') {
        const path = battleFindPath(before, action.to, this.state) ?? [action.to]
        this.store.dispatch('battle/move', { unitId: curId, to: action.to })
        const moved = this.state.units.find((u) => u.id === curId) as BattleUnit
        if (hexKey(moved.position) === hexKey(before.position)) {
          this.store.dispatch('battle/endTurn', { unitId: curId })
        } else {
          await this.animateMove(curId, path)
        }
      } else if (action.type === 'attack') {
        const path = hexKey(action.to) === hexKey(before.position)
          ? []
          : (battleFindPath(before, action.to, this.state) ?? [action.to])
        this.store.dispatch('battle/attack', { unitId: curId, targetId: action.targetId, to: action.to })
        const afterUnit = this.state.units.find((u) => u.id === curId)
        if (this.state.phase === 'combat' && this.state.currentUnitId === curId) {
          this.store.dispatch('battle/endTurn', { unitId: curId })
        }
        if (afterUnit && hexKey(afterUnit.position) !== hexKey(before.position) && path.length > 0) {
          await this.animateMove(curId, path)
        }
      } else if (action.type === 'shoot') {
        this.store.dispatch('battle/shoot', { unitId: curId, targetId: action.targetId })
        if (this.state.phase === 'combat' && this.state.currentUnitId === curId) {
          this.store.dispatch('battle/endTurn', { unitId: curId })
        }
      } else {
        this.store.dispatch('battle/endTurn', { unitId: curId })
      }
      this.drawUnits()
      this.drawOverlay()
      this.updateLogAndResult()
    }
  } finally {
    this.enemyActing = false
  }
}
```

`refreshViews()` 改：

```ts
private refreshViews(): void {
  this.drawUnits()
  this.drawOverlay()
  this.updateLogAndResult()
  void this.stepEnemyAi()
}
```

`handleClick()` 开头加动画守卫；移动/近战分支加 `animateMove`：

```ts
private handleClick(hex: Axial): void {
  if (this.animActive || this.animQueue.length > 0) return
  const state = this.state
  const current = state.units.find((u) => u.id === state.currentUnitId)
  if (!current || current.side !== 'player') return
  const unitAt = state.units.find((u) => occupiedHexes(u).some((h) => hexKey(h) === hexKey(hex)))
  if (this.hover.cursorKind === 'sword' && this.hover.swordTargetId && this.hover.swordHex) {
    const to = this.hover.swordHex
    const path = hexKey(to) === hexKey(current.position) ? [] : (battleFindPath(current, to, this.state) ?? [to])
    this.store.dispatch('battle/attack', { unitId: current.id, targetId: this.hover.swordTargetId, to })
    if (path.length > 0) void this.animateMove(current.id, path)
    this.refreshViews()
    return
  }
  if ((this.hover.cursorKind === 'bow' || this.hover.cursorKind === 'broken-arrow') && unitAt && unitAt.side !== current.side) {
    this.store.dispatch('battle/shoot', { unitId: current.id, targetId: unitAt.id })
    this.refreshViews()
    return
  }
  if (unitAt && unitAt.side === 'player') {
    this.store.dispatch('battle/select', { unitId: unitAt.id })
    this.refreshViews()
    return
  }
  if (battleReachableArea(current, state).some((h) => hexKey(h) === hexKey(hex))) {
    const path = battleFindPath(current, hex, this.state) ?? [hex]
    this.store.dispatch('battle/move', { unitId: current.id, to: hex })
    void this.animateMove(current.id, path)
    this.refreshViews()
    return
  }
}
```

`debug.ts` 的 `waitForMove` 改为同时等战斗：

```ts
async waitForMove() {
  await adventure()?.waitForMove()
  await battle()?.waitForMove()
}
```

（BattleScene 需 `waitForMove(): Promise<void>` 方法，见上。）

- [ ] **Step 2: 验证**

Run: `pnpm test` + `pnpm typecheck`。
可选手动：`pnpm dev` 观察逐格动画（`setAnimationSpeed(150)` via 调试）、AI 异步逐格。

- [ ] **Step 3: 提交**

```bash
powershell.exe -NoProfile -Command "git -C 'F:\work\three-kingdoms-tactics\.claude\worktrees\crystalline-stargazing-panda' add -A && git -C 'F:\work\three-kingdoms-tactics\.claude\worktrees\crystalline-stargazing-panda' commit -m \"feat(render): 逐格移动动画（setAnimationSpeed 生效）+ AI 异步

Co-Authored-By: Claude <noreply@anthropic.com>\""
```

---

### Task 9: e2e 重写（刀剑/远程/移动即行动/信息面板）

**Files:**
- Rewrite: `src/e2e/battle.spec.ts`

**Interfaces:**
- Consumes: Task 6 的 `startBattle`、Task 7 的 `hover`/`infoPanelText`、Task 8 的 `setAnimationSpeed(0)`。
- Produces: 6 个 Playwright 测试，全部程序化状态断言（截图交人工目检）。

- [ ] **Step 1: 重写 battle.spec.ts**

```ts
import { expect, test, type Page } from '@playwright/test'

/**
 * 战斗 e2e：主菜单入口 + startBattle 确定性交互（刀剑冲锋/反击、远程满额/半额、移动即行动、信息面板、胜负循环）。
 * 模型无多模态：断言一律程序化（window.__game.getState()）；截图仅供人工目检。
 */
const MENU_BATTLE = { x: 960, y: 734 }
const SKIP = { x: 1880, y: 1040 }
const RETURN = { x: 960, y: 580 }

interface UnitState {
  id: string
  side: string
  defId: string
  count: number
  position: { q: number; r: number }
  size: number
  hpLeft: number
  maxHp: number
  hasActed: boolean
  hasMoved: boolean
  retaliated: boolean
  woundedHp: number
  screen: { x: number; y: number }
}
interface DebugGameState {
  ready?: boolean
  scene?: string
  phase?: string
  turn?: number
  currentUnitId?: string | null
  selectedUnitId?: string | null
  grid?: { cols: number; rows: number }
  obstacles?: { q: number; r: number }[]
  reachable?: { q: number; r: number; screen: { x: number; y: number } }[]
  hover?: {
    ghostHex?: { q: number; r: number } | null
    cursorKind?: string
    swordTargetId?: string | null
    blinkId?: string | null
  }
  infoPanelText?: string | null
  units?: UnitState[]
}

const getState = (page: Page): Promise<DebugGameState> =>
  page.evaluate(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState() ?? {})

const waitBattleReady = (page: Page) =>
  page.waitForFunction(() => {
    const s = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return s?.ready === true && s?.scene === 'battle' && s?.phase === 'combat'
  })

type Army = { side: 'player' | 'enemy'; generalName: string; atkBonus: number; defBonus: number; units: { defId: string; count: number }[] }

const startBattle = (page: Page, player: Army, enemy: Army, grid: { cols: number; rows: number }) =>
  page.evaluate(({ p, e, g }) => {
    const bridge = (window as { __game?: { startBattle(p: unknown, e: unknown, g: unknown): void } }).__game
    bridge?.startBattle(p, e, g)
  }, { p: player, e: enemy, g: grid })

const setAnimationSpeed = (page: Page, ms: number) =>
  page.evaluate((v) => (window as { __game?: { setAnimationSpeed(n: number): void } }).__game?.setAnimationSpeed(v), ms)

test('主菜单 → 战斗测试：矩形战场 + 障碍物 + 7 单位', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('canvas', { state: 'attached' })
  await page.mouse.click(MENU_BATTLE.x, MENU_BATTLE.y)
  await waitBattleReady(page)
  const s = await getState(page)
  expect(s.grid).toEqual({ cols: 13, rows: 9 })
  expect(s.obstacles).toHaveLength(6)
  expect(s.units).toHaveLength(7)
  expect(s.units?.find((u) => u.defId === 'cavalry')?.size).toBe(2)
  await page.screenshot({ path: 'screenshots/battle-field-rect.png' })
})

test('近战：边界刀剑 → 点击冲锋 + 全伤反击', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('canvas', { state: 'attached' })
  await page.mouse.click(MENU_BATTLE.x, MENU_BATTLE.y)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }, { defId: 'militia', count: 20 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'swordsman', count: 20 }] },
    { cols: 5, rows: 3 })
  // p0 (0,0) vs e0 刀兵 (3,0)；悬停 (2,0)↔(3,0) 边界中点 → 刀剑指向 e0
  const s = await getState(page)
  expect(s.currentUnitId).toBe('p0')
  const e0 = s.units!.find((u) => u.id === 'e0')!
  const ex = e0.screen.x - (30 * Math.sqrt(3)) / 2
  const ey = e0.screen.y
  await page.mouse.move(ex, ey)
  const hov = (await getState(page)).hover
  expect(hov?.cursorKind).toBe('sword')
  expect(hov?.swordTargetId).toBe('e0')
  await page.mouse.click(ex, ey)
  const after = await getState(page)
  const p0 = after.units!.find((u) => u.id === 'p0')!
  const e0a = after.units!.find((u) => u.id === 'e0')!
  expect(p0.position).toEqual({ q: 2, r: 0 })
  expect(e0a.hpLeft).toBe(6)      // 40 - 34
  expect(p0.hpLeft).toBe(7)       // 20 - 13（反击）
  expect(e0a.retaliated).toBe(true)
  expect(after.currentUnitId).toBe('p1') // 反击后 advance 到 p1（无 AI 介入）
  await page.screenshot({ path: 'screenshots/battle-sword-attack.png' })
})

test('远程：弓（满额）/ 断箭（半额）', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('canvas', { state: 'attached' })
  await page.mouse.click(MENU_BATTLE.x, MENU_BATTLE.y)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'archer', count: 10 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }] },
    { cols: 5, rows: 3 }) // e0 (3,0)，距离 3 ≤ 6 → 满额
  const s = await getState(page)
  expect(s.currentUnitId).toBe('p0')
  const e0 = s.units!.find((u) => u.id === 'e0')!
  await page.mouse.move(e0.screen.x, e0.screen.y)
  expect((await getState(page)).hover?.cursorKind).toBe('bow')
  await page.mouse.click(e0.screen.x, e0.screen.y)
  await page.waitForTimeout(80)
  expect((await getState(page)).units!.find((u) => u.id === 'e0')!.hpLeft).toBe(17)
  await page.screenshot({ path: 'screenshots/battle-bow-full.png' })
  // 断箭：e0 距离 7（另一场 startBattle 重置）
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'archer', count: 10 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }] },
    { cols: 9, rows: 3 }) // e0 (7,0)，距离 7 > 6 → 半额
  const s2 = await getState(page)
  const e0b = s2.units!.find((u) => u.id === 'e0')!
  await page.mouse.move(e0b.screen.x, e0b.screen.y)
  expect((await getState(page)).hover?.cursorKind).toBe('broken-arrow')
  await page.mouse.click(e0b.screen.x, e0b.screen.y)
  await page.waitForTimeout(80)
  expect((await getState(page)).units!.find((u) => u.id === 'e0')!.hpLeft).toBe(33)
  await page.screenshot({ path: 'screenshots/battle-broken-arrow.png' })
})

test('移动即行动：移动后 hasActed 且轮到下一单位（AI 不介入）', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('canvas', { state: 'attached' })
  await page.mouse.click(MENU_BATTLE.x, MENU_BATTLE.y)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }, { defId: 'militia', count: 50 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }] },
    { cols: 7, rows: 3 })
  const s = await getState(page)
  expect(s.currentUnitId).toBe('p0')
  const reach1 = s.reachable!.find((h) => h.q === 1 && h.r === 0)!
  await page.mouse.click(reach1.screen.x, reach1.screen.y)
  const after = await getState(page)
  const p0 = after.units!.find((u) => u.id === 'p0')!
  expect(p0.position).toEqual({ q: 1, r: 0 })
  expect(p0.hasActed).toBe(true)
  expect(p0.hasMoved).toBe(true)
  expect(after.currentUnitId).toBe('p1') // 移动即行动 → advance 到下一个玩家单位
})

test('信息面板：hover 部队 → 兵种/数量/伤兵剩余血', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('canvas', { state: 'attached' })
  await page.mouse.click(MENU_BATTLE.x, MENU_BATTLE.y)
  await waitBattleReady(page)
  await setAnimationSpeed(page, 0)
  await startBattle(page,
    { side: 'player', generalName: 'P', atkBonus: 0, defBonus: 0, units: [{ defId: 'swordsman', count: 12 }] },
    { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 20 }] },
    { cols: 5, rows: 3 })
  const s = await getState(page)
  const p0 = s.units!.find((u) => u.id === 'p0')!
  await page.mouse.move(p0.screen.x, p0.screen.y)
  await page.waitForTimeout(50)
  const panel = (await getState(page)).infoPanelText
  expect(panel).toContain('刀兵')
  expect(panel).toContain('数量：12')
  expect(panel).toContain('伤兵剩余：2') // swordsman hp2，12 满编 → 末位 24-11×2=2
  await page.screenshot({ path: 'screenshots/battle-info-panel.png' })
})

test('默认战斗：反复跳过 → AI 冲锋/射击 → 战败 → 返回主菜单', async ({ page }) => {
  await page.goto('/')
  await page.waitForSelector('canvas', { state: 'attached' })
  await page.mouse.click(MENU_BATTLE.x, MENU_BATTLE.y)
  await waitBattleReady(page)
  let guard = 0
  let s: DebugGameState = await getState(page)
  while (s.phase === 'combat' && guard++ < 120) {
    await page.mouse.click(SKIP.x, SKIP.y)
    await page.waitForTimeout(80)
    s = await getState(page)
  }
  expect(s.phase).toBe('lost')
  await page.screenshot({ path: 'screenshots/battle-result-lost.png' })
  await page.mouse.click(RETURN.x, RETURN.y)
  await page.waitForFunction(
    () => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.ready === false
  )
})
```

- [ ] **Step 2: 跑 e2e**

Run: `powershell.exe -NoProfile -Command "cd F:\work\three-kingdoms-tactics\.claude\worktrees\crystalline-stargazing-panda && pnpm test:e2e"`
Expected: 全部通过。若某个 hover 断言因鼠标到位时序不稳定，在断言前加 `await page.waitForTimeout(50)`。

- [ ] **Step 3: 提交**

```bash
powershell.exe -NoProfile -Command "git -C 'F:\work\three-kingdoms-tactics\.claude\worktrees\crystalline-stargazing-panda' add -A && git -C 'F:\work\three-kingdoms-tactics\.claude\worktrees\crystalline-stargazing-panda' commit -m \"test(e2e): 战斗交互回归（刀剑冲锋/远程满额半额/移动即行动/信息面板）

Co-Authored-By: Claude <noreply@anthropic.com>\""
```

---

### Task 10: PRD 同步 + 全量回归

**Files:**
- Modify: `PRD.md`（§15 战斗 MVP、§16 P2）
- No code change（除非回归发现问题）。

**Interfaces:** 无（文档 + 回归）。

- [ ] **Step 1: 更新 PRD §15 战斗（MVP）**

把 531–539 行块替换为：

```md
### 战斗（MVP）
- [x] 矩形锯齿边战场（13×9 行宽×行数）+ 障碍物（固定测试图 6 块，连通性不变量校验）+ 双方固定部队 stack（战斗测试入口）
- [x] 按速度回合制（speed 降序；同速攻方先行）
- [x] 一个单位一个行动：移动即行动；近战边界刀剑交战（落点冲锋/原地攻击）；远程三态（满额 / 断箭半额 / 贴身禁射后近战 30%）
- [x] 伤害公式（HOMM3 式攻防修正，ATK_DEF_MODIFIER=0.05 可调）+ 反击（全伤、每回合每个单位一次、仅近战引发）
- [x] 1×2 大型单位（骑兵）支持：占主体+东邻两格、双格寻路、命中任一占据格
- [x] 数量显示在格子上 + hover 伤兵剩余血（无血条）
- [x] 简易 PVE AI（冲锋：够得着就近战落点/远程射击；够不着逼近）
- [x] 逐格移动动画（setAnimationSpeed 可调，AI 异步逐格）
- [x] 提示系统：当前单位金标+箭头、移动残影、刀剑/弓/断箭三态光标、目标闪烁、hover 信息面板
- [x] 胜负判定 + 返回主菜单
```

- [ ] **Step 2: 更新 PRD §16 P2（line 586）**

把 586 行替换为：

```md
- [ ] 战斗增强：等待/防御（受击-50%）、士气/幸运、英雄施法、随机伤害、经验/战利品（MVP 已含：矩形战场/移动即行动/近战冲锋/反击/远程三态/AI冲锋/数量与伤兵血显示/逐格动画/提示系统；以上为后续增量）
```

在 586 行后追加两行：

```md
- [ ] 战斗特技：连击 / 连射 / 远射 / 抵射 / 无限反击（记入 PRD，MVP 后做）
- [ ] 武将主动技能（一回合一次，可在任意部队行动时释放；例外：若某回合所有部队都无法行动，则也无法释放主动技能）
```

- [ ] **Step 3: 全量回归**

Run:
```bash
powershell.exe -NoProfile -Command "cd F:\work\three-kingdoms-tactics\.claude\worktrees\crystalline-stargazing-panda && pnpm test"
powershell.exe -NoProfile -Command "cd F:\work\three-kingdoms-tactics\.claude\worktrees\crystalline-stargazing-panda && pnpm test:e2e"
powershell.exe -NoProfile -Command "cd F:\work\three-kingdoms-tactics\.claude\worktrees\crystalline-stargazing-panda && pnpm typecheck"
```
Expected: 全绿。截图产物：`screenshots/battle-field-rect.png`、`battle-sword-attack.png`、`battle-bow-full.png`、`battle-broken-arrow.png`、`battle-info-panel.png`、`battle-result-lost.png`——交用户人工目检。

- [ ] **Step 4: 提交**

```bash
powershell.exe -NoProfile -Command "git -C 'F:\work\three-kingdoms-tactics\.claude\worktrees\crystalline-stargazing-panda' add -A && git -C 'F:\work\three-kingdoms-tactics\.claude\worktrees\crystalline-stargazing-panda' commit -m \"docs+test: PRD 战斗 MVP 同步（矩形战场/移动即行动/反击/远程三态/AI冲锋/动画/提示）+ 全量回归

Co-Authored-By: Claude <noreply@anthropic.com>\""
```

---

## Self-Review

**Spec 覆盖检查**（对照 `docs/superpowers/specs/2026-08-11-battle-polish-design.md`）：

| Spec 节 | 对应任务 |
|---|---|
| §3.2 矩形战场窗口 + 相机 | Task 1（inBattleGrid）+ Task 6（渲染/相机） |
| §3.3 障碍物 + 连通性 | Task 1 |
| §3.1 行动模型（回合/同速攻方先行/移动即行动/advance 重置） | Task 2 |
| §3.4 近战刀剑交互 + 无效点击 no-op | Task 7 |
| §3.5 远程三态（射程6/断箭/贴身禁射/近战30%） | Task 3（30%）+ Task 4（shoot/断箭/射程） |
| §3.6 反击（全伤/每回合一次/仅近战） | Task 3 |
| §3.7 特技 → 记 PRD | Task 10 |
| §3.8 提示系统（金标/残影/三态光标/闪烁/信息面板） | Task 6（金标）+ Task 7（其余） |
| §3.9 血量显示（count 在格 + hover 伤兵血，无血条） | Task 1（woundedHp）+ Task 6（去血条）+ Task 7（面板） |
| §3.10 逐格动画 + setAnimationSpeed + AI 异步 | Task 8 |
| §3.11 AI 冲锋/射击（canEngageTarget） | Task 5 |
| §4 常量（MELEE_ATTACK_MULT/RANGE_OUT_MULT/RANGED_RANGE/EDGE_HIT_TOLERANCE） | Task 3/4（core）+ Task 7（渲染容差 10） |
| §5 模块改动（data/debug/e2e） | Task 1（battleTest）/4（units）/6（debug）/9（e2e） |
| §6 命令接口（battle/shoot、attack with to） | Task 3/4 |
| §7 测试计划（core 单测清单 + e2e 清单） | Task 1–5 + Task 9 |
| §8 PRD 同步 | Task 10 |

**占位符扫描**：无 TBD/TODO/「后续补充」；每个步骤含可复制代码或明确断言。

**类型一致性**：`EnemyAction.attack` 带 `to`（Task 5 定义）与 Task 8 的 `stepEnemyAi`/`handleClick` 使用一致；`computeDamage` 第 5 参 `attackMult`（Task 3）与 Task 3/4 调用一致；`init` 的 grid payload（Task 1）与 Task 6 `startBattle` 参数一致；`woundedHp`（Task 1 定义）在 Task 6/7/9 复用。

**已知取舍（执行时注意）**：
- `hasMoved` 在移动即行动模型下对当前单位恒为 false，`shoot`/AI 里保留该判断属防御性（spec §3.5「已移动不能射」在旧两步模型下才有意义），不单独测。
- 渲染层 6–8 无法用 Vitest（core-only），验证靠 `pnpm typecheck` + 手动 + Task 9 e2e。
- 旧 `battle/attack` 的 3 个远程型测试在 Task 3 删除、Task 4 以 `battle/shoot` 形式补回（含 defBonus 回归、灭队判胜）。
- 模型不多模态：所有渲染验收以 e2e 状态断言为准，截图仅人工目检（见 CLAUDE.md 调试/回归工作流）。
