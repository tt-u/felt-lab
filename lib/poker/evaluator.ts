import type { Card } from './cards';
import { RANK_CHARS } from './cards';

// 7张牌评牌器。返回可比较的整数, 越大越强。
// score = (category << 20) | k1 << 16 | k2 << 12 | k3 << 8 | k4 << 4 | k5
// category: 8同花顺 7四条 6葫芦 5同花 4顺子 3三条 2两对 1一对 0高牌

export const CATEGORY_NAMES_ZH = [
  '高牌',
  '一对',
  '两对',
  '三条',
  '顺子',
  '同花',
  '葫芦',
  '四条',
  '同花顺',
] as const;

export function categoryOf(score: number): number {
  return score >> 20;
}

export function handNameZh(score: number): string {
  const cat = categoryOf(score);
  if (cat === 8 && ((score >> 16) & 0xf) === 12) return '皇家同花顺';
  return CATEGORY_NAMES_ZH[cat];
}

export function handNameDetailZh(score: number): string {
  const cat = categoryOf(score);
  const k1 = (score >> 16) & 0xf;
  const k2 = (score >> 12) & 0xf;
  const r = (x: number) => RANK_CHARS[x];
  switch (cat) {
    case 8:
      return k1 === 12 ? '皇家同花顺' : `同花顺 ${r(k1)} 高`;
    case 7:
      return `四条 ${r(k1)}`;
    case 6:
      return `葫芦 ${r(k1)} 带 ${r(k2)}`;
    case 5:
      return `同花 ${r(k1)} 高`;
    case 4:
      return `顺子 ${r(k1)} 高`;
    case 3:
      return `三条 ${r(k1)}`;
    case 2:
      return `两对 ${r(k1)} 和 ${r(k2)}`;
    case 1:
      return `一对 ${r(k1)}`;
    default:
      return `高牌 ${r(k1)}`;
  }
}

// 在 rank 位掩码中找最大顺子的顶张, 无顺子返回 -1。包含 A-5 轮子。
function bestStraightTop(mask: number): number {
  for (let hi = 12; hi >= 4; hi--) {
    const need = 0b11111 << (hi - 4);
    if ((mask & need) === need) return hi;
  }
  // 轮子: A(12) + 2..5 (位 0..3)
  if ((mask & 0b1000000001111) === 0b1000000001111) return 3;
  return -1;
}

const rankCount = new Int8Array(13);
const suitCount = new Int8Array(4);

export function evaluate7(cards: readonly Card[]): number {
  rankCount.fill(0);
  suitCount.fill(0);
  let rankMask = 0;
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const r = c >> 2;
    rankCount[r]++;
    suitCount[c & 3]++;
    rankMask |= 1 << r;
  }

  let flushSuit = -1;
  for (let s = 0; s < 4; s++) {
    if (suitCount[s] >= 5) {
      flushSuit = s;
      break;
    }
  }

  if (flushSuit >= 0) {
    let flushMask = 0;
    for (let i = 0; i < cards.length; i++) {
      if ((cards[i] & 3) === flushSuit) flushMask |= 1 << (cards[i] >> 2);
    }
    const sf = bestStraightTop(flushMask);
    if (sf >= 0) return (8 << 20) | (sf << 16);
    // 同花: 取最大5张
    let score = 5 << 20;
    let shift = 16;
    for (let r = 12; r >= 0 && shift >= 0; r--) {
      if (flushMask & (1 << r)) {
        score |= r << shift;
        shift -= 4;
      }
    }
    return score;
  }

  let quad = -1;
  let trips1 = -1;
  let trips2 = -1;
  let pair1 = -1;
  let pair2 = -1;
  for (let r = 12; r >= 0; r--) {
    const n = rankCount[r];
    if (n === 4) quad = quad < 0 ? r : quad;
    else if (n === 3) {
      if (trips1 < 0) trips1 = r;
      else if (trips2 < 0) trips2 = r;
    } else if (n === 2) {
      if (pair1 < 0) pair1 = r;
      else if (pair2 < 0) pair2 = r;
    }
  }

  if (quad >= 0) {
    let kicker = -1;
    for (let r = 12; r >= 0; r--) {
      if (r !== quad && rankCount[r] > 0) {
        kicker = r;
        break;
      }
    }
    return (7 << 20) | (quad << 16) | (kicker << 12);
  }

  if (trips1 >= 0 && (pair1 >= 0 || trips2 >= 0)) {
    const fill = trips2 >= 0 ? Math.max(trips2, pair1 < 0 ? -1 : pair1) : pair1;
    return (6 << 20) | (trips1 << 16) | (fill << 12);
  }

  const st = bestStraightTop(rankMask);
  if (st >= 0) return (4 << 20) | (st << 16);

  if (trips1 >= 0) {
    let score = (3 << 20) | (trips1 << 16);
    let shift = 12;
    for (let r = 12; r >= 0 && shift >= 8; r--) {
      if (r !== trips1 && rankCount[r] > 0) {
        score |= r << shift;
        shift -= 4;
      }
    }
    return score;
  }

  if (pair1 >= 0 && pair2 >= 0) {
    let kicker = -1;
    for (let r = 12; r >= 0; r--) {
      if (r !== pair1 && r !== pair2 && rankCount[r] > 0) {
        kicker = r;
        break;
      }
    }
    return (2 << 20) | (pair1 << 16) | (pair2 << 12) | (kicker << 8);
  }

  if (pair1 >= 0) {
    let score = (1 << 20) | (pair1 << 16);
    let shift = 12;
    for (let r = 12; r >= 0 && shift >= 4; r--) {
      if (r !== pair1 && rankCount[r] > 0) {
        score |= r << shift;
        shift -= 4;
      }
    }
    return score;
  }

  let score = 0;
  let shift = 16;
  for (let r = 12; r >= 0 && shift >= 0; r--) {
    if (rankCount[r] > 0) {
      score |= r << shift;
      shift -= 4;
    }
  }
  return score;
}
