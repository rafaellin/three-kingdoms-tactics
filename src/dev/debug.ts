import type Phaser from 'phaser'
import type { AdventureScene } from '../scenes/AdventureScene'
import type { BattleScene } from '../scenes/BattleScene'

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
}

declare global {
  interface Window {
    __game?: DebugBridge
  }
}

export function installDevBridge(game: Phaser.Game): DebugBridge {
  const adventure = () => game.scene.getScene('Adventure') as AdventureScene | null
  const battle = () => game.scene.getScene('Battle') as BattleScene | null

  /** 战斗激活返回战斗；否则大地图；主菜单/未就绪返回 null */
  const getActive = (): { getDebugState(): Record<string, unknown> } | null => {
    if (battle()?.scene.isActive()) return battle()
    if (adventure()?.scene.isActive()) return adventure()
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
    },
    setBgmVolume(volume) {
      adventure()?.setBgmVolume(volume)
    },
    setSfxVolume(volume) {
      adventure()?.setSfxVolume(volume)
    }
  }
  window.__game = bridge
  return bridge
}
