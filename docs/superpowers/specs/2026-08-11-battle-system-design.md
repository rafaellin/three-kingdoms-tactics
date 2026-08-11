# 主菜单 + 战斗系统（MVP）设计

> 日期：2026-08-11
> 需求来源：用户确认「优先做战斗系统；在此之前先做主菜单（开始游戏 / 战斗测试）」
> 相关：PRD §7 兵种、§15 战斗、PRD-SUPPLEMENT §1 战斗细化、§10 类型定义

## 1. 目标与范围

让游戏具备可玩的第一场战斗：

1. **主菜单**：启动进入主菜单，两个入口——**开始游戏**（进大地图 Adventure）、**战斗测试**（进战斗 Battle，固定部队 PVE）。
2. **战斗系统 MVP（最小闭环）**：六角格战场 + 双方固定部队 stack + 按速度回合制 + 点选移动/攻击 + 伤害公式 + 血条 + 简易 PVE AI + 胜负判定 → 返回主菜单。

**MVP 明确不含**（后续增量，PRD §16 注明）：反击、等待/防御、士气、幸运、英雄施法、经验/战利品、随机伤害（固定伤害保持确定性）、战斗地图地形障碍。

## 2. 架构（core / 渲染分离铁律）

```
src/
├── core/battle/             # 战斗核心（纯 TS，零 Phaser，可无浏览器单测）
│   ├── types.ts             #   BattleUnit / BattleState / 命令 payload
│   ├── damage.ts            #   伤害公式 + 可调常量
│   ├── pathing.ts           #   战斗内 BFS 寻路（平地图，障碍 = 其他单位）
│   └── battleReducer.ts     #   纯函数 reducer（init/select/move/attack/endTurn）
├── data/units.ts            # 兵种属性表（攻/防/伤/速/命/费/射程/尺寸）
├── data/battleTest.ts       # 战斗测试固定阵容（我方关羽+4 / 敌方吕布+3）
├── scenes/MainMenuScene.ts  # 主菜单
├── scenes/BattleScene.ts    # 战斗渲染层
├── e2e/battle.spec.ts       # 新 e2e
└── main.ts                  # 注册 MainMenu / Adventure / Battle，初始 = MainMenu
```

- 战斗用**独立 `CommandLog<BattleState>`**（不复用大地图 GameState），战斗可整体重放、独立单测。
- 渲染层只读 `BattleState` 渲染 + 把点击/按键转成 battle 命令；core 不得感知 Phaser/分辨率。
- 确定性：battle 命令经 reducer 折叠，相同序列 ⇒ 相同终态；MVP 无随机（固定伤害），后续随机统一走注入 RNG。

## 3. 战斗核心状态与命令

```ts
interface BattleUnit {
  id: string
  side: 'player' | 'enemy'
  defId: string            // 兵种 ID（data/units.ts）
  count: number            // stack 数量
  position: Axial          // 主体格（轴向坐标；size=2 时为左侧格）
  size: 1 | 2              // 占据格数（1=普通步兵/弓兵，2=骑兵等大型单位）
  hpLeft: number           // 剩余总血量（= 命×count，累计扣减，非单兵）
  maxHp: number
  hasActed: boolean        // 本回合已行动
}

interface BattleState {
  grid: { cols: number; rows: number }
  units: BattleUnit[]
  turn: number
  order: string[]          // 本回合按速度降序的 unitId 行动序列
  currentUnitId: string | null
  phase: 'combat' | 'won' | 'lost'
  log: string[]            // 战斗事件描述（显示 + 调试/回放）
}
```

命令（`battle/*`，经 `CommandLog<BattleState>` dispatch）：

| 命令 | payload | 作用 |
|---|---|---|
| `battle/init` | `{ playerArmy, enemyArmy, grid }` | 布置单位、按速度排 `order`、phase=combat |
| `battle/select` | `{ unitId }` | 选中单位（渲染高亮；当前单位移动/攻击由此驱动） |
| `battle/move` | `{ unitId, to }` | 移动当前单位到 `to`（主体格）；校验路径双格可通 |
| `battle/attack` | `{ attackerId, targetId }` | 攻击目标；命中判定见 §6/§7 |
| `battle/endTurn` | `{ unitId }` | 标记行动完 → 下一个单位；全动完 → turn+1 重排 |
| `battle/surrender` | — | 直接判负（战斗测试的"撤退"按钮，MVP 保留） |

