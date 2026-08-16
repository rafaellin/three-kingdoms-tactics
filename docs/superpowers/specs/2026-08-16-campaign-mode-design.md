# 战役模式设计（MVP · 千里走单骑·东岭关）

日期：2026-08-16
状态：已确认（brainstorming 通过）

## 背景

当前游戏只有两条独立路径：主菜单「开始游戏」→ 随机大地图探索（AdventureScene，无战斗入口），「战斗测试」→ 战斗 demo（BattleScene，硬编码阵容）。大地图与战斗完全解耦，`BattleResult` 只产出无人消费，`general/gainXp` 只有测试调用。

目标：引入**战役模式**（MVP），用预设关卡「千里走单骑·东岭关」打通 大地图 → 多英雄 → 城池 → 战斗 → 结算写回 → 胜利判定 的完整闭环；同时主菜单改造为「探索测试」+「开始战役」+「战斗测试」三入口。

战役模式遵循 HOMM3 机制（经搜索确认）：
- 英雄 = 带兵实体：每武将带一支军队（≤7 兵种槽，受 `maxUnits(level)` 限制），英雄是移动/指挥实体，不直接参战。
- 城池双槽：驻军槽（garrison）+ 驻城英雄（1，领导防御）+ 访问英雄（1，军队也参与防御）；英雄可移兵进城、驻守、换将。
- 战斗触发：攻击野怪/守将/敌城 → 战斗；守城（有守将）触发攻城。

## 决策汇总（用户确认）

| 项 | 决定 |
|---|---|
| MVP 内容 | 东岭关一段：窄路关卡 + 守将**孔秀**（5级，带2队）+ 散落中立杂兵（2-3组，练级） |
| 胜利条件 | **击败孔秀**（`defeatGarrison`） |
| 主菜单 | 3 按钮：「探索测试」「开始战役」「战斗测试」（保留） |
| 探索测试 | 进同一预设图，但**自由沙盘**：不设守将/胜利条件，杂兵可打（练级），不设城池驻守交互 |
| 开始战役 | 进东岭关战役：完整守将/胜利/城池交互 |
| 场景 | 复用 AdventureScene，setup 时传 mode + campaignId 区分 |
| 敌方移动 | 大地图上守将/杂兵**静止**（不追击）；进入战斗后 AI 正常行动 |
| 地图配置 | 探索/战役**共用同一份** `CampaignConfig` 纯数据 |
| 关卡地形 | **不加新地形**：周围 mountain/water 封死，孔秀站在唯一可通行格（窄路）上；守将 alive 时该格不可通行，被歼后可通行 |
| 多英雄 | 关羽/周仓/孙乾 3 武将并行，各带部队，地图上同时渲染可操作 |
| 城池 | HOMM3 式完整界面：驻军槽 + 驻城英雄 + 访问英雄；移兵/驻守/换将；**初始空城**（无驻守），3 将在城外由玩家决定谁驻守；**城内无酒馆**（不可招募新武将） |
| 杂兵 | 击败即从地图消失（不重生） |
| 战斗回流 | `BattleResult` → 写回 GameState：兵力损失、`general/gainXp`、守将被歼、杂兵移除 |

## 架构（核心/渲染分离，确定性铁律不变）

### ① 数据层 — 地图即配置（data/campaigns.ts，纯数据）

```ts
/** 守将驻点：站岗不可移动；站岗格不可通行直到被歼 */
interface Garrison {
  id: string                 // 'g-kongxiu'
  generalId: string          // 引用 GENERAL_BASES（需新增孔秀）
  level: number              // 5
  position: Axial            // 唯一可通行格（窄路关卡）
  units: { defId: UnitDefId; count: number }[]   // 2 队
}

/** 中立杂兵：练级用；被歼后从地图消失 */
interface Neutral {
  id: string
  position: Axial
  units: { defId: UnitDefId; count: number }[]   // 1 队
}

interface CampaignConfig {
  id: 'dongling'
  name: '千里走单骑·东岭关'
  map: MapData              // 手工构造 MapData 字面量（含窄路地形布局）
  startTowns: Town[]        // 1 座小城（初始空 garrison/无驻守）
  startGenerals: General[]  // 关羽/周仓/孙乾，5级，各带 army
  heroStarts: { generalId: string; position: Axial }[]  // 3 英雄初始位置
  garrisons: Garrison[]     // [孔秀]
  neutrals: Neutral[]       // 2-3 组杂兵
  victory: { kind: 'defeatGarrison'; targetId: string }  // 击败孔秀
  tavernEnabled: false      // 无酒馆
}
```

