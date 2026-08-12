import Phaser from 'phaser'
import { MainMenuScene } from './MainMenuScene'

/** 图标资源（key = 文件名去扩展名，与旧 AdventureScene.preload 一致） */
const ICON_URLS = import.meta.glob('/assets/icons/*.png', {
  query: '?url',
  import: 'default',
  eager: true
}) as Record<string, string>

/** BGM（只扫 assets/bgm/mp3/；wav/ 原声碟不加载） */
const BGM_URLS = import.meta.glob('/assets/bgm/mp3/*.{wav,mp3,ogg,m4a}', {
  query: '?url',
  import: 'default',
  eager: true
}) as Record<string, string>

/** 音效 */
const SFX_URLS = import.meta.glob('/assets/sound/*.{wav,mp3,ogg,m4a}', {
  query: '?url',
  import: 'default',
  eager: true
}) as Record<string, string>

/**
 * 加载页（渲染层）：第一个场景，一次性预载 icon / BGM / SFX 进 Phaser 全局缓存，
 * 之后各场景直接读缓存不再重复解码。加载完成后自动进入主菜单。
 * （Task 2 将在此加入主题曲自动播放 / OK 按钮逻辑。）
 */
export class LoadingScene extends Phaser.Scene {
  static readonly KEY = 'Loading'
  private static readonly BAR_W = 480
  private static readonly BAR_H = 12

  private progressBar!: Phaser.GameObjects.Graphics
  private progressText!: Phaser.GameObjects.Text
  private okButton: Phaser.GameObjects.Text | null = null

  constructor() {
    super(LoadingScene.KEY)
  }

  preload(): void {
    this.cameras.main.setBackgroundColor('#0f1622')
    const { width, height } = this.scale
    this.progressBar = this.add.graphics().setPosition(0, height / 2)
    this.progressText = this.add
      .text(width / 2, height / 2 - 40, '加载中… 0%', {
        fontFamily: 'sans-serif',
        fontSize: '20px',
        color: '#c8d2e0'
      })
      .setOrigin(0.5)

    for (const [path, url] of Object.entries(ICON_URLS)) {
      this.load.image(LoadingScene.baseKey(path), url)
    }
    for (const [path, url] of Object.entries(BGM_URLS)) {
      this.load.audio(LoadingScene.baseKey(path), url)
    }
    for (const [path, url] of Object.entries(SFX_URLS)) {
      this.load.audio(LoadingScene.baseKey(path), url)
    }

    this.load.on('progress', (v: number) => {
      const { width } = this.scale
      const x = (width - LoadingScene.BAR_W) / 2
      const y = this.progressBar.y - LoadingScene.BAR_H / 2
      this.progressBar.clear()
      this.progressBar.fillStyle(0x1a1f2e, 1)
      this.progressBar.fillRoundedRect(x, y, LoadingScene.BAR_W, LoadingScene.BAR_H, LoadingScene.BAR_H / 2)
      this.progressBar.fillStyle(0x5a7ab0, 1)
      const fillW = Math.max(LoadingScene.BAR_H, v * LoadingScene.BAR_W)
      this.progressBar.fillRoundedRect(x, y, fillW, LoadingScene.BAR_H, LoadingScene.BAR_H / 2)
      this.progressText.setText(`加载中… ${Math.round(v * 100)}%`)
    })
  }

  create(): void {
    // Task 2 将在此加入主题曲自动播放 / OK 按钮逻辑
    this.scene.start(MainMenuScene.KEY)
  }

  getDebugState(): Record<string, unknown> {
    return {
      ready: true,
      scene: 'loading',
      okButton: this.okButton ? { x: this.okButton.x, y: this.okButton.y } : null
    }
  }

  /** 路径 → 缓存 key：取文件名（去扩展名），如 '/assets/icons/town.png' → 'town' */
  private static baseKey(path: string): string {
    const file = path.split('/').pop() ?? path
    return file.replace(/\.[^.]+$/, '')
  }
}
