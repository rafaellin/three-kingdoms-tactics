# 主菜单 + 战斗系统 MVP 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增主菜单（开始游戏 / 战斗测试）与可玩的战斗 MVP（六角格战场、单位 stack、按速度回合制、移动/攻击、伤害公式、血条、简易 PVE AI、胜负返回主菜单）。

**Architecture:** 战斗为独立 core 领域（`src/core/battle/`）：`BattleState` + `battleReducer`（纯函数，经独立 `CommandLog` 驱动、可回放）+ 伤害公式 + 尺寸感知寻路 + 敌方 AI 纯函数。渲染层新增 `MainMenuScene` 与 `BattleScene`（只读状态渲染 + 输入转命令），`src/main.ts` 注册 3 场景、**初始进主菜单**。**启动即主菜单 ⇒ 存量 5 个 e2e spec 需先点「开始游戏」再断言（Task 13 适配）。**

**Tech Stack:** TypeScript strict、Phaser 4.2（仅渲染）、Vite 8、Vitest 4（core 单测）、Playwright（e2e）、pnpm。

## Global Constraints

- **core 铁律**：`src/core/battle/` 零 Phaser / DOM / 浏览器依赖；不感知分辨率；不得 import 渲染层。
- **确定性**：core 内禁止裸 `Math.random()` / `Date.now()`；MVP 固定伤害（无随机）。后续随机统一走注入 RNG（`src/core/rng.ts`）。
- 每个游戏操作是 battle 命令，经 `CommandLog` dispatch；相同命令序列 ⇒ 相同终态。
- 兵种属性表放 `src/data/units.ts`（纯数据，无逻辑）。
- 类型集中放 `src/core/battle/types.ts`；能定义成纯数据的不要写成逻辑。
- 新增 core 逻辑必须配套同目录 `*.test.ts`（Vitest），断言确定性的输入 → 输出。
- 渲染层保持薄：动画、排版、样式逻辑不进 core。
- 中文注释、英文标识符；每轮改动后跑 `pnpm test`；提交前跑一次 `pnpm typecheck`。
- 任务完成后同步 PRD §15 / §16（勾完成项、注明 MVP 未含项）。
- 伤害公式常量必须可调（`ATK_DEF_MODIFIER = 0.05`、`ATK_DEF_CAP = 3`）。

---

### Task 1: 兵种属性表 `src/data/units.ts`

**Files:**
- Create: `src/data/units.ts`
- Test: `src/data/units.test.ts`

**Interfaces:**
- Produces: `UnitDef`（interface）、`UNIT_DEFS: Record<string, UnitDef>`。兵种 id：`militia | swordsman | pikeman | archer | cavalry`。

- [ ] **Step 1: 写失败测试**

`src/data/units.test.ts`：
```ts
import { describe, expect, test } from 'vitest'
import { UNIT_DEFS } from './units'

describe('兵种属性表', () => {
  test('覆盖 MVP 五兵种', () => {
    for (const id of ['militia', 'swordsman', 'pikeman', 'archer', 'cavalry']) {
      expect(UNIT_DEFS[id]).toBeDefined()
    }
  })
  test('字段合法：伤害区间/速度/生命/射程/尺寸', () => {
    for (const def of Object.values(UNIT_DEFS)) {
      expect(def.minDamage).toBeLessThanOrEqual(def.maxDamage)
      expect(def.speed).toBeGreaterThan(0)
      expect(def.hp).toBeGreaterThan(0)
      expect(def.range).toBeGreaterThanOrEqual(1)
      expect([1, 2]).toContain(def.size)
    }
  })
  test('弓兵远程射程 2、骑兵 1×2', () => {
    expect(UNIT_DEFS.archer?.range).toBe(2)
    expect(UNIT_DEFS.cavalry?.size).toBe(2)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/data/units.test.ts`
Expected: FAIL（`Cannot find module './units'`）

- [ ] **Step 3: 实现数据表**

`src/data/units.ts`：
```ts
/**
 * 兵种属性表（纯数据，无逻辑）。占位值待平衡（PRD §7 未给数值）。
 * 实际攻防 = 基础 + 武将武力/3（见 core/battle/damage.ts）。
 */
export interface UnitDef {
  id: string
  name: string
  attack: number
  defense: number
  minDamage: number
  maxDamage: number
  /** 每回合可移动格数（也作为行动排序依据，越高越先动） */
  speed: number
  /** 单兵生命 */
  hp: number
  cost: { gold: number; wood?: number; stone?: number; iron?: number }
  /** 1=近战（需相邻）；2+=远程（hexDistance ≤ range） */
  range: number
  /** 1=占 1 格；2=占 主体格 + 东邻格（骑兵等大型单位，HOMM3 逻辑） */
  size: 1 | 2
}

export const UNIT_DEFS: Record<string, UnitDef> = {
  militia: { id: 'militia', name: '民兵', attack: 4, defense: 4, minDamage: 1, maxDamage: 3, speed: 4, hp: 1, cost: { gold: 50 }, range: 1, size: 1 },
  swordsman: { id: 'swordsman', name: '刀兵', attack: 6, defense: 8, minDamage: 3, maxDamage: 5, speed: 4, hp: 2, cost: { gold: 100 }, range: 1, size: 1 },
  pikeman: { id: 'pikeman', name: '枪兵', attack: 7, defense: 6, minDamage: 3, maxDamage: 5, speed: 4, hp: 2, cost: { gold: 100 }, range: 1, size: 1 },
  archer: { id: 'archer', name: '弓兵', attack: 6, defense: 4, minDamage: 2, maxDamage: 4, speed: 5, hp: 1, cost: { gold: 120 }, range: 2, size: 1 },
  cavalry: { id: 'cavalry', name: '骑兵', attack: 10, defense: 7, minDamage: 5, maxDamage: 8, speed: 9, hp: 3, cost: { gold: 200, iron: 5 }, range: 1, size: 2 }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test src/data/units.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/data/units.ts src/data/units.test.ts
git commit -m "feat(battle): 兵种属性表（攻防伤速命费/射程/尺寸）"
```

---

### Task 2: 战斗核心类型 `src/core/battle/types.ts`

**Files:**
- Create: `src/core/battle/types.ts`
- Test: `src/core/battle/types.test.ts`

**Interfaces:**
- Consumes: `Axial`（`../hex/HexGrid`）
- Produces:
```ts
export type Side = 'player' | 'enemy'
export interface BattleUnit { id: string; side: Side; defId: string; count: number; position: Axial; size: 1 | 2; hpLeft: number; maxHp: number; hasActed: boolean; hasMoved: boolean }
export interface BattleArmyConfig { side: Side; generalName: string; atkBonus: number; defBonus: number; units: { defId: string; count: number }[] }
export interface BattleState { grid: { cols: number; rows: number }; units: BattleUnit[]; general: Record<Side, { name: string; atkBonus: number; defBonus: number }>; turn: number; order: string[]; currentUnitId: string | null; selectedUnitId: string | null; phase: 'combat' | 'won' | 'lost'; log: string[] }
export function occupiedHexes(unit: Pick<BattleUnit, 'position' | 'size'>): Axial[]
```

- [ ] **Step 1: 写失败测试**

`src/core/battle/types.test.ts`：
```ts
import { describe, expect, test } from 'vitest'
import { hexKey } from '../hex/HexGrid'
import { occupiedHexes } from './types'

describe('occupiedHexes（1×1 / 1×2 占据格）', () => {
  test('size=1 只占主体格', () => {
    const hexes = occupiedHexes({ position: { q: 3, r: 2 }, size: 1 })
    expect(hexes.map(hexKey)).toEqual(['3,2'])
  })
  test('size=2 占主体格 + 东邻 (q+1, r)', () => {
    const hexes = occupiedHexes({ position: { q: 3, r: 2 }, size: 2 })
    expect(hexes.map(hexKey).sort()).toEqual(['3,2', '4,2'].sort())
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/core/battle/types.test.ts`
Expected: FAIL（`Cannot find module './types'`）

- [ ] **Step 3: 实现类型与占据 helper**

`src/core/battle/types.ts`：
```ts
/**
 * 战斗核心类型（纯数据 + 纯函数，零 Phaser）。
 * 战场为矩形六角网格（轴向坐标 q∈[0,cols-1]、r∈[0,rows-1]，全平地）。
 * 1×2 大型单位（骑兵）占据主体格 + 东邻居格 (q+1, r)，不旋转（HOMM3 逻辑）。
 */
import type { Axial } from '../hex/HexGrid'

export type Side = 'player' | 'enemy'

export interface BattleUnit {
  id: string
  side: Side
  defId: string
  /** 当前 stack 数量（受创后按 命×count 池折算，见 reducer） */
  count: number
  /** 主体格（轴向坐标；size=2 时为左侧格） */
  position: Axial
  size: 1 | 2
  /** 剩余总血量池（= 命×count 累计扣减） */
  hpLeft: number
  maxHp: number
  /** 本回合是否已行动（行动 = 攻击或结束回合） */
  hasActed: boolean
  /** 本回合是否已移动（MVP：每回合最多移动一次，移动后可再攻击） */
  hasMoved: boolean
}

export interface BattleArmyConfig {
  side: Side
  generalName: string
  /** = round(武力/3)，加到此方所有单位实际攻击 */
  atkBonus: number
  /** = round(统御/3)，加到此方所有单位实际防御 */
  defBonus: number
  units: { defId: string; count: number }[]
}

export interface BattleState {
  grid: { cols: number; rows: number }
  units: BattleUnit[]
  general: Record<Side, { name: string; atkBonus: number; defBonus: number }>
  turn: number
  /** 本回合按速度降序的 unitId 行动序列 */
  order: string[]
  currentUnitId: string | null
  /** 渲染层选中（高亮）；e2e 断言用 */
  selectedUnitId: string | null
  phase: 'combat' | 'won' | 'lost'
  log: string[]
}

/** 单位占据的 hex 集合：size=1 → 主体格；size=2 → 主体格 + 东邻 (q+1, r) */
export function occupiedHexes(unit: Pick<BattleUnit, 'position' | 'size'>): Axial[] {
  return unit.size === 2 ? [unit.position, { q: unit.position.q + 1, r: unit.position.r }] : [unit.position]
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test src/core/battle/types.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/battle/types.ts src/core/battle/types.test.ts
git commit -m "feat(battle): 战斗核心类型 + 1×2 占据格 helper"
```

---

### Task 3: 伤害公式 `src/core/battle/damage.ts`

**Files:**
- Create: `src/core/battle/damage.ts`
- Test: `src/core/battle/damage.test.ts`

