# 行动顺序条：中途速度修正重排（battle/speedMod）设计

日期：2026-08-14
状态：已确认，待实现

## 背景 / 问题

行动顺序条已按 `state.order` 显示，但 `order` 只在回合结算时重排（`advance()`）。当某单位在行动中被施加减速/加速（武将主动技能 / 兵种被动技能），其本回合剩余序需要立即重排；且加速再快也不能越过「当前正在行动的单位」。

另：单位被消灭后，`state.order` 里会残留其 id 直到回合结束（视图已隐藏，但 core 层不干净）。

## 目标

1. 提供战斗中途改速度的通道：命令 `battle/speedMod { unitId, delta }`；
2. 改速度后重排「当前单位之后的未行动段」——当前单位不动，**加速最多紧接其后、不越过当前单位**；
3. 重排顺带剔除阵亡残留 id（让 order 在 core 层也干净）；
4. 视图零改动（队列本就读 `state.order`）。

不改渲染逻辑；新增 core 命令 + 单测 + dev/e2e 钩子。

## 设计

### 1. core 字段与纯函数

- `BattleUnit.speedMod?: number`（战斗内速度修正，跨回合保留；叠加在 `speed` 覆盖 / 兵种速度之上）。
- `effectiveSpeed(unit)`（`types.ts`）：`(unit.speed ?? UNIT_DEFS[defId].speed) + (unit.speedMod ?? 0)`。`sortOrder` 与中途重排统一用它。

### 2. 命令 `battle/speedMod`

`speedMod(state, unitId, delta)`：
- 目标不在场 / 非战斗阶段 → no-op；
- `unit.speedMod += delta`；
- `reorderRemaining(state)`：取当前单位在 `order` 的位置，**前缀（已行动段 + 当前单位）原样保留**，其后**未行动段**剔除阵亡后按 `effectiveSpeed` 稳定降序重排（tie-break 沿用现有：同速攻方先行 → id）；
- 不改 `currentUnitId`；记 log（`速度±delta（现 N）`）。

「不越过当前单位」由「当前单位不在重排段」自动保证。

### 3. 接线

- dev bridge 暴露 `applySpeedMod(unitId, delta)`（BattleScene → dispatch + refreshViews；e2e / 调试用，技能系统将来从其接线）。
- e2e：`battle.spec.ts` 断言减速下沉、加速上移不越当前、队首不变。

### 4. 测试

- core 单测（battleReducer.test.ts）：初始序 / 减速后移 / 加速不越当前 / 改当前单位自身不重排（下回合生效）/ 重排剔除阵亡残留。
- e2e：经 `applySpeedMod` 断言 `turnQueue` 顺序随之变化。

### 5. PRD 同步

- §15 战斗（MVP）追加 speedMod 重排完成项。

## 验收标准

1. `battle/speedMod` 对未行动段重排正确；当前单位永不被越过；
2. 阵亡单位 id 在重排时从 `order` 剔除；
3. `pnpm test` 全绿；相关 e2e 通过；`pnpm typecheck`（提交前）通过。
