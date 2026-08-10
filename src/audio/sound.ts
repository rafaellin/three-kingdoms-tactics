import type Phaser from 'phaser'

/**
 * 设置声音实例音量。
 * Phaser 4 的 BaseSound 类型上没有 setVolume（只有具体实现 WebAudioSound / HTML5AudioSound 才有）；
 * 运行时 sound.add() 返回的实例必为二者之一，故收窄后调用。
 */
export function setSoundVolume(sound: Phaser.Sound.BaseSound, volume: number): void {
  ;(sound as Phaser.Sound.WebAudioSound | Phaser.Sound.HTML5AudioSound).setVolume(volume)
}
