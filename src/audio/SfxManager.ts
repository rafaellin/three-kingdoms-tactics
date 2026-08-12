import type Phaser from 'phaser'
import { setSoundVolume } from './sound'
import { SFX_URLS, baseKey } from './assetKeys'

/**
 * 音效管理器（渲染层）。
 *
 * 职责：
 * - 构建期自动发现 assets/sound/ 下全部可播音频（新增文件无需改代码）；
 * - 移动等需要循环的音效：playLooped 开始循环、stopLooped 停止（移动结束必须停）；
 * - 一次性音效（战斗/点击等）后续按需在 playLooped 基础上加 playOnce。
 *
 * 与 BGM 并发：每次 sound.add() 是独立实例，WebAudio 混音下可同时播放，互不影响。
 * 与 core 的边界：音效属纯视听层，不进事件日志/确定性回放。
 */

/** 默认音效音量（0~1）；未来"设置"界面调整 */
export const DEFAULT_SFX_VOLUME = 0.3

/** 对外暴露的音效状态（dev bridge / e2e 断言用） */
export interface SfxState {
  /** 音频已加载完成，可播放 */
  ready: boolean
  /** 当前音量（0~1） */
  volume: number
  /** 当前是否有循环音效在播（如移动脚步） */
  loopPlaying: boolean
}

export class SfxManager {
  private readonly keys: Set<string> = new Set()
  /** 当前循环音效（同一时刻只允许一个，如移动脚步） */
  private loop: Phaser.Sound.BaseSound | null = null
  private volume = DEFAULT_SFX_VOLUME
  private ready = false

  constructor(private readonly scene: Phaser.Scene) {
    for (const [path] of Object.entries(SFX_URLS)) {
      const key = baseKey(path)
      this.keys.add(key)
    }
    // 音频由 LoadingScene 预载进全局缓存 → 构造即可用（无需再加载）
    this.ready = this.keys.size === 0 || Array.from(this.keys).every((k) => this.scene.game.cache.audio.has(k))
    // 场景关闭时停止循环音效
    this.scene.events.once('shutdown', () => this.stopLooped())
  }

  /** 兼容旧调用：音频已由 LoadingScene 预载，无需再加载 */
  load(): Promise<void> {
    return Promise.resolve()
  }

  /** 循环播放一个音效（如移动脚步）；未就绪或已有循环音效时忽略 */
  playLooped(key: string): void {
    if (!this.ready || !this.keys.has(key) || this.loop) return
    const s = this.scene.sound.add(key, { loop: true, volume: this.volume })
    s.play()
    this.loop = s
  }

  /** 停止当前循环音效（移动结束必须调用） */
  stopLooped(): void {
    if (!this.loop) return
    this.loop.stop()
    this.loop.destroy()
    this.loop = null
  }

  /** 设置音量（0~1，clamp）；未来"设置"界面用 */
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v))
    if (this.loop) setSoundVolume(this.loop, this.volume)
  }

  getVolume(): number {
    return this.volume
  }

  getState(): SfxState {
    return { ready: this.ready, volume: this.volume, loopPlaying: this.loop !== null }
  }
}
