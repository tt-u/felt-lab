// AI 对手性格档案: 在 GTO 近似基线上做系统性偏移
export type PersonalityId = 'gto' | 'tag' | 'lag' | 'nit' | 'station' | 'maniac';

export interface Personality {
  id: PersonalityId;
  nameZh: string;
  tagZh: string;
  descZh: string;
  // 范围松紧: 1 = GTO 基线, >1 玩更多牌
  looseness: number;
  // 进攻性: 影响下注/加注 vs 跟注的倾向与频率
  aggression: number;
  // 诈唬频率乘数
  bluff: number;
  // 跟注倾向: >1 更难被打跑(跟注站), <1 容易弃牌
  callDown: number;
  // 翻前平跟(limp)倾向 0..1
  limp: number;
  // 下注尺寸偏移: >1 偏大注
  sizing: number;
}

export const PERSONALITIES: Record<PersonalityId, Personality> = {
  gto: {
    id: 'gto',
    nameZh: 'GTO 均衡',
    tagZh: '均衡',
    descZh: '按理论最优频率行动, 范围平衡, 难以被剥削',
    looseness: 1,
    aggression: 1,
    bluff: 1,
    callDown: 1,
    limp: 0,
    sizing: 1,
  },
  tag: {
    id: 'tag',
    nameZh: '紧凶 TAG',
    tagZh: '紧凶',
    descZh: '范围偏紧, 进攻坚决, 价值下注为主, 少跟多弃',
    looseness: 0.8,
    aggression: 1.25,
    bluff: 0.9,
    callDown: 0.85,
    limp: 0,
    sizing: 1.05,
  },
  lag: {
    id: 'lag',
    nameZh: '松凶 LAG',
    tagZh: '松凶',
    descZh: '范围宽, 高频施压, 诈唬多, 喜欢主动夺池',
    looseness: 1.5,
    aggression: 1.4,
    bluff: 1.6,
    callDown: 1.0,
    limp: 0,
    sizing: 1.1,
  },
  nit: {
    id: 'nit',
    nameZh: '紧弱 Nit',
    tagZh: '紧弱',
    descZh: '只玩强牌, 被动怕事, 加注必有货, 容易被偷盲',
    looseness: 0.55,
    aggression: 0.6,
    bluff: 0.3,
    callDown: 0.7,
    limp: 0.5,
    sizing: 0.85,
  },
  station: {
    id: 'station',
    nameZh: '跟注站',
    tagZh: '松弱',
    descZh: '什么牌都想看, 极少加注, 几乎不弃牌, 别对他诈唬',
    looseness: 1.7,
    aggression: 0.5,
    bluff: 0.2,
    callDown: 1.8,
    limp: 0.75,
    sizing: 0.8,
  },
  maniac: {
    id: 'maniac',
    nameZh: '疯鱼 Maniac',
    tagZh: '狂暴',
    descZh: '范围极宽, 疯狂加注与超池, 方差极大, 等他送钱',
    looseness: 2.2,
    aggression: 1.9,
    bluff: 2.2,
    callDown: 1.3,
    limp: 0.1,
    sizing: 1.4,
  },
};

export const PERSONALITY_IDS: PersonalityId[] = ['gto', 'tag', 'lag', 'nit', 'station', 'maniac'];

// 性格标签配色(数据语义用色, 非主题强调色)
export const PERSONALITY_HUES: Record<PersonalityId, number> = {
  gto: 158,
  tag: 210,
  lag: 28,
  nit: 0,
  station: 280,
  maniac: 350,
};

// 机器人名字: 牌室绰号风
export const BOT_NAMES = [
  '夜枭',
  '石佛',
  '白狐',
  '教授',
  '蛇眼',
  '快枪',
  '老K',
  '幽灵',
  '黑曼巴',
  '玫瑰',
  '铁头',
  '山猫',
] as const;