MVP 的**防御/等待**按钮省略（点击攻击范围外 = 可跳过移动直接 `endTurn`）。

## 4. 单位尺寸与占据规则（1×1 / 1×2，参考 HOMM3）

**关键新增能力：对 1×2 大型单位（如骑兵）的支持。**

- `size: 1`：占据 1 个 hex（主体格）。
- `size: 2`：占据 **主体格 + 东邻居格** `(q+1, r)`（轴向方向 0）。**单位不旋转**（HOMM3 中大型单位固定横向朝向），`position` 恒为主体格（左侧格）。
- `occupiedHexes(unit)`：`size===1 → [position]`；`size===2 → [position, { q+1, r }]`（helper 放 `core/battle/types.ts`）。
- **占格冲突**：任意单位（含 1×2 双格）占据格不得与其它单位占据格重叠；1×2 双格不得越出 `grid` 边界。
- **移动**：目标 = 主体格。移动路径对 size=2 单位按「逐格双格可通行」（主体+次格均无其它单位、在界内）校验（§5 寻路）。
- **攻击判定（HOMM3 逻辑）**：近战 = 攻击者主体格与目标**任一占据格**相邻；远程 = 攻击者主体格到目标**任一占据格**的 `hexDistance` ≤ `range`。即命中大型单位的任一格即可。
- **点击命中**：点击某 hex，若属于某单位的任一占据格 → 选中该单位（点 1×2 的任意一格都行）。
- **HP/伤害**：按 `count×命` 的 stack 总量，与 size 无关；大型单位被灭则整体移除。

## 5. 战斗寻路（core）

- 战场为**全平地**（MVP 无地形障碍），障碍 = 其它单位占据格集合。
- BFS 从单位主体格出发，六方向步进、代价全 1；对 size=2 单位，每一步校验「主体格 + 东邻居格」都未被占且在界内。
- 返回可达集（供渲染层高亮）与路径；移动命令在 core 校验最终位置合法性。

## 6. 伤害公式（core，常量可调）

```
实际攻防 = 兵种基础攻防 + 武力/3            // PRD §7.3（武将武力来自阵容配置）
damage   = 基础伤害 × count × [1 + ATK_DEF_MODIFIER × clamp(实际攻 - 实际防, -ATK_DEF_CAP, +ATK_DEF_CAP)]
```

```ts
export const ATK_DEF_MODIFIER = 0.05   // ★ 平衡旋钮（用户指定：0.05 可调）
export const ATK_DEF_CAP = 3           // 攻防差钳制 → 倍率 0.85 ~ 1.15
```

- MVP `基础伤害` 取兵种伤害区间中值（无随机）→ 确定性最强。
- 伤害结果 = 扣 `target.hpLeft`；≤0 → 单位移除（`phase` 判定胜负）。
- 后续随机伤害走注入 RNG（`core/rng.ts`）。

## 7. 射程 / 近战

- 兵种表加 `range`：近战兵 `range: 1`，弓兵 `range: 2`。
- 近战需与目标任一占据格相邻（§4）；远程在 `range` 内即可，**无视阻挡**（MVP 简化，无遮挡规则）。

## 8. 回合流程

1. `battle/init`：按速度降序排 `order`（同速以固定次序稳定）。
2. `currentUnit = order` 中第一个未行动单位。
3. 玩家单位：`select` 后渲染可移动范围 + 可攻击目标 → `move` / `attack` → `endTurn`。
4. 敌方单位：简易 AI（§9）自动 `move`/`attack`/`endTurn`。
5. 全部行动完 → `turn+1`，按当前单位速度重新排序。
6. 一方全灭 → `phase = won | lost` → 渲染结果 → 返回主菜单（或"再来一局"重开）。

## 9. 敌方 AI（MVP 简易）

按优先级：① 攻击范围内有可攻击的敌人 → 攻击（优先血量低者）；② 否则向最近敌人移动（走 BFS 路径）→ 若移动后仍够不着则 `endTurn`。不施法、不等待/防御。

## 10. 战场布局 / 测试阵容 / 兵种表

