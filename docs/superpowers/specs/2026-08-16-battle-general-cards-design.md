# 战斗数值展示：单兵血量 + 左右武将卡

日期：2026-08-16
状态：已确认（brainstorming 通过）

## 背景

战斗场景当前已具备兵种数值展示（格上兵种名 + 右下角兵力数；hover 面板显示 名称/数量/攻击/防御/伤害/速度/伤兵剩余血），但缺：

1. **单兵血量**：hover 面板没有「单个兵的血量」（`UNIT_DEFS[defId].hp`）这一行。
2. **武将卡**：战场上没有武将信息。当前 `BattleArmyConfig` / `BattleState.general` 只有 `{ name, atkBonus, defBonus }`，没有六维（武力/统御/智力/政治/魅力/等级）、蓝量、被动技能。

目标：在战斗场景左侧显示攻方武将卡、右侧显示守方武将卡，卡上展示 六维 + 当前蓝量/总蓝量 + 当前有效的被动技能；并在 hover 面板补单兵血量一行。

## 决策（brainstorming 确认）

- **单兵血量**：只在 hover 面板补一行「单兵血量：N」（N = `UNIT_DEFS[defId].hp`），格上不加血量条/数字。
- **被动技能**：**仅展示**。数据进 battle 配置占位（`{ name, level }` 列表），效果等技能系统（PRD §16 P0 未实现）再做。关羽「铁壁 Lv1」（PRD §6.4 示例）、吕布「狂暴 Lv1」（战将被动，PRD §6.2 示例）。
- **蓝量**：按 PRD 公式 `maxMana = 智力 × 系数`，系数先定 1。当前战斗内无任何消耗/回复蓝量机制（主动计略未实现），故 `currentMana = maxMana`（恒满）。
- **六维来源**：复用探索层武将数据 —— 扩展 core `General` 类型补六维，并新建 `src/data/generals.ts` 武将数据表，bootstrap 与 battleTest 共用同一份。

## 方案：数据表复用（方案 A）

新建 `src/data/generals.ts`（纯数据，仿 `units.ts`），bootstrap 的 START_GENERALS 与 battleTest 双方阵容都引用它，消除当前 bootstrap/battleTest 关羽数据重复。`BattleArmyConfig` 新增**可选** `general` 字段并保留旧 `generalName/atkBonus/defBonus` 作兜底 → 现有 ~40 处测试/e2e 阵容构造无需修改。

## 改动清单

### ① 核心数据（core）

**`src/core/state/GameState.ts`** — `General` 补六维（等级已存在）：

```ts
export interface General {
  id: string
  name: string
  faction: FactionId
  type: '战将' | '智将' | '全能'
  level: number
  xp: number
  atk: number   // 武力
  def: number   // 统御
  int: number   // 智力
  pol: number   // 政治
  cha: number   // 魅力
}
```

**`src/data/generals.ts`（新）**：

```ts
import type { General } from '../core/state/GameState'

export interface GeneralDef extends General {
  /** 已生效被动技能（展示用；效果待技能系统实现） */
  passives: { name: string; level: number }[]
}

export const GENERAL_DEFS: Record<'g-guan' | 'g-lvbu', GeneralDef> = {
  'g-guan': {
    id: 'g-guan', name: '关羽', faction: 'shu', type: '全能',
    level: 1, xp: 0,
    atk: 90, def: 70, int: 50, pol: 60, cha: 80,
    passives: [{ name: '铁壁', level: 1 }]
  },
  'g-lvbu': {
    id: 'g-lvbu', name: '吕布', faction: 'qun', type: '战将',
    level: 1, xp: 0,
    atk: 100, def: 80, int: 30, pol: 20, cha: 40,
    passives: [{ name: '狂暴', level: 1 }]
  }
}
```

（六维数值为占位平衡值；吕布 ID 不在开局武将池，仅 battleTest 用。）

**`src/data/bootstrap.ts`**：`START_GENERALS = [GENERAL_DEFS['g-guan']]`（复用，删掉内联的关羽占位）。

**`src/data/battleTest.ts`**：`PLAYER_ARMY` / `ENEMY_ARMY` 改用 `general` 字段引用 `GENERAL_DEFS['g-guan']` / `GENERAL_DEFS['g-lvbu']`（删掉 `generalName/atkBonus/defBonus`，由 reducer 从六维推导，结果一致）。

