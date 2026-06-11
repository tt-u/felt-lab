// 浏览器端到端冒烟: 设置 -> 对战若干手 -> 结束 -> AI 复盘流式输出
// 运行: npx tsx scripts/e2e-test.ts (需本机 Chrome 与已启动的服务, BASE_URL 可覆盖)
import puppeteer, { Page } from 'puppeteer-core';

const BASE = process.env.BASE_URL ?? 'http://localhost:3777';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function clickByText(page: Page, selector: string, text: string): Promise<boolean> {
  return page.evaluate(
    ({ selector, text }) => {
      const els = Array.from(document.querySelectorAll(selector));
      const el = els.find((e) => (e.textContent ?? '').includes(text)) as HTMLElement | undefined;
      if (el) {
        el.click();
        return true;
      }
      return false;
    },
    { selector, text }
  );
}

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    protocolTimeout: 120_000,
    args: [
      '--no-sandbox',
      '--window-size=1440,900',
      '--user-data-dir=/tmp/poker-e2e-profile',
      '--no-first-run',
      '--disable-extensions',
    ],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('dialog', (d) => d.accept());
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // 失败路径也要输出已收集的页面错误
  process.on('exit', () => {
    if (errors.length) {
      console.log('页面 JS 错误:');
      for (const e of errors) console.log(' -', e.slice(0, 300));
    }
  });

  // 1. 设置页
  await page.goto(BASE, { waitUntil: 'networkidle0' });
  await page.screenshot({ path: '/tmp/poker-setup.png' });
  if (!(await page.evaluate(() => document.body.innerText.includes('翻牌屋')))) {
    throw new Error('设置页未渲染');
  }

  // 选单挑减少等待
  await clickByText(page, 'button', '单挑');
  if (!(await clickByText(page, 'button', '开始训练'))) throw new Error('找不到开始按钮');
  await page.waitForFunction(() => location.pathname === '/table', { timeout: 5000 });

  // 2. 对战: 轮到英雄就行动, 打满 60 秒或 6 手
  const deadline = Date.now() + 60_000;
  let acted = 0;
  let sawHandTwo = false;
  let sawDecision = false;
  let sawRabbit = false;
  let sawGauge = false;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => document.body.innerText);
    if (/第 [2-9] 手/.test(state)) sawHandTwo = true;
    if (state.includes('你的胜率')) sawDecision = true;
    if (state.includes('兔子洞')) sawRabbit = true;
    if (state.includes('对范围胜率')) sawGauge = true;
    if (sawHandTwo && acted >= 4 && sawDecision) break;
    if (await clickByText(page, 'button', '跟注')) acted++;
    else if (await clickByText(page, 'button', '过牌')) acted++;
    else if (state.includes('下一手')) await clickByText(page, 'button', '下一手');
    await sleep(700);
  }
  await page.screenshot({ path: '/tmp/poker-table.png' });
  if (acted === 0) throw new Error('英雄从未获得行动机会');
  console.log(
    `戏剧层: 决策复盘${sawDecision ? '✓' : '未捕获'} 兔子洞${sawRabbit ? '✓' : '未捕获'} 牌力仪表${sawGauge ? '✓' : '未捕获'}`
  );
  if (!sawGauge) throw new Error('牌力仪表未出现');

  // 3. 结束并复盘(若英雄破产, 会话可能已自动跳转复盘页)
  const onReview = await page.evaluate(() => location.pathname === '/review');
  if (!onReview) {
    if (!(await clickByText(page, 'button', '结束并复盘'))) throw new Error('找不到结束按钮');
  }
  await page.waitForFunction(() => location.pathname === '/review', { timeout: 8000 });

  // 等待统计与结构化 AI 复盘
  await page.waitForFunction(() => document.body.innerText.includes('VPIP'), { timeout: 8000 });
  await page.waitForFunction(
    () => {
      const t = document.body.innerText;
      return t.includes('行为模式') || t.includes('下一步训练') || t.includes('重试');
    },
    { timeout: 120_000 }
  );
  await sleep(1500);
  await page.screenshot({ path: '/tmp/poker-review.png', fullPage: true });

  const reviewText = await page.evaluate(() => document.body.innerText);
  if (!reviewText.includes('AI 教练复盘')) throw new Error('复盘区块缺失');
  if (!/手数/.test(reviewText)) throw new Error('统计区块缺失');
  if (reviewText.includes('重试') && !reviewText.includes('行为模式')) {
    throw new Error('结构化复盘生成失败(显示了错误状态)');
  }
  const hasComment = reviewText.includes('教练:');
  console.log(hasComment ? '即时点评: 已出现在手牌列表' : '即时点评: 本次未捕获(可能尚未返回)');

  await browser.close();

  if (errors.length) {
    console.log('页面 JS 错误:');
    for (const e of errors) console.log(' -', e);
    throw new Error(`存在 ${errors.length} 个页面错误`);
  }
  console.log(`e2e 通过: 英雄行动 ${acted} 次, 复盘页正常, AI 输出已流式渲染`);
  console.log('截图: /tmp/poker-setup.png /tmp/poker-table.png /tmp/poker-review.png');
}

main().catch((e) => {
  console.error('e2e 失败:', e.message);
  process.exit(1);
});
