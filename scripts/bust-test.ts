// 对手破产下桌/补码 流程回归测试(store 层)
// 覆盖: 下桌排除入局、按钮位跳过空座、引擎按钮索引换算、补码旧行为、对手清空收局、缩桌至单挑盲注
import { useGame, type Seat, type SessionConfig } from '../lib/store';

let failed = 0;
function check(name: string, cond: boolean, detail?: string) {
  console.log(`${cond ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!cond) failed++;
}

function mkConfig(botRebuy: boolean): SessionConfig {
  return {
    tableSize: 4,
    showPersonalities: true,
    liveCoach: false,
    startingBB: 100,
    sb: 1,
    bb: 2,
    targetHands: null,
    botRebuy,
    opponents: [],
  };
}

function mkSeats(stacks: number[]): Seat[] {
  return stacks.map((stack, i) => ({
    id: i === 0 ? 'hero' : `bot-${i - 1}`,
    name: i === 0 ? '你' : `机器人${i}`,
    isHero: i === 0,
    personality: i === 0 ? null : 'gto',
    stack,
    rebuys: 0,
    avatarId: i === 0 ? null : i,
    out: false,
  }));
}

// 置于 handEnd, 用 nextHand 驱动 beginHand
function playHandFrom(config: SessionConfig, seats: Seat[], button: number) {
  useGame.setState({
    config,
    seats,
    button,
    handNo: 0,
    hand: { result: {} } as never,
    phase: 'handEnd',
    histories: [],
    handComments: {},
    paused: false,
    version: 0,
  });
  useGame.getState().nextHand();
  return useGame.getState();
}

// ===== 场景一: 破产下桌 — 排除入局 + 按钮位跳过 + 引擎索引换算 =====
{
  const s = playHandFrom(mkConfig(false), mkSeats([200, 0, 200, 200]), 0);
  const ids = s.hand!.players.map((p) => p.id);
  check('破产对手被标记下桌', s.seats[1].out === true);
  check('下桌者不再入局', !ids.includes('bot-0'), ids.join(','));
  check('入局人数正确(3人)', s.hand!.players.length === 3);
  check('按钮位跳过空座', s.button === 2, `button=${s.button}`);
  check(
    '引擎按钮索引换算正确',
    s.hand!.players[s.hand!.button].id === 'bot-1',
    `引擎按钮=${s.hand!.players[s.hand!.button].id}`
  );
}

// ===== 场景二: 自动补码(默认行为不回归) =====
{
  const s = playHandFrom(mkConfig(true), mkSeats([200, 0, 200, 200]), 0);
  check('补码模式: 破产者满血复活', s.seats[1].stack === 200 && s.seats[1].rebuys === 1);
  check('补码模式: 四人全员入局', s.hand!.players.length === 4);
  check('补码模式: 无人下桌', s.seats.every((x) => !x.out));
}

// ===== 场景三: 对手全部下桌 → 训练结束 =====
{
  const s = playHandFrom(mkConfig(false), mkSeats([200, 1]), 0);
  check('对手清空后收局', s.phase === 'over', `phase=${s.phase}`);
  check('收局时下桌标记已写', s.seats[1].out === true);
}

// ===== 场景四: 缩桌至单挑 — 盲注切换为 HU 规则(按钮位发小盲) =====
{
  const s = playHandFrom(mkConfig(false), mkSeats([200, 0, 300]), 0);
  check('缩桌后单挑入局', s.hand!.players.length === 2);
  const btnPlayer = s.hand!.players[s.hand!.button];
  check('单挑按钮位发小盲', btnPlayer.streetBet === 1, `streetBet=${btnPlayer.streetBet}`);
}

if (failed) {
  console.error(`\n${failed} 项失败`);
  process.exit(1);
}
console.log('\n破产下桌流程回归: 全部通过');
process.exit(0);
