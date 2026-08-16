# 战役体验修复 + Player 重构实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 引入 Player 实体，把资源/迷雾/占领/城池/轮转全部从势力绑定改为玩家绑定（同势力玩家不串），并修复 5 个战役 UX 问题（图标消失/英雄重叠/结束回合/切换武将/战斗交互）。

**Architecture:** core 层新增 `Player { id, faction, kind: 'human'|'ai' }`，`GameState.resources/visibility/nodeStates.owner/town.owner` 全部改为 `PlayerId` 键，删除 `currentFaction`，`HeroUnit` 加 `playerId`（保留 faction 作势力色显示）。回合模型改为按玩家序列轮转（战役 玩家→AI→system，探索 玩家→system），`aiAct`/`spawnNeutrals` 留接口 MVP no-op。渲染层从 `players[currentPlayerId].faction` 取势力色，新增右侧武将/城池列表（RightPanel）+ 悬停刀剑 + 战斗胜利移动/失败回城。

**Tech Stack:** TypeScript（strict）、Phaser 4（仅渲染）、Vitest（core 单测）、Playwright（e2e）、pnpm。

## Global Constraints

- **核心/渲染分离（铁律）**：`src/core/` 纯 TS 零 Phaser/DOM；渲染层单向依赖 core。新增 core 逻辑必须配套同目录 `*.test.ts`。
- **确定性（不可破坏）**：core 内禁止裸 `Math.random`/`Date.now`；随机走注入 RNG；reducer 纯函数 immutable。
- **类型集中**：领域实体在 `src/core/state/GameState.ts`；`Player` 实体定义于此。
- **中文注释、英文标识符**；风格与现有文件一致。
- **测试模式**：`*.test.ts` 同目录；`CommandLog` + `dispatch` 驱动；断言 `toBe/toEqual`。
- **PRD 同步**：实现后同步 `PRD.md` §5（多英雄/城池/回合模型）§15/§16。
- **每次改代码跑 `pnpm test`**；提交前一次 `pnpm typecheck`。
- **subagent 模型**：沿用会话 model（不覆盖）。

---

### Task 1: GameState 类型重构 — Player 实体 + 全部势力→玩家绑定

**Files:**
- Modify: `src/core/state/GameState.ts`
- Modify: `src/core/state/reducer.ts`
- Modify: `src/data/bootstrap.ts`
- Modify: `src/data/campaigns.ts`
- Modify: `src/core/testing/setup.ts`
- Test: `src/core/state/GameState.test.ts`、`src/core/state/Movement.test.ts`、`src/core/state/Campaign.test.ts`

**Interfaces:**
- Consumes: 现有 `FactionId`/`Resources`/`Visibility`/`MapData`/`Axial`/`UnitDefId`
- Produces: `Player { id: string; faction: FactionId; kind: 'human'|'ai' }`；`GameState.players`/`currentPlayerId`；`resources/visibility/nodeStates.owner/town.owner` 改 PlayerId 键；`HeroUnit.playerId`；`currentHero`/`currentPlayer` helpers；`aiAct`/`spawnNeutrals` 接口

**背景（权威 spec：`docs/superpowers/specs/2026-08-16-campaign-ux-fixes-design.md` §3）：** 用户确认全部势力绑定改玩家绑定（同势力玩家不串）。这是横切重构——GameState 类型一改，reducer/数据/渲染/测试必须同步，故合为一个大任务。

**GameState.ts 变更：**
```ts
/** 玩家（回合操作单元）：同势力可有多个玩家（如两个魏势力玩家对战），势力仅作显示/渲染标签 */
export interface Player {
  id: string
  faction: FactionId
  kind: 'human' | 'ai'
}

export interface GameState {
  // ...现有字段...
  /** 参与回合的玩家序列（顺序 = 轮转顺序） */
  players: Player[]
  /** 当前行动玩家 id；setup 前为 null */
  currentPlayerId: string | null
  /** 各玩家资源，key = PlayerId */
  resources: Record<string, Resources>          // 原 Record<FactionId, ...>
  /** 按玩家的战争迷雾，key = PlayerId（同势力玩家各自独立视野） */
  visibility: Record<string, Record<string, Visibility>>  // 原 Record<FactionId, ...>
  // 删除 currentFaction、turnOrder（FactionId[]）
}
// NodeState.owner: FactionId | null → PlayerId | null（string | null）
// Town.owner: FactionId → PlayerId（string）
// HeroUnit 加 playerId: string；保留 faction（势力色显示）

/** 当前操作玩家（从 currentPlayerId 取；无则 players[0]） */
export function currentPlayer(state: GameState): Player | null
/** 当前操作英雄（复用现有 currentHero，内部经 hero.playerId） */
```

