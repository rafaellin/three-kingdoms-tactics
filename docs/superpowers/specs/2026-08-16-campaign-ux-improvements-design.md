# 战役体验改进（8 项反馈，第 6 项暂不出现观察中）

日期：2026-08-16
状态：设计稿（待确认）

## 背景

Player 重构 + 战役体验修复（`c2d4e08..3c97b22`）落地后，用户试玩反馈 8 项改进。其中第 6 项（杂兵复活）经再次试玩「好像又没了」——先不处理，观察。其余 7 项设计如下。

## 决策（用户确认）

| # | 项 | 决定 |
|---|---|---|
| 1 | 武将格显示 | **config 加 `label` 字段**（繁体姓氏，如 關/關羽），格内写姓氏 + 六角格边框（当前操作武将黄框，其他武将也加框） |
| 2 | 结束回合按钮 | 从右下角移到**右侧面板「下一个(h)」下方** |
| 3 | 底部当前武将信息条 | 屏幕最底部一行：名字/等级/剩余行动力/带部队（兵种+兵力数，像战斗队列那样逐格列出） |
| 4 | hover 格 tooltip | 地形/移动消耗（或不可通过）/驻军信息（武将、部队数量） |
| 5 | 右侧武将条 | 去掉 `armyCount` 数字（那个「32」是兵力总数，误导） |
| 6 | 杂兵复活 | ~~暂不出现，观察~~ |
| 7 | 访问/驻城 | **访问武将保留在大地图**（叠城上，HOMM3 式）；驻城才移入 garrison；「交换」按钮扩展语义 |
| 8 | 升级/技能提示 | 升级提示 + 2选1技能界面**接口预留**（技能系统未做，文档化 + 留钩子） |

## 各项方案

### 1. 武将格：繁体姓氏 + 六角格边框

- **不加 label**（用户确认）：武将名字**直接存繁体**（关羽→關羽、周仓→周倉、孙乾→孫乾、孔秀→孔秀），地图显示时取名字第一个字（關/周/孫/孔）。所有显示武将名字的地方（右侧列表/城池面板/战斗武将卡）自动变繁体。
- `GENERAL_BASES` 各武将 `name` 改为繁体：關羽/周倉/孫乾/孔秀。（`id` 不变，`g-guan` 等；战役配置 `campaigns.ts` 的武将引用 `GENERAL_BASES` 自动生效；`battleTest.ts` 的吕布名也改 呂布 保持一致性。）
- `syncHeroSprites`（AdventureScene）：武将 sprite 加六角格边框（fillHex 六角形，**当前操作武将黄色 0xffd166 边框，其他武将灰/白边框**）+ 格内姓氏文本（名字第一个字，繁体）。当前武将沿用金点高亮，其他武将也画框。
- 姓氏文本用 mapOnly Text，随 sprite 定位。

### 2. 结束回合按钮移到右侧面板

- `AdventureScene` 底部 `endTurnButton`（右下角）删除；在 `RightPanel` 的「下一个(h)」下方加「结束回合」按钮（同回调 `endTurn()`）。
- 保留 E 键快捷键。
- RightPanel 增加 `onEndTurn` action + 按钮。

### 3. 底部当前武将信息条

- 新增 `src/ui/StatusBar.ts`（或复用 RightPanel 模式）：屏幕最底部一行，显示当前选中武将：
  - 名字 + 等级 + 剩余行动力（如 `关羽 Lv5 移动力 5/6`）
  - 带部队：逐格列出 `兵种名 ×数量`（如 `刀兵 ×20  弓兵 ×12`），像战斗界面 TurnOrderQueue 那样。
- AdventureScene：创建 + `refreshViews` 刷新 + shutdown 销毁。

### 4. hover 格 tooltip

- `updateNodeTooltip` 扩展为通用「格信息 tooltip」：悬停任意格显示：
  - 地形名 + 移动消耗（`森林 1.5`）或（`山地 不可通过`）
  - 若有守将/杂兵/其他武将：驻军信息（武将名 + 部队数）
  - 若城池：城名 + 驻军/驻城/访问武将
- 复用现有 `nodeDetailText` 或新增 tooltip text；更新逻辑在 `updateHover`/`updateNodeTooltip`。

### 5. 右侧武将条去掉 armyCount

- `RightPanel.ts` 武将行 label 从 `关羽 Lv5 32` → `关羽 Lv5`（去掉 armyCount）；`RightPanelHeroRowDebug` 保留 armyCount（e2e 可能用）但显示去掉。

