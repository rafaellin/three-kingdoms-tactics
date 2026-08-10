import type Phaser from 'phaser'
import type { AdventureScene } from '../scenes/AdventureScene'

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
  const scene = () => game.scene.getScene('Adventure') as AdventureScene | null

  const bridge: DebugBridge = {
    getState() {
      const s = scene()
      return s ? s.getDebugState() : { ready: false }
    },
    setSeed(seed) {
      scene()?.setSeed(seed)
    },
    setAnimationSpeed(ms) {
      scene()?.setAnimationSpeed(ms)
    },
    async waitForMove() {
      await scene()?.waitForMove()
    },
    setBgmVolume(volume) {
      scene()?.setBgmVolume(volume)
    },
    setSfxVolume(volume) {
      scene()?.setSfxVolume(volume)
    }
  }
  window.__game = bridge
  return bridge
}
