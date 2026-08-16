# 战役体验修复（5 问题）

日期：2026-08-16
状态：设计稿（待确认）

## 背景

战役模式 MVP 完成后，用户试用反馈 5 个问题：
1. 战斗后回 adventure，所有武将图标消失
2. 武将可重叠/穿过（自己武将也不能）
3. 结束回合无效（应下一天 + 重置行动力）
4. 无法切换武将（需右侧武将/城池列表 + 点击切换 + 「下一个(h)」）
5. 战斗交互：悬停守将/杂兵格应刀剑光标 + 交战高亮；胜利后英雄移动目标格（失败回城）

## 决策（用户确认）

| 项 | 决定 |
|---|---|
| 结束回合 | **按「玩家序列」轮转，非魏蜀吴群**。战役 = 玩家 → AI → system；探索测试也改单势力（玩家 → system） |
| AI 轮 | AI **不是跳过**，是按地图配置行动（MVP 战役 AI 配置「不动」→ 无行动；留接口给未来攻城/移动） |
| system 结算 | 天数推进、资源统计、野怪随机生成在**回合末尾 system 结算**，不算 AI 玩家 |
| 切换武将 | 右侧简单武将/城池列表（可点击），+「下一个(h)」按钮；美化后续 |
| 战斗移动 | 胜利 → 英雄移动到目标格；战斗消耗行动力 = 从边上走进那格的代价，**不清空剩余**；失败回城 |

## 各问题方案

### 1. 武将图标消失 — bug 修复（渲染层）
根因：`createLayers()` 不重置 5 个 sprite/label Map（`heroSprites`/`townSprites`/`nodeSprites`/`garrisonLabels`/`neutralLabels`）。`scene.start` 复用实例时旧 GameObject 被销毁，Map 残留死引用 → 渲染不重建。
修复：`createLayers()` 开头 `xxx.clear()` 这 5 个 Map。

### 2. 武将重叠 — core 修复
- `moveHeroTo`（`src/core/state/reducer.ts:360`）：加「目标格被其他英雄占据 → 拒绝」校验。
- `MapMovementCost`（渲染层 `makeMapCosts`）：`garrisonAt` 扩展为「存活守将格 OR 其他英雄格」→ 寻路不穿过。

### 3. 回合模型 — 核心重构（core，按玩家 id 轮转）

**原则（用户确认）：按玩家 id 轮转，不按势力写死**。未来可两个同势力玩家对战。

**引入 Player 实体**：
```ts
interface Player {
  id: string            // 'p1' | 'p2' | 'ai1' ...（唯一标识，独立于势力）
  faction: FactionId    // 所属势力（同势力玩家可同 faction）
  kind: 'human' | 'ai'  // 人类玩家 or AI
}
```

**GameState 变更（全部改玩家绑定，势力仅作显示标签；用户确认）**：
- 新增 `players: Player[]`（参与回合的玩家序列，顺序 = 轮转顺序）
- 新增 `currentPlayerId: string | null`（当前行动玩家，替代 `currentFaction` 作为轮转游标；`currentFaction` 删除，渲染层从 `players[currentPlayerId].faction` 取势力色）
- **资源**：`resources: Record<FactionId, Resources>` → `Record<PlayerId, Resources>`（同势力玩家各自独立资源）
- **迷雾**：`visibility: Record<FactionId, ...>` → `Record<PlayerId, ...>`（同势力玩家各自独立视野，不串）
- **资源点占领**：`NodeState.owner: FactionId | null` → `PlayerId | null`（谁占领归谁，含同势力区分）
- **城池归属**：`Town.owner: FactionId` → `PlayerId`（城池归玩家；同势力玩家各自有城）
- **英雄**：`HeroUnit` 新增 `playerId`；**保留 `faction`**（仅作势力色显示；迷雾/资源判定改用 `playerId` 查询所属玩家）
- `computeDailyIncome`/`canAfford`/`applyDailyIncome` 改按 PlayerId 结算（城池/矿的 owner 是 PlayerId）
- 每日结算按玩家循环（`state.players`）而非按势力

**CampaignConfig 变更**：
- 新增 `players: Player[]`（战役：`[{id:'p1', faction:'shu', kind:'human'}, {id:'ai1', faction:'wei', kind:'ai'}]`；探索：`[{id:'p1', faction:'shu', kind:'human'}]`）
- `heroStarts` 每项加 `playerId`（英雄归属哪个玩家）

**`advanceTurn` 重写（按玩家推进）**：
```
advanceTurn(state):
  players = state.players
  if empty: return state
  idx = players.findIndex(p => p.id === state.currentPlayerId)
  // 推进：从当前玩家 → 下一玩家；若下一玩家是 AI → 执行 AI 回合 → 再推进；
  // 直到轮到「human 玩家」（非 AI）或轮完一圈进入 system
  loop:
    next = (idx + 1) % players.length
    nextPlayer = players[next]
    if nextPlayer.kind === 'ai':
      state = aiAct(state, nextPlayer.id)   // MVP: 返回原 state（AI 配置不动）；留接口
      // 继续推进（AI 自动结束回合）
    else:
      // human 玩家：重置该玩家所有英雄移动力，currentPlayerId = nextPlayer.id
      break
  // system：若经历了所有玩家（回到起点前）→ 天数+1、每日结算、野怪生成
  if wrappedAround:
    turn += 1; applyDailyIncome; spawnNeutrals(state)
```

