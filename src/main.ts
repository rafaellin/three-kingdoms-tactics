import Phaser from 'phaser'
import { LoadingScene } from './scenes/LoadingScene'
import { MainMenuScene } from './scenes/MainMenuScene'
import { CampaignSelectScene } from './scenes/CampaignSelectScene'
import { AdventureScene } from './scenes/AdventureScene'
import { BattleScene } from './scenes/BattleScene'
import { installDevBridge } from './dev/debug'

const game = new Phaser.Game({
  type: Phaser.WEBGL,
  parent: 'game',
  backgroundColor: '#0f1622',
  scale: {
    // RESIZE：canvas 撑满窗口；设计基准 1920×1080
    mode: Phaser.Scale.RESIZE,
    width: 1920,
    height: 1080
  },
  scene: [LoadingScene, MainMenuScene, CampaignSelectScene, AdventureScene, BattleScene]
})

installDevBridge(game)