**reducer.ts 变更：**
- `setup`/`campaignStart`：`players` 从 payload（SetupPayload 加 `players: Player[]`；campaign 用 `campaign.players`）；`currentPlayerId = players[0].id`；resources/visibility 按 players 初始化（每个玩家 ZERO_RESOURCES/空雾）。
- `moveHeroTo`：迷雾查 `visibility[hero.playerId]`；**新增「目标格被其他英雄占据 → 拒绝」**（问题2）。
- `advanceTurn`：按 `players` 序列推进（见 Task 2）。
- `computeDailyIncome`/`applyDailyIncome`/`canAfford`（GameState.ts 里的纯函数）：改 PlayerId——按玩家循环结算，城池/矿 owner 是 PlayerId。
- `aiAct(state, playerId)`（新纯函数，`src/core/state/ai.ts`）：MVP 返回原 state（AI 配置不动）；留接口注释。
- `spawnNeutrals(state)`（新纯函数）：MVP 返回原 state；留接口。

**数据适配：**
- `bootstrap.ts`：`START_FACTIONS` 改为 `START_PLAYERS: Player[]`（`[{id:'p1', faction:'shu', kind:'human'}, ...]`？——探索测试单玩家 p1/shu；原四势力仅保留 shu 玩家）。资源 `START_RESOURCES` 按玩家。
- `campaigns.ts`：`CampaignConfig.players`（战役 `[{id:'p1',faction:'shu',kind:'human'},{id:'ai1',faction:'wei',kind:'ai'}]`）+ `heroStarts` 加 `playerId`。
- `setup.ts`：`makeSetup` payload 用 `players`。

**测试适配：** `resources.shu`→`resources.p1`（等）、`visibility.shu`→`visibility.p1`、`nodeStates.owner`/`town.owner` → PlayerId、`currentFaction` 断言 → `currentPlayerId`。同步 `aiAct`/`spawnNeutrals` 单测 + 英雄重叠单测 + 每日结算按玩家单测。

- [ ] **Step 1: 写失败测试** — 新断言：`players` 非空、`currentPlayerId`、英雄重叠拒绝
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** — GameState/reducer/数据/ai.ts/spawnNeutrals 全量变更 + 测试适配
- [ ] **Step 4: 运行确认通过** — `pnpm test` 全绿 + `pnpm typecheck` 干净
- [ ] **Step 5: 提交** — `feat: Player 实体 + 资源/迷雾/占领/城池全部玩家绑定（同势力不串）`

---

### Task 2: 回合模型 — 按玩家序列轮转 + system 结算

**Files:**
- Modify: `src/core/state/reducer.ts`（advanceTurn）
- Test: `src/core/state/Campaign.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `players`/`currentPlayerId`/`aiAct`/`spawnNeutrals`
- Produces: `advanceTurn` 按玩家推进

**advanceTurn 重写（权威 spec §3）：**
```
advanceTurn(state):
  players = state.players
  if players.length === 0: return state
  idx = players.findIndex(p => p.id === state.currentPlayerId)
  let next = (idx + 1) % players.length
  let wrapped = next === 0   // 轮完一圈 → 进 system
  // 推进到下一个 human 玩家（AI 自动行动后继续）
  while (players[next].kind === 'ai') {
    state = aiAct(state, players[next].id)   // MVP no-op
    next = (next + 1) % players.length
    if (next === 0) wrapped = true
  }
  const nextPlayer = players[next]
  // 重置该玩家所有英雄移动力
  const heroes = state.heroes.map(h => h.playerId === nextPlayer.id ? { ...h, movementLeft: h.maxMovement } : h)
  let nextState = { ...state, currentPlayerId: nextPlayer.id, heroes }
  // system：轮完一圈 → 天数+1、每日结算、野怪生成接口
  if (wrapped) {
    nextState = spawnNeutrals(nextState)
    nextState = applyDailyIncome(nextState)   // 按玩家结算
    nextState = { ...nextState, turn: nextState.turn + 1 }
  }
  return nextState
