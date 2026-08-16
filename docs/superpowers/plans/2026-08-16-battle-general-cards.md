# 战斗数值展示：单兵血量 + 左右武将卡 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 战斗场景 hover 面板补「单兵血量」一行；左右边缘显示攻方/守方武将卡（六维 + 当前蓝量/总蓝量 + 当前有效的被动技能）。

**Architecture:** 三层数据流——`src/data/generals.ts` 存武将**基础配置**（基础六维 + 每级成长 + 预设被动）；`core/generals.ts` 的 `deriveStats(base, level)` 推导**当前属性值**（`General.stats`，动态层）；战斗 `BattleState.general` 只携带当前值（六维 + 蓝量 + 被动），渲染层 `src/ui/GeneralCard.ts` 纯读展示。`BattleArmyConfig` 的 `general` 为**可选**字段，缺省时从旧 `generalName/atkBonus/defBonus` 反推展示值 → 现有 ~40 处测试/e2e 阵容构造无需改动。

**Tech Stack:** TypeScript (strict) / Phaser 4（仅渲染层）/ Vitest（core 单测）/ Playwright（e2e）/ pnpm

## Global Constraints

- **核心/渲染分离**：`src/core/` 零 Phaser/DOM/浏览器依赖；渲染层可 import core，core 禁 import 渲染层。
- **确定性**：core 禁裸 `Math.random()` / `Date.now()`（本计划无随机，全用 `Math.round` 等纯函数）。
- **新 core 逻辑必须配 Vitest 单测**（源码同目录 `*.test.ts`）。
- 用 **pnpm**（禁 npm）。
- 中文注释、中文命名；标识符用英文。
- **typecheck 时机**：每轮改动后跑 `pnpm test`（core 单测，快）；**`pnpm typecheck` 仅在 git commit 前跑一次**（费时）。
- 提交信息中文、清晰描述改动，结尾带 `Co-Authored-By: Claude <noreply@anthropic.com>`。
- **PRD 同步（最后任务）**：PRD.md §15 完成项勾 `[x]` 并写明差距，不允许文档与代码脱节。
- 视觉走 `src/ui/theme.ts` 调色板 token；颜色数值从 `theme.ts` 常量取，不硬编码。

---

### Task 1: 基础配置表 + 当前属性值推导层

**Files:**
- Create: `src/data/generals.ts`
- Create: `src/core/generals.ts`
- Create: `src/core/generals.test.ts`
- Modify: `src/core/state/GameState.ts`（新增 `GeneralStats`，扩展 `General` 加 `stats` + `passives`）
- Modify: `src/data/bootstrap.ts`（START_GENERALS 改用 GENERAL_BASES + deriveStats）

**Interfaces:**
- Consumes: 无（地基）
- Produces:
  - `GeneralStats`（`src/core/state/GameState.ts`）：`{ atk; def; int; pol; cha }`，全部 number
  - `General` 扩展字段：`stats: GeneralStats`、`passives: { name: string; level: number }[]`
  - `GeneralBase`（`src/data/generals.ts`）：`{ id; name; faction: FactionId; type: '战将'|'智将'|'全能'; baseAtk; baseDef; baseInt; basePol; baseCha; growthPerLevel: { atk; def; int; pol; cha }; passives: { name; level }[] }`
  - `GENERAL_BASES: Record<'g-guan' | 'g-lvbu', GeneralBase>`
  - `deriveStats(base: GeneralBase, level: number): GeneralStats`（`src/core/generals.ts`）

- [ ] **Step 1: 写失败的 deriveStats 测试**

创建 `src/core/generals.test.ts`：

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test`
Expected: FAIL —— `src/core/generals.ts` / `src/data/generals.ts` 不存在，模块解析报错。

- [ ] **Step 3: 实现基础配置表**

创建 `src/data/generals.ts`：

```ts
/**
 * 武将基础配置（纯数据，无逻辑）。
 * 「当前属性值」由 core/generals.ts 的 deriveStats 推导，本表只存静态基础值。
 * 六维数值为占位平衡值；吕布不在开局武将池，仅 battleTest 用。
 */
