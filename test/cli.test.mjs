// 命令（tenukiban check / init / accept）の試験。本物の process で走らせる。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmp, run, write, sampleProject } from './helpers.mjs';

function started() {
  const t = tmp();
  sampleProject(t);
  const r = run(t, ['init']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return t;
}
const baselineOf = (t) => JSON.parse(fs.readFileSync(path.join(t.proj, '.tenukiban', 'baseline.json'), 'utf8'));

test('始める前の check は「問題なし」と言わず 2 で止まる。読めたファイルが 0 件でも 2', () => {
  const t = tmp();
  write(t, 'a.js', 'x\n');
  const r = run(t, ['check']);
  assert.equal(r.status, 2);
  assert.match(r.stdout, /tenukiban init/);
  const e = tmp();
  write(e, 'readme.txt', 'x');
  assert.equal(run(e, ['init']).status, 2);
  assert.ok(!fs.existsSync(path.join(e.proj, '.tenukiban', 'baseline.json')), '0 件なら基準を作らない');
});

test('init のあと check は通る。成功のふりを足すと 1 で止め、場所・説明・AIへの頼み方を日本語で出す', () => {
  const t = started();
  const ok = run(t, ['check']);
  assert.equal(ok.status, 0, ok.stdout);
  assert.match(ok.stdout, /通りました/);
  write(t, 'src/pay.js', "export function charge(card) {\n  // TODO 決済をつなぐ\n  return { success: true };\n}\n");
  const ng = run(t, ['check']);
  assert.equal(ng.status, 1);
  assert.match(ng.stdout, /止めました/);
  assert.match(ng.stdout, /src\/pay\.js 3行目/);
  assert.match(ng.stdout, /かんたんに言うと/);
  assert.match(ng.stdout, /AIにこう頼んでください/);
  assert.match(ng.stdout, /🆕/);
});

test('日本語・英語の誇大表現を新しく書くと止める（新しいファイルでも素通りしない）', () => {
  const t = started();
  write(t, 'public/lp.html', '<h1>セキュリティは万全、100%安全なAI受付</h1>\n<p>Our AI never makes mistakes.</p>\n');
  const r = run(t, ['check', '--json']);
  assert.equal(r.status, 1);
  const j = JSON.parse(r.stdout);
  const ids = j.findings.filter((f) => f.blocking).map((f) => f.id).sort();
  assert.deepEqual(ids, ['en-never-fails', 'ja-100pct', 'ja-banzen']);
});

test('前からある指摘は止めない。直すと基準が引き締まり、戻すと止まる（過去の最良は消せない）', () => {
  const t = tmp();
  sampleProject(t);
  write(t, 'src/old.js', 'export function load() {\n  try { return read(); } catch {}\n}\n');
  assert.equal(run(t, ['init']).status, 0);
  const r1 = run(t, ['check']);
  assert.equal(r1.status, 0);
  assert.match(r1.stdout, /前からあるもの/);
  write(t, 'src/old.js', 'export function load() {\n  try { return read(); } catch (e) { console.error(e); throw e; }\n}\n');
  const r2 = run(t, ['check']);
  assert.equal(r2.status, 0);
  assert.match(r2.stdout, /新しい基準にしました/);
  assert.equal(baselineOf(t).debt.best.emptyCatch, 0);
  write(t, 'src/old.js', 'export function load() {\n  try { return read(); } catch {}\n}\n');
  assert.equal(run(t, ['check']).status, 1, '直した物を戻したら止まる');
});

test('基準ファイルを消しても緑にならない（控えがあるので「消された」と止める）', () => {
  const t = started();
  fs.rmSync(path.join(t.proj, '.tenukiban', 'baseline.json'));
  const r = run(t, ['check']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /基準ファイルが消された/);
  const again = run(t, ['init']);
  assert.equal(again.status, 2, '控えがあるのに黙ってやり直さない');
  assert.match(again.stdout, /前に見張っていた/);
  assert.equal(run(t, ['init', '--reason', '試験のため最初から']).status, 0);
  assert.equal(baselineOf(t).history[0].reason, '試験のため最初から');
});

test('基準を手で緩める・過去最良を書き換える・記録を消す → 控えと比べて止める', () => {
  const t = started();
  write(t, 'src/a.js', '// TODO 1\n');
  const b = baselineOf(t);
  b.debt.current.todo = 5; b.debt.best.todo = 5;
  fs.writeFileSync(path.join(t.proj, '.tenukiban', 'baseline.json'), JSON.stringify(b));
  const r = run(t, ['check']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /記録なしに緩められた/);
  assert.match(r.stdout, /過去最良が 0 から 5/);
  fs.writeFileSync(path.join(t.proj, '.tenukiban', 'baseline.json'), '{ broken');
  assert.equal(run(t, ['check']).status, 1, '壊れた基準でも緑にしない');
});

test('accept：理由が要る・画面の無い所（AI の道具）からは断る・--non-interactive なら記録に残して毎回知らせる', () => {
  const t = started();
  write(t, 'src/a.js', '// TODO あとで\n');
  assert.equal(run(t, ['check']).status, 1);
  const noTty = run(t, ['accept', '--reason', 'あとで直す']);
  assert.equal(noTty.status, 2);
  assert.match(noTty.stderr, /AI は実行しないでください/);
  assert.equal(run(t, ['accept', '--non-interactive']).status, 2, '理由なしは断る');
  const ok = run(t, ['accept', '--reason', '来週の作業で直す', '--non-interactive']);
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /debt\.todo を 0 → 1/);
  const h = baselineOf(t).history.at(-1);
  assert.equal(h.reason, '来週の作業で直す');
  assert.equal(h.interactive, false);
  const after = run(t, ['check']);
  assert.equal(after.status, 0);
  assert.match(after.stdout, /画面の確認なし/);
  assert.match(after.stdout, /緩めた記録: 1 件/);
});

