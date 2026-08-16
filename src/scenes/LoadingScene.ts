import Phaser from 'phaser'
import { MainMenuScene } from './MainMenuScene'
import { getBgmManager, type BgmManager } from '../audio/BgmManager'
import { fadeAndStart } from '../ui/fade'
import { BGM_URLS, SFX_AUDIO, ICON_URLS, FONT_URLS, baseKey } from '../audio/assetKeys'

/**
 * 加载页（渲染层）：第一个场景，一次性预载 icon / BGM / SFX 进 Phaser 全局缓存，
 * 之后各场景直接读缓存不再重复解码。
 *
 * 加载完成后：
 * - 若音频未被浏览器锁定 → 直接起播主题曲并进入主菜单；
 * - 若音频被锁定 → 显示「点击进入」按钮，首次点击手势内解锁音频并起播主题曲。
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
      this.load.image(baseKey(path), url)
    }
    for (const [path, url] of Object.entries(FONT_URLS)) {
      this.load.font({ key: baseKey(path), url, format: 'woff2' })
    }
    for (const [path, url] of Object.entries(BGM_URLS)) {
      this.load.audio(baseKey(path), url)
    }
    for (const [key, url] of Object.entries(SFX_AUDIO)) {
      this.load.audio(key, url)
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
    const bgm = getBgmManager(this)
    if (!this.sound.locked) {
      // 已有用户手势 → 音频可直接播：直接起播主题曲并进入主菜单。
      // bgm.unlock() 先于 switchToCategory，确保 BgmManager.unlocked 已置 true，
      // 这样即使 sound.locked 仅在本次手势刚清（时序上先读后写），
      // switchToCategory 也走的是已解锁分支，不会把起播推迟到下一次手势。
      bgm.unlock()
      bgm.switchToCategory('menu')
      fadeAndStart(this, MainMenuScene.KEY)
    } else {
      // 音频被浏览器自动播放策略锁定：装解锁监听 + 显示 OK 按钮，单击解锁并起播主题曲
      bgm.unlock()
      this.showOkButton(bgm)
    }
  }

  private showOkButton(bgm: BgmManager): void {
    const { width, height } = this.scale
    this.okButton = this.add
      .text(width / 2, height * 0.6, '点击进入', {
        fontFamily: 'sans-serif',
        fontSize: '28px',
        color: '#ffffff',
        backgroundColor: '#33415c'
      })
      .setOrigin(0.5)
      .setPadding(24, 12)
      .setDepth(10)
      .setInteractive({ useHandCursor: true })
    this.okButton.on('pointerdown', () => {
      bgm.switchToCategory('menu')
      fadeAndStart(this, MainMenuScene.KEY)
    })
  }

  getDebugState(): Record<string, unknown> {
    return {
      ready: true,
      scene: 'loading',
      okButton: this.okButton ? { x: this.okButton.x, y: this.okButton.y } : null,
      bgm: getBgmManager(this).getState()
    }
  }

}