import type { FactionId } from '../core/state/GameState'

export interface GeneralBase {
  id: string
  name: string
  faction: FactionId
  type: '战将' | '智将' | '全能'
  /** 基础六维（Lv1 基准） */
  baseAtk: number   // 武力
  baseDef: number   // 统御
  baseInt: number   // 智力
  basePol: number   // 政治
  baseCha: number   // 魅力
  /** 每级成长（占位值；PRD §5.2 未给数值，动态成长接缝） */
  growthPerLevel: { atk: number; def: number; int: number; pol: number; cha: number }
  /** 预设被动技能（展示用；效果待技能系统） */
  passives: { name: string; level: number }[]
}

export const GENERAL_BASES: Record<'g-guan' | 'g-lvbu', GeneralBase> = {
  'g-guan': {
    id: 'g-guan', name: '关羽', faction: 'shu', type: '全能',
    baseAtk: 90, baseDef: 70, baseInt: 50, basePol: 60, baseCha: 80,
    growthPerLevel: { atk: 3, def: 2, int: 2, pol: 1, cha: 2 },
    passives: [{ name: '铁壁', level: 1 }]
  },
  'g-lvbu': {
    id: 'g-lvbu', name: '吕布', faction: 'qun', type: '战将',
    baseAtk: 100, baseDef: 80, baseInt: 30, basePol: 20, baseCha: 40,
    growthPerLevel: { atk: 4, def: 2, int: 1, pol: 1, cha: 1 },
    passives: [{ name: '狂暴', level: 1 }]
  }
}
```

- [ ] **Step 4: 实现 deriveStats**

创建 `src/core/generals.ts`：

```ts
/**
 * 当前属性值推导（core 逻辑，纯函数）。
 * 当前 = 基础 + (level-1)×每级成长（占位线性；装备/技能加成将来叠加）。Lv1 = 基础值。
 * 这是升级系统（PRD §16）的接缝：将来升级/装备/技能在此叠加。
 */
import type { GeneralBase } from '../data/generals'
import type { GeneralStats } from './state/GameState'

export function deriveStats(base: GeneralBase, level: number): GeneralStats {
  const g = Math.max(0, level - 1)
  return {
    atk: base.baseAtk + g * base.growthPerLevel.atk,
    def: base.baseDef + g * base.growthPerLevel.def,
    int: base.baseInt + g * base.growthPerLevel.int,
    pol: base.basePol + g * base.growthPerLevel.pol,
    cha: base.baseCha + g * base.growthPerLevel.cha
  }
}
```

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm test`
Expected: generals.test.ts 3 个用例 PASS。

- [ ] **Step 6: 扩展 General 类型 + 更新 bootstrap**

修改 `src/core/state/GameState.ts`：在 `export interface General {`（当前第 30 行附近）之前插入：

```ts
/** 当前属性值（动态层：基础 + 成长 + 装备/技能加成；随升级变化） */
export interface GeneralStats {
  atk: number   // 武力
  def: number   // 统御
  int: number   // 智力
  pol: number   // 政治
  cha: number   // 魅力
}
```

并把 `General` 接口改为：

```ts
export interface General {
  id: string
  name: string
  faction: FactionId
  /** 战将 / 智将 / 全能，决定升级属性与技能池 */
  type: '战将' | '智将' | '全能'
  level: number
  xp: number
  /** 当前六维（战斗展示/攻防/蓝量都读这里，不读基础配置） */
  stats: GeneralStats
  /** 已生效被动技能（展示） */
  passives: { name: string; level: number }[]
}
```

修改 `src/data/bootstrap.ts`：顶部 import 追加 `import { deriveStats } from '../core/generals'` 与 `import { GENERAL_BASES } from './generals'`；把 `START_GENERALS` 改为：

```ts
/** 初始武将池（P0：先放主角关羽；六维/被动来自基础配置） */
const GUAN = GENERAL_BASES['g-guan']
export const START_GENERALS: readonly General[] = [
  {
    id: GUAN.id,
    name: GUAN.name,
    faction: GUAN.faction,
    type: GUAN.type,
    level: 1,
    xp: 0,
    stats: deriveStats(GUAN, 1),
    passives: GUAN.passives
  }
]
```