- 新增武将数据：`GENERAL_BASES` 增加 `g-zhoucang`（周仓）、`g-sunqian`（孙乾）、`g-kongxiu`（孔秀）——base/lv20 双锚点，5 级用 `deriveStats(base, 5)`。
- 关卡窄路：地图 terrain 里孔秀格两侧/周围刷 `mountain`（不可通行），孔秀格为 `plain`（唯一通道）；孔秀存活时 `moveHero` 到该格被拦截并触发战斗。
- **探索测试**复用同一份 `CAMPAIGNS['dongling']`，但 setup 时 `mode:'explore'` → 不放置 garrisons、不设 victory、允许打 neutrals 练级（城交互可简化或跳过）。

### ② 核心层 — 状态 + 命令（core，无 Phaser）

**GameState 变更（src/core/state/GameState.ts）**：
- `hero: HeroUnit | null` → `heroes: HeroUnit[]`（多英雄）
- `General` 增加 `army: { defId: UnitDefId; count: number }[]` —— **军队挂在 General（武将财产，跟人走），不挂在 HeroUnit**。理由：HeroUnit 是瞬态移动实体（驻城时从 heroes 移除），army 放它会在驻城时丢失；城池双槽（`garrisonGeneralId`/`visitorGeneralId`）与地图英雄都通过 generalId 引用 `General.army`，军队只存一份。
- **关键约束**：一个武将同一时刻只有一种状态——地图移动（有 HeroUnit）**或**城池（驻守/访问，从 heroes 移除进城池槽）；从城出发变回 HeroUnit。避免同一武将两份军队。
- `Town` 增加：`garrison: { defId; count }[]`、`garrisonGeneralId: string | null`、`visitorGeneralId: string | null`
- 新增：`campaignId: string | null`、`garrisons: GarrisonState[]`（含 `alive: boolean`）、`neutrals: NeutralState[]`（含 `defeated: boolean`）、`victory: { kind; targetId } | null`、`outcome: 'won' | null`

**地形**：不加新地形 id。关卡通行由「孔秀格 + alive」判定，在 `moveHero`/寻路 `MapMovementCost` 接入：守将 alive 且目标格=守将格 → 拦截。

**命令（gameReducer 新增 case）**：
- `campaign/start` — payload 含 `mode` + `campaign`（配置）：`mode==='campaign'` 放置 garrisons + victory；`mode==='explore'` 跳过。替代 `game/setup` 的随机图路径（或扩展 setup）。
- `hero/select` — 设置当前操作英雄（渲染高亮）
- `hero/move` — 复用 `unit/move` 语义，支持多英雄（payload 加 `heroId`）
- `hero/enterTown` — 英雄走进己方城 → `visitorGeneralId = heroId`（从 heroes 移除）
- `hero/garrison` — 访问英雄 → 驻城英雄（`garrisonGeneralId`，visitor 清空）
- `hero/leaveTown` — 驻城/访问英雄出城 → 回到 heroes（位置=城格）
- `town/swapHeroes` — **换将**：驻城英雄 ↔ 访问英雄互换（军队随武将走，HOMM3 式）
- `town/transferTroops` — 英雄 army ↔ 城 garrison 移兵（数量增减）
- `campaign/battle` — 英雄目标=守将/杂兵/敌城格 → 返回战斗入口数据（阵容）
- `campaign/resolveBattle` — 战斗结算写回：`BattleResult` → 兵力损失写回英雄 army、`general/gainXp`、守将 `alive=false`、杂兵 `defeated=true`、若击败孔秀 → `checkVictory`
- `campaign/checkVictory` — victory.kind==='defeatGarrison' 且 target 守将 !alive → `outcome='won'`，渲染弹胜利面板

**确定性**：所有随机（如有）走注入 RNG；reducer 纯函数 immutable；`resolveBattle` 由调用方把 `BattleResult` 放进 payload，reducer 不做随机。

### ③ 渲染层 — 复用 AdventureScene

- `MainMenuScene.create()`：3 按钮
  - 「探索测试」→ `fadeAndStart(this, AdventureScene.KEY, { mode: 'explore', campaignId: 'dongling' })`
  - 「开始战役」→ `fadeAndStart(this, AdventureScene.KEY, { mode: 'campaign', campaignId: 'dongling' })`
  - 「战斗测试」→ `fadeAndStart(this, BattleScene.KEY)`（保留）
  - Y：0.50 / 0.63 / 0.76 三等分（需更新 e2e `MENU_START`/`MENU_BATTLE` 常量 + 新增 `MENU_CAMPAIGN`）