**Interfaces:**
- Consumes: `UNIT_DEFS`（`../../data/units`）、`BattleUnit`（`./types`）
- Produces:
```ts
export const ATK_DEF_MODIFIER = 0.05   // ★ 平衡旋钮（用户指定可调）
export const ATK_DEF_CAP = 3           // 攻防差钳制 → 倍率 0.85 ~ 1.15
export function computeActualAttack(defId: string, atkBonus: number): number
export function computeActualDefense(defId: string, defBonus: number): number
export function computeDamage(attacker: BattleUnit, target: BattleUnit, atkBonus: number, defBonus: number): number
```

- [ ] **Step 1: 写失败测试**

`src/core/battle/damage.test.ts`：
```ts
import { describe, expect, test } from 'vitest'
import { ATK_DEF_CAP, ATK_DEF_MODIFIER, computeActualAttack, computeActualDefense, computeDamage } from './damage'
import type { BattleUnit } from './types'

const unit = (over: Partial<BattleUnit>): BattleUnit => ({
  id: 'u', side: 'player', defId: 'militia', count: 10, position: { q: 0, r: 0 }, size: 1,
  hpLeft: 30, maxHp: 30, hasActed: false, hasMoved: false, ...over
})

describe('伤害公式（HOMM3 式攻防修正）', () => {
  test('实际攻防 = 兵种基础 + 武将加成', () => {
    expect(computeActualAttack('militia', 30)).toBe(34)   // 4 + 30
    expect(computeActualDefense('militia', 27)).toBe(31)  // 4 + 27
  })
  test('基础伤害 × count × 修正，含舍入', () => {
    // 民兵伤害区间 1~3 中值 2；count 10；atkBonus 30 → 攻 34，defBonus 27 → 防 31，差 3
    // → 10 × 2 × (1 + 0.05×3) = 23
    const a = unit({ defId: 'militia', count: 10 })
    const t = unit({ side: 'enemy', defId: 'militia', hpLeft: 50, maxHp: 50 })
    expect(computeDamage(a, t, 30, 27)).toBe(23)
  })
  test('攻防差钳制在 ±ATK_DEF_CAP', () => {
    const a = unit({ defId: 'militia', count: 1 })
    const t = unit({ side: 'enemy', defId: 'militia', hpLeft: 10, maxHp: 10 })
    // 攻远大于防：差钳到 +CAP
    expect(computeDamage(a, t, 100, 0)).toBe(Math.round(1 * 2 * (1 + ATK_DEF_MODIFIER * ATK_DEF_CAP)))
    // 攻远小于防：差钳到 -CAP
    expect(computeDamage(a, t, 0, 100)).toBe(Math.round(1 * 2 * (1 - ATK_DEF_MODIFIER * ATK_DEF_CAP)))
  })
  test('伤害至少为 1（不为 0）', () => {
    const a = unit({ defId: 'militia', count: 1 })
    const t = unit({ side: 'enemy', defId: 'militia', hpLeft: 10, maxHp: 10 })
    expect(computeDamage(a, t, 0, 1000)).toBeGreaterThanOrEqual(1)
  })
  test('修正倍率由可调常量驱动（平衡旋钮）', () => {
    // 常量必须导出为 number；上面的钳制测试已用 ATK_DEF_MODIFIER 断言倍率生效
    expect(typeof ATK_DEF_MODIFIER).toBe('number')
    expect(ATK_DEF_CAP).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/core/battle/damage.test.ts`
Expected: FAIL（`Cannot find module './damage'`）

- [ ] **Step 3: 实现伤害公式**

`src/core/battle/damage.ts`：
```ts
/**
 * 伤害公式（纯函数，确定性）。
 * 实际攻防 = 兵种基础攻防 + 武将武力/统御加成（PRD §7.3）。
 * damage = 基础伤害(区间中值) × count × [1 + ATK_DEF_MODIFIER × clamp(攻-防, ±ATK_DEF_CAP)]
 * ATK_DEF_MODIFIER / ATK_DEF_CAP 是平衡旋钮（用户指定可调）。
 */
import { UNIT_DEFS } from '../../data/units'
import type { BattleUnit } from './types'

export const ATK_DEF_MODIFIER = 0.05
export const ATK_DEF_CAP = 3

export function computeActualAttack(defId: string, atkBonus: number): number {
  return UNIT_DEFS[defId].attack + atkBonus
}

export function computeActualDefense(defId: string, defBonus: number): number {
  return UNIT_DEFS[defId].defense + defBonus
}

export function computeDamage(attacker: BattleUnit, target: BattleUnit, atkBonus: number, defBonus: number): number {
  const att = computeActualAttack(attacker.defId, atkBonus)
  const def = computeActualDefense(target.defId, defBonus)
  const diff = Math.max(-ATK_DEF_CAP, Math.min(ATK_DEF_CAP, att - def))
  const mid = (UNIT_DEFS[attacker.defId].minDamage + UNIT_DEFS[attacker.defId].maxDamage) / 2
  return Math.max(1, Math.round(attacker.count * mid * (1 + ATK_DEF_MODIFIER * diff)))
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test src/core/battle/damage.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/battle/damage.ts src/core/battle/damage.test.ts
git commit -m "feat(battle): 伤害公式（攻防修正，常量可调）"
```

---

### Task 4: 战斗寻路 `src/core/battle/pathing.ts`

**Files:**
- Create: `src/core/battle/pathing.ts`
- Test: `src/core/battle/pathing.test.ts`

**Interfaces:**
- Consumes: `hexKey/Axial`（`../hex/HexGrid`）、`reachableArea/findPath/MovementCost`（`../pathfinding/Pathfinding`）、`occupiedHexes/BattleState/BattleUnit`（`./types`）、`UNIT_DEFS`（`../../data/units`）
- Produces:
```ts
export function battleMovementCost(mover: BattleUnit, state: BattleState): MovementCost
export function battleReachableArea(mover: BattleUnit, state: BattleState): Axial[]
export function battleFindPath(mover: BattleUnit, to: Axial, state: BattleState): Axial[] | null
```

- [ ] **Step 1: 写失败测试**

`src/core/battle/pathing.test.ts`：
```ts
import { describe, expect, test } from 'vitest'
import { hexKey } from '../hex/HexGrid'
import { battleFindPath, battleReachableArea } from './pathing'
import type { BattleState, BattleUnit } from './types'

function makeUnit(over: Partial<BattleUnit>): BattleUnit {
  return {
    id: 'u0', side: 'player', defId: 'militia', count: 10, position: { q: 0, r: 0 },
    size: 1, hpLeft: 10, maxHp: 10, hasActed: false, hasMoved: false, ...over
  }
}

function makeState(units: BattleUnit[], grid: { cols: number; rows: number } = { cols: 20, rows: 20 }): BattleState {
  return {
    grid,
    units,
    general: { player: { name: 'P', atkBonus: 0, defBonus: 0 }, enemy: { name: 'E', atkBonus: 0, defBonus: 0 } },
    turn: 1, order: units.map((u) => u.id), currentUnitId: units[0]?.id ?? null, selectedUnitId: null, phase: 'combat', log: []
  }
}

describe('战斗寻路（全平地，障碍 = 其他单位）', () => {
  test('移动力 = 兵种 speed（无遮挡平地）', () => {
    // 起点放网格中心 (10,10)，避免角点把可达集裁剪掉；
    // speed4 → 六角球内 1+6+12+18+24 = 61 格全部落在 20×20 界内
    const s = makeState([makeUnit({ defId: 'militia', position: { q: 10, r: 10 } })])
    expect(battleReachableArea(s.units[0]!, s)).toHaveLength(61)
  })
  test('他单位占据格不可走（含 1×2 双格）', () => {
    // 敌人骑兵 size2 占 (2,2)+(3,2)
    const enemy = makeUnit({ id: 'e0', side: 'enemy', defId: 'cavalry', position: { q: 2, r: 2 }, size: 2 })
    const s = makeState([makeUnit({ defId: 'cavalry' }), enemy])
    const reach = battleReachableArea(s.units[0]!, s)
    expect(reach.some((h) => hexKey(h) === '2,2')).toBe(false)
    expect(reach.some((h) => hexKey(h) === '3,2')).toBe(false)
  })
  test('1×2 单位移动时双格校验：目标东邻被占则不可达', () => {
    const blocker = makeUnit({ id: 'b', side: 'enemy', defId: 'militia', position: { q: 3, r: 0 } })
    const mover = makeUnit({ id: 'u0', defId: 'cavalry', position: { q: 0, r: 0 }, size: 2 })
    const s = makeState([mover, blocker])
    // 骑兵到 (2,0) 需占 (2,0)+(3,0)，而 (3,0) 被占 → 不可达
    expect(battleReachableArea(mover, s).some((h) => hexKey(h) === '2,0')).toBe(false)
  })
  test('battleFindPath 返回路径或 null（越界/被占 → null）', () => {
    const s = makeState([makeUnit({ defId: 'militia' })])
    expect(battleFindPath(s.units[0]!, { q: 2, r: 0 }, s)).not.toBeNull()
    const s2 = makeState([makeUnit({ defId: 'militia' }), makeUnit({ id: 'e0', side: 'enemy', position: { q: 2, r: 0 } })])
    expect(battleFindPath(s2.units[0]!, { q: 2, r: 0 }, s2)).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/core/battle/pathing.test.ts`
Expected: FAIL（`Cannot find module './pathing'`）

- [ ] **Step 3: 实现寻路**

`src/core/battle/pathing.ts`：
```ts
/**
 * 战斗内寻路（纯函数，确定性）。
 * 战场全平地，障碍 = 其它单位占据格（含 1×2 双格）；边界 = grid。
 * 移动力 = 兵种 speed；1×2 单位每一步校验「主体格 + 东邻格」都可通行。
 */
import { hexKey, type Axial } from '../hex/HexGrid'
import { findPath, reachableArea, type MovementCost } from '../pathfinding/Pathfinding'
import { UNIT_DEFS } from '../../data/units'
import { occupiedHexes, type BattleState, type BattleUnit } from './types'

function inGrid(state: BattleState, hex: Axial): boolean {
  return hex.q >= 0 && hex.q < state.grid.cols && hex.r >= 0 && hex.r < state.grid.rows
}

/** 该单位能否把主体格放到 to（size=1 校验 1 格；size=2 校验主体+东邻双格） */
function canStandAt(mover: BattleUnit, state: BattleState, to: Axial): boolean {
  if (!inGrid(state, to)) return false
  for (const hex of occupiedHexes({ position: to, size: mover.size })) {
    if (!inGrid(state, hex)) return false
    for (const other of state.units) {
      if (other.id === mover.id) continue
      if (occupiedHexes(other).some((h) => hexKey(h) === hexKey(hex))) return false
    }
  }
  return true
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

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test src/core/battle/pathing.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/battle/pathing.ts src/core/battle/pathing.test.ts
git commit -m "feat(battle): 战斗寻路（障碍=单位、1×2 双格校验）"
```

