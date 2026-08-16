/**
 * 游戏会话抽象（纯数据/解析，无 Phaser）。
 * AdventureScene 是通用运行时：通过 GameSession 区分「战役 / 对战(沙盘)」，
 * 再经 resolveSession 解析出渲染与 dispatch 需要的 ResolvedSession。
 * 对战侧本期沿用「探索测试」沙盘作为非战役 session，PvP/PvE 未来再挂。
 */
import { getCampaign, type CampaignConfig, type CampaignIntro } from './campaigns'

/** 会话（渲染层从主菜单/战役选择传入 AdventureScene 的 data） */
export type GameSession =
  | { kind: 'campaign'; campaignId: string } // 战役：完整剧情/守将/胜利
  | { kind: 'explore'; campaignId: string } // 对战/沙盘：无守将/胜利/剧情，复用某战役地图

/** 解析后的会话（供 campaign/start dispatch + 开场 modal） */
export interface ResolvedSession {
  /** 供 campaign/start dispatch 用（探索 = 单人 human；战役 = 完整玩家序列） */
  mode: 'explore' | 'campaign'
  campaign: CampaignConfig
  /** 仅战役有开场介绍；探索/沙盘为 null */
  intro: CampaignIntro | null
}

export function resolveSession(session: GameSession): ResolvedSession {
  const campaign = getCampaign(session.campaignId)
  if (!campaign) throw new Error(`未知战役: ${session.campaignId}`)
  return {
    mode: session.kind,
    campaign,
    intro: session.kind === 'campaign' ? campaign.intro : null
  }
}
