# 战役体验改进（7 项）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 落地用户反馈的 7 项战役体验改进（繁体武将名+格边框 / 结束回合移位 / 底部信息条 / hover tooltip / 去误导数字 / 访问驻城语义 / 升级提示接口）。第 6 项（杂兵复活）观察中暂不处理。

**Architecture:** core 层调整 `enterTown`/`garrisonTown`/`leaveTown`/`swapHeroes` 语义（访问保留在地图、驻城移入 garrison、交换单槽切换）+ `GeneralBase.name` 改繁体；渲染层改武将格（六角格边框+姓氏）、右侧面板（结束回合移位/去数字）、新增底部 StatusBar、hover tooltip 扩展。PRD §16 记录升级/技能提示接口。

**Tech Stack:** TypeScript（strict）、Phaser 4（仅渲染）、Vitest（core 单测）、Playwright（e2e）、pnpm。

## Global Constraints

- **核心/渲染分离（铁律）**：`src/core/` 纯 TS 零 Phaser/DOM；渲染层单向依赖 core。新增 core 逻辑配套同目录 `*.test.ts`。
- **确定性（不可破坏）**：core 内禁止裸 `Math.random`/`Date.now`；reducer 纯函数 immutable。
- **类型集中**：领域实体在 `src/core/state/GameState.ts`；`GeneralBase` 在 `src/data/generals.ts`。
- **中文注释、英文标识符**；风格与现有文件一致。
- **测试模式**：`*.test.ts` 同目录；`CommandLog`+`dispatch`；e2e 用 `__game.getState()` 程序化断言。
- **PRD 同步**：实现后同步 `PRD.md` §15/§16。
- **每次改代码跑 `pnpm test`**；提交前一次 `pnpm typecheck`。
- **subagent 模型**：沿用会话 model。

---

### Task 1: 访问/驻城语义重构（reducer + 渲染 + e2e）

**Files:**
- Modify: `src/core/state/reducer.ts`（enterTown/garrisonTown/leaveTown/swapHeroes + moveHeroTo 进城清除）
- Modify: `src/ui/TownPanel.ts`（交换按钮单槽语义）
- Modify: `src/scenes/AdventureScene.ts`（syncHeroSprites 对访问武将仍画；tryAutoEnterTown 调整）
- Test: `src/core/state/Campaign.test.ts`、`src/e2e/town-panel.spec.ts`

**Interfaces:**
- Consumes: `GameState.heroes`/`Town.visitorGeneralId`/`garrisonGeneralId`/`swapHeroes` 命令
- Produces: 新语义——**访问武将保留在 heroes（位置=城格，大地图可见叠城上）；驻城武将从 heroes 移除（进 garrison）**

**背景（权威 spec：`docs/superpowers/specs/2026-08-16-campaign-ux-improvements-design.md` §7）：** HOMM3 式——英雄走进城 = 访问（仍在地图，叠城上可见）；驻城 = 进 garrison（不可见）。「交换」= 驻城↔访问双向切换。

**reducer 变更：**
- `enterTown`（当前 line ~481）：**不再从 heroes 移除英雄**——英雄保留在 heroes（位置=城格），`town.visitorGeneralId = heroId`。
- `garrisonTown`（访问→驻城）：英雄**从 heroes 移除**，`garrisonGeneralId = heroId`、`visitorGeneralId = null`。
- `leaveTown`：
  - 驻城英雄出城 → garrison 清空 + **加回 heroes**（位置=城格）。
  - 访问英雄出城 → 仅清 `visitorGeneralId`（英雄本就在 heroes，无需加回；位置仍在城格）。
- `swapHeroes`：扩展——
  - 双槽都占：互换（现状）。
  - 只有驻城无访问：驻城出城（garrison 清空，英雄加回 heroes 位置=城格）。
  - 只有访问无驻城：访问进驻（访问移入 garrison，英雄从 heroes 移除）。
- `moveHeroTo`（当前 line ~360）：若移动的英雄当前是某城 `visitorGeneralId` 且移动离开城格 → 清空该城 `visitorGeneralId`（离开即结束访问）。

**渲染：**
- `syncHeroSprites`：访问英雄在 heroes 中 → 正常画（叠城上）；驻城英雄不在 heroes → 不画。
- `tryAutoEnterTown`：逻辑不变（走到城格 → enterTown → 现在英雄保留在地图）。
- `TownPanel`：「交换」按钮 dispatch 扩展语义（双槽→swap、单驻城→leaveTown、单访问→garrisonTown）。

**e2e：** `town-panel.spec.ts` 适配——进城后英雄**仍在 heroes**（位置=城格，断言 heroes 含 g-guan）；驻守后从 heroes 移除；交换单槽场景（只有驻城点交换=出城、只有访问点交换=进驻）。

