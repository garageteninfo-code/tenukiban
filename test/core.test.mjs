// 部品の試験。前半は同僚の 歯止め/改良/test/hadome.test.mjs を写したもの（同じ動きを保つ）。後半は手抜き番で足した物。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { compare, update, tamperCheck } from '../lib/ratchet.mjs';
import { loadConfig, listFiles } from '../lib/config.mjs';
import { loadRules, RULES_DIR } from '../lib/honesty.mjs';
import { scanText, noopReason, countTests, findWeakenedTests, isSecretFile, compileRules } from '../lib/scan-core.mjs';
import { EXPLAIN, askText } from '../lib/explain.mjs';
import { parseCoverage } from '../lib/gates.mjs';
import { tmp, ROOT } from './helpers.mjs';

const LOWER = { asAny: 'lower', emptyCatch: 'lower' };
const COLLEAGUE = path.resolve(ROOT, '..', '..', '試験', '歯止め');
const rulesFor = () => loadRules(loadConfig({ root: tmp().proj }));
const ids = (rules, src) => scanText(src, rules).map((h) => h.rule.id);

// ---------- 同僚の試験の写し ----------
test('[写し] 引き締めは自由・緩めるのは理由が要る・過去最良は戻らない', () => {
  let sec = update({ asAny: 10, emptyCatch: 3 }, undefined, { directions: LOWER, gate: 'debt' }).section;
  let r = update({ asAny: 8, emptyCatch: 3 }, sec, { directions: LOWER, gate: 'debt' });
  assert.deepEqual(r.refused, []);
  assert.equal(r.section.best.asAny, 8);
  sec = r.section;
  r = update({ asAny: 20, emptyCatch: 3 }, sec, { directions: LOWER, gate: 'debt' });
  assert.deepEqual(r.refused, ['asAny']);
  assert.equal(r.section.current.asAny, 8);
  r = update({ asAny: 20, emptyCatch: 3 }, sec, { directions: LOWER, gate: 'debt', reason: '外部の型定義が無い SDK を入れた' });
  assert.equal(r.section.current.asAny, 20);
  assert.equal(r.section.best.asAny, 8);
  assert.equal(r.loosened[0].reason, '外部の型定義が無い SDK を入れた');
});

test('[写し] 比べる: 悪化で失敗・揺れ（slack）は許す・gateOn=best なら過去最良と比べる', () => {
  const sec = { current: { line: 80 }, best: { line: 85 } };
  assert.equal(compare({ line: 79.8 }, sec, { directions: { line: 'higher' }, slack: 0.3 }).failed, false);
  assert.equal(compare({ line: 79.6 }, sec, { directions: { line: 'higher' }, slack: 0.3 }).failed, true);
  assert.equal(compare({ line: 82 }, sec, { directions: { line: 'higher' }, gateOn: 'best' }).failed, true);
});

test('[写し] 控えと比べて、記録なしの緩め・過去最良の書き換え・削除を見つける', () => {
  const ref = { debt: { current: { asAny: 10 }, best: { asAny: 5 } }, history: [] };
  assert.deepEqual(tamperCheck(ref, ref, { debt: { asAny: 'lower' } }), []);
  const loosened = { debt: { current: { asAny: 12 }, best: { asAny: 5 } }, history: [] };
  assert.match(tamperCheck(loosened, ref, { debt: { asAny: 'lower' } })[0], /理由の記録/);
  const withWhy = { ...loosened, history: [{ gate: 'debt', metric: 'asAny', from: 10, to: 12, reason: 'x' }] };
  assert.deepEqual(tamperCheck(withWhy, ref, { debt: { asAny: 'lower' } }), []);
  const bestEdited = { debt: { current: { asAny: 10 }, best: { asAny: 10 } }, history: [] };
  assert.match(tamperCheck(bestEdited, ref, { debt: { asAny: 'lower' } })[0], /過去最良/);
  assert.match(tamperCheck(null, ref, { debt: { asAny: 'lower' } })[0], /消されて/);
});

test('[写し] 正直さ: 仮の印のそばの成功は止め、実際に処理した成功は止めない', () => {
  const rules = rulesFor();
  assert.ok(ids(rules, 'function send() {\n  // TODO 本当に送る\n  return { ok: true };\n}').includes('stub-success'));
  assert.deepEqual(ids(rules, 'async function save(r) {\n  await db.insert(r);\n  return { ok: true };\n}'), []);
  assert.ok(ids(rules, 'try { a(); } catch {}').includes('empty-catch'));
  assert.deepEqual(ids(rules, 'try { a(); } catch {\n  // 無いときは作り直すので無視してよい\n}'), []);
});