- [ ] **Step 7: 全量 core 测试 + typecheck + commit**

Run: `pnpm test`（确保 GameState.test.ts / setup 派生测试仍绿）
Run: `pnpm typecheck`（仅此处跑一次）

```bash
git add src/data/generals.ts src/core/generals.ts src/core/generals.test.ts src/core/state/GameState.ts src/data/bootstrap.ts
git commit -m "feat: 武将基础配置表 + deriveStats 当前属性值层（General 补六维/被动）"
```

**自检**：确认没有别的文件手写 `General` 字面量（`grep -rn 'xp:' src --include=*.ts` 应只剩 GameState.ts 定义与 bootstrap 的赋值）。

---

### Task 2: 战斗数据层——general 携带当前属性

**Files:**
- Modify: `src/core/battle/types.ts`
- Modify: `src/core/battle/battleReducer.ts`
- Modify: `src/data/battleTest.ts`
- Test: `src/core/battle/battleReducer.test.ts`

**Interfaces:**
- Consumes: `GeneralStats`（Task 1）、`deriveStats`（Task 1）、`GENERAL_BASES`（Task 1）
- Produces:
  - `BattleGeneralConfig`（`src/core/battle/types.ts`）：`{ name; level; stats: GeneralStats; passives: { name; level }[] }`
  - `BattleGeneral`（`src/core/battle/types.ts`）：`{ name; atkBonus; defBonus; stats: GeneralStats; level; maxMana; currentMana; passives }`
  - `BattleArmyConfig.general?: BattleGeneralConfig`（新增可选；`generalName/atkBonus/defBonus` 变可选）
  - `BattleState.general: Record<Side, BattleGeneral>`
  - `battleReducer` 新增常量 `MANA_COEF = 1` 与内部函数 `buildGeneral(cfg)`（不导出）

- [ ] **Step 1: 写失败的 general 测试**

在 `src/core/battle/battleReducer.test.ts` 顶部 import 追加：

```ts
import type { BattleGeneralConfig } from './types'
```

在文件末尾（最后一个 `})` 后）追加 describe 块：

```ts
describe('battle/init 武将当前属性', () => {
  const GUAN_GENERAL: BattleGeneralConfig = {
    name: '关羽',
    level: 1,
    stats: { atk: 90, def: 70, int: 50, pol: 60, cha: 80 },
    passives: [{ name: '铁壁', level: 1 }]
  }
  test('有 general：六维/攻防加成/蓝量/被动正确', () => {
    const s = makeStore({
      player: { side: 'player', general: GUAN_GENERAL, units: [{ defId: 'militia', count: 10 }] },
      enemy: { side: 'enemy', generalName: 'E', atkBonus: 0, defBonus: 0, units: [{ defId: 'militia', count: 10 }] }
    }).getState()
    const g = s.general.player
    expect(g.name).toBe('关羽')
    expect(g.stats).toEqual({ atk: 90, def: 70, int: 50, pol: 60, cha: 80 })
    expect(g.atkBonus).toBe(30)   // round(90/3)
    expect(g.defBonus).toBe(23)   // round(70/3)
    expect(g.level).toBe(1)
    expect(g.maxMana).toBe(50)    // round(int50 × MANA_COEF1)
    expect(g.currentMana).toBe(50)
    expect(g.passives).toEqual([{ name: '铁壁', level: 1 }])
  })
  test('无 general：旧字段反推展示值，行为不变', () => {
    const s = makeStore().getState() // TEST_ARMIES: atkBonus30/defBonus23
    const g = s.general.player
    expect(g.atkBonus).toBe(30)
    expect(g.defBonus).toBe(23)
    expect(g.stats).toEqual({ atk: 90, def: 69, int: 0, pol: 0, cha: 0 }) // atk=30×3, def=23×3
    expect(g.maxMana).toBe(0)
    expect(g.passives).toEqual([])
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm test`
Expected: FAIL —— `BattleGeneralConfig` 不存在 / `BattleArmyConfig.general` 不存在。