- [ ] **Step 1: 写失败测试** — `Campaign.test.ts`：enterTown 后英雄保留在 heroes；garrisonTown 后移除；swap 单槽扩展
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** — reducer 语义 + 渲染 + TownPanel + e2e 适配
- [ ] **Step 4: 运行确认通过** — `pnpm test` + `pnpm test:e2e` + typecheck
- [ ] **Step 5: 提交** — `feat: 访问武将保留在地图（叠城上）+ 驻城才移入 garrison + 交换单槽切换`

---

### Task 2: 繁体武将名 + 武将格边框/姓氏（数据 + 渲染 + e2e）

**Files:**
- Modify: `src/data/generals.ts`（name 改繁体）
- Modify: `src/data/campaigns.ts`（startGenerals name 改繁体，若硬编码）
- Modify: `src/scenes/AdventureScene.ts`（syncHeroSprites 加六角格边框 + 姓氏文本）
- Modify: `src/data/battleTest.ts`（吕布→呂布）
- Test: `src/e2e/*.spec.ts`（关羽→關羽 等断言适配，约 20 处）

**Interfaces:**
- Consumes: `GeneralBase.name`（繁体）、`GENERAL_BASES`/`CAMPAIGNS` 武将名
- Produces: 武将名繁体显示（所有显示点自动生效）；武将格边框 + 姓氏首字

**背景（权威 spec §1）：** 不加 label，武将名直接存繁体；地图显示取第一个字（姓氏）。所有显示武将名的地方（右侧列表/城池面板/战斗武将卡）自动变繁体。

**数据变更（`src/data/generals.ts`）：**
```ts
'g-guan':   { id: 'g-guan',   name: '關羽', ... }   // 原 关羽
'g-lvbu':   { id: 'g-lvbu',   name: '呂布', ... }   // 原 吕布
'g-zhoucang': { id: 'g-zhoucang', name: '周倉', ... } // 原 周仓
'g-sunqian':  { id: 'g-sunqian',  name: '孫乾', ... } // 原 孙乾
'g-kongxiu':  { id: 'g-kongxiu',  name: '孔秀', ... } // 孔秀 繁简同
```
`src/data/campaigns.ts` startGenerals 的 name 字段同步改（若它硬编码 name 而非读 GENERAL_BASES——检查；应为 `name: '關羽'` 等）。`src/data/battleTest.ts` 注释里的吕布名。

**渲染（`syncHeroSprites`）：**
- 每个英雄 sprite 画**六角格边框**（`fillHex`/`strokePoints` 六角形）：当前操作武将（selectedHeroId）黄色 `0xffd166`，其他武将灰/白。
- 格内**姓氏文本**（name 第一个字符，繁体）：mapOnly Text，位置 = hero 格中心，随 sprite 定位。当前武将金点高亮保留。

**e2e 适配：** grep 所有 `关羽|周仓|孙乾|吕布` 断言 → 繁体（battle.spec/campaign-*/right-panel/town-panel/world-snapshot/battleReducer.test 等约 20 处）。`generals.test.ts`/`Campaign.test.ts` 注释里的名字不改（注释可留简体，断言 name 字段改繁体）。

- [ ] **Step 1: 写失败测试** — generals.test.ts 断言 name 为繁体（關羽）
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** — 数据改繁体 + syncHeroSprites 边框/姓氏 + e2e 适配
- [ ] **Step 4: 运行确认通过** — `pnpm test` + `pnpm test:e2e` + typecheck
- [ ] **Step 5: 提交** — `feat: 武将名繁体（關羽等）+ 武将格六角边框/姓氏显示`

---

### Task 3: 右侧面板 — 结束回合移位 + 去误导数字

**Files:**
- Modify: `src/ui/RightPanel.ts`
- Modify: `src/scenes/AdventureScene.ts`（删右下结束回合按钮）
- Test: `src/e2e/right-panel.spec.ts`

**Interfaces:**
- Consumes: `endTurn()`（AdventureScene 现有方法）、RightPanel actions
- Produces: RightPanel 加「结束回合」按钮（在「下一个」下）；武将行 label 去 armyCount

**背景（权威 spec §2/§5）：** 结束回合按钮从右下角移到右侧面板「下一个」下；武将行 `关羽 Lv5 32` 中的 32（armyCount 兵力总数）误导，去掉。

**改动：**
- `RightPanel.ts`：`actions` 加 `onEndTurn()`；在「下一个(h)」按钮下方加「结束回合」按钮（同 `nextHero` 样式）。武将行 label：`${name} Lv${level}`（去掉 armyCount）。`RightPanelHeroRowDebug` 保留 `armyCount`（e2e 用）但显示去掉。
- `AdventureScene.ts`：删除底部 `endTurnButton`（右下角，line ~480-496）；`repositionBottomControls` 相应简化；E 键保留。RightPanel 创建时传 `onEndTurn: () => this.endTurn()`。

**e2e：** `right-panel.spec.ts` 加断言：右侧有「结束回合」按钮（点击后 turn+1/行动力回满）；武将行 label 不含数字（`关羽 Lv5`）。

