import type { SessionRecord } from './store';
import {
  computeHeroStats,
  computeOpponentImages,
  handToText,
  selectKeyHands,
  type HandHistory,
  type OpponentImage,
} from './poker/history';
import { PERSONALITIES } from './poker/personality';

export function imageLine(img: OpponentImage): string {
  const tag =
    img.vpip > 45
      ? img.afq > 50
        ? '打得又松又凶'
        : '什么牌都想看'
      : img.vpip < 20
        ? img.afq > 50
          ? '很紧, 动手就有货'
          : '紧且被动'
        : img.afq > 55
          ? '不松但火力足'
          : '中规中矩';
  const shows = img.recentShowdowns.length ? `; ${img.recentShowdowns.join('; ')}` : '';
  return `${img.name}: ${img.hands}手里入池${img.vpip.toFixed(0)}%, 翻前主动${img.pfr.toFixed(0)}%, 翻后进攻${img.afq.toFixed(0)}% (${tag})${shows}`;
}

// ---- 结构化复盘(JSON 模式) ----

// 跨手牌的行为模式(总复盘的核心产出, 与单手战术分析职责分离)
export interface ReviewPattern {
  title: string;
  severity: 'high' | 'medium' | 'low';
  evidence: string; // 引用具体手号与频率数据
  impact: string;
  fix: string;
}

export interface StructuredReview {
  grade: string;
  headline: string;
  styleRead: string;
  summary: string[];
  patterns: ReviewPattern[];
  adaptation: { vs: string; assessment: string }[];
  tilt: string;
  drills: string[];
}

export const REVIEW_SYSTEM_PROMPT = `你是严谨的职业德州扑克分析师兼教练, 精通 GTO 理论与剥削性打法, 你的产出标准是 solver 报告级的严谨, 同时保持可读。
分析原则(必须遵守):
- 每个结论都要有依据: 范围对照/赔率计算/尺寸基准/频率, 不许只下结论
- 评级与判定严格校准: 不为照顾情绪抬高评价; 结果赢了但决策有错照样指出, 结果输了但决策正确照样肯定
- 任何肯定都必须附带具体依据, 严禁"打得不错"这类空洞表扬
- 不贬损也不讨好: 禁止"送钱""灾难"等措辞, 也禁止无信息的夸奖
- 记录中附有程序实时计算的 [决策点数据](胜率/所需赔率/参考建议), 分析必须与这些数字对账
- 记录中的 [单手复盘结论] 是训练时已发给学员的逐手判定, 你的 keyHands 判定与建议必须与之一致;
  确需修正某手的结论时, 必须在该手的 comment 里显式说明修正理由, 不允许无解释的矛盾

学员刚完成一次训练对局(对手为 AI, 风格已在记录中标注)。
请输出一份"快读式"复盘, 必须是合法 json 对象, 不要任何额外文字。所有字符串用中文, 金额以 BB 为单位。禁止使用破折号。schema 如下:

职责边界(最重要): 每手牌的战术分析(单个决策对不对/赔率/尺寸)训练时已逐手完成并发给学员([单手复盘结论]),
总复盘禁止重复单手战术点评; 你的任务是只有看完整局才能发现的东西: 跨手牌的重复模式、对不同对手的适应、状态变化、结构性盈亏。

{
  "grade": "S/A/B/C/D 五档之一, 本局综合评级",
  "headline": "不超过18字的一句话总评, 指出本局最核心的模式",
  "styleRead": "不超过50字: 数据画像(VPIP/PFR/AFq等)勾勒的风格, 及这种风格的优势与代价",
  "summary": ["3条以内, 每条不超过36字, 本局最重要的发现(必须基于聚合数据或重复出现的证据)"],
  "patterns": [
    {
      "title": "不超过14字: 模式名(如'翻后面对下注弃牌不足''后位偷盲缺位')",
      "severity": "high | medium | low",
      "evidence": "不超过65字: 证据, 必须引用具体手号(如'第3/9/17手')和频率数据([整局聚合数据]/[决策点数据]/[单手复盘结论])",
      "impact": "不超过40字: 这个模式的代价(漏多少EV/被什么类型对手剥削)",
      "fix": "不超过45字: 系统性修正方法(频率目标/标准线)"
    }
  ],
  "adaptation": [
    { "vs": "对手名字(风格)", "assessment": "不超过55字: 学员针对这个对手调整得如何, 该怎么剥削他" }
  ],
  "tilt": "不超过50字: 状态轨迹评估(大输后是否变形/上下半场差异), 依据聚合数据; 无异常给空字符串",
  "drills": ["2-3条, 每条不超过28字, 针对最重的模式设计的训练任务"]
}

要求: patterns 2-4 条按严重度排序, 每条都必须有手号或频率证据, 禁止凭印象指控;
重复出现≥2次的问题才算模式, 单次失误留给单手复盘; 不要编造记录里不存在的手牌或行动。

牌力事实铁律: 记录中每条街都有 [学员此时: 成牌X | 板面性质Y] 标注, 这是程序计算的客观事实, 你必须以此为准。
严禁自行推断成牌或臆测大小关系; 板面标注"无同花可能/无顺子可能"时, 绝不能说对手可能有同花/顺子;
学员成牌为四条/葫芦时, 只有更大的四条/葫芦或同花顺才可能反超, 不要凭空制造威胁。`;

