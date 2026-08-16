# 战斗数值展示：单兵血量 + 左右武将卡

日期：2026-08-16
状态：已确认（brainstorming 通过，含「基础配置 / 当前属性值」分层修订）

## 背景

战斗场景当前已具备兵种数值展示（格上兵种名 + 右下角兵力数；hover 面板显示 名称/数量/攻击/防御/伤害/速度/伤兵剩余血），但缺：

1. **单兵血量**：hover 面板没有「单个兵的血量」（`UNIT_DEFS[defId].hp`）这一行。
2. **武将卡**：战场上没有武将信息。当前 `BattleArmyConfig` / `BattleState.general` 只有 `{ name, atkBonus, defBonus }`，没有六维（武力/统御/智力/政治/魅力/等级）、蓝量、被动技能。

目标：在战斗场景左侧显示攻方武将卡、右侧显示守方武将卡，卡上展示 六维 + 当前蓝量/总蓝量 + 当前有效的被动技能；并在 hover 面板补单兵血量一行。

## 决策（brainstorming 确认）

- **单兵血量**：只在 hover 面板补一行「单兵血量：N」（N = `UNIT_DEFS[defId].hp`），格上不加血量条/数字。
- **被动技能**：**仅展示**。数据进配置占位（`{ name, level }` 列表），效果等技能系统（PRD §16 P0 未实现）再做。关羽「铁壁 Lv1」（PRD §6.4 示例）、吕布「狂暴 Lv1」（战将被动，PRD §6.2 示例）。
- **蓝量**：按 PRD 公式 `maxMana = 智力 × 系数`，系数先定 1。当前战斗内无任何消耗/回复蓝量机制（主动计略未实现），故 `currentMana = maxMana`（恒满）。
- **六维分层（用户确认）**：基础六维写**配置文件**；因武将**动态成长**（升级、装备、技能加成），中间再有一层**「当前属性值」**——战斗展示与攻防/蓝量计算都读当前值，不直接读基础配置。

## 分层架构：基础配置 → 当前属性值 → 战斗展示

```
src/data/generals.ts      基础配置（静态）：GeneralBase
  基础六维 baseAtk/…/baseCha + 每级成长 growthPerLevel + 预设被动
        │ deriveStats(base, level)  ← 当前属性值推导（core/generals.ts）
        ▼
core General.stats         当前属性值（运行时，随成长/装备/技能变化）＝动态层
        │ battle 读 current
        ▼
BattleState.general        战斗展示（六维 + 蓝量 + 被动）
```

- **基础配置**（`GeneralBase`）：写死的静态数值表。
- **当前属性值**（`GeneralStats`）：`deriveStats(base, level)` 计算（Lv1 下 = 基础值；成长公式为占位线性增长，是将来升级系统的接缝）。
- **战斗只吃当前值**：`BattleArmyConfig.general` 携带当前六维，战斗层不感知基础配置与成长公式。

## 改动清单

### ① 基础配置（data）

**`src/data/generals.ts`（新）** —— 仿 `units.ts` 的纯数据表：

```ts
import type { FactionId } from '../core/state/GameState'

/** 基础六维（静态配置；「当前属性值」由 deriveStats 推导，不直接用这些字段展示） */
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

（六维/成长数值为占位平衡值；吕布 ID 不在开局武将池，仅 battleTest 用。）

### ② 当前属性值层（core）

**`src/core/state/GameState.ts`** —— 新增 `GeneralStats`，`General` 携带当前六维 + 被动：

```ts
/** 当前属性值（动态层：基础 + 成长 + 装备/技能加成；随升级变化） */
export interface GeneralStats {
  atk: number   // 武力
  def: number   // 统御
  int: number   // 智力
  pol: number   // 政治
  cha: number   // 魅力
}

export interface General {
  id: string
  name: string
  faction: FactionId
  type: '战将' | '智将' | '全能'
  level: number
  xp: number
  /** 当前六维（战斗展示/攻防/蓝量都读这里，不读基础配置） */
  stats: GeneralStats
  /** 已生效被动技能（展示） */
  passives: { name: string; level: number }[]
}
```

**`src/core/generals.ts`（新）** —— 基础 → 当前值推导（纯函数，可单测）：

```ts
import type { GeneralBase } from '../data/generals'
import type { GeneralStats } from './state/GameState'

/** 当前属性值 = 基础 + (level-1)×每级成长（占位线性；装备/技能加成将来叠加）。Lv1 = 基础值。 */
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

**`src/data/bootstrap.ts`**：`START_GENERALS` 用 `deriveStats` 生成关羽的运行时 `General`（复用基础配置，删掉内联占位）。

### ③ 战斗数据（core/battle）

**`src/core/battle/types.ts`**：

