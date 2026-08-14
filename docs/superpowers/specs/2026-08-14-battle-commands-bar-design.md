# 战斗操作按钮行 + 等待/防御 + 降逃和 + 模式连接接口 设计

日期：2026-08-14
状态：已确认，待实现

## 背景 / 问题

战斗 UI 目前只有右下角「跳过行动 / 撤退」按钮组（`OperationButtons`）+ 底部行动顺序条（`TurnOrderQueue`，按 `state.order` 显示、已行动原地灰掉）。需求升级为：

1. **功能按钮整合进行动队列行**：底部通栏条两侧放 `【设置】【降】【逃】【和】` 与 `【技】【候】【守】`；
2. **等待机制**：部队可选择「等待」，进入**等待队列**（速度升序，最慢先动），正常队列清空后才行动；等待段内速度变化需重排；
3. **防御指令**：原地防御，防御值临时 +2，直到下次行动；
4. **高危操作**：投降 / 逃跑 / 议和（确认弹窗 + hover 提示，无快捷键），并产出统一 `BattleResult` 供探索模式消费；
5. **攻防加成链**：兵种原始值 → 武将属性 → buff → debuff → 防御指令 +2（buff/debuff 层留空位，技能系统将来写入）；
6. **探索↔战斗连接接口**：只设计接口（进入参数 / 结算结果），探索接线为将来工作；「战斗测试」充当这套接口的 unit test。

## 目标

1. core 层重构行动队列为**三队列**（已完成 / 正常 / 等待），排序权威、可单测；
2. 新增 `battle/wait`、`battle/defend`、`battle/flee`、`battle/negotiate` 命令；
3. 渲染层整合底部行动队列行为单行交互条（三段队列 + 两侧按钮 + 确认弹窗 + 快捷键）；
4. 定义并产出 `BattleEnterParams` / `BattleResult`，战斗测试注入固定金钱/阵营使其可测；
5. 攻防计算重构为加成链纯函数（`mods` 点数/百分比 + 防御 +2）；
6. 同步 PRD §15/§16；今后不可做项写入 `docs/FUTURE-WORK.md`。

## 设计

### 1. core：三队列重构（替代 `state.order`）

`BattleState` 移除 `order: string[]`，改为三个显式队列（**排序权威**）：

| 字段 | 语义 | 排序 |
|---|---|---|
| `completedQueue` | 本回合**已完成行动**的单位 id（按完成先后追加） | — |
| `normalQueue` | **正常队列**（原 `order` 语义） | `effectiveSpeed` 降序，队首=下一个行动 |
| `waitQueue` | **等待队列**（正常队列清空后才行动） | `effectiveSpeed` 升序，队首=最慢=下一个行动 |

- `currentUnitId` = `normalQueue[0]`；normal 清空后 = `waitQueue[0]`。
- 保留单位级 `hasActed`（守卫/防御过期语义），与队列同步：行动 → `hasActed=true` + 追加进 `completedQueue`。
- `advance()`：扫 `normalQueue`（跳阵亡）→ 扫 `waitQueue`（跳阵亡）→ 返回下一未行动单位；两者皆空 → 新回合。
- **新回合**：units 重置 `hasActed/hasMoved/retaliated`（**`defending` 跨回合保留**，见 §3）；`completedQueue=[]`、`normalQueue=sortOrder(units)`（降序）、`waitQueue=[]`。
- **阵亡剔除**：`dealDamage` 移除单位时，从三个队列同步剔除其 id（提供 `pruneDead(state)` 辅助）。

视图投影（`src/core/battle/queue.ts`）：

```ts
interface TurnOrderEntry {
  unitId: string
  side: BattleUnit['side']
  defId: UnitDefId
  hasActed: boolean
  segment: 'done' | 'normal' | 'wait'
}
buildTurnOrderQueue(state): TurnOrderEntry[]
// 按 [...completedQueue, ...normalQueue, ...waitQueue] 顺序投影，跳过阵亡残留 id，每条带 segment
```

### 2. 等待队列机制

**`battle/wait { unitId }`**：
- 当前单位在 `normalQueue` → 移出，按 `effectiveSpeed` **升序**插入 `waitQueue`；不置 `hasActed`（本回合稍后还会行动）。
- 当前单位已在 `waitQueue`（等待过）→ 命令拒绝（UI 同步 disable 按钮）。

**`battle/speedMod` 扩展重排**（定位受影响单位所在队列）：
- 在 `normalQueue`：保留 `currentUnitId` 及之前段，之后未行动段剔除阵亡按**降序**重排（现有逻辑平移）；
- 在 `waitQueue`：
  - 若当前单位也在 `waitQueue`（等待段正在行动）→ 保留当前单位及之前段，之后按**升序**重排（「不能移到当前单位前面」由当前单位不在重排段自动保证）；
  - 若当前单位不在 `waitQueue`（正常段还在行动）→ `waitQueue` 整体剔除阵亡后按**升序**重排；
- 受影响单位是当前单位自身 → 不重排（下回合生效）。