---

### Task 5: 战斗 reducer — init / 回合推进 `src/core/battle/battleReducer.ts`

**Files:**
- Create: `src/core/battle/battleReducer.ts`
- Test: `src/core/battle/battleReducer.test.ts`

**Interfaces:**
- Consumes: `UNIT_DEFS`、`types` 全部、`CommandLog/Reducer/Command`（`../events/CommandLog`）、`hexKey/Axial`（`../hex/HexGrid`）
- Produces:
```ts
export function createInitialBattleState(): BattleState
export const battleReducer: Reducer<BattleState>
```
- 命令：`battle/init`（payload `{ player: BattleArmyConfig; enemy: BattleArmyConfig; grid: { cols: number; rows: number } }`）、`battle/endTurn`（payload `{ unitId: string }`）、`battle/surrender`（无 payload）。
- 内部辅助（同文件，Task 6 复用）：`sortOrder(units)`、`advance(state)`、`phaseOf(units)`。

- [ ] **Step 1: 写失败测试**

`src/core/battle/battleReducer.test.ts`：
```ts
import { describe, expect, test } from 'vitest'
import { CommandLog } from '../events/CommandLog'
import { battleReducer, createInitialBattleState } from './battleReducer'
import type { BattleArmyConfig, BattleState } from './types'

const TEST_GRID = { cols: 13, rows: 9 }
const TEST_ARMIES = {
  player: { side: 'player' as const, generalName: '关羽', atkBonus: 30, defBonus: 23,
    units: [{ defId: 'militia', count: 30 }, { defId: 'cavalry', count: 8 }] },
  enemy: { side: 'enemy' as const, generalName: '吕布', atkBonus: 33, defBonus: 27,
    units: [{ defId: 'archer', count: 8 }] }
}

function makeStore(opts?: { player?: BattleArmyConfig; enemy?: BattleArmyConfig; grid?: { cols: number; rows: number } }) {
  const store = new CommandLog<BattleState>(createInitialBattleState(), battleReducer)
  store.dispatch('battle/init', {
    player: opts?.player ?? TEST_ARMIES.player,
    enemy: opts?.enemy ?? TEST_ARMIES.enemy,
    grid: opts?.grid ?? TEST_GRID
  })
  return store
}

describe('battle/init', () => {
  test('布置单位：hp = 命×count、按速度降序排行动序', () => {
    const s = makeStore().getState()
    expect(s.phase).toBe('combat')
    expect(s.units).toHaveLength(3)
    const mil = s.units.find((u) => u.defId === 'militia')
    expect(mil?.maxHp).toBe(30)   // 30 × hp1
    expect(mil?.hpLeft).toBe(30)
    // 骑兵 speed9 > 弓兵5 > 民兵4 → 行动序 [cavalry, archer, militia]
    const cavalryId = s.units.find((u) => u.defId === 'cavalry')?.id
    expect(s.order[0]).toBe(cavalryId)
    expect(s.currentUnitId).toBe(cavalryId)
  })
  test('玩家单位在左 (q=0)、敌方在右 (q=cols-2)', () => {
    const s = makeStore().getState()
    expect(s.units.filter((u) => u.side === 'player').every((u) => u.position.q === 0)).toBe(true)
    expect(s.units.find((u) => u.side === 'enemy')?.position.q).toBe(s.grid.cols - 2)
  })
})

describe('battle/endTurn 回合推进', () => {
  test('行动完跳到下一单位；全动完 turn+1 重排', () => {
    const store = makeStore()
    const ids = store.getState().order
    for (const id of ids.slice(0, -1)) {
      store.dispatch('battle/endTurn', { unitId: id })
      expect(store.getState().currentUnitId).toBe(ids[ids.indexOf(id) + 1])
    }
    store.dispatch('battle/endTurn', { unitId: ids[ids.length - 1] as string })
    const s = store.getState()
    expect(s.turn).toBe(2)
    expect(s.units.every((u) => !u.hasActed && !u.hasMoved)).toBe(true)
  })
  test('非当前单位 endTurn 为 no-op', () => {
    const store = makeStore()
    const s0 = store.getState()
    const other = s0.units.find((u) => u.id !== s0.currentUnitId)!
    store.dispatch('battle/endTurn', { unitId: other.id })
    expect(store.getState().currentUnitId).toBe(s0.currentUnitId)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/core/battle/battleReducer.test.ts`
Expected: FAIL（`Cannot find module './battleReducer'`）

- [ ] **Step 3: 实现 init / endTurn / 辅助**

`src/core/battle/battleReducer.ts`：
```ts
/**
 * 战斗 reducer：纯函数，经独立 CommandLog 驱动 BattleState。
 * 相同命令序列 + 相同初始状态 ⇒ 相同终态（确定性）。MVP 无随机。
 * 命令：battle/init | battle/select | battle/move | battle/attack | battle/endTurn | battle/surrender
 */
import { type Command, type Reducer } from '../events/CommandLog'
import { hexDistance, hexKey, type Axial } from '../hex/HexGrid'
import { UNIT_DEFS } from '../../data/units'
import { computeDamage } from './damage'
import { battleFindPath, battleReachableArea } from './pathing'
import { occupiedHexes, type BattleArmyConfig, type BattleState, type BattleUnit } from './types'

export function createInitialBattleState(): BattleState {
  return {
    grid: { cols: 0, rows: 0 },
    units: [],
    general: {
      player: { name: '', atkBonus: 0, defBonus: 0 },
      enemy: { name: '', atkBonus: 0, defBonus: 0 }
    },
    turn: 1,
    order: [],
    currentUnitId: null,
    selectedUnitId: null,
    phase: 'combat',
    log: []
  }
}

function sortOrder(units: BattleUnit[]): string[] {
  return [...units]
    .sort((a, b) => {
      const sp = UNIT_DEFS[b.defId].speed - UNIT_DEFS[a.defId].speed
      if (sp !== 0) return sp
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
    })
    .map((u) => u.id)
}

function init(state: BattleState, payload: { player: BattleArmyConfig; enemy: BattleArmyConfig; grid: { cols: number; rows: number } }): BattleState {
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
        hasMoved: false
      }
    })
  const units = [...mk(payload.player, 0), ...mk(payload.enemy, payload.grid.cols - 2)]
  const order = sortOrder(units)
  return {
    ...state,
    grid: payload.grid,
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

/** 找到本回合下一个未行动单位；全部行动完则 turn+1、重置、按新状态重排 */
function advance(state: BattleState): BattleState {
  for (const id of state.order) {
    const u = state.units.find((x) => x.id === id)
    if (u && !u.hasActed) return { ...state, currentUnitId: id, selectedUnitId: null }
  }
  const units = state.units.map((u) => ({ ...u, hasActed: false, hasMoved: false }))
  const order = sortOrder(units)
  return { ...state, turn: state.turn + 1, units, order, currentUnitId: order[0] ?? null, selectedUnitId: null }
}

function endTurn(state: BattleState, unitId: string): BattleState {
  const unit = state.units.find((u) => u.id === unitId)
  if (!unit || unit.id !== state.currentUnitId) return state
  const units = state.units.map((u) => (u.id === unit.id ? { ...u, hasActed: true } : u))
  return advance({ ...state, units })
}

/** 判定胜负：一方全灭 */
function phaseOf(units: BattleUnit[]): BattleState['phase'] {
  if (!units.some((u) => u.side === 'player')) return 'lost'
  if (!units.some((u) => u.side === 'enemy')) return 'won'
  return 'combat'
}

export const battleReducer: Reducer<BattleState> = (state, cmd: Command) => {
  switch (cmd.type) {
    case 'battle/init':
      return init(state, cmd.payload as Parameters<typeof init>[1])
    case 'battle/endTurn':
      return endTurn(state, (cmd.payload as { unitId: string }).unitId)
    case 'battle/surrender':
      return { ...state, phase: 'lost', log: [...state.log, '投降'] }
    default:
      return state
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test src/core/battle/battleReducer.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/battle/battleReducer.ts src/core/battle/battleReducer.test.ts
git commit -m "feat(battle): reducer init/回合推进（按速度排序）"
```

---

### Task 6: 战斗 reducer — select / move / attack / 胜负

**Files:**
- Modify: `src/core/battle/battleReducer.ts`（switch 增加 case，复用 Task 5 的 `advance`/`phaseOf`）
- Test: `src/core/battle/battleReducer.test.ts`（追加 describe）

**Interfaces:**
- Consumes: Task 5 `createInitialBattleState`/`battleReducer`/`advance`/`phaseOf`、Task 3 `computeDamage`、Task 4 寻路、`occupiedHexes`、`hexKey`/`hexDistance`/`Axial`
- Produces: `battle/select`（payload `{ unitId: string | null }`）、`battle/move`（`{ unitId, to: Axial }`）、`battle/attack`（`{ unitId, targetId }`）

- [ ] **Step 1: 写失败测试（追加到测试文件，顶部补 `import { hexKey } from '../hex/HexGrid'`）**