```ts
import type { GeneralStats } from '../state/GameState'

/** 进入战斗的武将信息（携带当前属性值；战斗不感知基础配置/成长公式） */
export interface BattleGeneralConfig {
  name: string
  level: number
  /** 当前六维（调用方从 General.stats 传入） */
  stats: GeneralStats
  /** 已生效被动技能（展示） */
  passives: { name: string; level: number }[]
}

export interface BattleArmyConfig {
  side: Side
  /** 武将当前属性（缺省时从 generalName/atkBonus/defBonus 反推展示值） */
  general?: BattleGeneralConfig
  generalName?: string
  atkBonus?: number
  defBonus?: number
  units: BattleUnitConfig[]
}
```

`BattleState.general` 扩展为：

```ts
general: Record<Side, {
  name: string
  atkBonus: number        // = round(stats.atk/3)
  defBonus: number        // = round(stats.def/3)
  stats: GeneralStats     // 当前六维（展示）
  level: number
  maxMana: number         // = round(stats.int × MANA_COEF)
  currentMana: number
  passives: { name: string; level: number }[]
}>
```

**`src/core/battle/battleReducer.ts`** init 逻辑：
- 有 `general` → `stats` 直接取；`atkBonus = round(stats.atk/3)`、`defBonus = round(stats.def/3)`（关羽 90→30、吕布 100→33、统御 70→23、80→27，与现状一致）。
- 无 `general` → 用传入的 `atkBonus/defBonus`，展示 `stats = { atk: atkBonus×3, def: defBonus×3, int: 0, pol: 0, cha: 0 }`、`level: 1`、`passives: []`（现有 ~40 处测试/e2e 阵容构造行为不变）。
- `maxMana = Math.round(stats.int × MANA_COEF)`（`MANA_COEF = 1`）；`currentMana = maxMana`。

**`src/data/battleTest.ts`**：`PLAYER_ARMY` / `ENEMY_ARMY` 改用 `general` 字段，`stats = deriveStats(GENERAL_BASES['g-guan'], 1)` / `deriveStats(GENERAL_BASES['g-lvbu'], 1)`，`passives` 取基础配置；删掉 `generalName/atkBonus/defBonus`（reducer 从当前值推导，结果一致）。

### ④ 单兵血量（渲染层）

`src/scenes/BattleScene.ts` `updateInfoPanel` 在「伤兵剩余」后补一行：

```ts
`单兵血量：${UNIT_DEFS[unit.defId].hp}`
```

### ⑤ 武将卡（渲染层）

新建 `src/ui/GeneralCard.ts`（组件模式仿 `TurnOrderQueue.ts`）：

- 构造参数：`(scene, side)`；从 `BattleState.general[side]` 读数据纯渲染。
- BattleScene 实例化两个：`new GeneralCard(this, 'player')`（左）、`new GeneralCard(this, 'enemy')`（右）。
- **屏幕固定**（`setScrollFactor(0)`），垂直居中贴左右边缘，`this.scale.on('resize')` 重排（随相机宽度动态算 x）。
- 内容（自上而下）：
  1. 武将名（大字加粗）
  2. 当前六维两列三行：`武力 N 统御 N` / `智力 N 政治 N` / `魅力 N 等级 N`
  3. `蓝 current/max`
  4. 被动技能列表（每行一个：`名称 LvN`；无被动显示「—」）
- 视觉用 `src/ui/theme.ts` 调色板 token；具体视觉走 frontend-design skill。
- `destroy()` 清理 resize 监听（BattleScene shutdown 钩子调用）。

**窄窗口**：战场居中约 936px 宽，1920 下左右边距 ~490px（卡宽 ~210px 放得下）；更窄视口卡可能与战场边缘重叠，MVP 接受（代码注释说明）。

### ⑥ 测试 + dev bridge

- **core 单测**：
  - `src/core/generals.test.ts`（新）：`deriveStats` Lv1 = 基础值、高等级线性成长。
  - `src/core/battle/battleReducer.test.ts`（新）：有 `general` → 六维/maxMana/currentMana/passives 正确、atkBonus=round(atk/3)；无 `general` → 反推展示值、行为与现状一致。
- **e2e**（`src/e2e/battle.spec.ts`）：
  - `getDebugState()` 暴露 `general`（双方 stats/maxMana/currentMana/passives/level）。
  - 断言攻方（关羽）卡：武力90/统御70/智力50/蓝50/被动铁壁；守方（吕布）卡：武力100/蓝30/被动狂暴。
  - hover 面板文本含「单兵血量」。
- **PRD 同步**：`PRD.md` §15 战斗（MVP）新增勾选项「战斗数值展示（hover 单兵血量 + 左右武将卡）」，§16 不动。

## 不做（YAGNI）

- 被动技能**效果**（仅展示，技能系统整体未实现）。
- 主动计略/蓝量消耗/回复机制。
- 武将卡点击交互（纯信息展示）。
- 升级系统本体 / 装备 / 技能加成（PRD §16 后续；`deriveStats` + `growthPerLevel` 只是接缝占位）。
- 开局选将 / 酒馆等武将系统（PRD §16 后续，`GENERAL_BASES` 表为其打地基）。
- 格上血量条（用户已选 hover 面板补行）。