- [ ] **Step 3: 改 types.ts**

`src/core/battle/types.ts` 顶部 import 追加：

```ts
import type { GeneralStats } from '../state/GameState'
```

在 `BattleUnitConfig` 之后、`BattleArmyConfig` 之前插入：

```ts
/** 进入战斗的武将信息（携带当前属性值；战斗不感知基础配置/成长公式） */
export interface BattleGeneralConfig {
  name: string
  level: number
  /** 当前六维（调用方从 General.stats 传入） */
  stats: GeneralStats
  /** 已生效被动技能（展示） */
  passives: { name: string; level: number }[]
}

/** 战斗中一方的武将态（展示 + 攻防/蓝量派生） */
export interface BattleGeneral {
  name: string
  atkBonus: number   // = round(stats.atk/3)
  defBonus: number   // = round(stats.def/3)
  stats: GeneralStats
  level: number
  maxMana: number    // = round(stats.int × MANA_COEF)
  currentMana: number
  passives: { name: string; level: number }[]
}
```

把 `BattleArmyConfig` 改为：

```ts
export interface BattleArmyConfig {
  side: Side
  /** 武将当前属性（缺省时从 generalName/atkBonus/defBonus 反推展示值） */
  general?: BattleGeneralConfig
  generalName?: string
  /** = round(武力/3)，加到此方所有单位实际攻击 */
  atkBonus?: number
  /** = round(统御/3)，加到此方所有单位实际防御 */
  defBonus?: number
  units: BattleUnitConfig[]
}
```

把 `BattleState.general` 类型改为：

```ts
general: Record<Side, BattleGeneral>
```

- [ ] **Step 4: 改 battleReducer.ts**

`src/core/battle/battleReducer.ts` 顶部（import 后）加常量与辅助函数：

```ts
/** 魔法值上限系数：maxMana = round(智力 × MANA_COEF)（PRD §5.3：智力×系数；系数暂定 1） */
const MANA_COEF = 1

/** 进入战斗的武将信息 → 战斗武将态（六维/蓝量/被动；攻防加成从当前武力/统御推导） */
function buildGeneral(cfg: BattleArmyConfig): BattleState['general']['player'] {
  if (cfg.general) {
    const atkBonus = Math.round(cfg.general.stats.atk / 3)
    const defBonus = Math.round(cfg.general.stats.def / 3)
    const maxMana = Math.round(cfg.general.stats.int * MANA_COEF)
    return {
      name: cfg.general.name,
      atkBonus,
      defBonus,
      stats: { ...cfg.general.stats },
      level: cfg.general.level,
      maxMana,
      currentMana: maxMana,
      passives: cfg.general.passives.map((p) => ({ ...p }))
    }
  }
  // 无 general：旧字段反推展示值（现有测试/e2e 阵容行为不变）
  const atkBonus = cfg.atkBonus ?? 0
  const defBonus = cfg.defBonus ?? 0
  return {
    name: cfg.generalName ?? '未知',
    atkBonus,
    defBonus,
    stats: { atk: atkBonus * 3, def: defBonus * 3, int: 0, pol: 0, cha: 0 },
    level: 1,
    maxMana: 0,
    currentMana: 0,
    passives: []
  }
}
```

把初始状态 `general`（当前约第 24-26 行）改为：

```ts
general: {
  player: { name: '', atkBonus: 0, defBonus: 0, stats: { atk: 0, def: 0, int: 0, pol: 0, cha: 0 }, level: 1, maxMana: 0, currentMana: 0, passives: [] },
  enemy: { name: '', atkBonus: 0, defBonus: 0, stats: { atk: 0, def: 0, int: 0, pol: 0, cha: 0 }, level: 1, maxMana: 0, currentMana: 0, passives: [] }
}
```

把 init 里的 `general` 赋值（当前约第 108-111 行）改为：

```ts
general: {
  player: buildGeneral(payload.player),
  enemy: buildGeneral(payload.enemy)
},
```

注意：`battleReducer.ts` 已 `import { ... type BattleArmyConfig, type BattleState, type BattleUnit } from './types'`，`buildGeneral` 用到这些类型，无需新增 import。

