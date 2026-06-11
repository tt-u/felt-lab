// 牌力事实标注回归测试: 防止 DeepSeek 牌力幻觉的程序标注层退化
// 起因事故: 学员中四条, AI 复盘称"可能有同花/顺子比你大"(2026-06-10 用户报告)
// 防线 = handToText 逐街注入 [学员此时: 成牌X | 板面性质Y] + 系统提示词铁律
import { heroStreetFacts, boardTextureFacts, handToText } from '../lib/poker/history';
import { cardsText } from '../lib/poker/cards';
import { REVIEW_SYSTEM_PROMPT, HAND_COMMENT_SYSTEM_PROMPT } from '../lib/review-prompt';

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failed++;
}

// ===== 场景一: 原始事故复刻 — 中四条, 彩虹成对板, 无同花/顺子可能 =====
// card = rank*4 + suit; 9 的 rank=7
const hole = [28, 29]; // 9♠ 9♥
const board = [30, 31, 0, 45, 23]; // 9♦ 9♣ 2♠ K♥ 7♣

const riverFacts = heroStreetFacts(hole, board);
check('河牌成牌标注为四条', riverFacts.includes('四条'), riverFacts);

const texture = boardTextureFacts(board);
check('板面标注无同花可能', texture.includes('无同花可能'), texture);
check('板面标注无顺子可能', texture.includes('无顺子可能'), texture);
check('板面标注成对', texture.includes('板面成对'), texture);

const flopFacts = heroStreetFacts(hole, board.slice(0, 3));
check('翻牌即标注四条(逐街覆盖)', flopFacts.includes('四条'), flopFacts);

// ===== 场景二: 完整提示词文本中标注随街出现 =====
const hh = {
  handNo: 7, sb: 1, bb: 2,
  players: [
    { id: 'hero', name: '学员', isHero: true, personality: null, position: 'BTN', startStack: 200 },
    { id: 'b1', name: '石佛', isHero: false, personality: null, position: 'BB', startStack: 200 },
  ],
  heroHole: cardsText(hole),
  board: cardsText(board),
  actions: [
    { street: 'preflop', text: '学员 加注到 6; 石佛 跟注' },
    { street: 'flop', text: '石佛 过牌; 学员 下注 4; 石佛 跟注' },
    { street: 'river', text: '石佛 过牌; 学员 下注 20; 石佛 跟注' },
  ],
  results: [
    { name: '学员', isHero: true, net: 30, shown: cardsText(hole), handName: '四条 9' },
    { name: '石佛', isHero: false, net: -30, shown: null, handName: null },
  ],
  potSize: 60, heroNet: 30, wentToShowdown: true,
} as Parameters<typeof handToText>[0];

const txt = handToText(hh, false);
const annotated = txt.split('\n').filter((l) => l.includes('[学员此时:'));
check('提示词逐街注入标注(翻牌+河牌)', annotated.length === 2, `实际 ${annotated.length} 行`);
check('河牌行同时含 四条+无同花+无顺子',
  annotated.some((l) => l.includes('四条') && l.includes('无同花可能') && l.includes('无顺子可能')));

// ===== 场景三: 系统提示词铁律仍在 =====
check('整局复盘提示词含牌力事实铁律',
  REVIEW_SYSTEM_PROMPT.includes('铁律') && REVIEW_SYSTEM_PROMPT.includes('必须以此为准'));
check('单手详评提示词禁止臆测威胁',
  HAND_COMMENT_SYSTEM_PROMPT.includes('必须以此为准') && HAND_COMMENT_SYSTEM_PROMPT.includes('严禁自行推断'));

// ===== 场景四: 反向用例 — 真有同花/顺子可能时不得误报安全 =====
const wetBoard = [2, 6, 10, 45, 23]; // 2♦ 3♦ 4♦ K♥ 7♣: 三张方块+345 连张
const wet = boardTextureFacts(wetBoard);
check('湿润板面正确标注有同花可能', wet.includes('有同花可能'), wet);
check('湿润板面正确标注有顺子可能', wet.includes('有顺子可能'), wet);

if (failed) { console.error(`\n${failed} 项失败`); process.exit(1); }
console.log('\n牌力事实标注回归: 全部通过');