**`aiAct(state, playerId)`**：新纯函数（`src/core/state/ai.ts`），MVP 读 AI 配置（战役 AI 无行动）→ 返回原 state。未来攻城/移动逻辑在此扩展。
**`spawnNeutrals(state)`**：system 结算接口，MVP no-op（当前地图无随机野怪；别的图可能用）。

**探索模式（用户确认：同步改）**：players=['p1'(shu)] → 玩家结束 → 直接进 system（天数+1）→ 回玩家。结束回合 = 下一天 + 行动力回满。

**e2e 影响**：现有 `resources.spec.ts`/`GameState.test.ts` 依赖四势力轮转断言需同步改（探索单玩家后 currentPlayerId 恒为 p1，天数推进逻辑变）。

### 4. 右侧武将/城池列表 — 渲染层新 UI
- 新增 `src/ui/RightPanel.ts`（或复用 BgmControls 模式）：右侧竖列
  - 武将列表：名字/等级/兵力，点击 → `hero/select` 切换
  - 城池列表：名字/等级，点击 → `openTownPanel`
  - 「下一个(h)」按钮：循环切换选中武将
- AdventureScene 集成：创建面板 + 渲染 state + 快捷键 `keydown-H` → 下一武将
- 简单布局（不做美化），视口固定右侧

### 5. 战斗交互 — 渲染 + core
- **触发流程（先移动到相邻再战）**：点击存活守将/未歼灭杂兵格 → 英雄先**走到目标格相邻格**（扣该格移动代价，reducer `moveHeroTo` 放行到相邻格，目标格本身仍因守将/杂兵占据不可走入）→ 进入战斗。胜利后英雄**移入目标格**（`campaign/resolveBattle` 扩展：胜利 → 参战英雄 position = 目标格，**不清空剩余移动力**，仅已扣走进相邻格的代价）；失败 → 回城（最近己方城，MVP = `startTowns[0]` 城格）。
- **悬停高亮/光标**：`updateHover`/`drawOverlay`——悬停存活守将/未歼灭杂兵格，若该格相邻（可走到邻格后战）→ 刀剑光标 + 目标格交战高亮（红/刀剑）。AdventureScene 当前无刀剑光标逻辑，需新加（参照 BattleScene 的 sword hover 视觉）。
- 实现位置：
  - `triggerBattle` 改造：先 `animateMove` 到相邻格（dispatch `hero/move`），再进 Battle。
  - `campaign/resolveBattle` 扩展：payload 加 `targetPosition: Axial`（胜利后英雄位置）；胜利 → 英雄 position=target、扣 `moveCost(target)` 行动力（已在移动相邻格时扣了进相邻格的，移入目标格再扣一格代价）；失败 → 英雄 position=最近城、行动力=0。

## 不做（YAGNI）

- 右侧列表美化（后续）
- AI 实际攻城/移动（留 `aiAct` 接口，MVP no-op）
- 野怪随机重生（留 `spawnNeutrals` 接口，MVP no-op）
- 存档/读档

## 测试

- **core**：`GameState.test.ts`/`Movement.test.ts`/`Campaign.test.ts` 全部势力键断言（`resources.shu`/`visibility.shu`/`nodeStates.owner`/`town.owner`）适配为 PlayerId；`Campaign.test.ts` 补 advanceTurn 单玩家/玩家→AI→system、AI no-op、英雄重叠阻挡；每日结算按玩家
- **e2e**：`resources.spec.ts`/`movement.spec.ts`/`sfx.spec.ts` 等势力/迷雾断言适配玩家键；world-snapshot 回归；新增切换武将、战斗胜利移动/失败回城、结束回合下一天
- **渲染层**：AdventureScene 20+ 处 `.faction` 查询（迷雾/资源/友城）改经 `currentPlayer(state)` 取 playerId → visibility/resources 键

## 关键文件

| 文件 | 改动 |
|---|---|
| `src/core/state/reducer.ts` | `moveHeroTo` 重叠阻挡；`advanceTurn` 重写；`campaign/resolveBattle` 扩展（胜利移动/失败回城） |
| `src/core/state/GameState.ts` | 无（turnOrder 复用）；或加 `aiFactions` 类型 |
| `src/data/campaigns.ts` | `CampaignConfig` 加 `aiFactions` |
| `src/core/state/ai.ts`（新） | `aiAct(state, faction)` 接口，MVP no-op |
| `src/scenes/AdventureScene.ts` | createLayers 重置 Map；makeMapCosts 其他英雄格阻挡；右侧列表集成；悬停刀剑/交战高亮；战斗返回移动 |
| `src/ui/RightPanel.ts`（新） | 武将/城池列表 + 下一个(h) |
| `src/scenes/BattleScene.ts` | 无需改（回流已有） |
| e2e | 适配单势力回合 + 新增交互测试 |