- [ ] **Step 5: 跑测试确认通过**

Run: `pnpm test`
Expected: 新增 2 个用例 + 既有 battle 测试全部 PASS（既有用例走「无 general 反推」路径，断言值不变）。

- [ ] **Step 6: 改 battleTest.ts**

`src/data/battleTest.ts` 改为（删除 `generalName/atkBonus/defBonus`，改用 `general`）：

```ts
/**
 * 战斗测试固定阵容（纯数据）：主菜单「战斗测试」入口用。
 * 我方：关羽（武90/统70/智50/政60/魅80）+ 4 支；敌方：吕布（武100/统80/智30/政20/魅40）+ 4 支。
 * 攻防加成由 battleReducer 从当前武力/统御推导（atkBonus = round(武力/3)）。
 */
import type { Axial } from '../core/hex/HexGrid'
import type { BattleArmyConfig } from '../core/battle/types'
import { deriveStats } from '../core/generals'
import { GENERAL_BASES } from './generals'

export const BATTLE_GRID = { cols: 15, rows: 11 } as const

/** 固定测试图障碍：避开出生行/出生格，连通性单测锁定 */
export const BATTLE_OBSTACLES: Axial[] = [
  { q: 4, r: 0 }, { q: 5, r: 0 },
  { q: 4, r: 2 }, { q: 5, r: 2 },
  { q: 7, r: 4 }, { q: 8, r: 4 }
]

const GUAN = GENERAL_BASES['g-guan']
const LVBU = GENERAL_BASES['g-lvbu']

export const PLAYER_ARMY: BattleArmyConfig = {
  side: 'player',
  general: { name: GUAN.name, level: 1, stats: deriveStats(GUAN, 1), passives: GUAN.passives },
  units: [
    { defId: 'militia', count: 30 },
    { defId: 'swordsman', count: 12 },
    { defId: 'archer', count: 10 },
    { defId: 'cavalry', count: 8 }
  ]
}

export const ENEMY_ARMY: BattleArmyConfig = {
  side: 'enemy',
  general: { name: LVBU.name, level: 1, stats: deriveStats(LVBU, 1), passives: LVBU.passives },
  units: [
    { defId: 'militia', count: 20 },
    { defId: 'pikeman', count: 12 },
    { defId: 'archer', count: 8 },
    { defId: 'swordsman', count: 12, position: { q: 5, r: 3 } }
  ]
}
```

- [ ] **Step 7: 全量 core 测试 + typecheck + commit**

Run: `pnpm test`
Run: `pnpm typecheck`

```bash
git add src/core/battle/types.ts src/core/battle/battleReducer.ts src/data/battleTest.ts src/core/battle/battleReducer.test.ts
git commit -m "feat: 战斗 general 携带当前六维/蓝量/被动（BattleArmyConfig.general 可选，旧字段兜底）"
```

---

### Task 3: hover 信息面板补「单兵血量」

**Files:**
- Modify: `src/scenes/BattleScene.ts`（`updateInfoPanel`）
- Test: `src/e2e/battle.spec.ts`（既有 hover 用例补一行断言）

**Interfaces:**
- Consumes: `BattleUnit` / `UNIT_DEFS`（已 import）
- Produces: 无（纯展示）

- [ ] **Step 1: 改 updateInfoPanel**

`src/scenes/BattleScene.ts` 的 `updateInfoPanel`（当前约第 772-790 行），在 `伤兵剩余：${woundedHp(unit)} 血` 一行之后追加：

```ts
      `单兵血量：${UNIT_DEFS[unit.defId].hp}`
```

（保持数组内其它行不动；`infoPanelText` 为 `join('\n')` 的整段文本。）

- [ ] **Step 2: 既有 hover 用例补断言**

`src/e2e/battle.spec.ts` 的「信息面板：hover 部队 → 兵种/数量/伤兵剩余血」用例（当前约第 498 行），在 `expect(panel).toContain('伤兵剩余：20')` 之后补：

```ts
  expect(panel).toContain('单兵血量：20') // swordsman hp20
```

