import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, protocolTimeout: 120000,
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
  // 打几手有翻后行动的牌
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const t = await page.evaluate(() => document.body.innerText);
    if (/第 [3-9] 手/.test(t)) break;
    if (!(await click('跟注'))) { if (!(await click('过牌'))) { if (t.includes('下一手')) await click('下一手'); } }
    await sleep(600);
  }
  await click('结束并复盘');
  await page.waitForFunction(() => location.pathname === '/review', { timeout: 8000 });
  await page.waitForFunction(() => document.body.innerText.includes('全部手牌'), { timeout: 10000 });
  // 展开第一手
  await page.evaluate(() => {
    const sum = document.querySelector('details summary');
    (sum as HTMLElement)?.click();
  });
  await sleep(600);
  // 滚动到手牌列表
  await page.evaluate(() => {
    document.querySelector('details[open]')?.scrollIntoView({ block: 'start' });
  });
  await sleep(400);
  await page.screenshot({ path: '/tmp/timeline.png' });
  await browser.close();
  console.log('时间线截图完成');
}
main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
