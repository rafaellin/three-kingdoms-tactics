# 战斗行动顺序条（TurnOrderQueue）设计

日期：2026-08-14
状态：已确认，待实现

## 背景 / 问题

「战斗测试」场景目前看不到回合内行动顺序：玩家不知道「当前谁在行动」「接下来轮到谁」「谁已经行动完」。参考 HOMM3 界面，需要一个行动顺序条。

关键事实：**所需数据在 core 已齐全**：

- `BattleState.order: string[]` —— 本回合行动序（速度降序，同速攻方先行）；
- `BattleState.currentUnitId: string | null` —— 当前行动单位；
- `BattleUnit.hasActed` —— 本回合是否已行动；
- `battleReducer.advance()` —— 全员行动完后 `turn+1`、重置标记、**按剩余部队当前速度重排 `order`**。

故本次几乎纯渲染层工作，符合 MVC：队列是 view，计算数据是 data。

## 目标

1. 画面底部一条**全宽横条**（HOMM3 风格），展示当前回合行动顺序；
2. 每格方块：底色 = 该单位兵种六边形格子同色，中央兵种大字；
3. 当前行动单位黄色描边高亮；已行动单位灰掉；
4. 每回合结束按 `state.order` 自动重排（core 已做，视图只读）；
5. 横条与地图交互**零冲突**（拖拽平移、滚轮缩放、点击）；
6. 操作按钮下一轮再移入同一条横条，本次只加行动顺序条（横条已为整行布局预留）。

不改 core 战斗逻辑；仅新增一个派生纯函数 + 单测。

## 设计

### 1. 布局与视觉

- **整行通栏条**：贴视口底部全宽横条，高约 88px，`setScrollFactor(0)` 固定不随相机滚动，半透明墨色底（`#1a2333` 系，与网格底色一致）。缩放布局（scale/resize）时重排。
- **队列方块**：按 `state.order` 顺序，每单位一块**正方形**（46×46，间距 8），**水平居中**排在横条内。中央写兵种大字（`gridLabel`：民/刀/弓/枪/骑兵），30px 粗体白字。
- **底色 = 六边形格子同色**：玩家绿 `0x33aa44`、敌方红 `0xcc3333`。把 `BattleScene` 里现有 `SIDE_COLORS` 上提到 `src/ui/theme.ts`（单源），网格与队列共用，杜绝漂移。
- **当前行动单位**：黄色描边（`0xffcc33`，3px），与战场上现有黄色高亮同风格。
- **已行动单位**：方块叠一层半透明灰 + 文字变灰，明显「灰掉」。
- **结算（won/lost）**：整条隐藏（与「结算隐藏操作按钮」一致）。
- **过渡态**：现有「跳过行动/撤退」按钮与 BGM 控件本轮不动，视觉上浮在横条上方；下一轮再移入同一条。

### 2. 数据与 MVC

- **不加新状态**：队列完全由 `state.order` + `currentUnitId` + `hasActed` 派生。
- 新增纯函数 `buildTurnOrderQueue(state)`（`src/core/battle/queue.ts`）：把 `order` 映射为视图条目 `{ unitId, side, defId, hasActed }`，**跳过已阵亡单位在 `order` 里的残留 id**。配 Vitest 单测：保序、跳死、hasActed 透传、跨回合重排（order 变化 → 队列变化）。
- 视图 `render(state)` 只读派生数据 + `currentUnitId` 画黄色高亮；视图不维护任何自己的队列状态。

### 3. 输入不冲突

- 横条与方块**全部不设 `setInteractive`**，纯显示层：
  - 地图拖拽相机（`BattleScene` 现有 pointer 逻辑）在横条上起手照样生效——`hitTestPointer` 不含横条，不拦截；
  - 将来加滚轮缩放（参考 `AdventureScene` 的 wheel 处理）不会被横条吞掉；
  - 点击横条 = 底部坐标换算出的 hex 在网格外，走现有 `handleClick` 自然 no-op；
  - **不加任何新输入监听**。

### 4. 组件结构

- 新类 `src/ui/TurnOrderQueue.ts`（对齐 `OperationButtons` / `BgmControls` 惯例）：
  - 1 个横条 `Graphics`（bg）+ 1 个方块 `Graphics`（每帧 clear 重绘）+ `Map<unitId, Phaser.Text>` 复用文字对象（照抄 `drawUnits` 的 label 复用/销毁模式）；
  - `render(state)`、`setVisible(v)`、`destroy()`；
  - 自带 `scale.on('resize')` 重排（横条宽度 = 视口宽，方块重新居中）。
- `BattleScene`：
  - `createLayers()` 实例化、`shutdown` 时 `destroy()`；
  - 把 `drawUnits / drawOverlay / updateLogAndResult` 抽成 `syncViews()`，`refreshViews()` 与**敌方 AI 行动循环**（`stepEnemyAi`）共用 → 敌方每步行动后队列即时刷新；
  - `getDebugState()` 暴露 `turnQueue` 数组供 e2e 断言。

### 5. 测试

- **core 单测**：`src/core/battle/queue.test.ts`（保序 / 跳死 / 跨回合重排）。
- **e2e**（`src/e2e/battle.spec.ts` 追加）：
  1. 开局 `turnQueue` = 派生自 `state.order`，首格 = `currentUnitId`；
  2. 行动后该格 `hasActed` → 灰掉，黄色高亮（`currentUnitId`）移到下一格；
  3. 整回合结束 → 队列按新 `order` 重排（速度降序）；
  4. **输入不冲突**：在横条位置起手拖拽 → 相机仍平移；点击横条 → 无移动/选中/选单位；
  5. 截图留给人目检（注明给谁看、看什么）。

### 6. PRD 同步

- 实现后同步 `PRD.md` §15 开发状态 / §16 待完成。

## 验收标准

1. 战斗开局即显示行动顺序条，方块顺序 = `state.order`，居中、满行；
2. 每次行动后高亮与灰态即时更新（玩家与敌方回合都刷新）；
3. 整回合结束队列重排正确；
4. 横条上拖拽/点击/滚轮不影响地图交互；
5. `pnpm test` 全绿；相关 e2e 通过；`pnpm typecheck`（提交前）通过。