用户给的例子全部成立（写成单测锁定）：
- `AB 选择等待` → 正常 `CXYZ`，等待 `BA`；
- `X 行动时减速 A（比 B 慢）` → 正常 `YZ`，等待 `AB`；
- `Y 选择等待（A 仍比 Y 快）` → 正常 `Z`，等待 `YAB`；
- `Y 行动时减速 B（比 A、Y 都慢）` → 等待段 `YBA`（B 移到 Y 后面，不越过当前单位）。

### 3. 防御指令 + 攻防加成链

**`battle/defend { unitId }`**：当前单位 `defending=true`、`hasActed=true`，落队到 `completedQueue`。

- `BattleUnit.defending?: boolean`；在单位**下次行动**（move/attack/shoot/endTurn/defend）时清除 ——「直到下次行动」自然成立；`wait` 不清除（等待不是行动）。
- 跨回合保留：新回合不重置 `defending`。

**加成链（`src/core/battle/damage.ts` 重构）**：

```ts
BattleUnit.mods?: { atk?: number; def?: number; atkPct?: number; defPct?: number }
const DEFEND_BONUS = 2

computeActualAttack(defId, atkBonus, mods?) =
  (兵种攻击 + atkBonus + (mods?.atk ?? 0)) × (1 + (mods?.atkPct ?? 0))
computeActualDefense(defId, defBonus, mods?, defending?) =
  (兵种防御 + defBonus + (mods?.def ?? 0) + (defending ? DEFEND_BONUS : 0)) × (1 + (mods?.defPct ?? 0))
```

- 防御指令以 `defending` 标志在计算层 +2 点数（语义清晰、到期自动失效）。
- `computeDamage` 调用处改传 `attacker.mods / target.mods / target.defending`。
- 渲染层 infoPanel 显示计算结果（含加成分解）。buff/debuff 层留空位，技能系统将来写 `mods`。

### 4. 降 / 逃 / 和 + BattleResult 接口

**core 命令**（`battle/surrender` 已有，新增 `battle/flee`、`battle/negotiate`），三者强制结算战斗：

| 命令 | `phase` | `outcome` | 语义 |
|---|---|---|---|
| `battle/surrender` | `lost` | `surrendered` | 剩余部队清零、武将视作被俘、相当于战败 |
| `battle/flee` | `fled` | `fled` | 剩余部队清零、武将返回驻城、保留宝物 |
| `battle/negotiate` | `negotiated` | `negotiated` | 支付保释金、保留剩余部队、武将返回驻城 |

- `phase` 扩展为 `'combat' | 'won' | 'lost' | 'fled' | 'negotiated'`（渲染层已按 `!== 'combat'` 判终态，兼容）。
- `BattleState.outcome: BattleOutcome | null`：终态时记录（自然胜/败也写入 `won/lost`），供 `BattleResult` 与调试。
- `battle/negotiate` 校验：`state.enter.opponentKind !== 'wild'` 且 `state.enter.playerGold >= computeBail(state)`，否则拒绝。

**保释金纯函数**（`src/core/battle/`）：

```ts
const BAIL_RATIO = 1.5
computeBail(state): number =
  round(Σ 存活单位 count × UNIT_DEFS[defId].cost.gold × BAIL_RATIO)
```

**战斗参数 / 结算结果类型**（`src/core/battle/types.ts`）：

```ts
type BattleOutcome = 'won' | 'lost' | 'surrendered' | 'fled' | 'negotiated'

interface BattleEnterParams {
  playerGold: number              // 判断议和是否可负担
  opponentKind: 'faction' | 'wild' // 野怪不能议和
}

interface BattleResult {
  outcome: BattleOutcome
  remainingTroops: { defId: UnitDefId; count: number }[]  // 降/逃清零；和/胜保留
  expGained: number              // 仅战胜（现值 0，经验系统将来填）
  goldSettlement: number         // 议和 = -computeBail；其余 0
  generalCaptured: boolean | null // 降=true（被俘）；逃/和=false（返回驻城）；自然战败=null（探索层决定 30% 逃跑）
}
```

**接线**：
- `battle/init` payload 扩展：`playerGold?: number`、`opponentKind?: 'faction' | 'wild'`，存入 `state.enter`。
- **战斗测试模式**注入 `playerGold=10000`、`opponentKind='faction'`（可议和），让降/逃/和全部可测。
- `BattleScene.getBattleResult(): BattleResult`（终态时生成）；dev bridge 暴露 `getBattleResult()` 供 e2e / 调试断言。

### 5. UI：行动队列行整合

底部通栏条升级为单行：`【设置】【降】【逃】【和】 | 三段队列 | 【技】【候】【守】`

- **三段队列**（无分割线，连续排布）：
  - 已行动：半透明黑灰覆盖（现有逻辑）；
  - 正常：兵种侧色原色；
  - 等待：同侧色**略暗**（透明度略降）——无竖条/分隔线，连续但能分辨等待段。