test('accept：基準が書き換えられていたら、書き換えを受け入れずに控えから始める', () => {
  const t = started();
  const b = baselineOf(t);
  b.tests.current.testCases = 0; b.tests.best.testCases = 0;
  fs.writeFileSync(path.join(t.proj, '.tenukiban', 'baseline.json'), JSON.stringify(b));
  const r = run(t, ['accept', '--reason', '設定の見直し', '--non-interactive']);
  assert.match(r.stdout, /控えから始めます/);
  assert.equal(baselineOf(t).tests.best.testCases, 2, '過去最良は控えのまま');
});

test('--hook（Claude Code のフック）：止めたら 2 と AI への直し方を標準エラーに。通れば 0。4 回続けて止めたら人に渡す（1）', () => {
  const t = started();
  const hookIn = JSON.stringify({ hook_event_name: 'Stop', stop_hook_active: false });
  assert.equal(run(t, ['check', '--hook'], { input: hookIn }).status, 0);
  write(t, 'src/x.js', 'fetchData().then(setData).catch(() => {});\n');
  for (let i = 0; i < 3; i++) {
    const r = run(t, ['check', '--hook'], { input: hookIn });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /直し方/);
  }
  const fourth = run(t, ['check', '--hook'], { input: hookIn });
  assert.equal(fourth.status, 1);
  assert.match(fourth.stderr, /人が/);
});

test('init --apply：CLAUDE.md・AGENTS.md に決まりを追記し、フック（Stop）と断る設定を書く。既にある設定は書き換えない', () => {
  const t = tmp();
  sampleProject(t);
  write(t, 'CLAUDE.md', '# 既存の指示\n');
  const r = run(t, ['init', '--apply']);
  assert.equal(r.status, 0, r.stdout);
  const claude = fs.readFileSync(path.join(t.proj, 'CLAUDE.md'), 'utf8');
  assert.match(claude, /^# 既存の指示/);
  assert.match(claude, /tenukiban:start/);
  assert.ok(!claude.includes('{{CLI}}'));
  assert.ok(fs.existsSync(path.join(t.proj, 'AGENTS.md')));
  const s = JSON.parse(fs.readFileSync(path.join(t.proj, '.claude', 'settings.json'), 'utf8'));
  assert.match(s.hooks.Stop[0].hooks[0].command, /check --hook$/);
  assert.ok(s.permissions.deny.some((d) => d.includes('accept')));
  assert.equal(run(t, ['check']).status, 0);
  const t2 = tmp();
  sampleProject(t2);
  write(t2, '.claude/settings.json', '{"model":"x"}');
  const r2 = run(t2, ['init', '--apply']);
  assert.match(r2.stdout, /書き換えていません/);
  assert.equal(fs.readFileSync(path.join(t2.proj, '.claude', 'settings.json'), 'utf8'), '{"model":"x"}');
});

test('CI（環境変数 CI）では、基準も控えも書かない', () => {
  const t = started();
  const before = fs.readFileSync(path.join(t.proj, '.tenukiban', 'baseline.json'), 'utf8');
  write(t, 'test/more.test.js', "import { test } from 'node:test';\ntest('増やした', () => {});\n");
  const r = run(t, ['check'], { env: { CI: 'true' } });
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /PC の控えとは比べていません/);
  assert.equal(fs.readFileSync(path.join(t.proj, '.tenukiban', 'baseline.json'), 'utf8'), before);
});

test('A のファイルで 1 つ直し、B のファイルで 1 つ増やしても止める（ファイルごとに数える）', () => {
  const t = tmp();
  sampleProject(t);
  write(t, 'src/a.js', 'try { a(); } catch {}\n');
  assert.equal(run(t, ['init']).status, 0);
  write(t, 'src/a.js', 'try { a(); } catch (e) { console.error(e); }\n');
  write(t, 'src/b.js', 'try { b(); } catch {}\n');
  const r = run(t, ['check']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /src\/b\.js 1行目/);
});
