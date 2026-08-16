/**
 * 战役模式配置（纯数据，无逻辑）。
 * MVP 关卡「千里走单骑·东岭关」：1 小城 + 3 我方武将（关羽/周仓/孙乾，5 级带兵）
 * + 守将孔秀（5 级，2 队）+ 2 组中立杂兵（练级）+ 胜利条件（击败孔秀）。
 *
 * 地图为手工构造的窄路关卡：孔秀站在唯一可通行的 plain 格，两侧与关后 south 用
 * mountain 封死，迫使玩家只能正面击破守将后通过。
 */
import type { Axial } from '../core/hex/HexGrid'
import { hexKey } from '../core/hex/HexGrid'
import { generateMap, type MapData } from '../core/map/MapGen'
import { deriveStats } from '../core/generals'
import { GENERAL_BASES } from './generals'
import type { UnitDefId } from './units'
import type { TerrainId } from './terrain'
import type { General, Player, Town } from '../core/state/GameState'

/** 守将驻点：站岗不可移动；站岗格不可通行直到被歼 */
export interface Garrison {
  id: string
  generalId: string
  level: number
  position: Axial
  units: { defId: UnitDefId; count: number }[]
}

/** 中立杂兵：练级用；被歼后从地图消失（不重生） */
export interface Neutral {
  id: string
  position: Axial
  units: { defId: UnitDefId; count: number }[]
}

/** 战役开场介绍（进战役 modal 显示 + 语音朗读） */
export interface CampaignIntro {
  /** modal 标题 */
  title: string
  /** 文稿正文（朗读 + 显示，多段 \n 分隔） */
  body: string
  /** 任务目标（modal 底部显示） */
  objective: string
  /** 朗读音频缓存 key（assets/sound/campaign/<name>.wav 去扩展名） */
  narration: string
}

export interface CampaignConfig {
  id: string
  name: string
  /** 开场介绍（进战役 modal 显示 + 朗读） */
  intro: CampaignIntro
  /** 参与回合的玩家序列（战役 = 玩家 p1 → AI ai1） */
  players: Player[]
  /** 战役地图（含窄路关卡地形布局） */
  map: MapData
  startTowns: Town[]
  startGenerals: General[]
  /** 每武将一英雄（多英雄并行），初始位置 + 归属玩家 */
  heroStarts: { generalId: string; playerId: string; position: Axial }[]
  garrisons: Garrison[]
  neutrals: Neutral[]
  /** 胜利条件：击败孔秀守将 */
  victory: { kind: 'defeatGarrison'; targetId: string }
  /** 失败条件（声明式；本期不实现战败判定，仅入配置） */
  defeat: { kind: 'heroesDefeated'; description: string }
  /** 无酒馆（MVP 不可招募新武将） */
  tavernEnabled: boolean
}

/**
 * 手工构造东岭关地图（窄路关卡）。
 * - hexes 仅取 generateMap 的列表（radius 3 覆盖 (0,2) 及周边）——不用其 terrain/nodes：
 *   generateMap 会强制中心+六邻居为 plain 并自动放置资源点，会破坏预设窄路地形。
 * - 自己的 terrain：全 plain，再覆盖窄路布局（孔秀格 (0,1) plain；两侧/关后 mountain）。
 * - nodes 空：MVP 战役地图不放资源点，杂兵充当关卡内容。
 */
function buildDonglingMap(): MapData {
  const { hexes } = generateMap(1, 3)
  const terrain: Record<string, TerrainId> = {}
  for (const h of hexes) terrain[hexKey(h)] = 'plain'
  // 窄路关卡：孔秀格 (0,1) 为唯一可通行 plain；两侧 (-1,1)/(1,1) mountain 封死
  terrain[hexKey({ q: -1, r: 1 })] = 'mountain'
  terrain[hexKey({ q: 1, r: 1 })] = 'mountain'
  // 关后更南 (0,2)/(-1,2)/(1,2) 封死，确保只能从关卡正面走
  terrain[hexKey({ q: 0, r: 2 })] = 'mountain'
  terrain[hexKey({ q: -1, r: 2 })] = 'mountain'
  terrain[hexKey({ q: 1, r: 2 })] = 'mountain'
  // 东侧翼 (2,-1)/(2,0)/(2,1) 封死：堵死 (1,0)→(2,0)→(2,1) 绕关路径
  terrain[hexKey({ q: 2, r: -1 })] = 'mountain'
  terrain[hexKey({ q: 2, r: 0 })] = 'mountain'
  terrain[hexKey({ q: 2, r: 1 })] = 'mountain'
  // 西侧翼 (-2,1)/(-2,2) 封死：堵死 (-2,0)→(-2,1)→(-2,2) 绕关路径
  terrain[hexKey({ q: -2, r: 1 })] = 'mountain'
  terrain[hexKey({ q: -2, r: 2 })] = 'mountain'
  return { hexes, terrain, nodes: {} }
}

