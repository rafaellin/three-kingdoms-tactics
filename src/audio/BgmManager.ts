import type Phaser from 'phaser'
import { setSoundVolume } from './sound'
import { buildShuffledPlaylist, nextTrackIndex, prevTrackIndex } from './playlist'
import BGM_CONFIG from '../data/bgmConfig.json'

/**
 * 背景音乐管理器（渲染层）。
 *
 * 职责：
 * - 构建期自动发现 assets/bgm/mp3/ 下全部可播音频（新增文件无需改代码）；
 *   assets/bgm/wav/ 是留给玩家的原声碟，游戏不加载；
 * - 异步加载 → 首次用户交互（浏览器自动播放策略要求手势内触发）后，
 *   按调用方指定的分类起播对应 playlist；
 * - menu：主题曲单曲循环；
 * - explore / battle：分类曲目 shuffle → 顺序播放 → 循环整个 playlist；
 * - 每次 switchToCategory 重新 shuffle；
 * - 默认音量 10%（用户要求：宁小勿吵）。
 *
 * 与 core 的边界：BGM 属纯视听层，不进入事件日志/确定性回放，选曲可用 Math.random。
 * playlist 的洗牌/推进逻辑在 ./playlist（纯函数，可单测）。
 * 未来"设置"界面通过 setVolume / getState() 控制音量。
 */

/** BGM 播放场景分类 */
export type BgmCategory = 'menu' | 'explore' | 'battle'

/**
 * 默认 BGM 音量（0~1）：10%。
 * 仅在无持久化配置 / 设置未就绪时作为回退初始值；
 * 运行时音量以 setVolume() / getVolume() 为准（控件、设置页面共享）。
 */
export const DEFAULT_BGM_VOLUME = 0.1

