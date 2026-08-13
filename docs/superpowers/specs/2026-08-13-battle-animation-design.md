# 战斗动画（移动逐格 + 受击闪白）设计

日期：2026-08-13
状态：已确认，待实现

## 背景 / 问题

「战斗测试」场景目前**无任何动画**：

- `BattleScene.animationMs` 默认 `0`，从未设置默认值 → `animateMove` 直接 no-op，移动瞬间完成；
- 攻击/射击只更新日志文字，没有任何受击视觉反馈；
- 玩家看不出"谁移动了 / 谁打了谁 / 掉血多少"。

## 目标

1. 移动/冲锋默认**逐格动画**（150ms/格，与 AdventureScene 一致）；
2. 命中时目标**白闪淡出**，让玩家看清"谁被打了"；
3. 敌方 AI 行动使用**同样的动画**（冲锋动画 + 受击闪白）。

不改 core（动画纯渲染层）。

## 设计

### 1. 移动动画默认开启

`BattleScene.animationMs` 默认 `0 → 150`。`animateMove`（已存在）在 `animationMs > 0` 时逐格推进 `visualPos`，无需新增。

### 2. 时序调整：先动画、后落状态

现状是"先 dispatch 落状态、再播动画"（状态秒变但画面没动）。改为：

- 玩家移动 / 冲锋 / 敌方移动 / 敌方冲锋：**先 `await animateMove`（视觉滑过去），动画结束再 dispatch**（移动/攻击/反击在"落刀"那刻生效）。
- `handleClick` 改为 `async`，sword / bow / move 分支内 await 动画后再 dispatch。
- `stepEnemyAi` 的 move / attack 分支同样换顺序（attack 先冲锋再 dispatch）。

### 3. 受击闪白

新增两个纯渲染方法（BattleScene 内，depth 6，压在格子之上）：

- `playHitFlash(at: Axial, size: 1 | 2)`：在目标占据格画白色半透明填充，`tween alpha → 0`（350ms，`Cubic.easeOut`），结束后 `destroy()`。
- `flashDamageDealt(hpBefore, posBefore)`：对比攻击前后 `hpLeft`，**谁掉血谁闪**（主攻目标 + 反击目标都会闪）。位置用攻击前的 `posBefore`，所以**被消灭的单位也能闪**（用最后位置）。

### 4. 敌方行动一致

`stepEnemyAi` 的 attack / shoot 分支：dispatch 后调用 `flashDamageDealt`，与玩家一致。

### 5. 测试 / debug

- `getDebugState` 暴露 `animating`（动画是否进行中）与 `hitFlashCount`（受击闪白累计次数）。
- 新增 e2e 回归：默认速度（不设 `setAnimationSpeed`）下点击可达格 → 立即断言 `animating=true` 且单位位置**未变**（动画中）→ `waitForMove` 后断言位置更新（动画结束才落状态）。
- `'默认战斗'` e2e 显式 `setAnimationSpeed(0)`，保持快速、确定性。

## 非目标

- 不做漂浮伤害数字、不做远程箭矢飞行动画（用户明确不选）。
- 不改 core / 事件日志 / 确定性。