```ts
describe('battle/select', () => {
  test('只能选中玩家单位；可取消', () => {
    const store = makeStore()
    const p = store.getState().units.find((u) => u.side === 'player')!
    store.dispatch('battle/select', { unitId: p.id })
    expect(store.getState().selectedUnitId).toBe(p.id)
    store.dispatch('battle/select', { unitId: null })
    expect(store.getState().selectedUnitId).toBeNull()
  })
  test('选中敌方单位无效', () => {
    const store = makeStore()
    const e = store.getState().units.find((u) => u.side === 'enemy')!
    store.dispatch('battle/select', { unitId: e.id })
    expect(store.getState().selectedUnitId).toBeNull()
  })
})

describe('battle/move', () => {
  test('移动到可达格更新位置，并置 hasMoved', () => {
    const store = makeStore()
    const cur = store.getState().currentUnitId! // 骑兵（speed9，出生 (0,1)）
    store.dispatch('battle/move', { unitId: cur, to: { q: 1, r: 0 } })
    const u = store.getState().units.find((x) => x.id === cur)!
    expect(hexKey(u.position)).toBe('1,0')
    expect(u.hasMoved).toBe(true)
  })
  test('不可达/越界/已移动 均为 no-op', () => {
    const store = makeStore()
    const cur = store.getState().currentUnitId! // 骑兵 (0,1)
    store.dispatch('battle/move', { unitId: cur, to: { q: 99, r: 99 } }) // 越界 → no-op
    expect(hexKey(store.getState().units.find((x) => x.id === cur)!.position)).toBe('0,1')
    store.dispatch('battle/move', { unitId: cur, to: { q: 1, r: 0 } })  // 合法移动
    store.dispatch('battle/move', { unitId: cur, to: { q: 2, r: 0 } })  // 已移动 → no-op
    expect(hexKey(store.getState().units.find((x) => x.id === cur)!.position)).toBe('1,0')
  })
})

describe('battle/attack', () => {
  test('远程在射程内攻击：扣目标 hp、折算 count、攻击者行动', () => {
    // 小图 4×3：玩家 archer (0,0)、敌方 militia (2,0)，距离 2 ≤ 射程 2
    // archer speed5 > militia speed4 → 玩家 p0 先动（避免同速 id 平局陷阱）
    const store = makeStore({
      grid: { cols: 4, rows: 3 },
      player: { side: 'player', generalName: '关羽', atkBonus: 0, defBonus: 0, units: [{ defId: 'archer', count: 10 }] },
      enemy: { side: 'enemy', generalName: '吕布', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 50 }] }
    })
    expect(store.getState().currentUnitId).toBe('p0')
    store.dispatch('battle/attack', { unitId: 'p0', targetId: 'e0' })
    const s = store.getState()
    // 攻6 防4 差2 → 伤害 10×3×1.1 = 33；敌方 militia hp=50 → 剩 17，count = ceil(17/1) = 17
    const t = s.units.find((u) => u.id === 'e0')!
    expect(t.hpLeft).toBe(17)
    expect(t.count).toBe(17)
    expect(s.phase).toBe('combat')
    expect(s.units.find((u) => u.id === 'p0')!.hasActed).toBe(true)
    expect(s.currentUnitId).toBe('e0') // advance 到敌方未行动单位
  })
  test('灭队即判胜', () => {
    const store = makeStore({
      grid: { cols: 4, rows: 3 },
      player: { side: 'player', generalName: '关羽', atkBonus: 0, defBonus: 0, units: [{ defId: 'archer', count: 10 }] },
      enemy: { side: 'enemy', generalName: '吕布', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 8 }] }
    })
    store.dispatch('battle/attack', { unitId: 'p0', targetId: 'e0' })
    const s = store.getState()
    expect(s.units.find((u) => u.id === 'e0')).toBeUndefined()
    expect(s.phase).toBe('won')
  })
  test('近战需相邻：不相邻攻击为 no-op', () => {
    const store = makeStore()
    const s0 = store.getState()
    const cur = s0.currentUnitId! // 骑兵 (0,1)，敌方 archer (11,0) 距离远
    const enemyId = s0.units.find((u) => u.side === 'enemy')!.id
    store.dispatch('battle/attack', { unitId: cur, targetId: enemyId })
    const s = store.getState()
    expect(s.phase).toBe('combat')
    expect(s.units.find((u) => u.side === 'enemy')).toBeDefined()
    expect(s.currentUnitId).toBe(cur) // 未行动 → 当前单位不变
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/core/battle/battleReducer.test.ts`
Expected: FAIL（select/move/attack case 未实现 → dispatch 后状态不变）

- [ ] **Step 3: 实现 select / move / attack**

在 `battleReducer.ts` 的 `switch` 前追加辅助函数（`advance`/`phaseOf` 已在 Task 5 定义，同文件复用）：

```ts
function select(state: BattleState, unitId: string | null): BattleState {
  if (unitId === null) return { ...state, selectedUnitId: null }
  const unit = state.units.find((u) => u.id === unitId)
  if (!unit || unit.side !== 'player') return state
  return { ...state, selectedUnitId: unit.id }
}

function move(state: BattleState, unitId: string, to: Axial): BattleState {
  const unit = state.units.find((u) => u.id === unitId)
  if (!unit || unit.id !== state.currentUnitId || unit.hasActed || unit.hasMoved) return state
  if (hexKey(unit.position) === hexKey(to)) return state
  const reachable = battleReachableArea(unit, state)
  if (!reachable.some((h) => hexKey(h) === hexKey(to))) return state
  if (!battleFindPath(unit, to, state)) return state
  return {
    ...state,
    units: state.units.map((u) => (u.id === unitId ? { ...u, position: { ...to }, hasMoved: true } : u))
  }
}

function attack(state: BattleState, unitId: string, targetId: string): BattleState {
  const attacker = state.units.find((u) => u.id === unitId)
  const target = state.units.find((u) => u.id === targetId)
  if (!attacker || !target || attacker.id !== state.currentUnitId || attacker.hasActed) return state
  if (attacker.side === target.side) return state
  const range = UNIT_DEFS[attacker.defId].range
  const inRange = occupiedHexes(target).some((h) => hexDistance(attacker.position, h) <= range)
  if (!inRange) return state
  const general = state.general[attacker.side]
  const dmg = computeDamage(attacker, target, general.atkBonus, general.defBonus)
  let units = state.units.map((u) => (u.id === attacker.id ? { ...u, hasActed: true } : u))
  const hpLeft = target.hpLeft - dmg
  if (hpLeft <= 0) {
    units = units.filter((u) => u.id !== target.id)
  } else {
    units = units.map((u) =>
      u.id === target.id ? { ...u, hpLeft, count: Math.max(1, Math.ceil(hpLeft / UNIT_DEFS[u.defId].hp)) } : u
    )
  }
  const phase = phaseOf(units)
  const log = [...state.log, `${attacker.id} 攻击 ${target.id} 造成 ${dmg} 伤害${hpLeft <= 0 ? '（消灭）' : ''}`]
  if (phase !== 'combat') return { ...state, units, phase, log }
  return advance({ ...state, units, log })
}
```

在 `switch` 中增加 case：

```ts
    case 'battle/select': {
      const payload = cmd.payload as { unitId: string | null }
      return select(state, payload.unitId)
    }
    case 'battle/move': {
      const payload = cmd.payload as { unitId: string; to: Axial }
      return move(state, payload.unitId, payload.to)
    }
    case 'battle/attack': {
      const payload = cmd.payload as { unitId: string; targetId: string }
      return attack(state, payload.unitId, payload.targetId)
    }
```

- [ ] **Step 4: 跑测试确认通过**

Run: `pnpm test src/core/battle/battleReducer.test.ts`
Expected: PASS（含 Task 5 + Task 6 全部）

- [ ] **Step 5: Commit**

```bash
git add src/core/battle/battleReducer.ts src/core/battle/battleReducer.test.ts
git commit -m "feat(battle): select/move/attack 与胜负判定"
```

---

### Task 7: 敌方 AI `src/core/battle/ai.ts`

**Files:**
- Create: `src/core/battle/ai.ts`
- Test: `src/core/battle/ai.test.ts`

**Interfaces:**
- Consumes: `hexDistance/hexKey/Axial`（`../hex/HexGrid`）、`battleReachableArea`（`./pathing`）、`occupiedHexes/BattleState/BattleUnit`（`./types`）、`UNIT_DEFS`（`../../data/units`）
- Produces:
```ts
export type EnemyAction = { type: 'attack'; targetId: string } | { type: 'move'; to: Axial } | { type: 'endTurn' }
export function planEnemyAction(state: BattleState): EnemyAction
```

- [ ] **Step 1: 写失败测试**

`src/core/battle/ai.test.ts`：
```ts
import { describe, expect, test } from 'vitest'
import { planEnemyAction } from './ai'
import type { BattleState, BattleUnit } from './types'

function unit(over: Partial<BattleUnit>): BattleUnit {
  return {
    id: 'u', side: 'enemy', defId: 'militia', count: 10, position: { q: 0, r: 0 },
    size: 1, hpLeft: 10, maxHp: 10, hasActed: false, hasMoved: false, ...over
  }
}
function state(enemy: BattleUnit, foes: BattleUnit[]): BattleState {
  return {
    grid: { cols: 13, rows: 9 },
    units: [enemy, ...foes],
    general: { player: { name: 'P', atkBonus: 0, defBonus: 0 }, enemy: { name: 'E', atkBonus: 0, defBonus: 0 } },
    turn: 1, order: [enemy.id], currentUnitId: enemy.id, selectedUnitId: null, phase: 'combat', log: []
  }
}

describe('planEnemyAction（简易 AI）', () => {
  test('范围内有敌人 → 攻击（优先低血量）', () => {
    // 两个敌人都距 1、在射程内：血低者优先
    const foeLow = unit({ id: 'p1', side: 'player', position: { q: 1, r: 0 }, hpLeft: 5 })
    const foeHigh = unit({ id: 'p0', side: 'player', position: { q: 0, r: 1 }, hpLeft: 50 })
    const enemy = unit({ id: 'e0', defId: 'militia' }) // range 1
    const s = state(enemy, [foeLow, foeHigh])
    const action = planEnemyAction(s)
    expect(action.type).toBe('attack')
    if (action.type === 'attack') expect(action.targetId).toBe('p1')
  })
  test('范围内无敌人 → 向最近敌人移动', () => {
    const foe = unit({ id: 'p0', side: 'player', position: { q: 3, r: 0 } })
    const enemy = unit({ id: 'e0', defId: 'militia', position: { q: 0, r: 0 } })
    expect(planEnemyAction(state(enemy, [foe])).type).toBe('move')
  })
  test('射程为 1 的近战，距离 2 不触发攻击', () => {
    const foe = unit({ id: 'p0', side: 'player', position: { q: 2, r: 0 } }) // 距离 2
    const enemy = unit({ id: 'e0', defId: 'militia' })
    expect(planEnemyAction(state(enemy, [foe])).type).toBe('move')
  })
  test('无更近的可达格 → 返回 move 或 endTurn（不死循环）', () => {
    const foe = unit({ id: 'p0', side: 'player', position: { q: 10, r: 10 } })
    const enemy = unit({ id: 'e0', defId: 'militia' })
    expect(['move', 'endTurn']).toContain(planEnemyAction(state(enemy, [foe])).type)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test src/core/battle/ai.test.ts`
Expected: FAIL（`Cannot find module './ai'`）

- [ ] **Step 3: 实现 AI**

