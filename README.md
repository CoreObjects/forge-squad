# 锻造小队（Project Forge）V2 MVP

竖屏数值 RPG，微信小游戏优先。核心玩法：**锻造战纹 → 排 6 节战纹链 → 连携 → 命中 Boss 破绽谱触发破势**。

设计文档：`VISION (1).md`、`GAME_DESIGN (1).md`、`ECONOMY (1).md`、`MVP_SPEC (1).md`、`P0_BALANCE.md`。

## 运行

```bash
npm install
npm test                 # 单元测试 + 服务端集成测试 + 前 30 分钟成长曲线验收
npm run sim              # 经济节奏模拟（动作按真实耗时推进）：前 30 分钟与 D1–D14 对照 ECONOMY 目标
```

### 游戏服务端（账号 / 云存档 / 支付 / 埋点 / 竞技场）

需要 Node ≥ 22.13（使用内置 `node:sqlite`，无第三方依赖）。

```bash
cp server/.env.example server/.env    # 填写微信 AppID、AppSecret、虚拟支付 OfferID / AppKey、消息推送 Token
npm run server                        # 开发运行（读取 server/.env）
npm run server:build                  # 打包 → server/dist/index.mjs
npm run start:server                  # 运行打包产物
docker build -f server/Dockerfile -t forge-server .   # 容器部署（先 server:build）
```

内部测试可在 `server/.env` 开启 `DEV_LOGIN=1`（设备号登录）和 `DEV_PAY=1`（不走微信直接到账），正式环境必须关闭。

数据看板：`GET /api/admin/report?key=<ADMIN_KEY>`（可加 `&days=7`），回答 MVP_SPEC §36.2 的全部数据问题。

### 客户端

```bash
npm run dev                                          # 网页调试版（离线：本地存档 / 模拟支付 / 本地测试对手）
# 联网调试：浏览器打开 http://localhost:5173/?api=http://127.0.0.1:8787&gm=1
FORGE_API_BASE=https://api.example.com npm run build:wx   # 微信小游戏包 → dist-wx/，用微信开发者工具导入
FORGE_API_BASE=https://api.example.com FORGE_GM=1 npm run build:wx   # 带 GM 面板的测试包
```

微信接入清单：

1. `wechat/project.config.json` 的 `appid` 换成自己的小游戏 AppID。
2. 小游戏后台「开发管理 → 服务器域名」把服务端 HTTPS 域名加入 request 合法域名。
3. 虚拟支付后台创建道具（首充 ¥6、月卡 ¥30），道具 ID 填到 `WX_PRODUCT_FIRST_CHARGE` / `WX_PRODUCT_MONTHLY_CARD`。
4. 「消息推送」URL 填 `https://<域名>/api/pay/wx-notify`，数据格式 JSON、明文模式，Token 填到 `WX_MSG_TOKEN`。
5. 先用 `WX_PAY_ENV=1`（沙箱）+ 沙箱 AppKey 跑通，再切正式。

## 内容

| 模块 | 说明 |
|---|---|
| 战纹 | 锋 / 疾 / 御 / 震 × 6 品质；炉级品质概率表；稀有 10 / 史诗 50 / 传说 180 抽保底；新手前 4 次四类型、前 12 次必出史诗 |
| 战纹链 | 6 节放入、覆盖（旧纹自动熔炼）、交换；推荐节点（战力 + 连携 + 当前 Boss 破绽 + 对当前关卡的实战胜率） |
| 战斗 | 按 `P0_BALANCE.md` 数值（重甲守卫攻击 180）；PVE 敌人每 2 节行动；PVP 双方链交替；6 个双连携、2 个三连；破势；规则化失败解释 |
| 成长 | 角色等级（金币）、铁匠炉（炉火 + 金币 + 主线门槛）、10 章 100 关、章节 Boss 破绽谱 |
| 回流 | 挂机（40 分钟 1 锤，免费 12h / 月卡 18h）、日常任务、每日 Boss |
| 竞争 | 异步竞技场：真实玩家防守快照匹配（偏弱 / 接近 / 略强），服务端结算、每日次数与积分；人数不足时用标记为「系统测试数据」的测试账号补位 |
| 商业化 | ¥6 首充（20 锤 + 一次性史诗保底状态 + 外观）、¥30 月卡；微信虚拟支付，服务端下单签名 → 查单 / 发货通知到账 → 客户端发放 → 确认，全程幂等；支付后被杀进程下次启动补发 |
| 账号 / 存档 | 微信登录（code2Session）；云存档乐观并发，多设备按进度合并；离线时本地存档照常可玩 |
| 埋点 | `MVP_SPEC §30` 全部事件，批量上报、失败本地排队重试；服务端报表 |
| 新手 | 3 分钟引导：锻造 → 迅斩 → 手动放入 → 小 Boss 失败 → 换位 → 破势获胜 |
| GM | `MVP_SPEC §31` 全部测试能力 + P0 战斗验证 |

## 目录

```
src/core/          纯逻辑（不依赖 DOM / wx），全部可单测；服务端直接复用战斗代码
  config/*.json    所有可调数值
  game.ts          游戏状态与全部玩家动作
  battle.ts        战斗模拟（客户端演出与服务端结算共用）
  p0.ts            P0_BALANCE 验收基线
src/net/           联网：API 客户端、云存档合并、支付、埋点上报、竞技场
src/ui/            Canvas 2D 自绘界面（750×1334 设计尺寸）
src/platform/      网页 / 微信适配、合成音效
server/src/        游戏服务端（node:http + node:sqlite）
server/tests/      服务端集成测试（假微信接口按官方签名规则校验）与客户端联网端到端测试
tests/             客户端单元测试、P0 验收、前 30 分钟成长曲线验收
scripts/           微信打包、经济模拟机器人
```