/** 只扫 assets/bgm/mp3/（assets/bgm/wav/ 是原声碟，不加载）；.pkf 等伴生文件自动忽略 */
const BGM_URLS: Record<string, string> = import.meta.glob('/assets/bgm/mp3/*.{wav,mp3,ogg,m4a}', {
  query: '?url',
  import: 'default',
  eager: true
})

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
  private readonly keys: string[] = []
  private current: Phaser.Sound.BaseSound | null = null
  /** 随机排序后的播放顺序（仅 explore / battle） */
  private playlist: string[] = []
  /** 当前播放曲目在 playlist 中的下标（未起播为 -1） */
  private playlistIndex = -1
  private volume = DEFAULT_BGM_VOLUME
  private ready = false
  private playing = false
  /** 当前播放的场景分类 */
  private currentCategory: BgmCategory | null = null
  /** 当前播放曲目名 */
  private currentTrack: string | null = null
  /** 是否已发生过用户交互（决定加载完成后是否自动起播） */
  private interacted = false
  /** 调用方期望的播放分类（可能因音频未解锁而延迟执行） */
  private pendingCategory: BgmCategory | null = null
  /** 曲目切换回调（供 UI 更新标签；通过 setTrackChangeCallback 设置） */
  private onTrackChange?: () => void
  /** 首交互监听器（起播后解绑） */
  private readonly gestureHandler = (): void => this.onUserInteraction()

  constructor(private readonly scene: Phaser.Scene, onTrackChange?: () => void) {
    this.onTrackChange = onTrackChange
    for (const [path, url] of Object.entries(BGM_URLS)) {
      const key = BgmManager.baseKey(path)
      this.keys.push(key)
      this.scene.load.audio(key, url)
    }
    // 首次用户交互 → 解锁音频（浏览器要求在手势内触发）
    this.scene.input.on('pointerdown', this.gestureHandler)
    this.scene.input.keyboard?.on('keydown', this.gestureHandler)
    // 场景关闭时停止音乐，避免残留播放
    this.scene.events.once('shutdown', () => this.dispose())
  }

  /** 开始异步加载 BGM；resolve 时已可起播 */
  load(): Promise<void> {
    return new Promise((resolve) => {
      if (this.keys.length === 0) {
        resolve()
        return
      }
      this.scene.load.once('complete', () => {
        this.ready = true
        // 交互 / 切分类发生在加载完成前：加载完即执行待定起播
        if (this.interacted && this.pendingCategory && !this.playing) {
          this.startCategory(this.pendingCategory)
        }
        resolve()
      })
      this.scene.load.start()
    })
  }

  /**
   * 切换到指定场景的 BGM 分类。
   * - menu：主题曲单曲循环
   * - explore / battle：分类曲目 shuffle → 顺序播放 → 循环整个 playlist
   * 若音频未就绪或未解锁，记录意图并在条件满足后自动执行。
   */
  switchToCategory(category: BgmCategory): void {
    this.pendingCategory = category
    if (this.ready && this.interacted) {
      this.startCategory(category)
    }
  }

  /** 下一首（供 UI 按钮调用） */
  nextTrack(): void {
    if (this.currentCategory === 'menu') return // 主菜单只有单曲循环
    if (this.playlist.length === 0) return
    this.playlistIndex = nextTrackIndex(this.playlistIndex, this.playlist.length)
    this.playCurrent()
  }

  /** 上一首（供 UI 按钮调用） */
  prevTrack(): void {
    if (this.currentCategory === 'menu') return // 主菜单只有单曲循环
    if (this.playlist.length === 0) return
    this.playlistIndex = prevTrackIndex(this.playlistIndex, this.playlist.length)
    this.playCurrent()
  }

  /** 当前曲目名（供 UI 显示） */
  getCurrentTrack(): string | null {
    return this.currentTrack
  }

  /** 设置曲目切换回调（供 UI 控件在 BgmManager 之后创建时延迟接线） */
  setTrackChangeCallback(cb: () => void): void {
    this.onTrackChange = cb
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

  /** 用户首次交互：解锁音频并尝试起播 */
  private onUserInteraction(): void {
    this.interacted = true
    this.scene.sound.unlock()
    if (this.ready && this.pendingCategory && !this.playing) {
      this.startCategory(this.pendingCategory)
    }
    // 主菜单（单曲循环）不需要解绑手势——menu 可能在任何时候被再次触发
    if (this.currentCategory !== 'menu') {
      this.unbindGestures()
    }
  }

  /** 路径 → 缓存 key：取文件名（去扩展名），如 'assets/bgm/mp3/Neon Jade.mp3' → 'Neon Jade' */
  private static baseKey(path: string): string {
    const file = path.split('/').pop() ?? path
    return file.replace(/\.[^.]+$/, '')
  }

  /** 执行分类起播 */
  private startCategory(category: BgmCategory): void {
    if (this.keys.length === 0) return

    if (category === 'menu') {
      this.startMenuTheme()
      return
    }

    // explore / battle：取分类曲目 → shuffle → 从第一首开始顺序播放
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

  /** 主菜单：主题曲单曲循环 */
  private startMenuTheme(): void {
    const key = BGM_CONFIG.themeSong
    if (!key || !this.keys.includes(key)) return

    this.stopCurrent()
    this.currentCategory = 'menu'
    this.playlist = [key]
    this.playlistIndex = 0
    this.currentTrack = key
    this.playing = true
    this.onTrackChange?.()
    const s = this.scene.sound.add(key, { volume: this.volume, loop: true })
    s.play()
    this.current = s
  }

  /** 播放 playlist 中当前曲目；自然播完触发下一首 */
  private playCurrent(): void {
    if (this.currentCategory === 'menu') return
    if (this.playlist.length === 0) return
    this.stopCurrent()
    const key = this.playlist[this.playlistIndex] ?? (this.keys[0] as string)
    this.currentTrack = key
    this.onTrackChange?.()
    // 单曲不 loop：播放完走 nextTrack 接下一首（无 loop 才发 complete 事件）
    const s = this.scene.sound.add(key, { volume: this.volume })
    s.once('complete', () => this.nextTrack())
    s.play()
    this.current = s
  }

  private stopCurrent(): void {
    if (this.current) {
      this.current.stop()
      this.current.destroy()
      this.current = null
    }
  }

  private unbindGestures(): void {
    this.scene.input.off('pointerdown', this.gestureHandler)
    this.scene.input.keyboard?.off('keydown', this.gestureHandler)
  }

  private dispose(): void {
    this.stopCurrent()
    this.unbindGestures()
  }
}
