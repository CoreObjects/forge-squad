# 锻造小队（Project Forge）V2 MVP

竖屏数值 RPG，微信小游戏优先。核心玩法：**锻造战纹 → 排 6 节战纹链 → 连携 → 命中 Boss 破绽谱触发破势**。

设计文档：`VISION (1).md`、`GAME_DESIGN (1).md`、`ECONOMY (1).md`、`MVP_SPEC (1).md`、`P0_BALANCE.md`。

## 运行

```bash
npm install
npm run dev          # 浏览器调试版 http://localhost:5173 （开发模式自带 GM 面板）
npm test             # 单元测试
npm run build        # 网页正式包 → dist/（加 ?gm=1 打开 GM）
npm run build:wx     # 微信小游戏包 → dist-wx/，用微信开发者工具导入该目录
FORGE_GM=1 npm run build:wx   # 带 GM 面板的小游戏测试包
npm run sim          # 经济节奏模拟：免费活跃玩家 D0–D14 进度对照 ECONOMY 目标
```

微信工程的 `appid` 是占位值（`wechat/project.config.json`），接入时换成自己的小游戏 AppID。

## 内容

| 模块 | 说明 |
|---|---|
| 战纹 | 锋 / 疾 / 御 / 震 × 6 品质；炉级品质概率表；稀有 10 / 史诗 50 / 传说 180 抽保底；新手前 4 次四类型、前 12 次必出史诗 |
| 战纹链 | 6 节放入、覆盖（旧纹自动熔炼）、交换；推荐节点（战力 + 连携 + 当前 Boss 破绽） |
| 战斗 | 按 `P0_BALANCE.md` 数值；PVE 敌人每 2 节行动；PVP 双方链交替；6 个双连携、2 个三连；破势；规则化失败解释 |
| 成长 | 角色等级（金币）、铁匠炉（炉火 + 金币 + 主线门槛）、10 章 100 关、章节 Boss 破绽谱 |
| 回流 | 挂机（40 分钟 1 锤，免费 12h / 月卡 18h）、日常任务、每日 Boss |
| 竞争 | 异步竞技场（偏弱 / 接近 / 略强）、积分、排行榜、防守快照 |
| 商业化 | ¥6 首充（20 锤 + 一次性史诗保底状态 + 外观）、¥30 月卡；订单幂等到账 |
| 新手 | 3 分钟引导：锻造 → 迅斩 → 手动放入 → 小 Boss 失败 → 换位 → 破势获胜 |
| 埋点 | `MVP_SPEC §30` 全部事件，GM「数据」页可看关键比率 |
| GM | `MVP_SPEC §31` 全部测试能力 + P0 战斗验证 |

## 目录

```
src/core/          纯逻辑（不依赖 DOM / wx），全部可单测
  config/*.json    所有可调数值：概率、保底、连携、破势、炉级、关卡、产出、日常、竞技场、首充、月卡
  game.ts          游戏状态与全部玩家动作
  battle.ts        战斗模拟（输出事件流给表现层播放）
src/ui/            Canvas 2D 自绘界面（750×1334 设计尺寸）
src/platform/      网页 / 微信适配、合成音效
src/main.web.ts    网页入口
src/main.wx.ts     微信小游戏入口
tests/             Vitest
scripts/           微信打包、经济模拟
```

## 目前是模拟实现的部分

- **支付**：`MockPaymentProvider` 弹确认框即视为成功。正式接入实现 `PaymentProvider`（`wx.requestMidasPayment` + 服务端验单）。
- **竞技场对手**：本地生成、标记为「系统测试数据」的对手。正式接入把防守快照上传服务端做匹配。
- **埋点上报**：内存缓冲 + 控制台。正式接入给 `Analytics.addSink` 加服务端上报。
- **登录 / 云存档**：本地存储（`localStorage` / `wx.setStorageSync`）。
