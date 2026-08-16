# 战役模式实现计划（MVP · 千里走单骑·东岭关）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 打通 主菜单三入口 → 战役预设地图 → 多英雄移动 → 城池驻守/访问 → 战斗 → 结算写回 → 击败孔秀胜利 的完整闭环。

**Architecture:** 核心/渲染严格分离。数据层新增 `CampaignConfig`（地图/城/将/守将/杂兵/胜利条件纯数据）；核心层把 `GameState.hero` 单英雄改为 `heroes` 多英雄 + `General.army` 带兵 + `Town` 城池双槽（驻军/驻城英雄/访问英雄）+ 守将/杂兵/胜负状态；reducer 新增战役/城池/战斗回流命令。渲染层复用 AdventureScene（读 scene data 区分模式），主菜单三入口，BattleScene 结算后回调写回。

**Tech Stack:** TypeScript（strict）、Phaser 4（仅渲染）、Vitest（core 单测）、Playwright（e2e）、pnpm。

## Global Constraints

- **核心/渲染分离（铁律）**：`src/core/` 纯 TS，零 Phaser/DOM 依赖；渲染层单向依赖 core。新增 core 逻辑必须配套同目录 `*.test.ts`。
- **确定性（不可破坏）**：core 内禁止裸 `Math.random`/`Date.now`；所有随机走注入 RNG（`src/core/rng.ts`）；reducer 纯函数 immutable；相同命令序列 + 初始态 ⇒ 相同终态。
- **类型集中**：`GeneralStats`/`General`/`Town`/`GameState` 在 `src/core/state/GameState.ts`；`BattleState` 在 `src/core/battle/types.ts`。
- **中文注释、英文标识符**；风格与现有文件一致。
- **测试模式**：`*.test.ts` 与源码同目录；断言用 `expect(...).toBe/toEqual`；命令驱动用 `CommandLog` + `dispatch`。
- **PRD 同步（不可破坏）**：实现后把 `PRD.md` §5 多英雄/城池双槽/战役模式、§15/§16 todo 与代码对齐。
- **每次改代码后跑 `pnpm test`**（core 单测）；提交前一次 `pnpm typecheck`。
- **subagent 模型**：实现 subagent 沿用会话 model（不另行覆盖）。

---

### Task 1: 新武将数据（周仓/孙乾/孔秀）加入 GENERAL_BASES

**Files:**
- Modify: `src/data/generals.ts`
- Test: `src/core/generals.test.ts`

**Interfaces:**
- Consumes: 现有 `GeneralBase` 结构（`base`/`lv20` 双锚点）、`deriveStats`（`src/core/generals.ts`）
- Produces: `GENERAL_BASES` 新增 key `'g-zhoucang' | 'g-sunqian' | 'g-kongxiu'`，供 Task 2 的 `CampaignConfig` 引用

**背景：** 战役需 3 名我方武将（关羽已有） + 1 名守将孔秀。当前 `GENERAL_BASES` 只有 `'g-guan' | 'g-lvbu'`。新增 4 名武将的 base/lv20 双锚点数据（5 级强度用 `deriveStats(base, 5)` 计算）。

- [ ] **Step 1: 写失败测试** — 在 `src/core/generals.test.ts` 追加断言新武将 5 级属性

```ts
import { GENERAL_BASES } from '../data/generals'
// 现有 import 后追加：
test('新武将：周仓/孙乾/孔秀 base/lv20 存在且 5 级可推导', () => {
  expect(GENERAL_BASES['g-zhoucang']).toBeDefined()
  expect(GENERAL_BASES['g-sunqian']).toBeDefined()
  expect(GENERAL_BASES['g-kongxiu']).toBeDefined()
  const zhou = deriveStats(GENERAL_BASES['g-zhoucang'], 5)
  expect(zhou.atk).toBeGreaterThan(0)
  expect(zhou.def).toBeGreaterThan(0)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- generals.test.ts`
Expected: FAIL with "Cannot read properties of undefined"（`g-zhoucang` 不存在）

- [ ] **Step 3: 写实现** — `src/data/generals.ts` 的 `GENERAL_BASES` 增加三名武将

```ts
// Record key 类型扩展：
export const GENERAL_BASES: Record<'g-guan' | 'g-lvbu' | 'g-zhoucang' | 'g-sunqian' | 'g-kongxiu', GeneralBase> = {
  // ...现有 g-guan / g-lvbu 不动...
  'g-zhoucang': {
    id: 'g-zhoucang', name: '周仓', faction: 'shu', type: '战将',
    base: { atk: 14, def: 16, int: 6, pol: 6, cha: 10 },
    lv20: { atk: 80, def: 78, int: 30, pol: 30, cha: 45 },
    passives: []
  },
  'g-sunqian': {
    id: 'g-sunqian', name: '孙乾', faction: 'shu', type: '智将',
    base: { atk: 8, def: 10, int: 18, pol: 16, cha: 14 },
    lv20: { atk: 40, def: 45, int: 80, pol: 78, cha: 60 },
    passives: []
  },
  'g-kongxiu': {
    id: 'g-kongxiu', name: '孔秀', faction: 'wei', type: '战将',
    base: { atk: 12, def: 14, int: 8, pol: 8, cha: 8 },
    lv20: { atk: 70, def: 68, int: 30, pol: 30, cha: 30 },
    passives: []
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test -- generals.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/data/generals.ts src/core/generals.test.ts
git commit -m "feat: 新增武将 周仓/孙乾/孔秀 基础配置（base/lv20 双锚点）"
```

