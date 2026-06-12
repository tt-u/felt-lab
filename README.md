# 翻牌屋 FELT LAB

德州扑克对战训练: 和 GTO 近似策略或带性格偏移的对手实战, 每个决策点实时拆解, 整局生成行为模式复盘。

**在线体验**: http://blockinsight.top/felt-lab/

![产品演示](.github/promo.gif)

> 宣传片由 [HyperFrames](https://github.com/heygen-com/hyperframes) 渲染([高清 MP4](https://github.com/tt-u/felt-lab/raw/main/public/promo.mp4)); 源文件在 `video/promo/`, `npm run gen:promo` 重渲染。

## 功能

### 牌桌

- 单挑 / 6 / 7 / 8 / 9 人现金桌(盲注 1/2), 完整支持加注规则、全下、边池、未跟注返还、平分底池
- 发牌 / 下注 / 收池筹码动画与合成音效(可静音), 头像来自 BitmapPunks 像素头像池, 每局随机分配
- 开局可选对手风格"显示"(座位标出风格, 练针对性调整)或"隐藏"(盲打读牌风, 复盘时揭晓)

### 对手策略(GTO 近似基线 + 性格偏移)

- 翻前: solver 衍生 RFI 范围表(UTG 14% 到 BTN 42%); 单挑独立范围(BTN 开 72%, BB 宽防守)
- 翻后: 范围对范围引擎 — 重放公开行动推断每个玩家的 1326 组合实时范围, 胜率对范围抽样、MDF 最小防守频率、阻断牌选诈唬、范围优势驱动下注频率
- 六种性格档案(GTO 均衡 / 紧凶 / 松凶 / 紧弱 / 跟注站 / 疯鱼), 决策带频率随机化

### 实战复盘(本地实时, 零延迟)

- 每手结束立刻拆解你的每个决策点: 对手下了多大(占池比例)、按行动线他可能拿什么(范围引擎推断)、你的胜率 vs 所需胜率、教练建议 vs 实际选择
- 弃牌后可开"兔子洞": 剩余公共牌会怎么发、对手当时拿什么、你本来会赢还是弃得对
- 行动条常驻牌力仪表(当前成牌 + 对范围实时胜率); 全下摊牌时电视式胜率条; BAD BEAT / HERO CALL / 诈唬得手高光横幅
- 教练建议由本地确定性引擎给出(翻前查范围表, 翻后按数字阈值), 理由从数字生成, 与判定永不矛盾

### 复盘页

- 交互式手牌回放器: 迷你牌桌 + 可拖时间轴, 全员底牌明牌重放; 时间轴上绿 / 黄 / 红标记每个决策点的判定, 点击直达该帧查看对手范围、胜率与建议
- 数据画像: VPIP / PFR / 3Bet / WTSD / 摊牌胜率 / 进攻频率, 按位置盈亏与上下半场走势
- DeepSeek 结构化复盘: 行为模式(附手号证据与严重度)、对手如何适应你、状态轨迹(上头检测)、训练处方; 每手另有逐街详评
- 喂给 AI 的记录每街附程序计算的成牌 / 板面性质标注, 摊牌附程序判定的胜负对比 — 杜绝"四条被说成可能输给同花"这类牌力幻觉

## 本地运行

```bash
npm install
cp .env.example .env.local   # 填入你的 DeepSeek API Key
npm run dev                  # 开发
npm run build && npm start   # 生产
```

`.env.local`:

```
DEEPSEEK_API_KEY=sk-xxxxxxxx
```

服务端形态下 key 只在 API 路由(`app/api/review/route.ts`)中使用, 不会下发到浏览器; 静态部署形态见下文, 注意事项不同。

## 部署

- **GitHub Pages(静态, 本仓库已配置)**: push 到 main 自动构建部署(`.github/workflows/pages.yml`)。静态形态没有服务端, DeepSeek 由浏览器直连, key 来自 Actions secret `DEEPSEEK_API_KEY` 并在构建时注入前端包。**任何访客都能从前端代码读到这个 key**, 仅适合个人演示; 介意请改用服务端形态并删除该 secret。
- **服务端形态(key 不出服务器)**: Vercel 导入仓库并设置环境变量 `DEEPSEEK_API_KEY`, 或自托管 `npm run build && npm start`(建议反代 + HTTPS)。

## 测试

```bash
npm run test:engine   # 引擎自检: 评牌器正确性 + 600+ 手模拟(边池/筹码守恒/零和校验)
npm run test:facts    # 牌力事实标注回归: 守护 AI 提示词的反幻觉防线
npm run test:e2e      # 浏览器冒烟: 设置 -> 对战 -> AI 复盘全流程(需本机 Chrome 和已启动的服务)
npm run gen:ranking   # 重新生成翻前 169 手牌强度表(蒙特卡洛, 结果嵌入 lib/poker/ranges.ts)
```

## 媒体素材

落地页氛围视频(`video/hero/`, `npm run gen:hero`)与宣传片(`video/promo/`, `npm run gen:promo`)均由 HyperFrames 离线渲染, 需本机 ffmpeg。

## 架构

```
lib/poker/
  cards.ts        牌编码 / 洗牌(crypto 随机) / 手牌类别
  evaluator.ts    7 张牌评牌器(位运算, 返回可比较整数)
  equity.ts       蒙特卡洛胜率 + 已知牌精确枚举
  ranges.ts       翻前 169 手牌强度排序 + 标准 RFI 图表 + 单挑范围 + 范围记号解析
  range-model.ts  范围对范围引擎(范围重放 / 对范围胜率 / MDF / 阻断牌 / 范围优势)
  personality.ts  六种对手性格档案
  ai.ts           机器人决策(翻前图表 + 翻后范围对范围 + 性格偏移 + 频率随机化)
  engine.ts       牌局状态机(下注轮 / 全下 / 边池 / 摊牌分池)
  history.ts      手牌记录 / 玩家统计 / AI 提示词文本与牌力事实标注
lib/drama.ts      戏剧层(兔子洞反事实 / 决策点判定 / 高光横幅 / 确定性教练建议)
lib/llm.ts        DeepSeek 调用层(服务端代理 / 浏览器直连双形态自动切换)
lib/store.ts      Zustand 会话状态(机器人调度 / 即时点评 / sessionStorage 持久化)
lib/review-prompt.ts  结构化复盘提示词与解析
app/
  page.tsx          训练设置
  table/page.tsx    牌桌对战(右侧复盘/玩家/记录面板)
  review/page.tsx   数据画像 + 结构化 AI 复盘 + 交互式手牌回放
  api/review/route.ts  DeepSeek 代理(流式 SSE / 非流式 / JSON 模式; 静态导出时移除)
```

## 安全说明

- API Key 仅存于 `.env.local`(已被 .gitignore 忽略), 切勿提交到仓库或写进前端代码
- 如 Key 曾在聊天、截图等场景外泄, 请到 DeepSeek 控制台轮换
