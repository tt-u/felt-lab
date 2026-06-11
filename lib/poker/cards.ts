// 牌的紧凑编码: card = rank * 4 + suit
// rank: 0..12 对应 2..A; suit: 0=♠ 1=♥ 2=♦ 3=♣
export type Card = number;

export const RANK_CHARS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const;
export const SUIT_CHARS = ['♠', '♥', '♦', '♣'] as const;
export const SUIT_NAMES = ['spade', 'heart', 'diamond', 'club'] as const;

export const rankOf = (c: Card): number => c >> 2;
export const suitOf = (c: Card): number => c & 3;

export function cardText(c: Card): string {
  return RANK_CHARS[rankOf(c)] + SUIT_CHARS[suitOf(c)];
}

export function cardsText(cards: Card[]): string {
  return cards.map(cardText).join(' ');
}

export type Rng = () => number;

export function freshDeck(): Card[] {
  const deck: Card[] = new Array(52);
  for (let i = 0; i < 52; i++) deck[i] = i;
  return deck;
}

export function shuffle(deck: Card[], rng: Rng): Card[] {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// 基于 crypto 的随机数（可用时），保证发牌公平
export function secureRng(): Rng {
  if (typeof globalThis.crypto !== 'undefined' && 'getRandomValues' in globalThis.crypto) {
    const buf = new Uint32Array(256);
    let idx = buf.length;
    return () => {
      if (idx >= buf.length) {
        globalThis.crypto.getRandomValues(buf);
        idx = 0;
      }
      return buf[idx++] / 4294967296;
    };
  }
  return Math.random;
}

// 翻前手牌类别, 如 "AKs" / "T9o" / "QQ"
export function holeClass(a: Card, b: Card): string {
  let r1 = rankOf(a);
  let r2 = rankOf(b);
  if (r1 < r2) [r1, r2] = [r2, r1];
  const hi = RANK_CHARS[r1];
  const lo = RANK_CHARS[r2];
  if (r1 === r2) return hi + lo;
  return hi + lo + (suitOf(a) === suitOf(b) ? 's' : 'o');
}