---

### Task 2: CampaignConfig 纯数据（东岭关地图 + 城池 + 武将 + 守将 + 杂兵 + 胜利条件）

**Files:**
- Create: `src/data/campaigns.ts`
- Test: `src/data/campaigns.test.ts`

**Interfaces:**
- Consumes: `MapData`（`src/core/map/MapGen.ts`）、`Axial`（`src/core/hex/HexGrid.ts`）、`General`（`src/core/state/GameState.ts`）、`Town`、`UNIT_DEFS`（`src/data/units.ts`）、`GENERAL_BASES`（`src/data/generals.ts`）
- Produces: `CampaignConfig` 接口 + `CAMPAIGNS: Record<'dongling', CampaignConfig>`；供 Task 3（campaign/start）与 Task 7（AdventureScene setup）使用

**背景：** 战役地图是纯配置。东岭关：1 小城（初始空 garrison/无驻守）+ 3 我方武将（关羽/周仓/孙乾，5 级，各带初始兵力）+ 孔秀守将（5 级，2 队）+ 2-3 组中立杂兵（练级）。窄路：孔秀格两侧/周围 `mountain` 封死，孔秀站在唯一可通行 `plain` 格。

**东岭关地图布局（hex 坐标规划）：**
```
     (0,-2)
(-1,-1)  (1,-1)
   (0,0)   ← 小城（start town，玩家出生地）
(-1,1)  (1,1)
     (0,2)
```
- 初始城：`{ q: 0, r: 0 }`
- 三武将出生：`(0,-1)` 关羽 / `(-1,-1)` 周仓 / `(1,-1)` 孙乾
- 窄路关卡：从 `(0,0)` 向南——`(0,1)` 为孔秀格（plain，唯一通道），两侧 `(-1,1)`/`(1,1)` 设 `mountain` 不可通行；更南侧 `(0,2)`/`(-1,2)`/`(1,2)` 设 `mountain` 封死（不可绕关后）
- 杂兵：`(0,-2)` 民兵10 一组、`(1,-2)` 弓兵6 一组

```ts
// src/data/campaigns.ts
import type { Axial } from '../core/hex/HexGrid'
import type { MapData } from '../core/map/MapGen'
import type { General, Town } from '../core/state/GameState'
import { deriveStats } from '../core/generals'
import { GENERAL_BASES } from './generals'

export interface Garrison {
  id: string
  generalId: string
  level: number
  position: Axial
  units: { defId: string; count: number }[]
}

export interface Neutral {
  id: string
  position: Axial
  units: { defId: string; count: number }[]
}

export interface CampaignConfig {
  id: 'dongling'
  name: string
  map: MapData
  startTowns: Town[]
  startGenerals: General[]
  heroStarts: { generalId: string; position: Axial }[]
  garrisons: Garrison[]
  neutrals: Neutral[]
  victory: { kind: 'defeatGarrison'; targetId: string }
}

// 手工构造东岭关地图（含窄路：孔秀格 plain，两侧/周围 mountain）
function buildDonglingMap(): MapData { /* ... */ }

export const CAMPAIGNS: Record<'dongling', CampaignConfig> = {
  dongling: {
    id: 'dongling',
    name: '千里走单骑·东岭关',
    map: buildDonglingMap(),
    startTowns: [
      { id: 't-dongling', name: '东岭小城', owner: 'shu', level: 1,
        position: { q: 0, r: 0 }, garrisonGeneralId: null,
        garrison: [], visitorGeneralId: null }
    ],
    startGenerals: [
      { id: 'g-guan', name: '关羽', faction: 'shu', type: '全能', level: 5, xp: 0,
        stats: deriveStats(GENERAL_BASES['g-guan'], 5), passives: [],
        skillSlots: Math.floor(5 / 3), army: [
          { defId: 'swordsman', count: 20 }, { defId: 'archer', count: 12 }
        ] },
      { id: 'g-zhoucang', name: '周仓', faction: 'shu', type: '战将', level: 5, xp: 0,
        stats: deriveStats(GENERAL_BASES['g-zhoucang'], 5), passives: [],
        skillSlots: Math.floor(5 / 3), army: [
          { defId: 'pikeman', count: 15 }, { defId: 'militia', count: 20 }
        ] },
      { id: 'g-sunqian', name: '孙乾', faction: 'shu', type: '智将', level: 5, xp: 0,
        stats: deriveStats(GENERAL_BASES['g-sunqian'], 5), passives: [],
        skillSlots: Math.floor(5 / 3), army: [
          { defId: 'archer', count: 15 }, { defId: 'militia', count: 15 }
        ] }
    ],
    heroStarts: [
      { generalId: 'g-guan', position: { q: 0, r: -1 } },
      { generalId: 'g-zhoucang', position: { q: -1, r: -1 } },
      { generalId: 'g-sunqian', position: { q: 1, r: -1 } }
    ],
    garrisons: [
      { id: 'gar-kongxiu', generalId: 'g-kongxiu', level: 5, position: { q: 0, r: 1 },
        units: [{ defId: 'swordsman', count: 18 }, { defId: 'archer', count: 10 }] }
    ],
    neutrals: [
      { id: 'neu-1', position: { q: 0, r: -2 }, units: [{ defId: 'militia', count: 10 }] },
      { id: 'neu-2', position: { q: 1, r: -2 }, units: [{ defId: 'archer', count: 6 }] }
    ],
    victory: { kind: 'defeatGarrison', targetId: 'gar-kongxiu' }
  }
}
```

