# 今后再做（未来工作）

> 本文档记录「战斗操作按钮行 + 等待/防御 + 降逃和」设计落地时暂不实现的后续任务。
> 接口契约见 `docs/superpowers/specs/2026-08-14-battle-commands-bar-design.md`（BattleEnterParams /
> BattleResult / 攻防加成链 / BAIL_RATIO=1.5）。

## 探索↔战斗真实接线
- 遭遇战触发（大地图遇敌 → BattleScene 传入 BattleEnterParams：playerGold / opponentKind）
- 结算消费 BattleResult：武将驻城返回 / 被俘（释放|处斩）/ 宝物保留、金钱扣减闭环、经验入库
- 自然战败的 30% 逃跑判定（BattleResult.generalCaptured=null 时探索层决定）

## 技能系统本体
- 主动计略 / 被动技能、技能弹窗填充（当前「技能系统开发中」占位）
- buff/debuff 效果写入 BattleUnit.mods（点数/百分比两层已留空位）

## 设置界面本体
- 底部行【⚙】启用（当前 Unicode 占位 + disabled）
- 音量等设置项（BgmControls/SfxManager 已就绪）

## 经验 / 升级系统
- expGained 消费端（战胜得经验、每级属性增长、每 3 级解锁技能）

## 保释金经济闭环
- 经济系统接线（玩家金钱扣除、AI 阵营接受/拒绝议和）
- **待决策（玩家拍板）**：`computeBail` 当前按 `state.units` 汇总**双方**剩余部队金币价值（`src/core/battle/result.ts`），而议和的语义应是「你保留的部队」= 仅玩家侧。若改为仅统计玩家侧剩余部队，默认战斗测试阵容（PLAYER_ARMY + ENEMY_ARMY 金币合计 9860 → 保释金 = round(9860×1.5) = 14790 > 玩家 10000）的议和也将变为可执行——当前默认战斗测试入口下议和实为 disabled（仅小阵容如 e2e 5v5 民兵可测）。

## 攻防链消费端
- 兵种地形加成、宝物系统（mods 写入）、兵种克制
