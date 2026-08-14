import type Phaser from 'phaser'
import type { AdventureScene } from '../scenes/AdventureScene'
import type { BattleScene } from '../scenes/BattleScene'
import type { MainMenuScene } from '../scenes/MainMenuScene'
import type { LoadingScene } from '../scenes/LoadingScene'
import type { BattleArmyConfig } from '../core/battle/types'
import type { Axial } from '../core/hex/HexGrid'
import { getBgmManager } from '../audio/BgmManager'

/**
 * 开发调试桥（dev-only）。生产构建应剔除。
 * 通过 window.__game 暴露真实游戏状态与受控操作，
 * 供 e2e / 人工调试断言状态（而非仅看像素）。
 */
export interface DebugBridge {
  getState(): Record<string, unknown>
  setSeed(seed: number): void
  /** 逐格移动动画耗时；0 = 瞬间完成（e2e 用） */
  setAnimationSpeed(ms: number): void
  /** 等待移动动画结束 */
  waitForMove(): Promise<void>
  /** 设置 BGM 音量（0~1）；未来"设置"界面接线点 */
  setBgmVolume(volume: number): void
  /** 设置音效音量（0~1）；未来"设置"界面接线点 */
  setSfxVolume(volume: number): void
  /** 直接以指定阵容/网格开局（e2e 确定性交互测试） */
  startBattle(player: BattleArmyConfig, enemy: BattleArmyConfig, grid: { cols: number; rows: number; obstacles?: Axial[] }): void
  /** 中途速度修正（dev/e2e 钩子；减速/加速技能接线点） */
  applySpeedMod(unitId: string, delta: number): void
  /** 完整 battle log 文本（标准化格式，每行一条） */
  getLog(): string
  /** 下载完整 battle log 为 .log 文件 */
  downloadLog(): void
  /** 导出当前战斗状态为 JSON（复现 / debug 用） */
  exportState(): string
}

declare global {
  interface Window {
    __game?: DebugBridge
  }
}

export function installDevBridge(game: Phaser.Game): DebugBridge {
  const adventure = () => game.scene.getScene('Adventure') as AdventureScene | null
  const battle = () => game.scene.getScene('Battle') as BattleScene | null
  const menu = () => game.scene.getScene('MainMenu') as MainMenuScene | null
  const loading = () => game.scene.getScene('Loading') as LoadingScene | null

  /** 按活动场景返回其 getDebugState；Loading/MainMenu 也有状态（loading 进度、菜单按钮启用） */
  const getActive = (): { getDebugState(): Record<string, unknown> } | null => {
    if (battle()?.scene.isActive()) return battle()
    if (adventure()?.scene.isActive()) return adventure()
    if (menu()?.scene.isActive()) return menu()
    if (loading()?.scene.isActive()) return loading()
    return null
  }

  const bridge: DebugBridge = {
    getState() {
      return getActive()?.getDebugState() ?? { ready: false }
    },
    setSeed(seed) {
      adventure()?.setSeed(seed)
    },
    setAnimationSpeed(ms) {
      adventure()?.setAnimationSpeed(ms)
      battle()?.setAnimationSpeed(ms)
    },
    async waitForMove() {
      await adventure()?.waitForMove()
      await battle()?.waitForMove()
    },
    setBgmVolume(volume) {
      const scene = adventure() ?? battle() ?? menu() ?? loading()
      if (!scene) return
      getBgmManager(scene).setVolume(volume)
    },
    setSfxVolume(volume) {
      adventure()?.setSfxVolume(volume)
    },
    startBattle(player, enemy, grid) {
      battle()?.startBattle(player, enemy, grid)
    },
    applySpeedMod(unitId, delta) {
      battle()?.applySpeedMod(unitId, delta)
    },
    getLog() {
      return battle()?.getFullLog() ?? ''
    },
    downloadLog() {
      battle()?.downloadLog()
    },
    exportState() {
      return battle()?.exportState() ?? '{}'
    }
  }
  window.__game = bridge
  return bridge
}
