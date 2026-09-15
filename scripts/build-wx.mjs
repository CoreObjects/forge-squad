// 打包微信小游戏目录：dist-wx/（用微信开发者工具导入该目录即可运行）
import { build } from 'esbuild';
import { mkdirSync, copyFileSync, existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'dist-wx');
const gm = process.env.FORGE_GM === '1';

if (existsSync(out)) rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

await build({
  entryPoints: [resolve(root, 'src/main.wx.ts')],
  bundle: true,
  format: 'iife',
  target: 'es2017',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  minify: !gm,
  sourcemap: gm ? 'inline' : false,
  outfile: resolve(out, 'game.js'),
  define: { __GM__: JSON.stringify(gm) },
  loader: { '.json': 'json' },
  logLevel: 'info',
});

for (const f of ['game.json', 'project.config.json']) {
  copyFileSync(resolve(root, 'wechat', f), resolve(out, f));
}
console.log(`微信小游戏包已生成：${out}${gm ? '（含 GM 面板）' : ''}`);
