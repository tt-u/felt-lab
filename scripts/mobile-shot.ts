// 移动端布局测试: 390x844, 开桌截图 + 浮层截图
import puppeteer from 'puppeteer-core';
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: true, protocolTimeout: 120000,
    args: ['--no-sandbox', '--user-data-dir=/tmp/poker-mobile-profile', '--no-first-run'],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  page.on('dialog', (d) => d.accept());
  await page.goto('http://localhost:3777', { waitUntil: 'networkidle0' });
  // 6人桌开局
  const click = (text: string) => page.evaluate((t) => {
    const el = [...document.querySelectorAll('button')].find(b => (b.textContent ?? '').includes(t));
    if (el) (el as HTMLElement).click(); return !!el;
  }, text);
  await click('开始训练');
  await page.waitForFunction(() => location.pathname === '/table', { timeout: 5000 });
  await sleep(4500);
  await page.screenshot({ path: '/tmp/mobile-table.png' });
  // 打开浮层
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '复盘与玩家面板');
    (btn as HTMLElement)?.click();
  });
  await sleep(800);
  await page.screenshot({ path: '/tmp/mobile-panel.png' });
  await browser.close();
  console.log('移动端截图完成');
}
main().catch((e) => { console.error('失败:', e.message); process.exit(1); });