> 注意：此处 `General`/`Town` 带 `army`/`garrison`/`visitorGeneralId`/`skillSlots` 字段——这些字段在 **Task 3（GameState 类型扩展）** 中才落地。若 Task 2 先写，`campaigns.ts` 引用的类型尚无这些字段会 typecheck 失败。**执行顺序：Task 3（类型）应先于 Task 2（数据）**——见下方任务顺序说明。

- [ ] **Step 1: 写失败测试** — `src/data/campaigns.test.ts` 断言配置非空、关键元素在

```ts
import { describe, expect, test } from 'vitest'
import { CAMPAIGNS } from './campaigns'
import { hexKey } from '../core/hex/HexGrid'

describe('CampaignConfig 东岭关', () => {
  test('配置存在：1城/3将/1守将/2杂兵/胜利条件', () => {
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
    const kongxiuPos = c.garrisons[0].position
    // 孔秀格可通行
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
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm test -- campaigns.test.ts`
Expected: FAIL（文件不存在 / 类型缺失）

- [ ] **Step 3: 写实现** — 创建 `src/data/campaigns.ts`，`buildDonglingMap()` 用 hex BFS 半径 3 + 覆盖地形

```ts
function buildDonglingMap(): MapData {
  // 复用 makePlainMap 思路：hexes 来自 generateMap(1, 3)（半径3覆盖足够），全 plain，再覆盖
  // 说明：campaigns.ts 是 data 层纯数据，为保持 data 不依赖 core/testing，直接用 generateMap
  const { hexes } = generateMap(1, 3)
  const terrain: Record<string, TerrainId> = {}
  for (const h of hexes) terrain[hexKey(h)] = 'plain'
  // 窄路关卡：孔秀格 (0,1) plain；两侧 (-1,1)/(1,1) mountain
  terrain[hexKey({ q: -1, r: 1 })] = 'mountain'
  terrain[hexKey({ q: 1, r: 1 })] = 'mountain'
  // 关后更南封死，确保只能从关卡走
  terrain[hexKey({ q: 0, r: 2 })] = 'mountain'
  terrain[hexKey({ q: -1, r: 2 })] = 'mountain'
  terrain[hexKey({ q: 1, r: 2 })] = 'mountain'
  return { hexes, terrain, nodes: {} }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm test -- campaigns.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/data/campaigns.ts src/data/campaigns.test.ts
git commit -m "feat: 东岭关战役配置（地图/城池/武将/守将/杂兵/胜利条件）"
```

---

### Task 3: GameState 类型扩展 — 多英雄 + General.army + 城池双槽 + 守将/杂兵/胜负

**Files:**
- Modify: `src/core/state/GameState.ts`
- Modify: `src/core/state/reducer.ts`（`game/setup` 适配多英雄）
- Modify: `src/data/bootstrap.ts`（START_GENERALS 适配 `army`/`skillSlots`；若仍保留单英雄 setup 则加 `heroes`）
- Test: `src/core/state/GameState.test.ts`、`src/core/state/Movement.test.ts`（适配）

**Interfaces:**
- Consumes: `BattleUnitConfig` 的 `{ defId, count }` 形状（`src/core/battle/types.ts:62-69`，复用其 defId/count 字段，但不 import battle 类型——data 层自定）
- Produces: 扩展后的 `General`（+`army`+`skillSlots`）、`Town`（+`garrison`+`garrisonGeneralId`+`visitorGeneralId`）、`GameState`（`heroes`/`garrisons`/`neutrals`/`campaignId`/`victory`/`outcome`）、`HeroUnit`（保持）；供 Task 2 数据、Task 4 命令、Task 5-8 使用

**关键：`hero` → `heroes` 是破坏性变更**，波及所有读 `state.hero` 的地方（`reducer.ts`、`AdventureScene.ts`、`GameState.test.ts`、`Movement.test.ts`、dev bridge）。本任务一并适配，保持测试绿。