- [ ] **Step 1: 写失败测试** — right-panel.spec 断言结束回合按钮存在 + 行 label 无数字
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 提交** — `feat: 右侧面板加结束回合按钮 + 武将行去误导数字`

---

### Task 4: 底部当前武将信息条 StatusBar

**Files:**
- Create: `src/ui/StatusBar.ts`
- Modify: `src/scenes/AdventureScene.ts`（接线）
- Test: `src/e2e/status-bar.spec.ts`（新）

**Interfaces:**
- Consumes: `currentHero(state)`/`currentPlayer(state)`/`state.generals`
- Produces: `StatusBar` 组件（屏幕底部一行：当前武将名字/等级/剩余行动力/带部队列表）

**背景（权威 spec §3）：** 屏幕最底部显示当前选中武将信息，像战斗界面队列那样逐格列出部队。

**改动：**
- `StatusBar`（类似 RightPanel 模式，屏幕底部 fixed）：`refresh(state)` 显示当前武将：
  - `名字 Lv等级 移动力 X/Y`
  - 带部队：逐格 `兵种名 ×数量`（如 `刀兵 ×20  弓兵 ×12`），像 TurnOrderQueue 那样。
- `getDebugState` 暴露 `statusBar`（文本）供 e2e。
- AdventureScene：创建 + `refreshViews` 刷新 + shutdown 销毁。

**e2e：** `status-bar.spec.ts`：进战役 → 底部信息条显示 `關羽 Lv5 移动力 6/6` + `刀兵 ×20`；移动后行动力变化。

- [ ] **Step 1: 写失败测试** — status-bar.spec 断言信息条文本
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 提交** — `feat: 底部当前武将信息条（名字/等级/行动力/部队列表）`

---

### Task 5: hover 格 tooltip（地形/消耗/驻军）+ 升级提示接口 + PRD

**Files:**
- Modify: `src/scenes/AdventureScene.ts`（updateNodeTooltip 扩展为通用格 tooltip）
- Modify: `PRD.md`（§16 升级/技能提示接口）
- Test: `src/e2e/hover-tooltip.spec.ts`（新）

**Interfaces:**
- Consumes: `state.map.terrain`/`getTerrain`/`state.garrisons`/`neutrals`/`heroes`/`towns`
- Produces: 任意格 tooltip（地形/移动消耗/驻军）；升级提示接口文档化

**背景（权威 spec §4/§8）：** hover 任意格显示地形/移动消耗（或不可通过）/驻军信息；升级提示 + 2选1技能界面接口预留（技能系统未做）。

**改动：**
- `updateNodeTooltip` 扩展为通用「格信息 tooltip」：悬停任意格显示：
  - 地形名 + 移动消耗（`森林 1.5`）或（`山地 不可通过`）
  - 若有驻军：`守将 孔秀（2队）` / `野怪（1队）` / 其他武将（英雄名）
  - 若城池：城名 + 驻军/驻城/访问武将
  - 无内容（平地无驻军）→ 不显示或显示地形名
- 复用现有 `nodeDetailText` 或新增 tooltip text；更新逻辑在 `updateHover`。
- **升级提示接口**：core `resolveBattle` 已返回（army/xp/level 变化由 gainXp 处理）；渲染层在战斗返回后可查参战英雄 `level` 是否变化 → 弹「升級！」提示（本次只做提示，技能 2 选 1 界面因技能系统未做不实现）。`PRD.md` §16 补 todo：「战斗结束升级提示 + 技能 2 选 1 界面（技能系统就绪后）」。代码注释标出升级检测 hook。

**e2e：** `hover-tooltip.spec.ts`：悬停山地 → 文本含「不可通过」；悬停杂兵格 → 含野怪/兵力；悬停城池 → 城名。升级提示（战斗返回后 level 变化）——用 dev-bridge 注入大量经验或强敌确保升级 → 返回 → tooltip/提示。

- [ ] **Step 1: 写失败测试** — hover-tooltip.spec 断言
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** — tooltip 扩展 + 升级提示 + PRD
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 提交** — `feat: hover 格 tooltip（地形/消耗/驻军）+ 升级提示接口 + PRD §16`

---

## 任务依赖

```
Task 1（访问/驻城语义，core+render）——最核心
   ↓
Task 2（繁体名 + 格边框/姓氏，数据+render，波及大量 e2e）
   ↓
Task 3（右侧面板：结束回合移位 + 去数字）
   ↓
Task 4（底部 StatusBar）
   ↓
Task 5（hover tooltip + 升级提示接口 + PRD）
```

> Task 1 与 Task 2 都改 `syncHeroSprites`（Task 1 访问武将画法、Task 2 边框/姓氏）——两者有交叠，顺序执行：Task 1 先改「访问保留」语义，Task 2 再加边框/姓氏（基于 Task 1 后的 syncHeroSprites）。若冲突，Task 2 的 implementer 需看 Task 1 后的现状。