test('[写し] 正直さ: 日本語の言い切りは止め、打ち消しの言い方は止めない', () => {
  const rules = rulesFor();
  assert.ok(ids(rules, '<p>AIが完璧な返信を作ります</p>').includes('ja-kanpeki'));
  assert.deepEqual(ids(rules, '<p>AIの返信は完璧ではありません</p>'), []);
  assert.ok(ids(rules, '<p>100%安全です</p>').includes('ja-100pct'));
  assert.deepEqual(ids(rules, '<p>100%安全とは言えません</p>'), []);
  assert.deepEqual(ids(rules, '<span>全自動モード（要承認）</span>'), []);
  assert.ok(ids(rules, '<p>Our AI never makes mistakes</p>').includes('en-never-fails'));
  assert.deepEqual(ids(rules, '<p>Results are not guaranteed.</p>'), []);
});

test('[写し] 正直さ: 免除コメントと試験のファイルは違反にしない', () => {
  const rules = rulesFor();
  assert.deepEqual(scanText("const msg = '完全自動'; // tenukiban-allow: 製品名", rules), []);
  assert.deepEqual(scanText("const msg = '完全自動'; // hadome-allow: 製品名", rules), []);
  assert.deepEqual(scanText("const msg = '完全自動';", rules, { isTest: true }), []);
});

test('[写し] ファイルの列挙: .env や鍵のファイルは設定に関係なく読まない', () => {
  const { proj } = tmp();
  fs.writeFileSync(path.join(proj, '.env.js'), 'x');
  fs.writeFileSync(path.join(proj, 'a.js'), 'x');
  fs.writeFileSync(path.join(proj, 'server.pem'), 'x');
  assert.deepEqual(listFiles(loadConfig({ root: proj })).map((f) => path.basename(f)), ['a.js']);
});

test('[写し] カバレッジの要約: lcov・istanbul・node の表を読める。読めなければ null', () => {
  assert.deepEqual(parseCoverage('SF:a.js\nFNF:2\nFNH:1\nLF:10\nLH:8\nBRF:4\nBRH:2\nend_of_record\n'), { line: 80, branch: 50, funcs: 50 });
  assert.equal(parseCoverage('nothing here'), null);
});

// ---------- 手抜き番で足した物 ----------
test('規則ファイルは同僚が測った物と 1 文字も違わない（測った数字をそのまま言えるように）', (t) => {
  const theirs = path.join(COLLEAGUE, '改良', 'rules');
  if (!fs.existsSync(theirs)) { t.skip('同僚のフォルダが無い'); return; }
  for (const n of ['code', 'ja', 'en']) {
    assert.equal(fs.readFileSync(path.join(RULES_DIR, `honesty.${n}.json`), 'utf8'), fs.readFileSync(path.join(theirs, `honesty.${n}.json`), 'utf8'), n);
  }
});

test('同僚の 3 つの片の組で、捕まえた数・誤検知の数が同僚の記録と同じになる（A 38/0・B 19/0・C 10/1）', async (t) => {
  const dir = path.join(COLLEAGUE, 'ラベル付き');
  if (!fs.existsSync(dir)) { t.skip('同僚の片が無い'); return; }
  const rules = rulesFor();
  const expect = { cases: [38, 0], cases_holdout: [19, 0], cases_holdout2: [10, 1] };
  for (const [set, [caught, fa]] of Object.entries(expect)) {
    const { CASES } = await import(new URL(`file:///${path.join(dir, set + '.mjs').replace(/\\/g, '/')}`));
    let tp = 0, fp = 0;
    for (const c of CASES) {
      const hit = scanText(c.code + '\n', rules).length > 0;
      if (hit && c.label === 'bad') tp++;
      if (hit && c.label !== 'bad') fp++;
    }
    assert.deepEqual([tp, fp], [caught, fa], set);
  }
});

test('どの規則にも「かんたんな説明」と「AIへの頼み方」がある', () => {
  for (const f of fs.readdirSync(RULES_DIR)) {
    for (const r of JSON.parse(fs.readFileSync(path.join(RULES_DIR, f), 'utf8')).rules) {
      assert.ok(EXPLAIN[r.id], `説明が無い: ${r.id}`);
      assert.ok(EXPLAIN[r.id].plain && EXPLAIN[r.id].ask.includes('{where}'), r.id);
    }
  }
  for (const [id, e] of Object.entries(EXPLAIN)) assert.ok(e.title && e.plain && e.ask, id);
  const a = askText('empty-catch', 'src/a.js 3行目');
  assert.match(a, /src\/a\.js 3行目/);
  assert.match(a, /試験を消したり/);
});