**GameState.ts 变更：**
```ts
// HeroUnit 增加：英雄携带的部队（战斗时从这读；军队本体在 General.army，这里存快照引用一致即可——MVP 从 General.army 读，HeroUnit 不加 army）
export interface HeroUnit {
  generalId: string
  faction: FactionId
  position: Axial
  movementLeft: number
  maxMovement: number
  sightRange: number
}

// General 增加：
export interface General {
  // ...现有字段...
  skillSlots: number
  /** 武将携带的部队（军队本体，跟人走；战斗从这读） */
  army: { defId: UnitDefId; count: number }[]
}

// Town 增加：
export interface Town {
  // ...现有字段...
  /** 驻军槽（≤7 部队） */
  garrison: { defId: UnitDefId; count: number }[]
  /** 驻城英雄（领导防御）；同一时刻一个武将只有一种状态（地图移动 or 城池） */
  garrisonGeneralId: string | null
  /** 访问英雄（军队也参与防御） */
  visitorGeneralId: string | null
}

// 守将/杂兵状态：
export interface GarrisonState {
  id: string
  generalId: string
  level: number
  position: Axial
  units: { defId: UnitDefId; count: number }[]
  alive: boolean
}
export interface NeutralState {
  id: string
  position: Axial
  units: { defId: UnitDefId; count: number }[]
  defeated: boolean
}

// GameState：
export interface GameState {
  // ...现有字段...
  /** 多英雄（每武将一英雄；MVP 1 主英雄 + 2 副在外并行） */
  heroes: HeroUnit[]
  /** 当前操作英雄 id（渲染高亮/移动目标） */
  selectedHeroId: string | null
  /** 战役 id（非战役模式为 null） */
  campaignId: string | null
  /** 守将驻点状态 */
  garrisons: GarrisonState[]
  /** 中立杂兵状态 */
  neutrals: NeutralState[]
  /** 胜利条件（配置） */
  victory: { kind: 'defeatGarrison'; targetId: string } | null
  /** 战役结局（达成胜利 → 'won'） */
  outcome: 'won' | null
}
```

**适配点（保持测试绿）：**
- `reducer.ts` `setup`：`hero` → `heroes: [...payload.heroStarts.map(...)]`、`selectedHeroId: 第一个`。`moveHero` → 用 `selectedHeroId` 定位英雄；`computeVisionFor` 用选中英雄。
- `bootstrap.ts`：`START_GENERALS` 每个加 `army: []`、`skillSlots: 0`；删 `heroStart/heroGeneralId/heroFaction`（改由 campaign 或默认构造 heroes）。
- `setup.ts`（testing）：`makeSetup` 的 payload 改为构造 1 个英雄（关羽）`heroes: [{ generalId: 'g-guan', faction: 'shu', position: HERO_START, movementLeft: 6, maxMovement: 6, sightRange: 3 }]`、`selectedHeroId: 'g-guan'`。
- 所有 `state.hero` 读取 → `state.heroes.find(h => h.id === state.selectedHeroId)`（或渲染层 `currentHero` getter）。

- [ ] **Step 1: 写失败测试** — 断言 `GameState` 有 `heroes` 数组、`General.army`、`Town.garrison`

```ts
test('多英雄：GameState.heroes 存在，general 带 army，town 带双槽', () => {
  const s = makeStore().getState()
  expect(s.heroes).toHaveLength(1)
  expect(s.generals[0].army).toBeDefined()
  expect(s.towns[0].garrison).toBeDefined()
  expect(s.towns[0].visitorGeneralId).toBeNull()
})
```

- [ ] **Step 2: 运行确认失败** — typecheck / test FAIL（类型未定义）

- [ ] **Step 3: 实现** — 上述 GameState.ts / reducer.ts / bootstrap.ts / setup.ts 全量变更

- [ ] **Step 4: 运行确认通过** — `pnpm test` 全绿；`pnpm typecheck` 干净

- [ ] **Step 5: 提交**

```bash
git add src/core/state/GameState.ts src/core/state/reducer.ts src/data/bootstrap.ts src/core/testing/setup.ts src/core/state/*.test.ts
git commit -m "feat: GameState 多英雄 + General.army + 城池双槽 + 守将/杂兵/胜负 状态扩展"
```

---

### Task 4: reducer 命令集 — 战役启动 / 英雄移动 / 城池交互 / 战斗回流

**Files:**
- Modify: `src/core/state/reducer.ts`
- Modify: `src/core/pathfinding/MapMovementCost.ts`（守将 alive 格不可通行）
- Test: `src/core/state/Campaign.test.ts`（新，命令测试）

**Interfaces:**
- Consumes: Task 3 的 `GameState` 扩展类型、`CAMPAIGNS`（Task 2）、`deriveStats`、`xpToNext`/`maxUnits`（`src/core/growth.ts`）
- Produces: 新命令 case 清单（见下），供渲染层（Task 6-8）调用