- **新组件** `src/ui/BattleActionButtons.ts`：构造左右两组按钮，定位在底部条两侧。
  - `【设置】`：Unicode `⚙` 占位（disabled 灰态，不可点；将来设置界面启用）。
  - `【降】【逃】【和】`：hover 提示「投降/逃跑/议和」，点击 → 确认弹窗；**无快捷键**。
    - `【和】` disabled 条件：`opponentKind==='wild'` 或 `playerGold < computeBail(state)`。
  - `【技】(c)`：点击 → 空弹窗「技能系统开发中」+ 关闭（技能系统未开发）。
  - `【候】(w)`：dispatch `battle/wait`；当前单位已等待过 → disabled。
  - `【守】(d)`：dispatch `battle/defend`。
  - 非玩家回合 / busy / 终态 → 按钮整体不可点。
- **新组件** `src/ui/Modal.ts`：通用弹窗（半透明全屏遮罩 + 居中面板 + 标题/正文 + 按钮）。
  - `openConfirm(scene, { title, message, confirmLabel, cancelLabel }): Promise<boolean>`（遮罩外点击 = 取消）。
  - `openInfo(scene, { title, message, closeLabel }): Promise<void>`。
  - 确认弹窗文案：`确定要投降吗？` / `确定要弃军逃跑吗？` / `支付 xxx 金钱议和，确定吗？`。
- **快捷键**：键盘 `c/w/d`（仅玩家回合、非 busy、非终态）。
- **移除** `OperationButtons`（「跳过行动/撤退」被守/候与降/逃/和取代）。
- `TurnOrderQueue` 改为三段渲染；`BattleScene` 接线：按钮回调 → dispatch 对应命令 + 弹窗 + `refreshViews`。

### 6. 模式连接接口（只设计）

- 接口契约见 §4（`BattleEnterParams` / `BattleResult`），类型落 `src/core/battle/types.ts`。
- 「战斗测试」= 这套接口的 unit test：注入金钱/阵营，产出 `BattleResult` 供断言。
- 探索模式的真实接线（遭遇战触发、武将驻城/被俘/宝物、金钱扣减闭环、经验入库）为**将来工作**。

### 7. 今后再做文档

创建 `docs/FUTURE-WORK.md`，记录：
- 探索↔战斗真实接线（遭遇战、武将驻城/被俘/宝物、金钱扣减闭环、经验入库）；
- 技能系统本体（主动技/被动技、buff/debuff 效果写入 `mods`、技能弹窗填充）；
- 设置界面本体（`⚙` 启用 + 音量等）；
- 经验 / 升级系统（`expGained` 消费端）；
- 保释金经济闭环（经济系统接线）；
- 兵种地形加成、宝物系统（加成链 `mods` 消费端）。

文档保留本次设计的 `BattleEnterParams`/`BattleResult`/加成链契约，供将来实现参照。

## 测试

**core 单测**（`battleReducer.test.ts` 扩展 + 新 `wait.test.ts` / `result.test.ts`）：
- 三队列推进：move/attack/shoot/endTurn/defend 落 `completedQueue`；normal 清空后 wait 段行动；
- wait 升序插入（`AB 等待 → BA`）；不可二次等待；
- wait 段速度重排（`X 减速 A → AB`；`Y 等待 → YAB`；`Y 减速 B → YBA`）；
- normal 段速度重排（现有逻辑平移）+ 阵亡剔除；
- defend +2 生效且下次行动过期；跨回合保留；
- 加成链（mods 点数/百分比、defending +2、伤害计算）；
- 保释金（`computeBail` = 150%）；降/逃/和 结算（phase/outcome/BattleResult、gold 校验、野怪拒绝）。

**e2e**：
- 改造 `battle.spec.ts:525` 撤退流 → 【降】+ 确认弹窗 → 结果界面；
- 新增 守/候/技 按钮行为（含 w/d/c 快捷键）、三段队列显示断言、议和保释金弹窗文案与 disabled 态、`getBattleResult()` 断言。

## PRD 同步

- §15 战斗（MVP）：三队列重构、等待/防御、降逃和 + BattleResult、攻防加成链、行动队列行整合完成项；
- §16 待完成：新增上述功能对应的条目，未完成项保留 `[ ]` 并写明差距；
- §16 P3「设置界面」备注 `⚙` 占位。

## 验收标准

1. `battle/wait` 升序入等待队列，等待过的单位不可再等待；
2. 等待段与正常段速度变化均正确重排，当前单位永不被越过；
3. `battle/defend` +2 防御、下次行动过期；
4. 降/逃/和 确认后真实结算，产出 `BattleResult`；议和按 150% 保释金、野怪/金不足被拒；
5. 底部行动队列行三段连续显示（已行动灰 / 正常 / 等待略暗），两侧按钮 hover/disabled/快捷键正确；
6. `pnpm test` 全绿；相关 e2e 通过；`pnpm typecheck`（提交前）通过；PRD §15/§16 同步；`docs/FUTURE-WORK.md` 就绪。