// 整局聚合数据: 只有跨手牌才能看到的模式证据, 程序精确计算后喂给 AI
function sessionAggregates(histories: HandHistory[]): string[] {
  const lines: string[] = [];
  if (!histories.length) return lines;
  const bb = histories[0].bb;

  // 位置盈亏
  const byPos = new Map<string, { net: number; hands: number }>();
  for (const hh of histories) {
    const pos = hh.players.find((p) => p.isHero)?.position ?? '?';
    const e = byPos.get(pos) ?? { net: 0, hands: 0 };
    e.net += hh.heroNet / bb;
    e.hands++;
    byPos.set(pos, e);
  }
  lines.push(
    `- 位置盈亏: ${[...byPos.entries()]
      .sort((a, b) => a[1].net - b[1].net)
      .map(([p, e]) => `${p} ${e.net >= 0 ? '+' : ''}${e.net.toFixed(1)}BB(${e.hands}手)`)
      .join(', ')}`
  );

  // 与参考建议的一致率 + 最常见分歧
  const all = histories.flatMap((h) => h.decisions ?? []);
  if (all.length) {
    const agree = all.filter((d) => d.agree).length;
    const pre = all.filter((d) => d.street === '翻前');
    const post = all.filter((d) => d.street !== '翻前');
    const rate = (xs: typeof all) =>
      xs.length ? `${Math.round((xs.filter((d) => d.agree).length / xs.length) * 100)}%` : '无数据';
    const disagreeCount = new Map<string, number>();
    for (const d of all) {
      if (d.agree || !d.actualAction) continue;
      const actualType = d.actualAction.startsWith('弃')
        ? '弃牌'
        : d.actualAction.startsWith('过')
          ? '过牌'
          : d.actualAction.startsWith('跟')
            ? '跟注'
            : '加注';
      const adviceZh =
        d.adviceType === 'fold' ? '弃牌' : d.adviceType === 'check' ? '过牌' : d.adviceType === 'call' ? '跟注' : '加注';
      const key = `参考${adviceZh}时你选择${actualType}`;
      disagreeCount.set(key, (disagreeCount.get(key) ?? 0) + 1);
    }
    const topDisagree = [...disagreeCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
    lines.push(
      `- 决策与参考建议一致率: 总体 ${Math.round((agree / all.length) * 100)}% (翻前 ${rate(pre)}, 翻后 ${rate(post)}, 共${all.length}个决策点)`
    );
    if (topDisagree.length) {
      lines.push(`- 最常见分歧: ${topDisagree.map(([k, n]) => `${k} ×${n}`).join('; ')}`);
    }
  }

  // 上下半场
  if (histories.length >= 10) {
    const mid = Math.floor(histories.length / 2);
    const half = (xs: HandHistory[]) => xs.reduce((s, h) => s + h.heroNet / bb, 0);
    lines.push(
      `- 上下半场: 前半 ${half(histories.slice(0, mid)) >= 0 ? '+' : ''}${half(histories.slice(0, mid)).toFixed(1)}BB, 后半 ${half(histories.slice(mid)) >= 0 ? '+' : ''}${half(histories.slice(mid)).toFixed(1)}BB`
    );
  }

  // 上头检测: 大输(>=15BB)后5手的入池率 vs 全局
  const vpipOf = (hh: HandHistory) => {
    const heroId = hh.players.find((p) => p.isHero)?.id;
    return (hh.rawActions ?? []).some(
      (a) =>
        a.playerId === heroId &&
        a.street === 'preflop' &&
        (a.type === 'call' || a.type === 'raise' || a.type === 'bet')
    );
  };
  const overallVpip = histories.filter(vpipOf).length / histories.length;
  const bigLossIdx = histories
    .map((h, i) => ({ i, loss: h.heroNet / bb }))
    .filter((x) => x.loss <= -15)
    .map((x) => x.i);
  if (bigLossIdx.length) {
    const after = bigLossIdx.flatMap((i) => histories.slice(i + 1, i + 6));
    if (after.length >= 3) {
      const afterVpip = after.filter(vpipOf).length / after.length;
      lines.push(
        `- 大输(≥15BB)之后5手的入池率: ${Math.round(afterVpip * 100)}% (全局 ${Math.round(overallVpip * 100)}%)${afterVpip > overallVpip + 0.15 ? ', 明显升高, 疑似情绪影响' : ', 无明显变形'}`
      );
    }
  }
  return lines;
}

export function buildReviewUserPrompt(record: SessionRecord): string {
  const { config, seats, histories } = record;
  const stats = computeHeroStats(histories);
  const lines: string[] = [];

  lines.push('# 训练对局记录');
  lines.push('');
  lines.push('## 对局配置');
  lines.push(
    `- 桌型: ${config.tableSize === 2 ? '单挑' : `${config.tableSize} 人桌`} | 盲注 ${config.sb}/${config.bb} | 起始筹码 ${config.startingBB}BB`
  );
  lines.push(
    `- 训练时对手风格${config.showPersonalities ? '对学员可见' : '对学员隐藏(学员需自行读牌风)'}`
  );
  lines.push('');
  lines.push('## 对手名单(实际风格)');
  for (const s of seats) {
    if (s.isHero) continue;
    const p = s.personality ? PERSONALITIES[s.personality] : null;
    const stackStr = typeof s.stack === 'number' ? `, 终局后手 ${(s.stack / config.bb).toFixed(0)}BB` : '';
    lines.push(
      `- ${s.name}: ${p ? `${p.nameZh}, ${p.descZh}` : '未知'}${s.rebuys > 0 ? ` (补码 ${s.rebuys} 次)` : ''}${stackStr}`
    );
  }
  lines.push('');
  lines.push('## 对手打出来的形象(基于本局行动观察, 点评时可引用)');
  for (const img of computeOpponentImages(histories)) {
    lines.push(`- ${imageLine(img)}`);
  }
  lines.push('');
  lines.push('## 学员整体数据');
  lines.push(`- 总手数: ${stats.hands}`);
  lines.push(`- 盈亏: ${stats.netBB >= 0 ? '+' : ''}${stats.netBB.toFixed(1)} BB`);
  lines.push(`- VPIP: ${stats.vpip.toFixed(1)}% | PFR: ${stats.pfr.toFixed(1)}% | 3Bet: ${stats.threeBet.toFixed(1)}%`);
  lines.push(`- 看摊牌率 WTSD: ${stats.wtsd.toFixed(1)}% | 摊牌胜率 W$SD: ${stats.wsd.toFixed(1)}%`);
  lines.push(`- 翻后进攻频率 AFq: ${stats.afq.toFixed(1)}%`);
  lines.push(
    `- 单手最大盈利: +${stats.biggestWin.toFixed(1)} BB | 单手最大亏损: ${stats.biggestLoss.toFixed(1)} BB`
  );
  lines.push('');
  lines.push('## 整局聚合数据(程序精确计算, 模式指控必须以此为证)');
  lines.push(...sessionAggregates(histories));
  lines.push('');

  const key = selectKeyHands(histories, 28);
  if (key.length < histories.length) {
    lines.push(`## 手牌记录(已自动筛选 ${key.length}/${histories.length} 手关键牌局)`);
  } else {
    lines.push('## 手牌记录(全部)');
  }
  lines.push('');
  for (const hh of key) {
    lines.push(handToText(hh, true));
    if (hh.decisions?.length) {
      lines.push('[决策点数据]');
      for (const d of hh.decisions) {
        const need = d.neededPct !== null ? `, 所需 ${d.neededPct.toFixed(0)}%` : '';
        lines.push(
          `- ${d.street}: ${d.facingText}; 胜率约 ${d.heroEquityPct.toFixed(0)}%${need}; 参考 ${d.adviceAction}(${d.adviceReason}); 实际 ${d.actualAction || '未行动'}`
        );
      }
    }
    // 单手复盘结论: 供最终复盘对齐, 避免前后矛盾
    const note = record.handComments?.[hh.handNo];
    if (note && typeof note !== 'string') {
      lines.push(
        `[单手复盘结论] 判定 ${note.verdict}: ${note.title}${note.next ? `; 下次: ${note.next}` : ''}`
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

// 宽松解析: 兼容模型偶发的代码块包裹
export function parseStructuredReview(raw: string): StructuredReview | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  try {
    const j = JSON.parse(text);
    if (typeof j !== 'object' || j === null) return null;
    const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
    const str = (x: unknown, fb = ''): string => (typeof x === 'string' ? x : fb);
    const review: StructuredReview = {
      grade: str(j.grade, '?').slice(0, 3),
      headline: str(j.headline),
      styleRead: str(j.styleRead),
      summary: arr(j.summary).map((s) => str(s)).filter(Boolean),
      patterns: arr(j.patterns)
        .map((p) => {
          const o = (p ?? {}) as Record<string, unknown>;
          const sev = str(o.severity, 'medium');
          return {
            title: str(o.title),
            severity: (['high', 'medium', 'low'].includes(sev)
              ? sev
              : 'medium') as ReviewPattern['severity'],
            evidence: str(o.evidence),
            impact: str(o.impact),
            fix: str(o.fix),
          };
        })
        .filter((p) => p.title && p.evidence),
      adaptation: arr(j.adaptation)
        .map((a) => {
          const o = (a ?? {}) as Record<string, unknown>;
          return { vs: str(o.vs), assessment: str(o.assessment) };
        })
        .filter((a) => a.assessment),
      tilt: str(j.tilt),
      drills: arr(j.drills).map((d) => str(d)).filter(Boolean),
    };
    if (!review.headline && !review.summary.length && !review.patterns.length) return null;
    return review;
  } catch {
    return null;
  }
}

// ---- 单手即时点评 ----

// 单手详评: 结构化 JSON, 与全局复盘同形态, 含逐街分析
export interface HandCommentData {
  verdict: 'good' | 'ok' | 'mistake' | 'blunder';
  title: string;
  situation: string;
  streets: { street: string; note: string }[];
  read: string;
  math: string;
  next: string;
}

export const HAND_COMMENT_SYSTEM_PROMPT = `你是严谨的职业德州扑克分析师, 像 solver 报告一样拆牌, 不是啦啦队。学员刚打完一手, 输出一份严格的结构化复盘, 必须是合法 json 对象, 不要任何额外文字, schema:

{
  "verdict": "good | ok | mistake | blunder 之一",
  "title": "不超过12字: 这手牌最核心的技术主题(如'尺寸偏小漏价值''范围外冷跟')",
  "situation": "不超过55字: 这手牌的战略要点(位置关系/有效筹码/对手形象意味着什么), 不要流水账复述行动",
  "streets": [
    { "street": "翻前 | 翻牌 | 转牌 | 河牌 之一", "note": "不超过70字: 该街决策的严格分析: 先给结论(标准/偏松/偏紧/尺寸问题/漏价值), 再给依据(标准范围对照/尺寸基准/频率), 有偏差必须指出" }
  ],
  "read": "不超过55字: 对手范围读取与逐街演变",
  "math": "不超过55字: 关键数字拆解(底池赔率/所需胜率/SPR/价值诈唬比), 必须引用提供的数据",
  "next": "不超过45字: 下次同样局面的具体打法(含建议尺寸)"
}

verdict 严格校准(最重要的规则):
- good 仅当每条街的动作和尺寸都接近标准打法, 宁缺毋滥; 一局里大多数手应该是 ok 或 mistake
- ok = 方向对但有小偏差(尺寸不优/错过更好的线); mistake = 明确的错误(赔率不够的跟注/漏掉明显价值/范围外入池); blunder = 大额EV损失
- 即使结果赢了, 决策有问题照样给 mistake; 结果输了但决策正确照样给 good
分析规则:
- 提供的 [决策点数据] 是程序实时计算的胜率/所需赔率/参考建议, 你的分析必须与这些数字对账; 与参考建议不同时要给出你的依据
- 严禁空洞表扬: "打得漂亮"这类无信息内容禁止出现, 任何肯定都必须附带具体依据(范围/数字/尺寸)
- 哪怕是标准弃牌的手, 也要找出最有教学价值的角度(如这手在更晚位置其实可开, 或弃牌前的范围思考)
- 语气专业克制, 不贬损也不讨好; 严禁使用破折号"——"和"—"; 金额用 BB; 全部中文
streets 只包含学员实际有决策的街; 信息量极小的手 read 和 math 可给空字符串。
记录中 [学员此时: ...] 是程序计算的客观牌力事实, 必须以此为准, 严禁自行推断成牌或臆测不存在的威胁(如板面标注无同花可能就绝不能提同花)。`;

export function parseHandComment(raw: string): HandCommentData | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  try {
    const j = JSON.parse(text);
    const str = (x: unknown): string => (typeof x === 'string' ? x : '');
    const verdict = str(j.verdict);
    const streets = (Array.isArray(j.streets) ? j.streets : [])
      .map((s: unknown) => {
        const o = (s ?? {}) as Record<string, unknown>;
        return { street: str(o.street), note: str(o.note) };
      })
      .filter((s: { street: string; note: string }) => s.note)
      .slice(0, 4);
    const data: HandCommentData = {
      verdict: (['good', 'ok', 'mistake', 'blunder'].includes(verdict)
        ? verdict
        : 'ok') as HandCommentData['verdict'],
      title: str(j.title),
      situation: str(j.situation),
      streets,
      read: str(j.read),
      math: str(j.math),
      next: str(j.next),
    };
    if (!data.title && !data.situation && !data.next) return null;
    return data;
  } catch {
    return null;
  }
}

export interface CommentContext {
  // "你 后手 96BB, 陈默 后手 210BB, ..."
  stackLine: string;
  // 每个对手一行的观察形象
  imageLines: string[];
  // "本局已打 12 手, 你目前 -8.5BB"
  sessionLine: string;
}

export function buildHandCommentPrompt(
  hh: HandHistory,
  revealPersonalities: boolean,
  ctx?: CommentContext
): string {
  const parts = [handToText(hh, revealPersonalities)];
  // 程序实时计算的决策点数据: 让分析有数可依
  if (hh.decisions?.length) {
    parts.push('');
    parts.push('[决策点数据, 程序实时计算, 分析必须与之对账]');
    for (const d of hh.decisions) {
      const need = d.neededPct !== null ? `, 跟注所需胜率 ${d.neededPct.toFixed(0)}%` : '';
      parts.push(
        `- ${d.street}: ${d.facingText}; 学员对范围胜率约 ${d.heroEquityPct.toFixed(0)}%${need}; 参考建议 ${d.adviceAction}(${d.adviceReason}); 学员实际 ${d.actualAction || '未行动'}`
      );
    }
  }
  if (ctx) {
    parts.push('');
    parts.push(`[牌桌状态] ${ctx.stackLine}`);
    if (ctx.sessionLine) parts.push(`[本局进度] ${ctx.sessionLine}`);
    if (ctx.imageLines.length) {
      parts.push(`[对手形象, 基于本局观察]`);
      for (const l of ctx.imageLines) parts.push(`- ${l}`);
    }
  }
  return parts.join('\n');
}