`src/core/battle/ai.ts`：
```ts
/**
 * 敌方 AI（MVP 简易，纯函数确定性）：① 攻击范围内敌人（优先血低）；
 * ② 否则向最近敌人移动（走可达集中使距离最小的格，排除自身位置）；
 * ③ 都不行则结束回合。
 */
import { hexDistance, hexKey, type Axial } from '../hex/HexGrid'
import { UNIT_DEFS } from '../../data/units'
import { battleReachableArea } from './pathing'
import { occupiedHexes, type BattleState, type BattleUnit } from './types'

export type EnemyAction = { type: 'attack'; targetId: string } | { type: 'move'; to: Axial } | { type: 'endTurn' }

export function planEnemyAction(state: BattleState): EnemyAction {
  const unit = state.units.find((u) => u.id === state.currentUnitId)
  if (!unit || unit.side !== 'enemy') return { type: 'endTurn' }
  const foes = state.units.filter((u) => u.side !== unit.side)
  if (foes.length === 0) return { type: 'endTurn' }
  const range = UNIT_DEFS[unit.defId].range
  const inRange = (t: BattleUnit): boolean =>
    occupiedHexes(t).some((h) => hexDistance(unit.position, h) <= range)
  const targetable = foes
    .filter(inRange)
    .sort((a, b) => a.hpLeft - b.hpLeft || (a.id < b.id ? -1 : 1))
  if (targetable.length > 0) return { type: 'attack', targetId: (targetable[0] as BattleUnit).id }
  // 移动：选可达集中「到最近敌人距离最小」的格（排除自身格，避免原地踏步死循环）
  const reachable = battleReachableArea(unit, state).filter((h) => hexKey(h) !== hexKey(unit.position))
  let best: Axial | null = null
  let bestDist = Number.POSITIVE_INFINITY
  for (const hex of reachable) {
    let minD = Number.POSITIVE_INFINITY
    for (const t of foes) {
      for (const h of occupiedHexes(t)) minD = Math.min(minD, hexDistance(hex, h))
    }
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

Run: `pnpm test src/core/battle/ai.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/battle/ai.ts src/core/battle/ai.test.ts
git commit -m "feat(battle): 敌方简易 AI（攻击/逼近/跳过）"
```

---

### Task 8: 战斗测试阵容 `src/data/battleTest.ts`

**Files:**
- Create: `src/data/battleTest.ts`

**Interfaces:**
- Consumes: `BattleArmyConfig`（`../core/battle/types`）
- Produces:
```ts
export const BATTLE_GRID: { cols: number; rows: number }
export const PLAYER_ARMY: BattleArmyConfig
export const ENEMY_ARMY: BattleArmyConfig
```

- [ ] **Step 1: 实现数据**

`src/data/battleTest.ts`：
```ts
/**
 * 战斗测试固定阵容（纯数据）：主菜单「战斗测试」入口用。
 * 我方：关羽（武力90/统御70）+ 4 支；敌方：吕布（武力100/统御80）+ 3 支。
 * atkBonus = round(武力/3)，defBonus = round(统御/3)。
 */
import type { BattleArmyConfig } from '../core/battle/types'

export const BATTLE_GRID = { cols: 13, rows: 9 } as const

export const PLAYER_ARMY: BattleArmyConfig = {
  side: 'player',
  generalName: '关羽',
  atkBonus: 30,   // 90/3
  defBonus: 23,   // 70/3 ≈ 23.3
  units: [
    { defId: 'militia', count: 30 },
    { defId: 'swordsman', count: 12 },
    { defId: 'archer', count: 10 },
    { defId: 'cavalry', count: 8 }   // 骑兵 → 验证 1×2 支持
  ]
}

export const ENEMY_ARMY: BattleArmyConfig = {
  side: 'enemy',
  generalName: '吕布',
  atkBonus: 33,   // 100/3 ≈ 33.3
  defBonus: 27,   // 80/3 ≈ 26.7
  units: [
    { defId: 'militia', count: 20 },
    { defId: 'pikeman', count: 12 },
    { defId: 'archer', count: 8 }
  ]
}
```

- [ ] **Step 2: 验证编译**

Run: `pnpm typecheck`
Expected: 零 error

- [ ] **Step 3: Commit**

```bash
git add src/data/battleTest.ts
git commit -m "feat(battle): 战斗测试固定阵容"
```

---

### Task 9: 主菜单场景 + 入口注册

**Files:**
- Create: `src/scenes/MainMenuScene.ts`
- Create: `src/scenes/BattleScene.ts`（Task 10 填充完整实现，此处先占位）
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `AdventureScene.KEY`、`BattleScene.KEY`
- Produces: `MainMenuScene.KEY = 'MainMenu'`、`BattleScene.KEY = 'Battle'`

- [ ] **Step 1: 创建占位 BattleScene**

`src/scenes/BattleScene.ts`：
```ts
import Phaser from 'phaser'

/** 战斗场景（渲染层）——完整实现在 Task 10 */
export class BattleScene extends Phaser.Scene {
  static readonly KEY = 'Battle'
  constructor() {
    super(BattleScene.KEY)
  }
}
```

- [ ] **Step 2: 实现主菜单**

`src/scenes/MainMenuScene.ts`：
```ts
import Phaser from 'phaser'
import { AdventureScene } from './AdventureScene'
import { BattleScene } from './BattleScene'

/**
 * 主菜单（渲染层）：开始游戏 → 大地图；战斗测试 → 战斗场景。
 * 按钮为视口固定坐标（1920×1080 设计基准；RESIZE 下按当前宽高居中）。
 */
export class MainMenuScene extends Phaser.Scene {
  static readonly KEY = 'MainMenu'

  constructor() {
    super(MainMenuScene.KEY)
  }

  create(): void {
    const { width, height } = this.scale
    this.cameras.main.setBackgroundColor('#0f1622')
    this.add
      .text(width / 2, height * 0.3, '三国志：战术传说', {
        fontFamily: 'sans-serif',
        fontSize: '56px',
        color: '#f5f2e8'
      })
      .setOrigin(0.5)
    this.makeButton(width / 2, height * 0.55, '开始游戏', () => this.scene.start(AdventureScene.KEY))
    this.makeButton(width / 2, height * 0.68, '战斗测试', () => this.scene.start(BattleScene.KEY))
  }

  private makeButton(x: number, y: number, label: string, onClick: () => void): void {
    const btn = this.add
      .text(x, y, label, {
        fontFamily: 'sans-serif',
        fontSize: '28px',
        color: '#ffffff',
        backgroundColor: '#33415c'
      })
      .setPadding(24, 12)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true })
    btn.on('pointerdown', onClick)
  }
}
```

- [ ] **Step 3: 修改入口**

`src/main.ts`（整文件）：
```ts
import Phaser from 'phaser'
import { MainMenuScene } from './scenes/MainMenuScene'
import { AdventureScene } from './scenes/AdventureScene'
import { BattleScene } from './scenes/BattleScene'
import { installDevBridge } from './dev/debug'

const game = new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'game',
  backgroundColor: '#0f1622',
  scale: {
    // RESIZE：canvas 撑满窗口；设计基准 1920×1080
    mode: Phaser.Scale.RESIZE,
    width: 1920,
    height: 1080
  },
  scene: [MainMenuScene, AdventureScene, BattleScene]
})

installDevBridge(game)
```

- [ ] **Step 4: 验证编译**

Run: `pnpm typecheck`
Expected: 零 error

- [ ] **Step 5: Commit**

```bash
git add src/scenes/MainMenuScene.ts src/scenes/BattleScene.ts src/main.ts
git commit -m "feat(menu): 主菜单（开始游戏/战斗测试）+ 场景注册"
```

---

### Task 10: 战斗场景渲染 `src/scenes/BattleScene.ts`

**Files:**
- Modify: `src/scenes/BattleScene.ts`（完整实现）
- Test: 无单测（渲染层）；e2e 在 Task 12

**Interfaces:**
- Consumes: `CommandLog`、`battleReducer`/`createInitialBattleState`、`planEnemyAction`、`battleReachableArea`、`occupiedHexes/BattleState/BattleUnit`、`hexKey/HexLayout/Axial`（`../core/hex/HexGrid`）、`UNIT_DEFS`、`BATTLE_GRID/PLAYER_ARMY/ENEMY_ARMY`、`MainMenuScene.KEY`
- Produces: `getDebugState(): Record<string, unknown>`（含每单位 `screen` 像素坐标 + 当前玩家单位 `reachable` 屏幕坐标，供 e2e 点击）、`setAnimationSpeed(_ms: number): void`

- [ ] **Step 1: 完整实现**

`src/scenes/BattleScene.ts`：
```ts
import Phaser from 'phaser'
import { CommandLog } from '../core/events/CommandLog'
import { battleReducer, createInitialBattleState } from '../core/battle/battleReducer'
import { planEnemyAction } from '../core/battle/ai'
import { battleReachableArea } from '../core/battle/pathing'
import { occupiedHexes, type BattleState, type BattleUnit } from '../core/battle/types'
import { hexKey, HexLayout, type Axial } from '../core/hex/HexGrid'
import { UNIT_DEFS } from '../data/units'
import { BATTLE_GRID, ENEMY_ARMY, PLAYER_ARMY } from '../data/battleTest'
import { MainMenuScene } from './MainMenuScene'

const SIDE_COLORS = { player: 0x33aa44, enemy: 0xcc3333 } as const
const GRID_COLOR = 0x1a2333
const GRID_LINE = 0x0b0f18
const REACHABLE_FILL = 0x66ccff
const RANGE_STROKE = 0xffaa33

/**
 * 战斗场景（渲染层）。职责：读 BattleState 渲染 + 把点击/按钮转成 battle 命令。
 * 交互：
 * - 点击己方单位 → select（高亮）；点击可达空格 → move；点击射程内敌人 → attack
 * - 当前单位「跳过行动」；敌方单位由 planEnemyAction 自动行动
 * - 胜负 → 显示结果 + 返回主菜单
 */
export class BattleScene extends Phaser.Scene {
  static readonly KEY = 'Battle'

  private readonly layout = new HexLayout({ size: 30, origin: { x: 0, y: 0 } })
  private store!: CommandLog<BattleState>
  private gridGraphics!: Phaser.GameObjects.Graphics
  private overlayGraphics!: Phaser.GameObjects.Graphics
  private unitGraphics!: Phaser.GameObjects.Graphics
  private hpBarGraphics!: Phaser.GameObjects.Graphics
  private unitTexts = new Map<string, Phaser.GameObjects.Text>()
  private resultText!: Phaser.GameObjects.Text
  private returnButton!: Phaser.GameObjects.Text
  private logText!: Phaser.GameObjects.Text

  constructor() {
    super(BattleScene.KEY)
  }

  create(): void {
    this.store = new CommandLog<BattleState>(createInitialBattleState(), battleReducer)
    this.store.dispatch('battle/init', { player: PLAYER_ARMY, enemy: ENEMY_ARMY, grid: BATTLE_GRID })
    this.createLayers()
    // 相机居中到网格中心
    const g = this.state.grid
    const c = this.layout.hexToPixel({ q: g.cols / 2, r: g.rows / 2 })
    this.cameras.main.centerOn(c.x, c.y)
    this.setupInput()
    this.refreshViews()
  }

