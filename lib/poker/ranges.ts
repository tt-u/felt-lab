// 翻前手牌强度排序: 由 scripts/gen-ranking.ts 离线蒙特卡洛生成
// (55% 单挑胜率 + 45% 四人桌胜率加权, 每类 3 万次模拟)
export const HAND_RANKING: string[] = [
  'AA', 'KK', 'QQ', 'JJ', 'TT', '99', 'AKs', '88', 'AQs', 'AKo', 'AJs', 'ATs', 'AQo',
  'KQs', '77', 'KJs', 'AJo', 'KTs', 'A9s', 'KQo', 'ATo', '66', 'QJs', 'A8s', 'KJo', 'QTs',
  'K9s', 'A7s', 'KTo', 'A9o', 'A6s', 'A5s', 'JTs', 'Q9s', 'QJo', 'A8o', '55', 'A4s', 'K8s',
  'A3s', 'QTo', 'K7s', 'A7o', 'K9o', 'A2s', 'J9s', 'A5o', 'JTo', 'K6s', 'Q8s', 'A6o', 'T9s',
  'A4o', 'K5s', 'K8o', 'Q9o', '44', 'K4s', 'J8s', 'Q7s', 'A3o', 'J9o', 'K7o', 'T8s', 'Q6s',
  'A2o', 'K3s', 'Q8o', 'K6o', '98s', 'T9o', 'J7s', 'K2s', 'Q5s', '33', 'J8o', 'K5o', 'Q4s',
  'T7s', 'K4o', 'Q7o', 'J6s', '97s', 'Q3s', 'T8o', 'Q2s', 'Q6o', 'K3o', 'J5s', 'T6s', '87s',
  '98o', 'Q5o', 'K2o', '22', 'J7o', '96s', 'J3s', 'J4s', 'T7o', 'Q4o', '86s', 'J2s', '76s',
  'T5s', '97o', 'T4s', 'Q3o', 'J6o', '95s', 'J5o', '87o', 'T3s', 'T6o', '85s', 'Q2o', '75s',
  '65s', 'J4o', 'T2s', '96o', 'J3o', '94s', '93s', '54s', '84s', '76o', '86o', 'T5o', 'J2o',
  '92s', '74s', '64s', 'T4o', '95o', '83s', 'T3o', '85o', '53s', '75o', '73s', '63s', '65o',
  '82s', 'T2o', '43s', '94o', '93o', '52s', '84o', '74o', '62s', '54o', '72s', '64o', '42s',
  '92o', '32s', '83o', '53o', '73o', '82o', '63o', '43o', '52o', '72o', '62o', '42o', '32o',
];

// cls -> 百分位 (0 = 最强, 接近1 = 最弱)
const PCT = new Map<string, number>();
HAND_RANKING.forEach((cls, i) => PCT.set(cls, i / (HAND_RANKING.length - 1)));

export function handPercentile(cls: string): number {
  return PCT.get(cls) ?? 1;
}

// 位置: 从按钮逆时针 BTN SB BB UTG ... CO
export type Position = 'BTN' | 'SB' | 'BB' | 'UTG' | 'UTG+1' | 'MP' | 'LJ' | 'HJ' | 'CO';

// seatsFromButton: 0=BTN 1=SB 2=BB 3=UTG ...; 单挑时按钮即小盲
export function positionLabel(seatsFromButton: number, totalPlayers: number): Position {
  if (totalPlayers === 2) return seatsFromButton === 0 ? 'BTN' : 'BB';
  if (seatsFromButton === 0) return 'BTN';
  if (seatsFromButton === 1) return 'SB';
  if (seatsFromButton === 2) return 'BB';
  // 剩余位置从 UTG 开始, 最后一个非盲注位是 CO, 倒数第二是 HJ
  const afterBlinds = totalPlayers - 3; // UTG..CO 的数量
  const idx = seatsFromButton - 3; // 0 = UTG
  const fromEnd = afterBlinds - 1 - idx; // 0 = CO
  if (fromEnd === 0) return 'CO';
  if (fromEnd === 1 && afterBlinds >= 2) return 'HJ';
  if (fromEnd === 2 && afterBlinds >= 3) return 'LJ';
  if (idx === 0) return 'UTG';
  if (idx === 1) return 'UTG+1';
  return 'MP';
}

// GTO 近似的位置开池范围 (占总手牌的百分比)
export const OPEN_PCT: Record<Position, number> = {
  UTG: 0.15,
  'UTG+1': 0.17,
  MP: 0.19,
  LJ: 0.21,
  HJ: 0.25,
  CO: 0.3,
  BTN: 0.44,
  SB: 0.38,
  BB: 0.4, // BB 无人开池时不存在"开池", 仅作兜底
};

// 面对开池加注时的基础范围 (3bet / 跟注, 占总手牌百分比)
export const VS_OPEN_3BET_PCT: Record<Position, number> = {
  UTG: 0.04,
  'UTG+1': 0.04,
  MP: 0.045,
  LJ: 0.05,
  HJ: 0.055,
  CO: 0.065,
  BTN: 0.08,
  SB: 0.07,
  BB: 0.075,
};