**新命令：**
```ts
// payload 类型
export interface CampaignStartPayload {
  mode: 'campaign' | 'explore'
  campaign: CampaignConfig
}
export interface HeroMovePayload { heroId: string; to: Axial }
export interface HeroSelectPayload { heroId: string | null }
export interface EnterTownPayload { heroId: string; townId: string }
export interface GarrisonPayload { heroId: string; townId: string }   // 访问→驻守
export interface LeaveTownPayload { heroId: string; townId: string }  // 出城→回 heroes
export interface SwapHeroesPayload { townId: string }                 // 驻城↔访问互换
export interface TransferTroopsPayload { townId: string; from: 'hero' | 'garrison'; defId: string; count: number }
export interface ResolveBattlePayload {
  result: { outcome: 'won' | 'lost'; remainingTroops: { defId: string; count: number }[]; expGained: number }
  garrisonId?: string      // 打的是守将 → 标记 alive=false（胜利时）
  neutralId?: string       // 打的是杂兵 → 标记 defeated（胜利时）
  heroId: string           // 参战英雄
}
```

**reducer 逻辑：**
- `campaign/start`：按 mode 填 `campaignId`/`garrisons`（explore 空）/`neutrals`（都放）/`victory`（explore null）；heroes 从 `campaign.heroStarts` 构造；towns 从 `startTowns`；generals 从 `startGenerals`；`selectedHeroId = 第一英雄`；`outcome = null`。
- `hero/select`：设 `selectedHeroId`。
- `hero/move`（改造 `unit/move`）：定位 heroId 英雄，校验同现有（邻居/探索/地形/移动力）；**目标格 = alive 守将格 → 拒绝（不可通行，需先打）**；到位后 interactNode。返回新 state。
- `hero/enterTown`：英雄格=城格时，`town.visitorGeneralId = heroId`（英雄从 heroes 移除）。
- `hero/garrison`：访问英雄 → `garrisonGeneralId = heroId`、`visitorGeneralId = null`（同武将不可两槽并存）。
- `hero/leaveTown`：`garrisonGeneralId` 或 `visitorGeneralId` 清空 → 英雄回 heroes（位置=城格）。
- `town/swapHeroes`：`garrisonGeneralId` ↔ `visitorGeneralId` 互换（都非空才换）。
- `town/transferTroops`：英雄 army ↔ 城 garrison 移兵（数量增减，>=0）。
- `campaign/resolveBattle`：写回参战英雄 army = `remainingTroops`；`expGained` → 调 `gainXp` 内部逻辑（复用 Task A 的 `general/gainXp`）；`outcome==='won'` 且 garrisonId → 该守将 `alive=false`；neutralId → `defeated=true`；然后 `campaign/checkVictory` 检查。
- `campaign/checkVictory`：`victory?.kind==='defeatGarrison'` 且目标守将 !alive → `outcome='won'`。

**MapMovementCost 拦截守将格：** `cost()` 里除地形/迷雾外，若 `to` 是 alive 守将格 → Infinity。

```ts
// MapMovementCostInput 增加：
export interface MapMovementCostInput {
  terrainAt: (hex: Axial) => TerrainId
  fogAt: (hex: Axial) => Visibility | undefined
  /** 新增：目标格是否被存活守将占据（是 → 不可通行） */
  garrisonAt?: (hex: Axial) => boolean
}
// cost() 实现加：
if (this.input.garrisonAt?.(to)) return Number.POSITIVE_INFINITY
```

- [ ] **Step 1: 写失败测试** — `src/core/state/Campaign.test.ts`

```ts
// 用 CAMPAIGNS.dongling + campaign/start 建 store
function makeCampaignStore(mode: 'campaign' | 'explore' = 'campaign') {
  const store = new CommandLog<GameState>(createInitialState(), gameReducer)
  store.dispatch('campaign/start', { mode, campaign: CAMPAIGNS.dongling })
  return store
}

test('campaign/start：campaign 模式放守将+胜利；explore 不放守将', () => {
  const c = makeCampaignStore('campaign').getState()
  expect(c.garrisons).toHaveLength(1)
  expect(c.garrisons[0].alive).toBe(true)
  expect(c.victory?.kind).toBe('defeatGarrison')
  expect(c.heroes).toHaveLength(3)
  const e = makeCampaignStore('explore').getState()
  expect(e.garrisons).toHaveLength(0)
  expect(e.victory).toBeNull()
})

test('hero/move：目标格是存活守将格 → 拒绝（不可通行）', () => {
  const store = makeCampaignStore()
  // 关羽在 (0,-1)，尝试走到 (0,1)（孔秀格）——需先到 (0,0) 再到 (0,1)
  store.dispatch('hero/select', { heroId: 'g-guan' })
  store.dispatch('hero/move', { heroId: 'g-guan', to: { q: 0, r: 0 } })
  store.dispatch('hero/move', { heroId: 'g-guan', to: { q: 0, r: 1 } })
  expect(store.getState().heroes.find(h => h.generalId === 'g-guan')?.position)
    .toEqual({ q: 0, r: 0 })  // 停在 (0,0)，进不了孔秀格
})

test('campaign/resolveBattle：击败守将 → alive=false + 经验 + checkVictory', () => {
  const store = makeCampaignStore()
  store.dispatch('campaign/resolveBattle', {
    result: { outcome: 'won', remainingTroops: [{ defId: 'swordsman', count: 12 }], expGained: 500 },
    garrisonId: 'gar-kongxiu', heroId: 'g-guan'
  })
  const s = store.getState()
  expect(s.garrisons[0].alive).toBe(false)
  expect(s.outcome).toBe('won')
  const guan = s.generals.find(g => g.id === 'g-guan')!
  expect(guan.army).toEqual([{ defId: 'swordsman', count: 12 }])
  expect(guan.xp).toBeGreaterThan(0)
})

test('城池：enterTown→garrison→leaveTown→swapHeroes 流转', () => {
  const store = makeCampaignStore()
  // 孙乾进城
  store.dispatch('hero/move', { heroId: 'g-sunqian', to: { q: 0, r: 0 } })
  store.dispatch('hero/enterTown', { heroId: 'g-sunqian', townId: 't-dongling' })
  let s = store.getState()
  expect(s.towns[0].visitorGeneralId).toBe('g-sunqian')
  // 驻守
  store.dispatch('hero/garrison', { heroId: 'g-sunqian', townId: 't-dongling' })
  s = store.getState()
  expect(s.towns[0].garrisonGeneralId).toBe('g-sunqian')
  expect(s.towns[0].visitorGeneralId).toBeNull()
  // 移兵进城
  store.dispatch('town/transferTroops', { townId: 't-dongling', from: 'hero', defId: 'militia', count: 5 })
  s = store.getState()
  expect(s.towns[0].garrison).toEqual([{ defId: 'militia', count: 5 }])
  expect(s.generals.find(g => g.id === 'g-sunqian')!.army.find(u => u.defId === 'militia')!.count).toBe(10)
})
```