export const CAMPAIGNS: CampaignConfig[] = [
  {
    id: 'dongling',
    name: '千里走单骑·东岭关',
    intro: {
      title: '千里走单骑 · 东岭关',
      body: [
        '建安五年，曹操大破徐州。关羽为护刘备家眷，兵困土山，不得已暂投曹操。曹操礼遇甚厚——封侯赐金，更赠赤兔神驹，却终究留不住一颗归汉之心。',
        '得知义兄刘备下落，关羽挂印封金，护送两位皇嫂，提青龙偃月刀，跨赤兔马，千里单骑，踏上寻兄之路。然而这一路关隘重重，五关六将，无人肯放行。',
        '东岭关，是第一道天堑。守将孔秀据关而守，厉声喝道："无丞相文凭，休想过关！"',
        '关羽冷眉一横，青龙刀出鞘——',
        '过五关、斩六将，便从这一关开始。'
      ].join('\n'),
      objective: '任务目标：击败孔秀。',
      narration: 'campaign 1'
    },
    players: [
      { id: 'p1', faction: 'shu', kind: 'human' },
      { id: 'ai1', faction: 'wei', kind: 'ai' }
    ],
    map: buildDonglingMap(),
    startTowns: [
      {
        id: 't-dongling', name: '东岭小城', owner: 'p1', level: 1,
        position: { q: 0, r: 0 }, garrisonGeneralId: null,
        garrison: [], visitorGeneralId: null
      }
    ],
    startGenerals: [
      {
        id: 'g-guan', name: '關羽', faction: 'shu', type: '全能', level: 5, xp: 0,
        stats: deriveStats(GENERAL_BASES['g-guan'], 5), passives: [],
        skillSlots: Math.floor(5 / 3), army: [
          { defId: 'swordsman', count: 20 }, { defId: 'archer', count: 12 }
        ]
      },
      {
        id: 'g-zhoucang', name: '周倉', faction: 'shu', type: '战将', level: 5, xp: 0,
        stats: deriveStats(GENERAL_BASES['g-zhoucang'], 5), passives: [],
        skillSlots: Math.floor(5 / 3), army: [
          { defId: 'pikeman', count: 15 }, { defId: 'militia', count: 20 }
        ]
      },
      {
        id: 'g-sunqian', name: '孫乾', faction: 'shu', type: '智将', level: 5, xp: 0,
        stats: deriveStats(GENERAL_BASES['g-sunqian'], 5), passives: [],
        skillSlots: Math.floor(5 / 3), army: [
          { defId: 'archer', count: 15 }, { defId: 'militia', count: 15 }
        ]
      }
    ],
    heroStarts: [
      { generalId: 'g-guan', playerId: 'p1', position: { q: 0, r: -1 } },
      { generalId: 'g-zhoucang', playerId: 'p1', position: { q: -1, r: -1 } },
      { generalId: 'g-sunqian', playerId: 'p1', position: { q: 1, r: -1 } }
    ],
    garrisons: [
      {
        id: 'gar-kongxiu', generalId: 'g-kongxiu', level: 5, position: { q: 0, r: 1 },
        units: [{ defId: 'swordsman', count: 18 }, { defId: 'archer', count: 10 }]
      }
    ],
    neutrals: [
      { id: 'neu-1', position: { q: 0, r: -2 }, units: [{ defId: 'militia', count: 10 }] },
      { id: 'neu-2', position: { q: 1, r: -2 }, units: [{ defId: 'archer', count: 6 }] }
    ],
    victory: { kind: 'defeatGarrison', targetId: 'gar-kongxiu' },
    defeat: { kind: 'heroesDefeated', description: '关羽阵亡，千里走单骑功败垂成。' },
    tavernEnabled: false
  }
]

export function listCampaigns(): CampaignConfig[] {
  return CAMPAIGNS
}

export function getCampaign(id: string): CampaignConfig | undefined {
  return CAMPAIGNS.find((c) => c.id === id)
}
