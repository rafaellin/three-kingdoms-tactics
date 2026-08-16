# 世界状态持久化（战斗往返不丢状态）

日期：2026-08-16
状态：已确认（brainstorming 通过）

## 背景

战役模式 MVP（`d75b08e..0cabf9c`）存在已知 gap：**每次战斗返回后大地图状态重置**。根因：`AdventureScene.triggerBattle` 用 `scene.start('Battle')` 停掉 Adventure → 大地图 store 销毁；返回时 `create(data)` **无条件** `buildStore()` → `campaign/start` 重建全新状态，只有 `campaign/resolveBattle` 写回的部分（兵力/经验/守将歼灭/杂兵歼灭/胜利）持久。**英雄位置、回合数、资源、城池驻守/移兵/换将状态全部丢失**——「清杂兵→驻城→再打孔秀」的策略闭环不成立。

## 目标

战斗往返不丢大地图状态：城池驻守/移兵/换将、英雄位置、回合数、资源在战斗后保留。让完整策略闭环（移动→驻城→练级→挑战守将）成立。

## 决策（用户确认）

| 项 | 决定 |
|---|---|
| 快照存活范围 | **仅会话内**：渲染层模块级变量，页面刷新即丢（MVP 可接受；存档是更大 feature） |
| 战斗失败处理 | **胜败都恢复快照**：无论胜负，返回时都用快照恢复大地图，再写回 result（胜：守将歼/杂兵灭/经验；败：按 remainingTroops 覆盖英雄兵力，投降/逃跑清空该英雄） |

## 方案：世界快照（World Snapshot）

**核心机制**：进战斗前把当前 `GameState` 序列化保存到渲染层模块级变量；战斗返回时，`create(data)` 检测到快照 → 用反序列化的 state 作 CommandLog 初始态（**不** `campaign/start`），再 dispatch `campaign/resolveBattle` 写回战斗结果。

**关键接口复用**：
- `CommandLog<S>`（`src/core/events/CommandLog.ts`）：`new CommandLog(state, reducer)` 支持任意初始态（已具备）。
- `serializeState`/`deserializeState`（`src/core/state/GameState.ts`）：GameState ↔ JSON，已具备。
- `campaign/resolveBattle`（`src/core/state/reducer.ts`）：写回 army/xp/守将/杂兵/outcome，已具备。

**改动范围（纯渲染层，core 零改动）**：
1. `src/scenes/AdventureScene.ts` 顶部模块级：`let worldSnapshot: string | null = null`（存序列化 JSON，用户确认用模块级而非 game.registry）。
2. `triggerBattle` 进战斗前：`worldSnapshot = serializeState(this.state)`。
3. `create(data)`：若有 `data.result && data.heroId`：
   - 若 `worldSnapshot` 非空 → `this.store = new CommandLog<GameState>(deserializeState(worldSnapshot), gameReducer)`、`worldSnapshot = null`（恢复快照，不 campaign/start）
   - 否则（无快照，理论上不应发生）→ 走原 `buildStore()` + campaign/start
   - 然后照常 dispatch `campaign/resolveBattle`。
4. `buildStore()` 重构：把「campaign/start 全新开始」和「快照恢复」两条路径拆开——create 时若战斗返回且有快照则走恢复，否则走 campaign/start。
5. **战斗测试（独立入口）进 Battle 前清快照**（用户确认）：MainMenu → BattleScene（战斗测试）不走 Adventure，无 triggerBattle；但为防残留快照污染下局，在 BattleScene 无 battleReturn（战斗测试）时不涉及。进一步：主菜单「探索测试/开始战役」进 Adventure 时（无 result）也应 `worldSnapshot = null` 清残留——create 非战斗返回路径统一清快照。
6. **selectedHeroId 保留**（用户确认）：`selectedHeroId` 在 `GameState` 内，快照序列化天然保留，恢复后选中英雄不变。

**行为细节**：
- **胜利**：快照恢复城池/位置/资源 → resolveBattle 覆盖参战英雄兵力（remainingTroops）、加经验、守将 alive=false、杂兵 defeated、checkVictory → outcome=won → 胜利面板。
- **自然战败**：快照恢复 → resolveBattle 把参战英雄兵力写回 remainingTroops（残兵或空）→ 城池/其他英雄保留 → 玩家可换将重来。
- **投降/逃跑**：快照恢复 → resolveBattle 清空该英雄兵力（remainingTroops=[]）→ 城池/其他英雄保留。
- **议和**：快照恢复 → 兵力保留（remainingTroops 非空）、expGained=0 → 城池/其他英雄保留。
- **战斗测试（独立入口）**：无 battleReturn（不进 Adventure），不受影响。
- **探索测试**：也走 battleReturn（探索模式打杂兵也进战斗）→ 同样快照恢复，城池/位置保留。合理。

**确定性**：快照反序列化 = 精确状态（无随机）；resolveBattle 纯函数 immutable；命令序列 = 恢复前状态上的新命令，回放一致。core 不引入新随机。

## 不做（YAGNI）

- localStorage/文件存档（刷新恢复）——独立大 feature（PRD §15 世界状态保持）。
- 多存档槽/读档界面。
- 战斗内大地图操作（战斗时大地图不可操作，保持现状）。

## 测试

- **core**：无需新增（core 零改动；resolveBattle 已有单测覆盖胜/败/杂兵/守将）。
- **e2e** `src/e2e/world-snapshot.spec.ts`（新）：
  - 进战役 → 关羽移动到位 → 进城驻守（garrisonGeneralId 设置）→ 出城 → 打杂兵（战斗胜）→ 返回 → **断言城池驻守状态保留**（garrisonGeneralId 仍在、驻军不变）+ 关羽经验增。
  - 打孔秀 → 胜利 → 返回 → 断言 outcome=won + 胜利面板。
  - （关键断言：战斗返回后城池/英雄位置/回合不丢。）
- **现有 e2e 回归**：`campaign-full.spec.ts`/`campaign-battle.spec.ts` 应仍绿（它们打杂兵→返回→再打孔秀，现在状态保留后流程更顺，不应破坏）。

## 关键文件

| 文件 | 改动 |
|---|---|
| `src/scenes/AdventureScene.ts` | 模块级 `worldSnapshot`；`triggerBattle` 存快照；`create` 战斗返回走快照恢复；`buildStore` 拆两条路径 |
| `src/e2e/world-snapshot.spec.ts`（新） | 驻城→打杂兵→返回→状态保留 + 打孔秀→胜利 |
| `PRD.md` §15 | 「世界状态保持」gap 更新：战斗往返已保留（会话内快照），刷新持久仍 `[ ]` |