- [ ] **Step 2: 运行确认失败** — FAIL（命令未定义）

- [ ] **Step 3: 实现** — reducer 新增上述命令；MapMovementCost 拦截

- [ ] **Step 4: 运行确认通过** — `pnpm test` 全绿；`pnpm typecheck` 干净

- [ ] **Step 5: 提交**

```bash
git add src/core/state/reducer.ts src/core/pathfinding/MapMovementCost.ts src/core/state/Campaign.test.ts
git commit -m "feat: 战役/城池/英雄移动/战斗回流 reducer 命令集 + 守将格通行拦截"
```

---

### Task 5: 主菜单三入口（探索测试 / 开始战役 / 战斗测试）

**Files:**
- Modify: `src/scenes/MainMenuScene.ts`
- Modify: `src/e2e/helpers.ts`（坐标常量）
- Test: `src/e2e/menu.spec.ts`（新，或扩展现有）

**Interfaces:**
- Consumes: `AdventureScene.KEY`（传 data）、`BattleScene.KEY`
- Produces: 三按钮回调（`scene.start` 带 data）；`MENU_START`/`MENU_CAMPAIGN`/`MENU_BATTLE` 坐标

**设计：** 三按钮 Y 坐标 `0.50 / 0.63 / 0.76`。
```ts
this.startBtn = this.createButton(width / 2, height * 0.50, '探索测试', () => {
  if (this.buttonsEnabled) fadeAndStart(this, AdventureScene.KEY, { mode: 'explore', campaignId: 'dongling' })
})
this.campaignBtn = this.createButton(width / 2, height * 0.63, '开始战役', () => {
  if (this.buttonsEnabled) fadeAndStart(this, AdventureScene.KEY, { mode: 'campaign', campaignId: 'dongling' })
})
this.battleBtn = this.createButton(width / 2, height * 0.76, '战斗测试', () => {
  if (this.buttonsEnabled) fadeAndStart(this, BattleScene.KEY)
})
```
- `fadeAndStart` 当前签名 `(scene, target)` —— 扩展为 `(scene, target, data?)`，把 data 传给 `scene.start(target, data)`。
- `helpers.ts`：`MENU_START = {x:960, y:1080*0.50}`、新增 `MENU_CAMPAIGN = {x:960, y:1080*0.63}`、`MENU_BATTLE = {x:960, y:1080*0.76}`。
- **e2e 适配**：现有 `gotoAdventure`/`gotoBattle` 依赖坐标——`gotoAdventure` 用 `MENU_START`（探索测试，仍进 AdventureScene，语义保留）；`gotoBattle` 用 `MENU_BATTLE`（战斗测试，不变）。新增 `gotoCampaign(page)` helper 用 `MENU_CAMPAIGN`。

- [ ] **Step 1: 写失败测试** — `src/e2e/menu.spec.ts`（新增）：三按钮可见且坐标正确
- [ ] **Step 2: 运行确认失败** — e2e FAIL（只有两按钮）
- [ ] **Step 3: 实现** — MainMenuScene 三按钮 + fadeAndStart data 支持 + helpers 坐标
- [ ] **Step 4: 运行确认通过** — `pnpm test` + `pnpm test:e2e`（menu/battle 相关）
- [ ] **Step 5: 提交**

```bash
git add src/scenes/MainMenuScene.ts src/ui/fade.ts src/e2e/helpers.ts src/e2e/menu.spec.ts
git commit -m "feat: 主菜单三入口（探索测试/开始战役/战斗测试）+ fadeAndStart 传 data"
```

