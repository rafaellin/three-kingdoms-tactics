/**
 * 回合级 AI 行动接口（core 纯函数，确定性）。
 * 与 `src/core/battle/ai.ts`（战斗内 AI）区分：这里是「大地图回合」的 AI 玩家行动。
 *
 * MVP：AI 配置「不动」→ 返回原 state（无行动）；留接口给未来攻城/移动。
 */
import type { GameState } from './GameState'

/**
 * AI 玩家行动（advanceTurn 轮到 AI 时调用；MVP no-op）。
 * 未来：读地图配置 → 攻城/移动等行动在此扩展，返回新 state（确定性，不就地修改）。
 */
export function aiAct(state: GameState, playerId: string): GameState {
  void playerId
  return state
}

/**
 * system 结算接口：回合末野怪随机生成（MVP no-op）。
 * 当前地图无随机野怪（杂兵是手工配置、非重生）；别的图若配置随机野怪在此扩展。
 * 确定性约束：随机必须走注入 RNG，不得裸 Math.random。
 */
export function spawnNeutrals(state: GameState): GameState {
  return state
}