```
- 战役：players=[p1(shu human), ai1(wei ai)] → p1 结束 → ai1（aiAct no-op）→ 回 p1 + system（天数+1）
- 探索：players=[p1] → p1 结束 → 直接 system → 回 p1
- **结束回合 = 下一天 + 行动力回满**（问题3）

- [ ] **Step 1: 写失败测试** — advanceTurn 战役 p1→ai→p1（天数+1、p1 英雄行动力回满）；探索 p1→p1（天数+1）
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** — advanceTurn 重写 + aiAct 接线
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 提交** — `feat: 回合模型按玩家序列轮转（战役 玩家→AI→system，探索 玩家→system）+ system 结算`

---

### Task 3: 渲染层适配 — faction→playerId 查询 + createLayers sprite Map 重置

**Files:**
- Modify: `src/scenes/AdventureScene.ts`

**Interfaces:**
- Consumes: Task 1 的 `currentPlayer`/`currentHero`/`players`
- Produces: 渲染层全部 `visibility[hero.faction]`/`resources[hero.faction]` → `visibility[hero.playerId]`/`resources[player.id]`；`currentFaction` 显示 → `currentPlayer(state).faction`

**改动（含问题1 sprite Map 重置 + 问题2 寻路阻挡）：**
1. **createLayers() 开头清空 5 个 Map**（问题1）：
   ```ts
   this.heroSprites.clear(); this.townSprites.clear(); this.nodeSprites.clear()
   this.garrisonLabels.clear(); this.neutralLabels.clear()
   ```
   （`scene.start` 复用实例时旧 GameObject 已销毁，Map 残留死引用 → 必须清）
2. **所有 `.faction` 查询改 playerId**：`drawFog`/`drawTowns`/`drawNodes`/`drawGarrisons`/`drawNeutrals`/`updateHud`/`makeMapCosts`/`handleClick`/`updateNodeTooltip`/`getDebugState` 里 `visibility[hero.faction]` → `visibility[hero.playerId]`；`resources[hero.faction]` → `resources[currentPlayer(state).id]`；`town.owner !== hero.faction` → `town.owner !== currentPlayer(state).id`。
3. **makeMapCosts 加「其他英雄格」阻挡**（问题2）：
   ```ts
   garrisonAt: (h) =>
     this.state.garrisons.some(g => g.alive && hexKey(g.position) === hexKey(h)) ||
     this.state.heroes.some(oh => oh.generalId !== hero.generalId && hexKey(oh.position) === hexKey(h))
   ```

- [ ] **Step 1: 写失败测试** — 现有 e2e（movement/resources/campaign-map）适配 playerId 断言；新增「重进 Adventure 后 sprite 存在」断言（问题1）
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现** — 上述三块
- [ ] **Step 4: 运行确认通过** — `pnpm test` + `pnpm test:e2e`
- [ ] **Step 5: 提交** — `fix: 渲染层按玩家绑定 + createLayers 重置 sprite Map（图标消失）+ 英雄重叠寻路阻挡`

---

### Task 4: 右侧武将/城池列表 + 下一个(h) 快捷键

**Files:**
- Create: `src/ui/RightPanel.ts`
- Modify: `src/scenes/AdventureScene.ts`

**Interfaces:**
- Consumes: `hero/select` 命令、`currentHero`、`state.players`/`heroes`/`towns`
- Produces: `RightPanel` 组件（列出当前玩家英雄 + 城池 + 「下一个(h)」按钮）

**改动：**
- `RightPanel`（屏幕右侧固定，简单布局不做美化）：当前玩家（`players[currentPlayerId]`）的武将列表（名字/等级/兵力总数，点击 → `hero/select` 切换）、城池列表（名字/等级，点击 → 调 `openTownPanel`）、「下一个(h)」按钮。
- AdventureScene：创建 RightPanel + `refreshViews` 时 `panel.refresh(state)` + `keydown-H` → 循环切换 `hero/select`（问题4）。
- 复用 `makeButton`/`theme` 模式。

- [ ] **Step 1: 写失败测试** — e2e：进战役 → 右侧列 3 武将 → 点击周仓 → `selectedHeroId==='g-zhoucang'` → 按 h → 切孙乾
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 提交** — `feat: 右侧武将/城池列表 + 下一个(h) 切换（hero/select）`

---

### Task 5: 战斗交互 — 相邻移动触发 + 胜利移动/失败回城 + 悬停刀剑

**Files:**
- Modify: `src/scenes/AdventureScene.ts`（triggerBattle/updateHover/drawOverlay）
- Modify: `src/core/state/reducer.ts`（campaign/resolveBattle 扩展）

**Interfaces:**
- Consumes: `hero/move`、`campaign/resolveBattle`、`moveCost`（terrain）
- Produces: `ResolveBattlePayload.targetPosition: Axial`（胜利后英雄位置）

**改动：**
1. **触发（直接移动上去交战；用户确认修订）**：点击存活守将/未歼灭杂兵格 → 英雄**直接移动到目标格本身**（`animateMove` 到该格，`moveHeroTo` 允许把存活守将/未歼灭杂兵格作为移动终点放行）→ 到达触发战斗。**相邻格不触发交战**。**移动路径不能穿过任何武将**（寻路 `makeMapCosts`：所有武将占据格——己方英雄/存活守将/未歼灭杂兵——不可通行）。
2. **「不能穿过」+「不能重叠」**（问题2 + 问题5）：`moveHeroTo` 相邻格校验——被**其他英雄**占据 → 拒绝（不能重叠）；存活守将/未歼灭杂兵格 → 作为移动终点放行（走进触发战斗）。寻路把武将格全挡（不能穿过），目标格单独经 `hero/move` 终点处理。
3. **resolveBattle 扩展**：失败 → 英雄回最近己方城（MVP = 玩家第一城格），行动力=0；胜利时英雄已在目标格（移动到位即占据），无需额外移动，**不清空剩余移动力**（已扣走进去的代价）。
4. **悬停刀剑**（问题5）：`updateHover` 悬停存活守将/未歼灭杂兵格（英雄可达该格）→ `cursorKind='sword'` + `drawOverlay` 目标格红色交战高亮（参照 BattleScene 刀剑视觉）。

- [ ] **Step 1: 写失败测试** — e2e：点杂兵 → 英雄直接移动到杂兵格 → 战 → 胜 → 英雄 position=杂兵格 + 行动力保留；败 → 回城。悬停守将 → cursorKind sword。英雄不能移动穿过另一英雄/守将格
- [ ] **Step 2: 运行确认失败**
- [ ] **Step 3: 实现**
- [ ] **Step 4: 运行确认通过**
- [ ] **Step 5: 提交** — `feat: 战斗直接移动上去触发 + 胜利占格/失败回城 + 不能穿过/重叠武将 + 悬停刀剑`

---

### Task 6: 全量测试适配 + PRD 同步

**Files:**
- Modify: `src/e2e/*.spec.ts`（resources/movement/sfx/campaign-*/world-snapshot 等势力键适配）
- Modify: `src/core/state/*.test.ts`（收尾）
- Modify: `PRD.md` / `PRD-SUPPLEMENT.md`