- [ ] **Step 3: 跑该 e2e 用例确认通过**

Run: `pnpm exec playwright test src/e2e/battle.spec.ts -g "信息面板"`
Expected: PASS（既有 hover 用例已用 toContain，加行不破坏）。

- [ ] **Step 4: typecheck + commit**

Run: `pnpm typecheck`

```bash
git add src/scenes/BattleScene.ts src/e2e/battle.spec.ts
git commit -m "feat: hover 信息面板补单兵血量行 + e2e 断言"
```

---

### Task 4: 左右武将卡（GeneralCard 组件 + BattleScene 集成 + dev bridge）

**Files:**
- Create: `src/ui/GeneralCard.ts`
- Modify: `src/scenes/BattleScene.ts`
- Test: `src/e2e/battle.spec.ts`（新增用例）

**Interfaces:**
- Consumes: `BattleState.general[side]`（Task 2 产出，含 stats/level/maxMana/currentMana/passives）
- Produces:
  - `class GeneralCard`（`src/ui/GeneralCard.ts`）：`constructor(scene: Phaser.Scene, side: Side)`、`render(state: BattleState): void`、`getDebugText(): string`、`setVisible(v: boolean): void`、`destroy(): void`
  - `BattleScene.getDebugState()` 新增 `general`（= `state.general`）与 `generalCardText`（`{ player: string; enemy: string }`）

- [ ] **Step 1: 写失败的 e2e 用例**

`src/e2e/battle.spec.ts` 的 `DebugGameState` 接口（当前约第 28-63 行）末尾追加：

```ts
  general?: {
    player?: { name?: string; level?: number; stats?: { atk?: number; def?: number; int?: number; pol?: number; cha?: number }; maxMana?: number; currentMana?: number; passives?: { name?: string; level?: number }[] }
    enemy?: { name?: string; level?: number; stats?: { atk?: number; def?: number; int?: number; pol?: number; cha?: number }; maxMana?: number; currentMana?: number; passives?: { name?: string; level?: number }[] }
  }
  generalCardText?: { player?: string; enemy?: string }
```

在文件末尾（最后一个测试后）追加：

```ts
test('战斗数值展示：左右武将卡（六维/蓝量/被动）+ 主菜单战斗测试入口', async ({ page }) => {
  await gotoBattle(page) // 主菜单 → 战斗测试（PLAYER_ARMY=关羽 / ENEMY_ARMY=吕布，带 general）
  await waitBattleReady(page)
  const s = await getState(page)
  // 攻方（左）关羽卡：六维/蓝量/被动
  expect(s.general?.player).toMatchObject({
    name: '关羽', level: 1,
    stats: { atk: 90, def: 70, int: 50, pol: 60, cha: 80 },
    maxMana: 50, currentMana: 50,
    passives: [{ name: '铁壁', level: 1 }]
  })
  // 守方（右）吕布卡
  expect(s.general?.enemy).toMatchObject({
    name: '吕布', level: 1,
    stats: { atk: 100, def: 80, int: 30, pol: 20, cha: 40 },
    maxMana: 30, currentMana: 30,
    passives: [{ name: '狂暴', level: 1 }]
  })
  // 卡已渲染（debug 暴露可见文本）
  expect(s.generalCardText?.player).toContain('关羽')
  expect(s.generalCardText?.player).toContain('武力 90')
  expect(s.generalCardText?.player).toContain('蓝量 50/50')
  expect(s.generalCardText?.player).toContain('被动 铁壁 Lv1')
  expect(s.generalCardText?.enemy).toContain('吕布')
  expect(s.generalCardText?.enemy).toContain('武力 100')
  await page.screenshot({ path: 'screenshots/battle-general-cards.png' }) // 给人看：左右武将卡布局观感
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `pnpm exec playwright test src/e2e/battle.spec.ts -g "战斗数值展示"`
Expected: FAIL —— `s.general` / `s.generalCardText` 为 undefined（尚未实现）。

- [ ] **Step 3: 实现 GeneralCard 组件**

创建 `src/ui/GeneralCard.ts`：

```ts
import Phaser from 'phaser'
import type { BattleState, Side } from '../core/battle/types'
import { COLORS, css, FONT_DISPLAY } from './theme'