### 6. 杂兵复活 — 观察

### 7. 访问/驻城（核心改动）

**reducer**（`src/core/state/reducer.ts`）：
- `enterTown`：**不再把英雄从 `heroes` 移除**——英雄保留在 heroes（位置=城格），`town.visitorGeneralId = heroId`。英雄在大地图仍可见（叠城上）。
- `garrisonTown`（访问→驻城）：驻城时**把英雄从 heroes 移除**（进 garrison 槽，大地图不可见），`garrisonGeneralId = heroId`、`visitorGeneralId = null`。
- `leaveTown`：驻城英雄出城 → 从 garrison 槽清空 + **加回 heroes**（位置=城格）；访问英雄「出城」→ 仅清 visitorGeneralId（英雄本就在 heroes，无需加回，位置仍在城格可继续走）。
- `swapHeroes`：**扩展语义（单槽切换）**——城池有两个槽（驻城 `garrisonGeneralId` + 访问 `visitorGeneralId`）：
  - **双槽都占**：互换（现状）。
  - **只有驻城、无访问**：点交换 = **驻城武将出城**（garrison 清空，英雄加回 heroes 位置=城格）——即「出城」。
  - **只有访问、无驻城**：点交换 = **访问武将进驻**（访问移入 garrison，英雄从 heroes 移除）——即「驻守」。
  - 即「交换」按钮是驻城↔访问的**双向切换**：双槽互换、单槽切到另一侧。
- `transferTroops` actor（garrison 优先）保持不变。

**渲染**：
- `syncHeroSprites`：hero 在 heroes 中（含访问者）→ 画；驻城者不在 heroes → 不画（已在 garrison）。访问者 sprite 位置=城格（叠城上）。
- `TownPanel`：「交换」按钮按上述扩展语义 dispatch（双槽→swap、单驻城→出城、单访问→驻守）。按钮 label 保持「交换」。

**e2e**：`town-panel.spec` 适配——进城后英雄**仍在 heroes**（位置=城格）；驻守后从 heroes 移除；交换单槽场景。

### 8. 升级/技能提示接口预留

- 技能系统未做（PRD §16 P0 未实现）。本次**只留接口 + 文档**：
  - `PRD.md` §16 补 todo：「战斗结束升级提示 + 技能 2 选 1 界面」。
  - core 预留：`resolveBattle` 返回后，若参战英雄升级（level 变化）→ 渲染层可查 `general.level` 变化弹提示；技能槽解锁（`skillSlots` 递增）→ 留 `skillOffer` 事件位（future）。
  - 本次不实现 UI（技能系统无数据），只确保升级提示的 hook 点在文档/代码注释明确。

## 不做（YAGNI）

- 技能系统本体（2选1 UI、技能池）。
- 杂兵复活修复（第 6 项观察，若再现再查）。
- 武将格贴图/美术（用程序化边框 + 文本）。

## 测试

- core：`enterTown` 保留英雄在 heroes；`garrisonTown` 移出；`swapHeroes` 单槽扩展语义；`leaveTown` 访问/驻城两条路径。
- e2e：town-panel 适配（访问保留/驻守移出/交换单槽）；武将格边框/姓氏（getDebugState 暴露 label + 边框状态）；底部信息条（文本断言）；hover tooltip（地形/消耗/驻军文本）。
- 全量 `pnpm test` + `pnpm test:e2e` + typecheck。

## 关键文件

| 文件 | 改动 |
|---|---|
| `src/data/generals.ts` | `GeneralBase.label` + 各武将繁体姓氏 |
| `src/core/state/reducer.ts` | `enterTown`/`garrisonTown`/`leaveTown`/`swapHeroes` 语义调整 |
| `src/core/state/GameState.ts` | 无（heroes/visitor 语义已支持） |
| `src/scenes/AdventureScene.ts` | 武将格边框+姓氏；删底部结束回合按钮；hover tooltip 扩展；底部信息条接线 |
| `src/ui/RightPanel.ts` | 加「结束回合」按钮；去掉 armyCount；「下一个」下移 |
| `src/ui/StatusBar.ts`（新） | 底部当前武将信息条 |
| `src/ui/TownPanel.ts` | 「交换」按钮扩展语义 |
| `PRD.md` | §16 升级/技能提示 todo |
