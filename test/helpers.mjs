// 試験の道具。一時フォルダと「PC の控え」はすべてこの商品のフォルダの中（試験/test-tmp）に作る。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const CLI = path.join(ROOT, 'bin', 'tenukiban.mjs');
const TMP_BASE = path.join(ROOT, '試験', 'test-tmp');
fs.mkdirSync(TMP_BASE, { recursive: true });

export function tmp() {
  const d = fs.mkdtempSync(path.join(TMP_BASE, 't-'));
  const proj = path.join(d, 'proj');
  fs.mkdirSync(proj);
  return { proj, home: path.join(d, 'home') };
}

/** 手抜き番を別の process で走らせる（CI の環境変数は外し、控えは試験用の場所に）。 */
export function run(t, args, { input = '', env = {} } = {}) {
  const e = { ...process.env, TENUKIBAN_HOME: t.home, ...env };
  delete e.CI;
  delete e.CLAUDE_PROJECT_DIR;
  if (env.CI) e.CI = env.CI;
  return spawnSync(process.execPath, [CLI, ...args, '--root', t.proj], { encoding: 'utf8', input, env: e });
}

export function write(t, rel, text) {
  const p = path.join(t.proj, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}

export function git(t, ...args) {
  const r = spawnSync('git', ['-C', t.proj, '-c', 'user.email=test@example.invalid', '-c', 'user.name=test', '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
}

/** 小さな見本の案件（架空）。 */
export function sampleProject(t) {
  write(t, 'package.json', JSON.stringify({ name: 'sample', scripts: { test: 'node --test test/' } }, null, 2));
  write(t, 'src/order.js', "export async function saveOrder(db, o) {\n  await db.insert(o);\n  return { ok: true };\n}\n");
  write(t, 'public/index.html', '<p>ご注文を受け付けます。送る前に内容を確認してください。</p>\n');
  write(t, 'test/order.test.js', "import { test } from 'node:test';\ntest('保存する', () => {});\ntest('空なら断る', () => {});\n");
}
