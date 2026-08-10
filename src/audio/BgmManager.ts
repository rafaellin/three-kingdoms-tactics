import type Phaser from 'phaser'
import { setSoundVolume } from './sound'
import { buildPlaylist, nextTrackIndex } from './playlist'
import BGM_CONFIG from '../data/bgmConfig.json'

/**
 * 背景音乐管理器（渲染层）。
 *
 * 职责：
 * - 构建期自动发现 assets/bgm/mp3/ 下全部可播音频（新增文件无需改代码）；
 *   assets/bgm/wav/ 是留给玩家的原声碟，游戏不加载；
 * - 异步加载 → 首次用户交互（浏览器自动播放策略要求手势内触发）后，
 *   把全部曲目排成 playlist 顺序播放（一首结束接下一首）、循环整个 playlist；
 *   主题曲（BGM_CONFIG.themeSong，见 src/data/bgmConfig.json）固定第一首，其余随机；
 *   主题曲未找到则无主题曲、全随机；
 * - 默认音量 10%（用户要求：宁小勿吵）。
 *
 * 与 core 的边界：BGM 属纯视听层，不进入事件日志/确定性回放，选曲可用 Math.random。
 * playlist 的洗牌/推进逻辑在 ./playlist（纯函数，可单测）。
 * 未来"设置"界面通过 setVolume / getState() 控制音量。
 */

/** 默认 BGM 音量（0~1）：10% */
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
  /** 已开始播放（首次交互后为 true） */
  playing: boolean
  /** 曲目数量（assets/bgm/mp3/ 下可播音频数） */
  trackCount: number
  /** 当前播放顺序（主题曲固定第一首；未起播为空数组） */
  playlist: string[]
}

export class BgmManager {
  private readonly keys: string[] = []
  private current: Phaser.Sound.BaseSound | null = null
  /** 随机排序后的播放顺序（keys 的一个排列） */
  private playlist: string[] = []
  /** 当前播放曲目在 playlist 中的下标（未起播为 -1） */
  private playlistIndex = -1
  private volume = DEFAULT_BGM_VOLUME
  private ready = false
  private playing = false
  /** 是否已发生过用户交互（决定加载完成后是否自动起播） */
  private interacted = false
  /** 首交互监听器（起播后解绑） */
  private readonly gestureHandler = (): void => this.onUserInteraction()

  constructor(private readonly scene: Phaser.Scene) {
    for (const [path, url] of Object.entries(BGM_URLS)) {
      const key = BgmManager.baseKey(path)
      this.keys.push(key)
      this.scene.load.audio(key, url)
    }
    // 首次用户交互 → 解锁音频 + 随机起播（浏览器要求在手势内触发）
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
        // 交互发生在加载完成前：加载完即自动起播
        if (this.interacted && !this.playing) this.startPlaylist()
        resolve()
      })
      this.scene.load.start()
    })
  }

  /** 用户首次交互：解锁音频并尝试起播；音频未就绪则等加载完成后自动起播 */
  private onUserInteraction(): void {
    this.interacted = true
    this.scene.sound.unlock()
    if (this.ready && !this.playing) this.startPlaylist()
  }

  /** 路径 → 缓存 key：取文件名（去扩展名），如 'assets/bgm/mp3/Neon Jade.mp3' → 'Neon Jade' */
  private static baseKey(path: string): string {
    const file = path.split('/').pop() ?? path
    return file.replace(/\.[^.]+$/, '')
  }

  /** 起播：主题曲固定第一首、其余随机，从第一首开始顺序播放 */
  private startPlaylist(): void {
    if (this.keys.length === 0) return
    this.stopCurrent()
    this.playlist = buildPlaylist(this.keys, BGM_CONFIG.themeSong, () => Math.random())
    this.playlistIndex = 0
    this.playCurrent()
    this.playing = true
    this.unbindGestures()
  }

  /** 播放 playlist 中当前曲目；自然播完触发下一首 */
  private playCurrent(): void {
    if (this.playlist.length === 0) return
    this.stopCurrent()
    const key = this.playlist[this.playlistIndex] ?? (this.keys[0] as string)
    // 单曲不 loop：播放完走 nextTrack 接下一首（无 loop 才发 complete 事件）
    const s = this.scene.sound.add(key, { volume: this.volume })
    s.once('complete', () => this.nextTrack())
    s.play()
    this.current = s
  }

  /** 曲目结束 → 下一首；到末尾循环回 playlist 开头 */
  private nextTrack(): void {
    this.playlistIndex = nextTrackIndex(this.playlistIndex, this.playlist.length)
    this.playCurrent()
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
      playlist: this.playlist
    }
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
