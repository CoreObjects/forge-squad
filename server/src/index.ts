import { existsSync } from 'node:fs';
import { createApp } from './app';
import { loadConfig, wxLoginConfigured, wxPayConfigured } from './config';

const envFile = process.env.ENV_FILE ?? 'server/.env';
if (existsSync(envFile)) process.loadEnvFile(envFile);

const cfg = loadConfig(process.env);
const { server, ctx } = createApp(cfg);
server.listen(cfg.port, cfg.host, () => {
  console.log(`[forge-server] listening on http://${cfg.host}:${cfg.port}`);
  console.log(`[forge-server] db=${cfg.dbPath} wxLogin=${wxLoginConfigured(cfg)} wxPay=${wxPayConfigured(cfg)} devLogin=${cfg.devLogin} devPay=${cfg.devPay}`);
  if (cfg.devLogin || cfg.devPay) console.warn('[forge-server] DEV_LOGIN / DEV_PAY 已开启：只用于内部测试，正式环境请关闭');
});

const shutdown = () => {
  server.close(() => {
    ctx.db.close();
    process.exit(0);
  });
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