---

### Task 6: AdventureScene 读战役配置 + 多英雄渲染 + 守将/杂兵渲染 + 窄路关卡

**Files:**
- Modify: `src/scenes/AdventureScene.ts`
- Test: `src/e2e/campaign-map.spec.ts`（新）

**Interfaces:**
- Consumes: `CAMPAIGNS`（Task 2）、Task 3/4 的 state 类型与命令
- Produces: `create(data)` 读 mode/campaignId；`currentHero` getter；守将/杂兵/多英雄渲染；守将格高亮

**关键改动：**
```ts
create(data: { mode?: 'explore' | 'campaign'; campaignId?: 'dongling' }): void {
  // ...现有 setup...
  this.mode = data?.mode ?? 'explore'
  this.campaignId = data?.campaignId ?? 'dongling'
  // buildStore 从 CAMPAIGNS 构造（替代 generateMap）：
  //   dispatch('campaign/start', { mode, campaign: CAMPAIGNS[this.campaignId] })
}

// 多英雄：syncHeroSprites() 遍历 state.heroes 画每个英雄圆点（含选中高亮）
// 守将：drawGarrisons() 画孔秀格（城寨图标 + 名字），被歼移除
// 杂兵：drawNeutrals() 画野怪图标，被歼移除
// 窄路：孔秀格存活时高亮（红色边框/标识）
// 点击：点守将/杂兵格 → 若在可达/相邻 → 进入战斗（Task 8 接线）
```

**渲染细节：** 现有 `heroSprite` 单英雄 → 改为 `heroSprites: Map<generalId, Graphics>`；`syncHeroSprites()` 每帧同步位置。守将用 `drawGarrisons()`（townGraphics 同级 depth），杂兵用 `drawNeutrals()`。

- [ ] **Step 1: 写失败测试** — `src/e2e/campaign-map.spec.ts`：`gotoCampaign` → 断言 `getState().campaignId === 'dongling'`、`garrisons.length === 1`、`heroes.length === 3`、地图非随机（守将格存在）
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** — AdventureScene create(data) + 多英雄/守将/杂兵渲染
- [ ] **Step 4: 运行确认通过** — `pnpm test` + e2e
- [ ] **Step 5: 提交**

```bash
git add src/scenes/AdventureScene.ts src/e2e/campaign-map.spec.ts
git commit -m "feat: AdventureScene 读战役配置 + 多英雄/守将/杂兵渲染"
```

---

### Task 7: 城池界面 TownPanel（驻军/驻城/访问 + 移兵/驻守/换将/出城）

**Files:**
- Create: `src/ui/TownPanel.ts`
- Modify: `src/scenes/AdventureScene.ts`（点击城池 → 打开 TownPanel；与现有 showTownDetail 合并/替换）
- Modify: `src/dev/debug.ts`（getState 暴露 town 详情）
- Test: `src/e2e/town-panel.spec.ts`（新）

**Interfaces:**
- Consumes: Task 3/4 的 `Town` 双槽 + 命令（`hero/enterTown`/`garrison`/`leaveTown`/`swapHeroes`/`transferTroops`）
- Produces: `TownPanel` 组件（复用 `GeneralCard`/`Modal` 模式），渲染层组件

**设计：** 复用 `Modal` 弹层模式。内容：
- 城名/等级/势力
- 驻军槽列表（兵种+数量）
- 驻城英雄卡（名字/等级/军队）
- 访问英雄卡（名字/等级/军队）
- 按钮：驻守（访问→驻城）、换将（驻城↔访问）、出城（回 heroes）、移兵（hero army ↔ garrison，点兵种→输入数量或+/-按钮）

```ts
export class TownPanel extends Phaser.GameObjects.Container {
  constructor(scene: Phaser.Scene, townId: string, actions: {
    onGarrison(heroId: string): void
    onLeave(heroId: string): void
    onSwap(): void
    onTransfer(from: 'hero' | 'garrison', defId: string, count: number): void
  })
}
```

- [ ] **Step 1: 写失败测试** — `src/e2e/town-panel.spec.ts`：进城 → TownPanel 显示驻军/英雄 → 驻守/移兵/换将/出城断言（getState 验证 state.towns）
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** — TownPanel + AdventureScene 接线
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 提交**

```bash
git add src/ui/TownPanel.ts src/scenes/AdventureScene.ts src/dev/debug.ts src/e2e/town-panel.spec.ts
git commit -m "feat: 城池界面 TownPanel（驻军/驻城/访问 + 移兵/驻守/换将/出城）"
```

---

### Task 8: 战斗回流 — 大地图触发战斗 + BattleResult 写回

**Files:**
- Modify: `src/scenes/AdventureScene.ts`（点守将/杂兵 → 进 Battle）
- Modify: `src/scenes/BattleScene.ts`（接收外部阵容 + 结算回调）
- Modify: `src/dev/debug.ts`
- Test: `src/e2e/campaign-battle.spec.ts`（新）