  private get state(): BattleState {
    return this.store.getState()
  }

  private createLayers(): void {
    this.gridGraphics = this.add.graphics().setDepth(0)
    this.unitGraphics = this.add.graphics().setDepth(2)
    this.overlayGraphics = this.add.graphics().setDepth(3)
    this.hpBarGraphics = this.add.graphics().setDepth(3)
    this.drawGrid()
    // 结果 + 返回主菜单（视口固定，scrollFactor 0）
    this.resultText = this.add
      .text(960, 520, '', { fontFamily: 'sans-serif', fontSize: '48px', color: '#ffffff' })
      .setOrigin(0.5)
      .setDepth(12)
      .setScrollFactor(0)
      .setVisible(false)
    this.returnButton = this.add
      .text(960, 580, '返回主菜单', { fontFamily: 'sans-serif', fontSize: '24px', color: '#ffffff', backgroundColor: '#33415c' })
      .setOrigin(0.5)
      .setDepth(12)
      .setScrollFactor(0)
      .setPadding(24, 12)
      .setVisible(false)
      .setInteractive({ useHandCursor: true })
    this.returnButton.on('pointerdown', () => this.scene.start(MainMenuScene.KEY))
    this.logText = this.add
      .text(24, 24, '', { fontFamily: 'sans-serif', fontSize: '16px', color: '#c8d2e0' })
      .setDepth(12)
      .setScrollFactor(0)
    this.makeCornerButton(1880, 1040, '跳过行动', () => this.endCurrentTurn())
    this.makeCornerButton(1880, 980, '撤退', () => this.surrender())
  }

  private drawGrid(): void {
    this.gridGraphics.clear()
    const { cols, rows } = this.state.grid
    for (let r = 0; r < rows; r++) {
      for (let q = 0; q < cols; q++) {
        const hex = { q, r }
        this.fillHex(this.gridGraphics, hex, GRID_COLOR, 1)
        this.strokeHex(this.gridGraphics, hex, GRID_LINE, 1)
      }
    }
  }

  /** 画单位（1×2 画两格）、数量文本、血条 */
  private drawUnits(): void {
    this.unitGraphics.clear()
    this.hpBarGraphics.clear()
    const seen = new Set<string>()
    for (const unit of this.state.units) {
      for (const hex of occupiedHexes(unit)) {
        this.fillHex(this.unitGraphics, hex, SIDE_COLORS[unit.side], 0.85)
      }
      // 血条 + 文本：跨两格时取两格中心
      const c1 = this.layout.hexToPixel(unit.position)
      const c2 = unit.size === 2 ? this.layout.hexToPixel(occupiedHexes(unit)[1] as Axial) : c1
      const cx = (c1.x + c2.x) / 2
      const ratio = unit.hpLeft / unit.maxHp
      const w = unit.size === 2 ? 90 : 46
      this.hpBarGraphics.fillStyle(0x000000, 0.6)
      this.hpBarGraphics.fillRect(cx - w / 2, c1.y - 34, w, 6)
      this.hpBarGraphics.fillStyle(ratio > 0.3 ? 0x33dd55 : 0xdd3333, 1)
      this.hpBarGraphics.fillRect(cx - w / 2 + 1, c1.y - 33, Math.max(0, (w - 2) * ratio), 4)
      let t = this.unitTexts.get(unit.id)
      if (!t) {
        t = this.add
          .text(cx, c1.y, '', { fontFamily: 'sans-serif', fontSize: '18px', color: '#ffffff' })
          .setOrigin(0.5)
          .setDepth(4)
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

  /** 当前玩家单位：可达格高亮 + 射程内敌人描边 + 选中高亮 */
  private drawOverlay(): void {
    this.overlayGraphics.clear()
    const state = this.state
    const current = state.units.find((u) => u.id === state.currentUnitId)
    if (!current || state.phase !== 'combat') return
    if (current.side === 'player') {
      for (const hex of battleReachableArea(current, state)) {
        this.fillHex(this.overlayGraphics, hex, REACHABLE_FILL, 0.18)
      }
      const range = UNIT_DEFS[current.defId].range
      for (const foe of state.units.filter((u) => u.side !== current.side)) {
        const inRange = occupiedHexes(foe).some((h) => this.hexDist(current.position, h) <= range)
        if (!inRange) continue
        for (const hex of occupiedHexes(foe)) this.strokeHex(this.overlayGraphics, hex, RANGE_STROKE, 3)
      }
    }
    if (state.selectedUnitId) {
      const sel = state.units.find((u) => u.id === state.selectedUnitId)
      if (sel) for (const hex of occupiedHexes(sel)) this.strokeHex(this.overlayGraphics, hex, 0xffffff, 2)
    }
  }

  private updateLogAndResult(): void {
    this.logText.setText(this.state.log.slice(-4).join('\n'))
    const terminal = this.state.phase !== 'combat'
    this.resultText.setVisible(terminal)
    this.returnButton.setVisible(terminal)
    if (terminal) this.resultText.setText(this.state.phase === 'won' ? '胜利！' : '战败…')
  }

  private refreshViews(): void {
    this.drawUnits()
    this.drawOverlay()
    this.updateLogAndResult()
    this.stepEnemyAi()
  }

  /**
   * 若当前是敌方单位，自动行动直到轮到我方或战斗结束。
   * 防御：行动若无效（如移动被拒）则强制 endTurn，杜绝死循环。
   */
  private stepEnemyAi(): void {
    let guard = 0
    while (this.state.phase === 'combat' && this.currentSide() === 'enemy' && guard++ < 50) {
      const action = planEnemyAction(this.state)
      const curId = this.state.currentUnitId as string
      const before = this.state.units.find((u) => u.id === curId) as BattleUnit
      if (action.type === 'move') {
        this.store.dispatch('battle/move', { unitId: curId, to: action.to })
        const moved = this.state.units.find((u) => u.id === curId) as BattleUnit
        // 移动成功则保持当前单位（可继续攻击）；失败则强制结束回合
        if (hexKey(moved.position) === hexKey(before.position)) {
          this.store.dispatch('battle/endTurn', { unitId: curId })
        }
      } else {
        this.store.dispatch(action.type === 'attack' ? 'battle/attack' : 'battle/endTurn', {
          unitId: curId,
          ...(action.type === 'attack' ? { targetId: action.targetId } : {})
        })
        // 成功的攻击/endTurn 必然 advance（currentUnitId 变化）；未变化说明被拒 → 强制结束
        if (this.state.phase === 'combat' && this.state.currentUnitId === curId) {
          this.store.dispatch('battle/endTurn', { unitId: curId })
        }
      }
    }
    this.drawUnits()
    this.drawOverlay()
    this.updateLogAndResult()
  }

  private currentSide(): BattleUnit['side'] | null {
    return this.state.units.find((x) => x.id === this.state.currentUnitId)?.side ?? null
  }

  private endCurrentTurn(): void {
    if (this.state.phase !== 'combat' || this.currentSide() !== 'player') return
    this.store.dispatch('battle/endTurn', { unitId: this.state.currentUnitId as string })
    this.refreshViews()
  }

  private surrender(): void {
    this.store.dispatch('battle/surrender')
    this.refreshViews()
  }

  // ---------- 输入 ----------

  private setupInput(): void {
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => {
      if (this.state.phase !== 'combat' || this.currentSide() !== 'player') return
      this.handleClick(this.layout.pixelToHex(p.worldX, p.worldY))
    })
  }

  private handleClick(hex: Axial): void {
    const state = this.state
    const current = state.units.find((u) => u.id === state.currentUnitId)
    if (!current) return
    const unitAt = state.units.find((u) => occupiedHexes(u).some((h) => hexKey(h) === hexKey(hex)))
    // 点敌方单位且射程内 → 攻击
    if (unitAt && unitAt.side !== current.side) {
      const range = UNIT_DEFS[current.defId].range
      const inRange = occupiedHexes(unitAt).some((h) => this.hexDist(current.position, h) <= range)
      if (inRange) {
        this.store.dispatch('battle/attack', { unitId: current.id, targetId: unitAt.id })
        this.refreshViews()
        return
      }
    }
    // 点己方单位 → 选中
    if (unitAt && unitAt.side === 'player') {
      this.store.dispatch('battle/select', { unitId: unitAt.id })
      this.refreshViews()
      return
    }
    // 点可达空格 → 移动
    if (battleReachableArea(current, state).some((h) => hexKey(h) === hexKey(hex))) {
      this.store.dispatch('battle/move', { unitId: current.id, to: hex })
      this.refreshViews()
    }
  }

  // ---------- helpers ----------

  private hexDist(a: Axial, b: Axial): number {
    return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.q + a.r - b.q - b.r))
  }

  private fillHex(g: Phaser.GameObjects.Graphics, hex: Axial, color: number, alpha: number): void {
    const pts: Phaser.Math.Vector2[] = []
    for (let i = 0; i < 6; i++) {
      const p = this.layout.cornerAt(hex, i)
      pts.push(new Phaser.Math.Vector2(p.x, p.y))
    }
    g.fillStyle(color, alpha)
    g.fillPoints(pts, true)
  }

  private strokeHex(g: Phaser.GameObjects.Graphics, hex: Axial, color: number, width: number): void {
    const pts: Phaser.Math.Vector2[] = []
    for (let i = 0; i < 6; i++) {
      const p = this.layout.cornerAt(hex, i)
      pts.push(new Phaser.Math.Vector2(p.x, p.y))
    }
    g.lineStyle(width, color, 1)
    g.strokePoints(pts, true)
  }

  private makeCornerButton(x: number, y: number, label: string, onClick: () => void): void {
    const btn = this.add
      .text(x, y, label, { fontFamily: 'sans-serif', fontSize: '20px', color: '#ffffff', backgroundColor: '#33415c' })
      .setOrigin(1, 0.5)
      .setDepth(12)
      .setScrollFactor(0)
      .setPadding(14, 8)
      .setInteractive({ useHandCursor: true })
    btn.on('pointerdown', onClick)
  }

  /** 战斗移动为瞬移；兼容 dev 桥（e2e 用） */
  setAnimationSpeed(_ms: number): void {}

  // ---------- dev / e2e ----------