**`src/core/battle/types.ts`**：

```ts
export interface BattleGeneralConfig {
  name: string
  atk: number   // 武力
  def: number   // 统御
  int: number   // 智力
  pol: number   // 政治
  cha: number   // 魅力
  level: number // 等级
  /** 已生效被动技能（展示用） */
  passives: { name: string; level: number }[]
}

export interface BattleArmyConfig {
  side: Side
  /** 武将六维+被动（缺省时从 generalName/atkBonus/defBonus 反推展示值） */
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
  atkBonus: number
  defBonus: number
  atk: number; def: number; int: number; pol: number; cha: number; level: number
  maxMana: number
  currentMana: number
  passives: { name: string; level: number }[]
}>
```

**`src/core/battle/battleReducer.ts`** init 逻辑：
- 有 `general` → 六维直接取，`atkBonus = round(atk/3)`、`defBonus = round(def/3)`（关羽 90→30、吕布 100→33、统御 70→23、80→27，与现状一致）。
- 无 `general` → 用传入的 `atkBonus/defBonus`，展示用 `atk = atkBonus×3`、`def = defBonus×3`、`int/pol/cha = 0`、`level = 1`、`passives = []`（保持现有测试/e2e 行为不变）。
- `maxMana = Math.round(int × MANA_COEF)`，`MANA_COEF = 1`；`currentMana = maxMana`。

### ② 单兵血量（渲染层）

`src/scenes/BattleScene.ts` `updateInfoPanel` 在「伤兵剩余」后补一行：

```ts
`单兵血量：${UNIT_DEFS[unit.defId].hp}`
```

### ③ 武将卡（渲染层）

新建 `src/ui/GeneralCard.ts`（组件模式仿 `TurnOrderQueue.ts`）：

- 构造参数：`(scene, side)`；从 `BattleState.general[side]` 读数据纯渲染。
- BattleScene 实例化两个：`new GeneralCard(this, 'player')`（左）、`new GeneralCard(this, 'enemy')`（右）。
- **屏幕固定**（`setScrollFactor(0)`），垂直居中贴左右边缘，`this.scale.on('resize')` 重排（随相机宽度动态算 x）。
- 内容（自上而下）：
  1. 武将名（大字加粗）
  2. 六维两列三行：`武力 N 统御 N` / `智力 N 政治 N` / `魅力 N 等级 N`
  3. `蓝 current/max`
  4. 被动技能列表（每行一个：`名称 LvN`；无被动显示「—」）
- 视觉用 `src/ui/theme.ts` 调色板 token；具体视觉走 frontend-design skill。
- `destroy()` 清理 resize 监听（BattleScene shutdown 钩子调用）。

**窄窗口**：战场居中约 936px 宽，1920 下左右边距 ~490px（卡宽 ~210px 放得下）；更窄视口卡可能与战场边缘重叠，MVP 接受（代码注释说明）。

### ④ 测试 + dev bridge

- **core 单测**（`src/core/battle/battleReducer.test.ts` 新增）：
  - `general` 存在：六维/maxMana/currentMana/passives 正确；atkBonus=round(atk/3)（关羽 90→30）。
  - `general` 缺省：展示六维从 atkBonus/defBonus 反推，maxMana=0，行为与现状一致。
- **e2e**（`src/e2e/battle.spec.ts`）：
  - `getDebugState()` 暴露 `general`（双方六维/maxMana/currentMana/passives）。
  - 断言攻方（关羽）卡数值：武力90/统御70/智力50/蓝50/被动铁壁；守方（吕布）卡数值：武力100/蓝30/被动狂暴。
  - hover 面板文本含「单兵血量」。
- **PRD 同步**：`PRD.md` §15 战斗（MVP）新增勾选项「战斗数值展示（hover 单兵血量 + 左右武将卡）」，§16 不动。

## 不做（YAGNI）

- 被动技能**效果**（仅展示，技能系统整体未实现）。
- 主动计略/蓝量消耗/回复机制。
- 武将卡点击交互（纯信息展示）。
- 开局选将 / 酒馆等武将系统（那是 PRD §16 后续，generals.ts 表为其打地基）。
- 格上血量条（用户已选 hover 面板补行）。