**改动：**
- e2e `resources.shu`/`visibility.shu`/`currentFaction` 等断言改玩家键/`currentPlayerId`。
- 补全：切换武将、战斗胜利移动/失败回城、结束回合下一天、英雄重叠阻挡的 e2e。
- PRD §5 多英雄/城池/回合模型（按玩家轮转）、§15 勾选（Player 重构、右侧列表、战斗交互）、§16 未完成保持 `[ ]`（AI 实际行动、野怪重生、存档）。

- [ ] **Step 1: 运行全量测试找失败**
- [ ] **Step 2: 适配所有 e2e + core 断言**
- [ ] **Step 3: 全量 `pnpm test` + `pnpm test:e2e` + `pnpm typecheck` 干净**
- [ ] **Step 4: 提交** — `test: 全量适配 Player 绑定 + 新 UX e2e + PRD 同步`

---

## 任务依赖

```
Task 1（GameState 类型 + reducer + 数据 + 测试适配）——横切基础
   ↓
Task 2（advanceTurn 玩家轮转 + system）
   ↓
Task 3（渲染层 playerId 查询 + sprite Map 重置 + 英雄重叠阻挡）——依赖 Task 1 类型
   ↓
Task 4（右侧列表 + 下一个 h）——依赖 Task 1 hero/select
   ↓
Task 5（战斗交互）——依赖 Task 2 回合 + Task 3 渲染
   ↓
Task 6（全量测试 + PRD）
```

> **注意**：Task 1 是横切重构——类型一改，reducer/数据/渲染/测试编译全挂，无法拆成独立中间态，故合为一个任务（大）。若 implementer 发现 Task 1 过大，可先做「类型+reducer+数据+core 测试」（保编译），渲染层适配留 Task 3。Task 3 明确承担渲染层 playerId 查询（Task 1 只需保证 typecheck 通过的最小渲染改动）。