### 战场
- **13×9 六角网格**（轴向 `q∈[0,12]`、`r∈[0,8]`），全平地。
- 我方单位布置于左半场（`q ≤ 4`），敌方右半场（`q ≥ 8`）；`size:2` 单位占用相应两格。

### 战斗测试阵容（`data/battleTest.ts`）
- **玩家**：关羽（战将，武力 90 / 统御 70）+ 4 支 stack：民兵×30、刀兵×12、弓兵×10、骑兵×8（骑兵验证 1×2 支持）。
- **敌方**：吕布（武力 100 / 统御 80）+ 3 支 stack：民兵×20、枪兵×12、弓兵×8。

### 兵种表（`data/units.ts`，占位值待平衡，PRD 未给数值）
| 兵种 | 攻 | 防 | 伤(区间) | 速 | 命 | 射程 | 尺寸 | 定位 |
|---|---|---|---|---|---|---|---|---|
| 民兵 | 4 | 4 | 1~3 | 4 | 1 | 1 | 1 | 炮灰 |
| 刀兵 | 6 | 8 | 3~5 | 4 | 2 | 1 | 1 | 肉盾 |
| 枪兵 | 7 | 6 | 3~5 | 4 | 2 | 1 | 1 | 反骑 |
| 弓兵 | 6 | 4 | 2~4 | 5 | 1 | 2 | 1 | 远程 |
| 骑兵 | 10 | 7 | 5~8 | 9 | 3 | 1 | **2** | 高机动高攻 |

（`size`、`range` 为本次新增字段；其它势力特色兵后续按 PRD §7.2 补充。）

## 11. 主菜单

- `MainMenuScene`：深色背景（同大地图）+ 标题「三国志：战术传说」+ 两个按钮。
  - **开始游戏** → `scene.start('Adventure')`
  - **战斗测试** → `scene.start('Battle')`
- `main.ts`：注册 3 个场景，`scene: [MainMenuScene, AdventureScene, BattleScene]`，初始 = MainMenu。
- AdventureScene / BattleScene 逻辑互不触碰（场景切换由 Phaser 管理，各自独立 CommandLog）。

## 12. 数据流 / 确定性 / 调试

- `BattleScene` 持 `CommandLog<BattleState>`，dispatch battle 命令 → `battleReducer` 更新 → 渲染层读 `getState()` 渲染。
- dev 桥扩展：`BattleScene` 暴露 `getState()`（`phase/turn/units(含坐标·hp·size·hasActed)/order/currentUnitId`）+ `setAnimationSpeed(ms)`，供 e2e 断言与调试。
- 战斗不接入大地图经验/资源（MVP）；战斗测试胜负仅返回主菜单。

## 13. 测试方案

**core 单测**（`core/battle/*.test.ts`，TDD）：
- 伤害公式：攻防差边界、钳制 ±3、`ATK_DEF_MODIFIER` 调整生效、stack 数量倍率。
- 1×2 支持：`occupiedHexes`、占格冲突、移动双格校验、近战/远程命中判定基于目标任一占据格。
- 行动排序（速度降序）、移动合法性、攻击灭队、胜负判定、回合推进、命令序列重放确定性。

**e2e**（`e2e/battle.spec.ts`）：
- 主菜单渲染两按钮；点「开始游戏」→ 进大地图；点「战斗测试」→ 进战斗场景。
- 战斗内：`select` 单位 → 断言 `getState()` 选中/可移动范围 → `move` 断言坐标 → `attack` 断言目标 `hpLeft` 下降/灭队 → 连续 `endTurn` 直到 `phase=won/lost` → 显示结果 → 返回主菜单。
- 截图存 `screenshots/`（主菜单、战场布局、1×2 骑兵占两格、血条）供人工目检。

**PRD 同步**：§15 勾掉 MVP 完成项（主菜单、战斗战场/移动攻击/伤害公式/血条/简易 AI）；§16 注明 MVP 未含项（反击/等待防御/士气幸运/施法/经验战利品/随机伤害）。

## 14. 验收标准

- `pnpm test`（含 battle core 单测）全绿；`pnpm typecheck` 零 error；`pnpm test:e2e` 全绿。
- 手动：主菜单两入口可用；战斗测试可完成「选中 → 移动 → 攻击 → 胜负 → 返回」闭环；骑兵按 1×2 占格、命中判定正确。
- PRD §15/§16 与实现一致。