export const VS_OPEN_CALL_PCT: Record<Position, number> = {
  UTG: 0.07,
  'UTG+1': 0.08,
  MP: 0.09,
  LJ: 0.1,
  HJ: 0.11,
  CO: 0.13,
  BTN: 0.18,
  SB: 0.12,
  BB: 0.32, // 大盲折扣防守更宽
};

// 面对 3bet
export const VS_3BET_4BET_PCT = 0.02;
export const VS_3BET_CALL_PCT = 0.08;

// ---- 单挑(HU)专用范围: 与满桌 GTO 完全不同, 范围大幅放宽 ----
// 按钮/小盲开池约 7 成牌, 大盲对小尺寸加注有折扣防守极宽
export const HU_OPEN_PCT = 0.72;
export const HU_BB_3BET_PCT = 0.13;
export const HU_BB_CALL_PCT = 0.55;
export const HU_VS_3BET_4BET_PCT = 0.05;
export const HU_VS_3BET_CALL_PCT = 0.17;

// ---- 标准 RFI(首入加注)范围表 ----
// 来源: 100BB 现金桌 solver 衍生范围的业界共识近似(GTO Wizard / Upswing 等公开图表的交集),
// 解决纯胜率排序"低估同花连张、高估弱Ax杂色牌"的偏差。
// 性格松紧通过在"图表内按强度排序 + 图表外按强度补充"的序列上移动阈值实现。

const RANKS_STR = '23456789TJQKA';

// 解析紧凑范围记号: "22+, A9s+, A5s-A4s, KTs+, AJo+, 98s"
export function parseRangeNotation(s: string): Set<string> {
  const out = new Set<string>();
  for (const tokRaw of s.split(',')) {
    const tok = tokRaw.trim();
    if (!tok) continue;
    const plus = tok.endsWith('+');
    const body = plus ? tok.slice(0, -1) : tok;
    if (body.includes('-')) {
      const [hi, lo] = body.split('-');
      if (hi.length === 2 && hi[0] === hi[1]) {
        const a = RANKS_STR.indexOf(hi[0]);
        const b = RANKS_STR.indexOf(lo[0]);
        for (let r = b; r <= a; r++) out.add(RANKS_STR[r] + RANKS_STR[r]);
      } else {
        const x = hi[0];
        const suf = hi[2];
        const a = RANKS_STR.indexOf(hi[1]);
        const b = RANKS_STR.indexOf(lo[1]);
        for (let r = b; r <= a; r++) out.add(x + RANKS_STR[r] + suf);
      }
    } else if (body.length === 2 && body[0] === body[1]) {
      const a = RANKS_STR.indexOf(body[0]);
      const top = plus ? 12 : a;
      for (let r = a; r <= top; r++) out.add(RANKS_STR[r] + RANKS_STR[r]);
    } else {
      const x = body[0];
      const k = RANKS_STR.indexOf(body[1]);
      const suf = body[2];
      if (plus) {
        const xi = RANKS_STR.indexOf(x);
        for (let r = k; r < xi; r++) out.add(x + RANKS_STR[r] + suf);
      } else {
        out.add(body);
      }
    }
  }
  return out;
}

const RFI_CHARTS: Partial<Record<Position, string>> = {
  UTG: '22+, A9s+, A5s-A4s, KTs+, QTs+, JTs, T9s, 98s, AJo+, KQo',
  'UTG+1': '22+, A9s+, A5s-A3s, K9s+, QTs+, JTs, T9s, 98s, 87s, AJo+, KQo',
  MP: '22+, A8s+, A5s-A2s, K9s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, ATo+, KJo+',
  LJ: '22+, A8s+, A5s-A2s, K9s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, ATo+, KJo+',
  HJ: '22+, A2s+, K8s+, Q9s+, J9s+, T8s+, 98s, 87s, 76s, 65s, ATo+, KJo+, QJo',
  CO: '22+, A2s+, K6s+, Q8s+, J8s+, T8s+, 97s+, 87s, 76s, 65s, 54s, A9o+, KTo+, QTo+, JTo',
  BTN: '22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 96s+, 86s+, 75s+, 64s+, 54s, 43s, A2o+, K9o+, Q9o+, J9o+, T9o, 98o',
  SB: '22+, A2s+, K4s+, Q6s+, J7s+, T7s+, 97s+, 86s+, 75s+, 65s, 54s, A4o+, K9o+, Q9o+, J9o+, T9o',
};

interface RfiOrder {
  order: string[]; // 图表内按强度排序, 其后接图表外按强度排序
  chartSize: number;
}

const RFI_CACHE = new Map<Position, RfiOrder>();

export function rfiOrder(pos: Position): RfiOrder | null {
  const chart = RFI_CHARTS[pos];
  if (!chart) return null;
  let cached = RFI_CACHE.get(pos);
  if (!cached) {
    const set = parseRangeNotation(chart);
    const inChart = HAND_RANKING.filter((c) => set.has(c));
    const outChart = HAND_RANKING.filter((c) => !set.has(c));
    cached = { order: [...inChart, ...outChart], chartSize: inChart.length };
    RFI_CACHE.set(pos, cached);
  }
  return cached;
}