test('正直さ: 基準に無い規則・ファイルでも、zero の比べ方なら「新しい項目」として素通りさせない', () => {
  const sec = { current: { 'empty-catch@a.js': 1 }, best: { 'empty-catch@a.js': 1 } };
  const r = compare({ 'empty-catch@a.js': 1, 'stub-success@b.js': 1 }, sec, { directions: { 'empty-catch@a.js': 'lower', 'stub-success@b.js': 'lower' }, zero: true });
  assert.equal(r.failed, true);
  // zero なしの比べ方だと、基準に無い項目は「新しい指標」で通ってしまう（ファイルごとに数えるので、zero が要る）
  const old = compare({ 'empty-catch@a.js': 1, 'stub-success@b.js': 1 }, sec, { directions: { 'empty-catch@a.js': 'lower', 'stub-success@b.js': 'lower' } });
  assert.equal(old.failed, false);
  // 直して 0 になった項目は消え、過去最良も 0（＝書かない）
  const u = update({}, sec, { directions: {}, zero: true, gate: 'honesty' });
  assert.deepEqual(u.section, { current: {}, best: {} });
  assert.deepEqual(tamperCheck({ honesty: u.section, history: [] }, { honesty: sec, history: [] }, { honesty: {} }, { zeroGates: ['honesty'] }), []);
});

test('控えと比べて、緩めた記録（history）を消したことを見つける', () => {
  const ref = { debt: { current: { a: 1 }, best: { a: 1 } }, history: [{ gate: 'debt', metric: 'a', reason: 'x' }] };
  const work = { ...ref, history: [] };
  assert.match(tamperCheck(work, ref, { debt: { a: 'lower' } }).join('\n'), /history/);
});

test('何もしない確認の命令を見分ける', () => {
  for (const c of ['', 'exit 0', 'true', 'echo ok', 'echo "tests passed"', 'node --test || true', 'jest --passWithNoTests', 'vitest run; exit 0', 'node -e ""']) assert.ok(noopReason(c), c);
  for (const c of ['node --test', 'npm run lint && node --test test/', 'echo "Error: no test specified" && exit 1', 'vitest run', 'tsc --noEmit']) assert.equal(noopReason(c), null, c);
});

test('試験の数・飛ばす印を数える', () => {
  const c = countTests("test('a', () => {});\nit(\"b\", () => {});\ntest.skip('c', () => {});\nxit('d', () => {});\ndescribe.only('e', () => {});\nconst s = 'split(\\'x\\')';\n");
  assert.equal(c.cases, 3);
  assert.equal(c.skipped, 3);
  const diff = 'diff --git a/test/a.test.js b/test/a.test.js\n--- a/test/a.test.js\n+++ b/test/a.test.js\n@@ -2 +2 @@\n-test(\'x\', () => {});\n+test.skip(\'x\', () => {});\n+++ b/src/a.js\n@@ -1 +1 @@\n+test.skip(\'not a test file\')\n';
  assert.deepEqual(findWeakenedTests(diff).map((w) => [w.file, w.line]), [['test/a.test.js', 2]]);
});

test('秘密のファイルの名前を見分ける（見本の .env.example は除く）', () => {
  for (const f of ['.env', 'app/.env.local', 'id_rsa', 'certs/server.pem', 'secrets.json', 'gcp/service-account-prod.json']) assert.ok(isSecretFile(f), f);
  for (const f of ['.env.example', 'env.js', 'src/key.js', 'config.sample.json', 'README.md']) assert.equal(isSecretFile(f), false, f);
});

test('規則の id が重複したら止める', () => {
  assert.throws(() => compileRules([{ name: 'a', rules: [{ id: 'x', pattern: 'a' }] }, { name: 'b', rules: [{ id: 'x', pattern: 'b' }] }]), /重複/);
});

test('見本のファイル（templates/）：JSON として読め、フックと断る設定があり、CI の見本は本流と比べる', () => {
  const dir = path.join(ROOT, 'templates');
  for (const f of ['claude-settings.例.json', 'claude-settings.編集のたび.例.json']) {
    const j = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    assert.match(j.hooks.Stop[0].hooks[0].command, /check --hook/, f);
    assert.ok(j.permissions.deny.some((d) => /accept/.test(d)), f);
  }
  const yml = fs.readFileSync(path.join(dir, 'github-actions.例.yml'), 'utf8');
  assert.match(yml, /fetch-depth: 0/);
  assert.match(yml, /--ci --base/);
  const md = fs.readFileSync(path.join(dir, 'CLAUDE.md断片.md'), 'utf8');
  assert.match(md, /tenukiban:start[\s\S]*\{\{CLI\}\} check[\s\S]*tenukiban:end/);
});