const CARD_W = 216
const EDGE = 16      // 屏幕边缘留白
const PAD = 16       // 面板内边距

/**
 * 战斗武将卡（渲染层，纯显示）。
 * 左=攻方(player)贴左缘、右=守方(enemy)贴右缘，垂直居中；setScrollFactor(0) 不随相机平移。
 * 内容：武将名 + 当前六维 + 蓝量 + 被动技能，全部派生自 state.general[side]。
 * 窄视口下卡可能与战场边缘重叠（MVP 接受；1920 设计基准下左右边距 ~490px 放得下）。
 */
export class GeneralCard {
  private readonly bg: Phaser.GameObjects.Graphics
  private readonly nameText: Phaser.GameObjects.Text
  private readonly body: Phaser.GameObjects.Text
  private lastState: BattleState | null = null

  constructor(private readonly scene: Phaser.Scene, private readonly side: Side) {
    this.bg = scene.add.graphics().setDepth(11).setScrollFactor(0)
    this.nameText = scene.add
      .text(0, 0, '', { fontFamily: FONT_DISPLAY, fontSize: '28px', fontStyle: 'bold', color: css(COLORS.gilt) })
      .setDepth(12)
      .setScrollFactor(0)
    this.body = scene.add
      .text(0, 0, '', { fontFamily: 'sans-serif', fontSize: '16px', color: css(COLORS.parchment), lineSpacing: 6 })
      .setDepth(12)
      .setScrollFactor(0)
    scene.scale.on('resize', this.onResize)
  }

  render(state: BattleState): void {
    this.lastState = state
    const gen = state.general[this.side]
    this.nameText.setText(gen.name)
    this.body.setText(
      [
        `武力 ${gen.stats.atk}    统御 ${gen.stats.def}`,
        `智力 ${gen.stats.int}    政治 ${gen.stats.pol}`,
        `魅力 ${gen.stats.cha}    等级 ${gen.level}`,
        `蓝量 ${gen.currentMana}/${gen.maxMana}`,
        ...(gen.passives.length > 0
          ? gen.passives.map((p) => `被动 ${p.name} Lv${p.level}`)
          : ['被动 —'])
      ].join('\n')
    )
    this.layout()
  }

  /** 卡体可见文本（e2e 断言用；纯派生自 state.general） */
  getDebugText(): string {
    return `${this.nameText.text}\n${this.body.text}`
  }

  setVisible(visible: boolean): void {
    this.bg.setVisible(visible)
    this.nameText.setVisible(visible)
    this.body.setVisible(visible)
  }

  destroy(): void {
    this.scene.scale.off('resize', this.onResize)
    this.bg.destroy()
    this.nameText.destroy()
    this.body.destroy()
  }

  private readonly onResize = (): void => {
    this.layout()
    if (this.lastState) this.render(this.lastState)
  }

  /** 定位 + 画面板：左卡从 x=EDGE 向右展开，右卡从 cam.width-EDGE 向左展开；垂直居中 */
  private layout(): void {
    const cam = this.scene.cameras.main
    const y = cam.height / 2
    const bodyH = this.body.height
    const cardH = this.nameText.height + 6 + bodyH + PAD * 2
    const leftX = EDGE
    const rightX = cam.width - EDGE - CARD_W
    const x0 = this.side === 'player' ? leftX : rightX
    this.bg.clear()
    this.bg.fillStyle(COLORS.nightInk, 0.82)
    this.bg.fillRoundedRect(x0, y - cardH / 2, CARD_W, cardH, 8)
    this.bg.lineStyle(2, COLORS.gilt, 0.6)
    this.bg.strokeRoundedRect(x0, y - cardH / 2, CARD_W, cardH, 8)
    const originX = this.side === 'player' ? 0 : 1
    this.nameText.setOrigin(originX, 0.5).setPosition(x0 + (originX === 0 ? PAD : CARD_W - PAD), y - cardH / 2 + this.nameText.height / 2)
    this.body.setOrigin(originX, 0).setPosition(x0 + (originX === 0 ? PAD : CARD_W - PAD), y - cardH / 2 + this.nameText.height + 6)
  }
}
```

- [ ] **Step 4: 集成进 BattleScene**

`src/scenes/BattleScene.ts`：
1. import 追加：`import { GeneralCard } from '../ui/GeneralCard'`
2. 字段区（`turnOrderQueue` 附近）加：

```ts
  private generalCards: { player: GeneralCard; enemy: GeneralCard } | null = null