  getDebugState(): Record<string, unknown> {
    if (!this.store) return { ready: false }
    const state = this.state
    const cam = this.cameras.main
    const screen = (h: Axial): { x: number; y: number } => {
      const p = this.layout.hexToPixel(h)
      return { x: p.x - cam.scrollX, y: p.y - cam.scrollY }
    }
    const current = state.units.find((u) => u.id === state.currentUnitId)
    const reachable =
      current && state.phase === 'combat'
        ? battleReachableArea(current, state).map((h) => ({ q: h.q, r: h.r, screen: screen(h) }))
        : []
    return {
      ready: true,
      scene: 'battle',
      phase: state.phase,
      turn: state.turn,
      currentUnitId: state.currentUnitId,
      selectedUnitId: state.selectedUnitId,
      grid: state.grid,
      order: state.order,
      log: state.log,
      reachable,
      units: state.units.map((u) => ({
        id: u.id,
        side: u.side,
        defId: u.defId,
        count: u.count,
        position: u.position,
        size: u.size,
        hpLeft: u.hpLeft,
        maxHp: u.maxHp,
        hasActed: u.hasActed,
        hasMoved: u.hasMoved,
        screen: screen(u.position)
      }))
    }
  }
}
```

- [ ] **Step 2: 验证编译**

Run: `pnpm typecheck`
Expected: 零 error

- [ ] **Step 3: Commit**

```bash
git add src/scenes/BattleScene.ts
git commit -m "feat(battle): 战斗场景渲染（网格/单位/血条/交互/AI 驱动）"
```

---

### Task 11: dev 桥扩展 `src/dev/debug.ts`

**Files:**
- Modify: `src/dev/debug.ts`

**Interfaces:**
- Consumes: `AdventureScene`、`BattleScene`（均须有 `getDebugState()`；BattleScene 已有 `setAnimationSpeed`）
- Produces: `getState()` 返回「当前激活场景」状态（战斗激活返回战斗状态，否则大地图；主菜单 → `{ ready: false }`）；`setAnimationSpeed(ms)` 对两场景都生效。

- [ ] **Step 1: 修改调试桥**

`src/dev/debug.ts`（整文件）：
```ts
import type Phaser from 'phaser'
import type { AdventureScene } from '../scenes/AdventureScene'
import type { BattleScene } from '../scenes/BattleScene'

/**
 * 开发调试桥（dev-only）。生产构建应剔除。
 * 通过 window.__game 暴露真实游戏状态与受控操作，
 * 供 e2e / 人工调试断言状态（而非仅看像素）。
 */
export interface DebugBridge {
  getState(): Record<string, unknown>
  setSeed(seed: number): void
  /** 逐格移动动画耗时；0 = 瞬间完成（e2e 用） */
  setAnimationSpeed(ms: number): void
  /** 等待移动动画结束 */
  waitForMove(): Promise<void>
  /** 设置 BGM 音量（0~1）；未来"设置"界面接线点 */
  setBgmVolume(volume: number): void
  /** 设置音效音量（0~1）；未来"设置"界面接线点 */
  setSfxVolume(volume: number): void
}

declare global {
  interface Window {
    __game?: DebugBridge
  }
}

export function installDevBridge(game: Phaser.Game): DebugBridge {
  const adventure = () => game.scene.getScene('Adventure') as AdventureScene | null
  const battle = () => game.scene.getScene('Battle') as BattleScene | null

  /** 战斗激活返回战斗；否则大地图；主菜单/未就绪返回 null */
  const getActive = (): { getDebugState(): Record<string, unknown> } | null => {
    if (battle()?.scene.isActive()) return battle()
    if (adventure()?.scene.isActive()) return adventure()
    return null
  }

  const bridge: DebugBridge = {
    getState() {
      return getActive()?.getDebugState() ?? { ready: false }
    },
    setSeed(seed) {
      adventure()?.setSeed(seed)
    },
    setAnimationSpeed(ms) {
      adventure()?.setAnimationSpeed(ms)
      battle()?.setAnimationSpeed(ms)
    },
    async waitForMove() {
      await adventure()?.waitForMove()
    },
    setBgmVolume(volume) {
      adventure()?.setBgmVolume(volume)
    },
    setSfxVolume(volume) {
      adventure()?.setSfxVolume(volume)
    }
  }
  window.__game = bridge
  return bridge
}
```

- [ ] **Step 2: 验证编译**

Run: `pnpm typecheck`
Expected: 零 error（`battle()?.scene.isActive()` 为 Phaser `ScenePlugin.isActive()`；BattleScene 已有 `setAnimationSpeed`）

- [ ] **Step 3: Commit**

```bash
git add src/dev/debug.ts
git commit -m "feat(battle): dev 桥按激活场景返回战斗/大地图状态"
```

---

### Task 12: 新 battle e2e `src/e2e/battle.spec.ts`

**Files:**
- Create: `src/e2e/battle.spec.ts`

**Interfaces:**
- Consumes: `window.__game.getState()`（Task 11 已扩展）
- 说明：Phaser 渲染到 canvas 无 DOM 文本，按钮用**固定视口坐标点击**（1920×1080 设计基准）；单位/可达格用 `getDebugState()` 暴露的 `screen` 坐标点击。

- [ ] **Step 1: 写 e2e**

`src/e2e/battle.spec.ts`：
```ts
import { expect, test, type Page } from '@playwright/test'

/**
 * 主菜单 + 战斗系统 e2e：主菜单两入口、战斗内 选中→移动、跳过回合→AI 行动→胜负→返回主菜单。
 * 模型无多模态：断言一律程序化（window.__game.getState()）；截图仅供人工目检。
 * 点击约定（1920×1080 设计基准）：主菜单 开始游戏(960,594) / 战斗测试(960,734)；
 * 战斗「跳过行动」(1880,1040)、结果「返回主菜单」(960,580)。
 */
const MENU_START = { x: 960, y: 594 }
const MENU_BATTLE = { x: 960, y: 734 }
const SKIP = { x: 1880, y: 1040 }
const RETURN = { x: 960, y: 580 }

interface BattleUnitState {
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
  screen: { x: number; y: number }
}
interface DebugGameState {
  ready?: boolean
  scene?: string
  phase?: string
  turn?: number
  currentUnitId?: string | null
  selectedUnitId?: string | null
  units?: BattleUnitState[]
  reachable?: { q: number; r: number; screen: { x: number; y: number } }[]
}

const getState = (page: Page): Promise<DebugGameState> =>
  page.evaluate(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState() ?? {})

const waitBattleReady = (page: Page) =>
  page.waitForFunction(() => {
    const s = (window as { __game?: { getState(): DebugGameState } }).__game?.getState()
    return s?.ready === true && s?.scene === 'battle' && s?.phase === 'combat'
  })

const waitAdventureReady = (page: Page) =>
  page.waitForFunction(() => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.ready === true)

const clickUnit = async (page: Page, unitId: string) => {
  const u = (await getState(page)).units?.find((x) => x.id === unitId)
  expect(u).toBeDefined()
  await page.mouse.click(u!.screen.x, u!.screen.y)
}

test('主菜单 → 开始游戏 → 进入大地图', async ({ page }) => {
  await page.goto('/')
  await page.mouse.click(MENU_START.x, MENU_START.y)
  await waitAdventureReady(page)
  const s = await getState(page)
  expect(s.turn).toBe(1)
  expect(s.scene).not.toBe('battle')
  await page.screenshot({ path: 'screenshots/battle-menu-start-adventure.png' })
})

test('主菜单 → 战斗测试 → 进入战斗（7 单位、含 1×2 骑兵）', async ({ page }) => {
  await page.goto('/')
  await page.mouse.click(MENU_BATTLE.x, MENU_BATTLE.y)
  await waitBattleReady(page)
  const s = await getState(page)
  expect(s.units).toHaveLength(7) // 玩家4 + 敌方3
  expect(s.units?.filter((u) => u.side === 'player')).toHaveLength(4)
  expect(s.units?.find((u) => u.defId === 'cavalry')?.size).toBe(2) // 1×2 支持
  await page.screenshot({ path: 'screenshots/battle-field.png' })
})

test('战斗内：选中 → 移动；跳过全回合 → AI 行动 → 战败 → 返回主菜单', async ({ page }) => {
  await page.goto('/')
  await page.mouse.click(MENU_BATTLE.x, MENU_BATTLE.y)
  await waitBattleReady(page)

  // ① 选中当前单位（玩家骑兵 speed9 最先动）
  const curId = (await getState(page)).currentUnitId!
  await clickUnit(page, curId)
  expect((await getState(page)).selectedUnitId).toBe(curId)

  // ② 点击一个可达非自身格 → 移动
  const s = await getState(page)
  const cur = s.units!.find((u) => u.id === curId)!
  const target = s.reachable!.find((h) => !(h.q === cur.position.q && h.r === cur.position.r))!
  await page.mouse.click(target.screen.x, target.screen.y)
  const moved = (await getState(page)).units!.find((u) => u.id === curId)!
  expect(moved.position).toEqual({ q: target.q, r: target.r })

  // ③ 反复「跳过行动」直到战斗结束（敌方 AI 自动行动、玩家全跳过 → 战败）
  let guard = 0
  let s2: DebugGameState = await getState(page)
  while (s2.phase === 'combat' && guard++ < 120) {
    await page.mouse.click(SKIP.x, SKIP.y)
    s2 = await getState(page)
  }
  expect(s2.phase).toBe('lost')
  await page.screenshot({ path: 'screenshots/battle-result-lost.png' })

  // ④ 点「返回主菜单」→ 回主菜单（无激活场景 → ready=false）
  await page.mouse.click(RETURN.x, RETURN.y)
  await page.waitForFunction(
    () => (window as { __game?: { getState(): DebugGameState } }).__game?.getState()?.ready === false
  )
})
```

- [ ] **Step 2: 跑 battle e2e**

Run: `pnpm test:e2e -- src/e2e/battle.spec.ts`
Expected: 3 个测试 PASS

- [ ] **Step 3: Commit**

```bash
git add src/e2e/battle.spec.ts
git commit -m "test(e2e): 主菜单 + 战斗闭环回归"
```

---

### Task 13: 存量 e2e 适配主菜单

**背景**：启动改为主菜单后，存量 spec（scaffold / movement / bgm / sfx / resources）都是 `page.goto('/')` 后直接等大地图就绪，会卡死。统一改为：新增共享 helper，先进主菜单点「开始游戏」再等大地图。

**Files:**
- Create: `src/e2e/helpers.ts`
- Modify: `src/e2e/scaffold.spec.ts`、`src/e2e/movement.spec.ts`、`src/e2e/bgm.spec.ts`、`src/e2e/sfx.spec.ts`、`src/e2e/resources.spec.ts`

- [ ] **Step 1: 创建共享 helper**

`src/e2e/helpers.ts`：
```ts
import type { Page } from '@playwright/test'

