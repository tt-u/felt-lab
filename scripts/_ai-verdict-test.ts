// 验证: 玩两手牌, 等 AI 点评到达, 复盘页回放器决策帧应显示 AI 判定(而非"引擎判定")
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, protocolTimeout: 180000,
    args: ['--no-sandbox', '--window-size=1440,900', '--user-data-dir=/tmp/poker-e2e-profile', '--no-first-run'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:3777', { waitUntil: 'networkidle0' });
  const click = (text: string) => page.evaluate((t) => {
    const el = [...document.querySelectorAll('button')].find(b => (b.textContent ?? '').includes(t));
    if (el) (el as HTMLElement).click(); return !!el;
  }, text);
  await click('单挑'); await click('开始训练');
  await page.waitForFunction(() => location.pathname === '/table', { timeout: 5000 });
  // 打到第3手
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const t = await page.evaluate(() => document.body.innerText);
    if (/第 [3-9] 手/.test(t)) break;
    if (!(await click('跟注'))) { if (!(await click('过牌'))) { if (t.includes('下一手')) await click('下一手'); } }
    await sleep(600);
  }
  // 等 AI 点评到达(侧栏出现"AI 教练详评"且 store 持久化)
  await sleep(12000);
  await click('结束并复盘');
  await page.waitForFunction(() => location.pathname === '/review', { timeout: 8000 });
  await page.waitForFunction(() => document.body.innerText.includes('全部手牌'), { timeout: 10000 });
  // 逐个展开手牌, 找有决策帧的, 检查 AI 判定
  const report = await page.evaluate(async () => {
    const out: string[] = [];
    const details = [...document.querySelectorAll('details')];
    for (const d of details) {
      (d.querySelector('summary') as HTMLElement)?.click();
      await new Promise((r) => setTimeout(r, 300));
      const markers = [...d.querySelectorAll('button[aria-label^="你的决策"]')];
      if (!markers.length) { (d.querySelector('summary') as HTMLElement)?.click(); continue; }
      (markers[0] as HTMLElement).click();
      await new Promise((r) => setTimeout(r, 200));
      const text = (d as HTMLElement).innerText;
      const hasEngine = text.includes('引擎判定');
      const hasVerdict = text.includes('正确') || text.includes('边缘') || text.includes('偏差');
      out.push(`手牌${out.length + 1}: 判定面板${hasVerdict ? '有' : '无'}, ${hasEngine ? '引擎fallback' : 'AI判定'}`);
      (d.querySelector('summary') as HTMLElement)?.click();
    }
    return out;
  });
  console.log(report.join('\n'));
  const aiCount = report.filter((r) => r.includes('AI判定')).length;
  console.log(aiCount > 0 ? `验证通过: ${aiCount} 手显示 AI 判定` : '问题确认: 全部回退引擎判定');
  await browser.close();
  if (aiCount === 0) process.exit(2);
}
main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
