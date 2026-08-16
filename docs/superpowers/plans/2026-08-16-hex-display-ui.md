# 武将格/守将/杂兵/状态栏 UI 改进实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 4 项渲染层 UI 改进：① 武将格去圆点字大 ② 守将格显示繁体姓氏字 ③ 杂兵格去数量改士兵 logo + hover 显示兵力详情 ④ StatusBar 部队信息按战斗队列 style（大框+大字+右下角小字数量）。

**Architecture:** 全渲染层（`src/scenes/AdventureScene.ts` + `src/ui/StatusBar.ts`），core 零改动。参照 `src/ui/TurnOrderQueue.ts` 的战斗队列方块 style。

**Tech Stack:** TypeScript、Phaser 4（仅渲染）、Vitest（core 单测，本任务可能不涉及）、Playwright（e2e）、pnpm。

## Global Constraints

- **核心/渲染分离**：本任务只动渲染层，core 零改动。
- **中文注释、英文标识符**。
- **e2e**：断言程序化（`__game.getState()`），截图给人看。
- **每次改代码跑 `pnpm test`**；提交前一次 `pnpm typecheck`。

---

### Task 1: 武将格去圆点 + 字大 + 守将繁体字

**Files:**
- Modify: `src/scenes/AdventureScene.ts`（syncHeroSprites / drawGarrisons）
- Test: `src/e2e/campaign-map.spec.ts`（适配）、可能新增断言

**改动：**
1. **syncHeroSprites**（line ~832-878）：删除金点/银点 `fillCircle`（选中金点+白圈、其他银点，line ~843-854），只留**六角格边框**（当前黄框 0xffd166/其他灰蓝框 0x9fb4c7）。姓氏字号 15→**26px**，居中（`setOrigin(0.5)` 已有），选中武将金字 `#ffd166`、其他 `#e8eef5`，深描边 `#0b0f18` 保留。
2. **drawGarrisons**（line ~627-664）：在城寨底（深红六角 0x7a1f1f）上叠**姓氏大字**（name[0] 繁体，字号 ~26px，**白字 `#ffffff`**，深描边），替代中央旗标 + 名字标签（或保留旗标，姓氏字替代 label 文本）。效果：孔秀格 = 深红六角底 + 白字「孔」。

**e2e 适配：** `campaign-map.spec.ts` 若断言武将圆点/守将标签文本 → 改断言姓氏字或 sprite 存在。

- [ ] **Step 1: 写失败测试** — campaign-map 断言 getDebugState 暴露 `renderedHeroes`（已有）+ 守将格姓氏字文本
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** — syncHeroSprites/drawGarrisons
- [ ] **Step 4: 运行确认通过** — `pnpm test` + `pnpm test:e2e` + typecheck
- [ ] **Step 5: 提交** — `feat: 武将格去圆点字大 + 守将格繁体姓氏字`

---

### Task 2: 杂兵格士兵 logo + hover 兵力详情

**Files:**
- Modify: `src/scenes/AdventureScene.ts`（drawNeutrals / updateHexTooltip）
- Test: `src/e2e/hover-tooltip.spec.ts`（适配）

**改动：**
1. **drawNeutrals**（line ~679-714）：删中央兵力数字标签，改画**程序化士兵 logo**——深绿六角底（0x3f4f24）+ 一个简单头盔/盾牌形状（用 Graphics 画，如白色圆底 + 顶部小矩形盔顶，或参照 icon-town 的画法）。无现成士兵 icon（assets/icons 只有 gold/iron/stone/town/wood），程序化。
2. **updateHexTooltip**（Task 5 已做通用 tooltip）：杂兵格 tooltip 从 `野怪（N队）` 扩展为**逐兵种列出** `野怪：民兵 ×10`（多兵种逗号连接）。

**e2e 适配：** `hover-tooltip.spec.ts` 杂兵断言从「含野怪」改为「含民兵 ×10」等逐兵种文本。

- [ ] **Step 1: 写失败测试** — hover-tooltip 杂兵断言含逐兵种
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** — drawNeutrals 士兵 logo + tooltip 逐兵种
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 提交** — `feat: 杂兵格士兵 logo + hover 逐兵种详情`

---

### Task 3: StatusBar 部队按战斗队列 style

**Files:**
- Modify: `src/ui/StatusBar.ts`
- Modify: `src/scenes/AdventureScene.ts`（无，若 StatusBar 需传入样式）
- Test: `src/e2e/status-bar.spec.ts`（适配）

**改动：**
`StatusBar` 部队条目（line ~70-84）从「刀兵 ×20」文本改为 **TurnOrderQueue 式方块**（参照 `src/ui/TurnOrderQueue.ts` line ~46-81）：
- 每个部队一个方块：底色 `BATTLE_SIDE_COLORS[player]`（或固定 0x33415c）+ 中央兵种大字（`UNIT_DEFS[defId].gridLabel` 首字，字号 ~24px）+ **右下角小字数量**（`×20`，字号 ~12px，右下角定位）。
- 方块大小 ~44×44，横向排布在 hero 文本右侧。
- 需要 import `UNIT_DEFS`/`BATTLE_SIDE_COLORS`（检查从哪来；BATTLE_SIDE_COLORS 在 TurnOrderQueue 或 battle 相关）。
- getDebugState 保持暴露 units 文本（e2e 断言适配）。

**e2e 适配：** `status-bar.spec.ts` 部队断言从 `刀兵 ×20` 改为方块相关（getDebugState 暴露 units 数组仍可断言文本；若 e2e 断言文本不变则只需加方块渲染断言）。

- [ ] **Step 1: 写失败测试** — status-bar 断言部队方块存在（getDebugState 暴露 units 数组或方块信息）
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** — StatusBar 部队方块
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 提交** — `feat: StatusBar 部队按战斗队列 style（大框+大字+右下角数量）`

---

## 任务依赖

```
Task 1（武将格 + 守将）→ 独立
Task 2（杂兵 logo + tooltip）→ 独立，依赖 Task 5 tooltip 已有
Task 3（StatusBar）→ 独立，参照 TurnOrderQueue
```

三个任务相互独立，顺序执行。