```

3. `create()` 顶部重置区（`this.turnOrderQueue = ...` 无需，但加在其它 reset 之后）加：

```ts
    this.generalCards = null
```

4. `createLayers()` 里 `this.turnOrderQueue = new TurnOrderQueue(...)` 之后加：

```ts
    this.generalCards = {
      player: new GeneralCard(this, 'player'),
      enemy: new GeneralCard(this, 'enemy')
    }
```

5. `create()` 的 shutdown 钩子（`this.events.once('shutdown', ...)`）里，`this.turnOrderQueue?.destroy()` 之后加：

```ts
      this.generalCards?.player.destroy()
      this.generalCards?.enemy.destroy()
      this.generalCards = null
```

6. `syncViews()`（当前约第 416-421 行）里 `this.turnOrderQueue?.render(this.state)` 之后加：

```ts
    this.generalCards?.player.render(this.state)
    this.generalCards?.enemy.render(this.state)
```

7. `getDebugState()` 返回对象里（`turnQueue` 之后）加：

```ts
      general: state.general,
      generalCardText: {
        player: this.generalCards?.player.getDebugText() ?? '',
        enemy: this.generalCards?.enemy.getDebugText() ?? ''
      },
```

- [ ] **Step 5: 跑该 e2e 用例确认通过**

Run: `pnpm exec playwright test src/e2e/battle.spec.ts -g "战斗数值展示"`
Expected: PASS。

- [ ] **Step 6: 全量 e2e 回归（确认既有战斗用例没被卡/面板破坏）**

Run: `pnpm test:e2e`
Expected: 全部 PASS（既有用例走「无 general」阵容，卡显示「未知」但不影响断言）。

- [ ] **Step 7: typecheck + commit**

Run: `pnpm typecheck`

```bash
git add src/ui/GeneralCard.ts src/scenes/BattleScene.ts src/e2e/battle.spec.ts
git commit -m "feat: 战斗左右武将卡（六维/蓝量/被动展示，screen-fixed，resize 重排）+ e2e"
```

---

### Task 5: PRD §15 同步

**Files:**
- Modify: `PRD.md`

**Interfaces:**
- Consumes: Task 1-4 完成后的实际实现
- Produces: PRD 与代码一致

- [ ] **Step 1: PRD §15 战斗（MVP）新增勾选项**

在 `PRD.md` §15「战斗（MVP）」列表（「行动队列行整合功能按钮」之后）追加一条已完成项：

```md
- [x] 战斗数值展示（2026-08）：hover 信息面板补「单兵血量」行；战场左右两侧屏幕固定显示攻方/守方武将卡（当前六维 + 当前/总蓝量 + 当前有效被动技能；六维来自「基础配置 → deriveStats 当前属性值」分层，battle general 携带当前值）
```

同时在 §16 或武将系统相关行注明被动技能仍**仅展示**、效果待技能系统（若该行已存在则保持不动，不重复造）。

- [ ] **Step 2: 复核 PRD 其余相关条目**

- §9.2 战斗画面「血条显示」：本次做的是 hover 面板单兵血量，不是战场血条——若该行描述不清，补一句「当前以 hover 面板数值形式实现（战场血条待后续）」；不要把它误标完成。
- 确认没有其它 checkbox 被本功能误改状态。

- [ ] **Step 3: typecheck（如改了 TS 无关可跳过）+ commit**

Run: `pnpm test`（保险，确认无副作用）

```bash
git add PRD.md
git commit -m "docs: PRD §15 战斗数值展示（单兵血量 + 武将卡）勾选同步"
```
