import type Phaser from 'phaser'
import { setSoundVolume } from './sound'
import { buildShuffledPlaylist, nextTrackIndex, prevTrackIndex } from './playlist'
import BGM_CONFIG from '../data/bgmConfig.json'
import { BGM_URLS, baseKey } from './assetKeys'

/**
 * 背景音乐管理器（渲染层，游戏级共享单例）。
 *
 * 职责：
 * - 构建期自动发现 assets/bgm/mp3/ 下全部可播音频（新增文件无需改代码）；
 *   assets/bgm/wav/ 是留给玩家的原声碟，游戏不加载；
 * - 音频由 LoadingScene（Boot）一次性预载进全局缓存，本管理器不再自行加载；
 * - 分类 playlist：menu / explore / battle 统一走「shuffle → 顺序播放 → 循环 playlist」，
 *   menu 单曲 playlist 即单曲无缝循环（loop）；
 * - 解锁（浏览器自动播放策略）：unlock() 安装 document 手势监听，首次手势内 context.resume()；
 * - 默认音量 10%（用户要求：宁小勿吵）。
 *
 * 与 core 的边界：BGM 属纯视听层，不进入事件日志/确定性回放，选曲可用 Math.random。
 * playlist 的洗牌/推进逻辑在 ./playlist（纯函数，可单测）。
 */

/** BGM 播放场景分类 */
export type BgmCategory = 'menu' | 'explore' | 'battle'

/** 默认 BGM 音量（0~1）：10%。 */
export const DEFAULT_BGM_VOLUME = 0.1

/** 对外暴露的 BGM 状态（dev bridge / e2e 断言用） */
export interface BgmState {
  /** 音频已加载完成，可起播 */
  ready: boolean
  /** 当前音量（0~1） */
  volume: number
  /** 已开始播放 */
  playing: boolean
  /** 曲目数量（assets/bgm/mp3/ 下可播音频数） */
  trackCount: number
  /** 当前播放顺序（未起播为空数组） */
  playlist: string[]
  /** 当前播放场景分类 */
  currentCategory: BgmCategory | null
  /** 当前播放曲目名 */
  currentTrack: string | null
}

export class BgmManager {
  private readonly keys: string[]
  private current: Phaser.Sound.BaseSound | null = null
  private playlist: string[] = []
  private playlistIndex = -1
  private volume = DEFAULT_BGM_VOLUME
  private ready: boolean
  private playing = false
  private currentCategory: BgmCategory | null = null
  private currentTrack: string | null = null
  private unlocked = false
  private pendingCategory: BgmCategory | null = null
  /** 曲目切换监听（供共享 BgmControls 等 UI 刷新；销毁时注销） */
  private readonly trackListeners = new Set<() => void>()

  constructor(private readonly game: Phaser.Game) {
    this.keys = Object.keys(BGM_URLS).map(baseKey)
    // LoadingScene 预载完成 → 全局缓存全部就绪
    this.ready = this.keys.length === 0 || this.keys.every((k) => this.game.cache.audio.has(k))
  }

  /** 解锁音频（幂等）：安装 document 首次手势监听；解锁后立即执行待定起播 */
  unlock(): void {
    if (this.unlocked) return
    this.unlocked = true
    this.game.sound.unlock()
    if (this.ready && this.pendingCategory) {
      this.startCategory(this.pendingCategory)
    }
  }

  /** 切换到指定场景的 BGM 分类；音频未就绪/未解锁时记录意图，条件满足后自动执行 */
  switchToCategory(category: BgmCategory): void {
    this.pendingCategory = category
    if (this.ready && this.unlocked) {
      this.startCategory(category)
    }
  }

  /** 下一首（单曲 playlist 无操作） */
  nextTrack(): void {
    if (this.playlist.length <= 1) return
    this.playlistIndex = nextTrackIndex(this.playlistIndex, this.playlist.length)
    this.playCurrent()
  }

  /** 上一首（单曲 playlist 无操作） */
  prevTrack(): void {
    if (this.playlist.length <= 1) return
    this.playlistIndex = prevTrackIndex(this.playlistIndex, this.playlist.length)
    this.playCurrent()
  }

  /** 当前曲目名（供 UI 显示） */
  getCurrentTrack(): string | null {
    return this.currentTrack
  }

  /** 注册曲目切换监听（供 UI 控件刷新标签/滑块） */
  addTrackListener(cb: () => void): void {
    this.trackListeners.add(cb)
  }

  /** 注销曲目切换监听（UI 销毁时必须调用，防止泄漏） */
  removeTrackListener(cb: () => void): void {
    this.trackListeners.delete(cb)
  }

  /** 设置音量（0~1，clamp）；未来"设置"界面用 */
  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v))
    if (this.current) setSoundVolume(this.current, this.volume)
  }

  getVolume(): number {
    return this.volume
  }

  getState(): BgmState {
    return {
      ready: this.ready,
      volume: this.volume,
      playing: this.playing,
      trackCount: this.keys.length,
      playlist: this.playlist,
      currentCategory: this.currentCategory,
      currentTrack: this.currentTrack
    }
  }

  // ---------- 内部实现 ----------

  private startCategory(category: BgmCategory): void {
    const catTracks: string[] = BGM_CONFIG.categories[category] ?? []
    const available = catTracks.filter((t) => this.keys.includes(t))
    if (available.length === 0) return
    this.stopCurrent()
    this.currentCategory = category
    this.playlist = buildShuffledPlaylist(available, () => Math.random())
    this.playlistIndex = 0
    this.currentTrack = this.playlist[0] ?? null
    this.playing = true
    this.playCurrent()
  }

  /** 播放 playlist 中当前曲目；单曲 loop（无缝），多曲播完自动推进下一首 */
  private playCurrent(): void {
    if (this.playlist.length === 0) return
    this.stopCurrent()
    const key = this.playlist[this.playlistIndex] ?? (this.keys[0] as string)
    this.currentTrack = key
    this.emitTrackChange()
    const isSingle = this.playlist.length === 1
    const s = this.game.sound.add(key, { volume: this.volume, loop: isSingle })
    if (!isSingle) {
      s.once('complete', () => this.nextTrack())
    }
    s.play()
    this.current = s
  }

  private emitTrackChange(): void {
    for (const cb of this.trackListeners) cb()
  }

  private stopCurrent(): void {
    if (this.current) {
      this.current.stop()
      this.current.destroy()
      this.current = null
    }
  }

}

let instance: BgmManager | null = null

/** 获取游戏级共享 BGM 管理器（首次调用时创建，之后复用） */
export function getBgmManager(scene: Phaser.Scene): BgmManager {
  if (!instance) instance = new BgmManager(scene.game)
  return instance
}