/** 主菜单按钮中心（1920×1080 设计基准） */
export const MENU_START = { x: 960, y: 594 }
export const MENU_BATTLE = { x: 960, y: 734 }

/** 从主菜单进入大地图并等待就绪（原各 spec 直接 goto 后即见大地图，现需点按钮） */
export async function gotoAdventure(page: Page): Promise<void> {
  await page.goto('/')
  await page.mouse.click(MENU_START.x, MENU_START.y)
  await page.waitForFunction(() => {
    const g = (window as { __game?: { getState(): { ready?: boolean } } }).__game
    return g?.getState()?.ready === true
  })
}
```

- [ ] **Step 2: 逐 spec 替换引导序列 + 删除不再用的本地 helper**

各 spec 顶部加 `import { gotoAdventure } from './helpers'`。

| spec | 原引导 | 改为 | 删除的本地 helper |
|---|---|---|---|
| `scaffold.spec.ts` | `await page.goto('/')`（L22） | `await gotoAdventure(page)` | 无 |
| `movement.spec.ts` | 3 处 `await page.goto('/')` + `await waitReady(page)` | `await gotoAdventure(page)` | `waitReady` |
| `bgm.spec.ts` | `await page.goto('/')` + `await waitGameReady(page)` | `await gotoAdventure(page)` | `waitGameReady` |
| `sfx.spec.ts` | `await page.goto('/')` + `await waitGameReady(page)` | `await gotoAdventure(page)` | `waitGameReady` |
| `resources.spec.ts` | 5 处 `await page.goto('/')` + `await waitReady(page)` | `await gotoAdventure(page)` | `waitReady` |

注意：
- `scaffold.spec.ts` 里原来等待 `hexesRendered > 0` 的 `waitForFunction` 保留（gotoAdventure 已等 ready，随即满足）。
- `bgm.spec.ts` / `sfx.spec.ts` 里「点击视口中心 (960,540) 解锁音频」的 `page.mouse.click(1920 / 2, 1080 / 2)` 保留——已在战斗/大地图场景内，不会误触主菜单按钮。
- 删除 helper 后若仍被引用会编译报错（noUnusedLocals）；确认全部替换后再删。

- [ ] **Step 3: 全量 e2e 回归**

Run: `pnpm test:e2e`
Expected: 全部 PASS（scaffold + movement + bgm + sfx + resources + battle 共 6 spec）

- [ ] **Step 4: Commit**

```bash
git add src/e2e/helpers.ts src/e2e/scaffold.spec.ts src/e2e/movement.spec.ts src/e2e/bgm.spec.ts src/e2e/sfx.spec.ts src/e2e/resources.spec.ts
git commit -m "test(e2e): 存量 spec 适配主菜单入口"
```

---

### Task 14: PRD 同步 + 全量回归 + 收尾

**Files:**
- Modify: `PRD.md`（§15 主菜单/战斗 MVP 完成；§16 注明 MVP 未含项）

- [ ] **Step 1: 同步 PRD**

在 `PRD.md` §15 新增「主菜单」与「战斗（MVP）」小节：
```markdown
### 主菜单
- [x] 主菜单（开始游戏 → 大地图；战斗测试 → 固定部队 PVE 战斗，2026-08 完成）

### 战斗（MVP）
- [x] 六角格战场（13×9 全平地）+ 双方固定部队 stack（战斗测试入口）
- [x] 按速度回合制（speed 降序，同速稳定排序）
- [x] 点选移动（每回合最多一次，移动后可攻击）+ 攻击（近战相邻 / 远程按射程）
- [x] 伤害公式（HOMM3 式攻防修正，ATK_DEF_MODIFIER=0.05 可调）
- [x] 1×2 大型单位（骑兵）支持：占主体+东邻两格、双格寻路、命中任一占据格
- [x] 血条 + 数量显示
- [x] 简易 PVE AI（攻击范围内敌人/逼近/跳过）
- [x] 胜负判定 + 返回主菜单
```
在 §16 注明：
```markdown
- [ ] 战斗增强：反击（半伤）、等待/防御（受击-50%）、士气/幸运、英雄施法、随机伤害、经验/战利品（MVP 已含：战场/移动攻击/伤害/血条/简易 AI；以上为后续增量）
```

- [ ] **Step 2: 全量回归**

Run: `pnpm test`
Expected: 全部 PASS（含 battle core 单测）

Run: `pnpm test:e2e`
Expected: 全部 PASS（6 spec）

Run: `pnpm typecheck`
Expected: 零 error

- [ ] **Step 3: 更新截图到主仓库（人工目检用）**

复制 `screenshots/*.png`（含 `battle-*.png`）到主仓库 `F:\work\three-kingdoms-tactics\screenshots\`（截图已被 gitignore，不进提交）。

- [ ] **Step 4: Commit**

```bash
git add PRD.md
git commit -m "docs: 战斗 MVP 完成 + PRD §15/§16 同步"
```

---

### Task 15: AOC 控制区域（大地图 + 战斗，参考三国志11）【后续增量】

> 新需求（用户 2026-08-11 提出，先记入 todo 与 PRD §16，本计划正文任务完成后实施）。

**背景：** 单位/武将一旦靠近敌方单位（进入敌方**控制区域** AOC），便不能再远离移动——不能"穿过"或"擦肩而过"敌方 AOC；一旦相邻只能停止或攻击邻近单位。**例外：** 具「陷阵」技能的单位无视 AOC（但仍不能穿过敌方单位本体）。范围：**大地图英雄移动 + 战斗战场**共用同一规则。

**Files:**
- Create: `src/core/battle/aoc.ts`（AOC 判定纯函数）
- Modify: `src/core/battle/pathing.ts`（battleReachableArea/battleFindPath 纳入 AOC）、`src/core/battle/battleReducer.ts`（move 校验）、`src/core/battle/types.ts`（BattleUnit 增 `canIgnoreAoc: boolean`）、`src/data/units.ts`（兵种技能标记）
- 大地图：英雄移动 pathing 复用同一 AOC 判定（`src/core/` 现有 hero MovementCost 接入）
- Test: `src/core/battle/aoc.test.ts`

**Design（确定性纯函数，TDD）：**
- AOC 定义：hex ∈ 敌方控制区 ⇔ ∃ 敌方单位 u，`hexDistance(hex, occupiedHexes(u) 任一) === 1`。
- 规则：
  1. 当前单位已处于敌方 AOC 且无陷阵 → 可达集 = `[当前位置]`（不能移动；仍可攻击邻近敌人）。
  2. 否则可达集 = 非 AOC 可达格 ∪ 与 AOC 相邻的边界格（进入 AOC 即结束移动）；**路径不得经过 AOC 格**（AOC 格只能作为终点进入）。
  3. 陷阵（`canIgnoreAoc`）→ 走普通移动规则，但仍不能进入敌方单位本体格（障碍不变）。
- 实现：在 battle 层组合现有 `reachableArea`——AOC 格视为不可通行求 `R_clear`，再并上 `R_clear` 中与 AOC 相邻的边界格；不改动 `Pathfinding` 本体（或按需给 `reachableArea` 加可选 `isTerminal` 参数）。
- 大地图英雄移动复用之（英雄同样带 `canIgnoreAoc` 技能标志）。

**TDD 测试：** ① 与敌相邻后不能再移动（可达集仅自身）；② 路径不得穿过 AOC（擦肩而过被禁）；③ 可移动到 AOC 边界格并停住（进入即停）；④ 陷阵单位无视 AOC 正常移动；⑤ 陷阵仍不能穿过敌方单位本体。

---

## Self-Review 记录

- **Spec 覆盖**：主菜单（Task 9）✓；战斗核心（Task 2-7）✓；伤害公式（Task 3）✓；1×2 支持（Task 2 types + Task 4 寻路 + Task 6 攻击 + Task 10 渲染）✓；血条/数量（Task 10）✓；简易 AI（Task 7 + Task 10 驱动）✓；胜负返回（Task 5/6 phase + Task 10 结果按钮 + Task 12 e2e）✓；调试桥（Task 11）✓；存量 e2e 适配（Task 13，spec §13 隐含回归）✓；PRD 同步（Task 14）✓。
- **类型一致性**：`BattleUnit` 字段 `id/side/defId/count/position/size/hpLeft/maxHp/hasActed/hasMoved` 在 types/寻路/reducer/AI/渲染/e2e 中一致；`occupiedHexes` 统一入口；`computeDamage(attacker,target,atkBonus,defBonus)` 签名一致；`ATK_DEF_MODIFIER`/`ATK_DEF_CAP` 常量名一致；命令 payload 字段名 `unitId/targetId/to` 在 reducer/场景/e2e 中一致；`HexLayout` 与 `hexKey`/`hexDistance`/`cornerAt` 均从 `../core/hex/HexGrid` 导入（已核对源码：`HexLayout` 类在该文件，含 `hexToPixel`/`pixelToHex`/`cornerAt`；`Pathfinding` 导出 `reachableArea(start, movement, costs)` 与 `findPath(start, goal, costs)`，与实现一致）。
- **占位扫描**：无 TBD/TODO；每个代码步骤含完整可粘贴代码。
- **已修正的草稿缺陷**：① Task 2 首版误写带 `.sort()` 的错误测试——已删；② Task 3 伤害测试曾把 atkBonus/defBonus 传成 `34-4,34-4`（攻防差 0，测试会挂）——改为 `30,27`；③ Task 5 `makeStore` 曾漏传 `grid`——已补 `TEST_GRID`；④ Task 6 移动测试曾断言骑兵在 `(0,3)`——实际 `init` 按 `r=i` 布置，骑兵在 `(0,1)`，已改；⑤ Task 6 攻击测试曾用 13 列图（敌方射程外）且 archer vs archer 同速会触发 id 平局（`e0` 先动导致 no-op）——改用 4×3 小图 + militia 目标（speed 4 < 5），并新增「灭队判胜」用例；⑥ Task 10 曾 import 未用的 `hexNeighbor/HexDir`——已删；⑦ AI 死循环风险——`planEnemyAction` 排除自身格 + `stepEnemyAi` 对无效行动强制 endTurn；⑧ 启动即主菜单会卡死存量 e2e——新增 Task 13 适配；⑨ Task 4 可达格测试把起点放角点 (0,0)（20×20 裁剪后仅 15 格 ≠ 61）——起点改网格中心 (10,10)；⑩ Task 5 reducer import 的 `type Side` 无人引用（tsconfig `noUnusedLocals` 开启，Task 8 typecheck 必挂）——已移除。