- `AdventureScene.create(data)`：读 `data.mode`/`data.campaignId` → `buildStore()` 从 `CAMPAIGNS[campaignId]` 构造（替代硬编码 `generateMap`）；**随机图路径保留**——`generateMap`/`setSeed` 保留为 dev 能力（`src/dev/debug.ts` 暴露，供调试/回归），主菜单不再默认进随机图
- 渲染新增：
  - 多英雄精灵（每英雄一个，区分归属/选中态；`syncHeroSprites`）
  - 守将格（关卡旗/城寨图标）、杂兵格（野怪图标）；被歼后移除
  - fort 窄路（孔秀格）高亮/标识
  - **城池界面（新 UI，完整）**：驻军槽 + 驻城/访问英雄卡 + 移兵/驻守/换将按钮（参考 `GeneralCard`/`Modal` 组件模式；视觉走 frontend-design skill）
  - 胜利面板（outcome==='won' → 弹层 → 返回主菜单）
- 战斗：`BattleScene` 复用 `startBattle(player, enemy, grid)`；**新增「结算后回调」**——BattleScene 结算把 `BattleResult` 交给 AdventureScene（经 scene.events 或注册回调），Adventure 调 `campaign/resolveBattle` 写回 → `checkVictory` → 刷新视图

### ④ dev bridge / e2e
- `src/dev/debug.ts` 暴露战役入口（`startCampaign()` / `startExplore()`）、`getState()` 扩展 garrisons/neutrals/heroes/outcome
- e2e 新增：
  - 主菜单三按钮可见
  - 探索测试：进图 → 打杂兵 → 得经验 → 回城
  - 战役全流程：开始战役 → 选将 → 清杂兵练级 → 挑战孔秀 → 胜利弹窗 → 返回主菜单
  - 城池：移兵/驻守/换将断言
- 现有 e2e 适配：`MENU_START`/`MENU_BATTLE` 坐标更新；`gotoAdventure`/`gotoBattle` 语义确认（探索测试仍进 AdventureScene，坐标常量同步）

## MVP 不做（YAGNI）

对战模式（PVE/PVP）、渡口/秦琪/夏侯惇、可移动的敌方武将、内政/建筑、酒馆招募、战役后续关卡、副将机制（已取消，改多英雄）、城池攻防（围城战）——本期只有守将遭遇战，无攻城战。

## 测试计划

- **core 单测**（`*.test.ts` 同目录）：
  - `campaigns` 配置可加载、heroStarts/garrisons/neutrals 非空
  - `moveHero`：孔秀格 alive 时不可通行/触发战斗；被歼后可通行；非孔秀格正常
  - `campaign/resolveBattle`：胜利 → 英雄 army 损失、孔秀 alive=false、杂兵 defeated、经验给参战武将；失败 → 英雄 army 清零（或按结果）
  - `campaign/checkVictory`：孔秀歼 → won；未歼 → null
  - 城池：`enterTown`/`garrison`/`transferTroops` 的移兵/驻守/换将边界
  - 多英雄 `unit/move` 带 heroId 各走各的
  - 确定性：命令序列重放 → 相同终态
- **e2e**（Playwright，见上）

## 关键文件

| 文件 | 改动 |
|---|---|
| `src/data/campaigns.ts`（新） | `CampaignConfig` + `CAMPAIGNS['dongling']`（地图/城/将/守将/杂兵/胜利） |
| `src/data/generals.ts` | `GENERAL_BASES` 增 周仓/孙乾/孔秀 |
| `src/data/units.ts` | 如需新增杂兵用兵种则补（可复用现有 5 兵种） |
| `src/core/state/GameState.ts` | `heroes`/`General.army`/`Town` 双槽/`garrisons`/`neutrals`/`campaignId`/`victory`/`outcome` |
| `src/core/state/reducer.ts` | `campaign/start`、`hero/select`、`hero/move`、`hero/enterTown`、`hero/garrison`、`hero/leaveTown`、`town/swapHeroes`、`town/transferTroops`、`campaign/battle`、`campaign/resolveBattle`、`campaign/checkVictory` |
| `src/core/pathfinding/MapMovementCost.ts` | 守将 alive 格不可通行 |
| `src/scenes/MainMenuScene.ts` | 3 按钮 |
| `src/scenes/AdventureScene.ts` | `create(data)` 读 mode/campaign；多英雄渲染；守将/杂兵渲染；城池界面调用；战斗回流 |
| `src/ui/TownPanel.ts`（新） | 城池界面（驻军/驻城/访问 + 移兵/驻守/换将） |
| `src/scenes/BattleScene.ts` | 结算后回调把 `BattleResult` 交给 Adventure |
| `src/dev/debug.ts` | 战役入口 + getState 扩展 |
| `src/e2e/*.spec.ts` | 坐标常量 + 新战役/城池/探索 e2e |
| `PRD.md` / `PRD-SUPPLEMENT.md` | §5 多英雄、城池双槽、战役模式章节同步 |