**Interfaces:**
- Consumes: `BattleScene.startBattle(player, enemy, grid)`（已有）；`campaign/resolveBattle`（Task 4）；`maxUnits`（`src/core/growth.ts`）
- Produces: `BattleEnterData`（传入 Battle 的场景数据）、结算回调把 `BattleResult` 交回 Adventure

**关键设计：**
- AdventureScene 点守将/杂兵格（可达或相邻）→ 构建 `player: BattleArmyConfig`（从当前英雄 General.army + stats/passives）+ `enemy: BattleArmyConfig`（守将 units + 孔秀 stats）+ grid → `this.scene.start('Battle', { enter: { mode, campaignId, garrisonId/neutralId, heroId, player, enemy, grid } })`
- BattleScene `init(data)`：若有 `data.enter` → 用传入阵容 init（不走默认 demo）；结算后「返回主菜单」按钮改为：先调 `onBattleResult` 回调（若设置了）把 `BattleResult` 交回，再 `scene.start('Adventure', { ...enter, result })` 回大地图写回。
- AdventureScene `create(data)`：若 data 带 `result` → `dispatch('campaign/resolveBattle', { result, garrisonId, neutralId, heroId })` → 刷新 → 若 `outcome==='won'` 弹胜利面板 → 返回主菜单。

**BattleResult 回调：**
```ts
// BattleScene 增加：结算后回调
onBattleResult?: (result: BattleResult) => void
// 结算时（won/lost/surrendered/fled/negotiated）调用：
//   记 this.finalResult；「返回主菜单」pointerdown → if (this.onBattleResult) this.onBattleResult(this.finalResult)
```

- [ ] **Step 1: 写失败测试** — `src/e2e/campaign-battle.spec.ts`：进战役 → 打杂兵 → 胜利 → 经验增加；打孔秀 → 胜利 → 守将 alive=false + outcome won
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** — Adventure/Battle 战斗回流接线
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 提交**

```bash
git add src/scenes/AdventureScene.ts src/scenes/BattleScene.ts src/dev/debug.ts src/e2e/campaign-battle.spec.ts
git commit -m "feat: 大地图触发战斗 + BattleResult 写回（经验/兵力/守将歼灭/胜利判定）"
```

---

### Task 9: 战役全流程 e2e + 胜利面板 + PRD 同步

**Files:**
- Modify: `src/scenes/AdventureScene.ts`（胜利面板：outcome==='won' → 弹层 → 返回主菜单）
- Modify: `src/e2e/*.spec.ts`（坐标常量回归）
- Modify: `PRD.md` / `PRD-SUPPLEMENT.md`（§5 多英雄/城池双槽/战役模式；§15/§16 todo 同步）
- Test: `src/e2e/campaign-full.spec.ts`（新，完整闭环）

**完整闭环 e2e：**
```
开始战役 → 选将（关羽）→ 打杂兵练级 → 回城驻守/移兵 → 挑战孔秀 → 胜利面板 → 返回主菜单
```

**PRD 同步要点：**
- §5.3 出征配置：删「主将+副将」→ 改「每武将一英雄带一支部队（HOMM3 式）」；§5.2 补 army 字段。
- 新增「战役模式」章节（预设地图配置 + 关卡 + 守将 + 胜利条件；与探索测试的区别）。
- §15 勾选完成项（主菜单三入口、多英雄、城池交互、战役模式、战斗回流）；§16 未完成保持 `[ ]`（对战模式等）。

- [ ] **Step 1: 写失败测试** — `src/e2e/campaign-full.spec.ts` 完整闭环
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** — 胜利面板 + PRD 同步
- [ ] **Step 4: 运行确认通过** — `pnpm test` + `pnpm test:e2e` 全绿；`pnpm typecheck` 干净
- [ ] **Step 5: 提交**

```bash
git add src/scenes/AdventureScene.ts src/e2e/campaign-full.spec.ts PRD.md PRD-SUPPLEMENT.md
git commit -m "feat: 战役全流程闭环（胜利面板）+ e2e + PRD 同步"
```

---

## 任务依赖与执行顺序

```
Task 1（新武将数据）
   ↓
Task 3（GameState 类型扩展：多英雄/army/城池/守将/胜负）   ← 必须先于 Task 2
   ↓
Task 2（CampaignConfig 数据：引用 Task 3 的类型字段）
   ↓
Task 4（reducer 命令集：campaign/start 消费 Task 2 配置）
   ↓
Task 5（主菜单三入口） → 独立，可并行于 Task 6-8
   ↓
Task 6（AdventureScene 读配置 + 多英雄/守将/杂兵渲染）
   ↓
Task 7（城池界面 TownPanel）
   ↓
Task 8（战斗回流）
   ↓
Task 9（战役全流程 e2e + 胜利面板 + PRD 同步）
```

> **注意**：Task 3（类型）必须先于 Task 2（数据）执行，因为 `CampaignConfig` 引用 `General.army`/`Town.garrison`/`visitorGeneralId`/`skillSlots` 等 Task 3 才落地的字段。若按编号顺序执行，Task 2 会 typecheck 失败。**实际执行顺序：Task 1 → Task 3 → Task 2 → Task 4 → ...**
