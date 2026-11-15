// 見張りの穴（AI が見張りそのものを外して通す）の試験。
// 同僚の自動修理の試験（偽の修理係で 12 通り）で「元は止められなかった」型を、ふだんの作業フォルダで再現する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { tmp, run, write, git, sampleProject } from './helpers.mjs';

function started(setup) {
  const t = tmp();
  sampleProject(t);
  if (setup) setup(t);
  const r = run(t, ['init']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  return t;
}
const blockingIds = (t, args = []) => {
  const r = run(t, ['check', '--json', ...args]);
  const j = JSON.parse(r.stdout);
  return { status: r.status, ids: j.findings.filter((f) => f.blocking).map((f) => f.id), j };
};
const setScript = (t, cmd) => {
  const p = path.join(t.proj, 'package.json');
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  if (cmd === null) delete j.scripts.test; else j.scripts.test = cmd;
  fs.writeFileSync(p, JSON.stringify(j, null, 2));
};

test('確認の命令（npm test）を空・echo・|| true にすると止める。消しても、別の命令にしても止める', () => {
  for (const [cmd, id] of [['', 'guard:gate-script-noop'], ['echo ok', 'guard:gate-script-noop'], ['node --test test/ || true', 'guard:gate-script-noop'], [null, 'guard:gate-script-removed'], ['node --test test/order.test.js', 'guard:gate-script-changed']]) {
    const t = started();
    setScript(t, cmd);
    const r = blockingIds(t);
    assert.equal(r.status, 1, String(cmd));
    assert.ok(r.ids.includes(id), `${cmd}: ${r.ids}`);
  }
});

test('試験を飛ばす（.skip・xit）・試験の数を減らす・試験のファイルを消すと止める（どのファイルが消えたかも出す）', () => {
  let t = started();
  write(t, 'test/order.test.js', "import { test } from 'node:test';\ntest('保存する', () => {});\ntest.skip('空なら断る', () => {});\n");
  let r = blockingIds(t);
  assert.ok(r.ids.includes('tests:skipped'), r.ids);
  t = started();
  write(t, 'test/order.test.js', "import { test } from 'node:test';\ntest('保存する', () => {});\n");
  assert.ok(blockingIds(t).ids.includes('tests:testCases'));
  t = started();
  fs.rmSync(path.join(t.proj, 'test', 'order.test.js'));
  r = blockingIds(t);
  assert.ok(r.ids.includes('tests:testFiles'));
  assert.match(r.j.findings.find((f) => f.id === 'tests:testFiles').where, /test\/order\.test\.js/);
});

test('試験の道具の設定・手抜き番の設定を書き換える・足すと止める', () => {
  let t = started((x) => write(x, 'vitest.config.mjs', "export default { test: { include: ['test/**'] } };\n"));
  write(t, 'vitest.config.mjs', "export default { test: { include: [], passWithNoTests: true } };\n");
  assert.ok(blockingIds(t).ids.includes('guard:protected-changed'));
  t = started();
  const cfg = path.join(t.proj, 'tenukiban.config.json');
  const j = JSON.parse(fs.readFileSync(cfg, 'utf8'));
  j.honesty.disable = ['stub-success'];
  fs.writeFileSync(cfg, JSON.stringify(j));
  assert.ok(blockingIds(t).ids.includes('guard:protected-changed'), '規則を止める設定の変更');
  t = started();
  write(t, 'jest.config.js', "module.exports = { testPathIgnorePatterns: ['test'] };\n");
  assert.ok(blockingIds(t).ids.includes('guard:protected-added'));
});

test('フックを外す・CLAUDE.md の決まりを消すと止める', () => {
  const t = tmp();
  sampleProject(t);
  assert.equal(run(t, ['init', '--apply']).status, 0);
  fs.writeFileSync(path.join(t.proj, '.claude', 'settings.json'), '{"hooks":{}}\n');
  fs.writeFileSync(path.join(t.proj, 'CLAUDE.md'), '# 指示\n');
  const r = blockingIds(t);
  assert.ok(r.ids.includes('guard:hook-removed'), r.ids);
  assert.ok(r.ids.includes('guard:marker-removed'), r.ids);
  assert.ok(!r.ids.includes('guard:protected-changed'), 'フックは 1 件にまとめる');
});

test('node_modules の中を直接書き換えると止める。依存の固定ファイルが変わった（npm install）なら、止めずに知らせる', () => {
  const setup = (x) => {
    write(x, 'node_modules/left-pad/package.json', '{"name":"left-pad","version":"1.0.0"}');
    write(x, 'node_modules/left-pad/index.js', 'module.exports = (s) => s;\n');
    write(x, 'node_modules/@scope/util/index.js', 'module.exports = 1;\n');
    write(x, 'package-lock.json', '{"lockfileVersion":3}');
  };
  let t = started(setup);
  assert.equal(blockingIds(t).status, 0);
  write(t, 'node_modules/@scope/util/index.js', 'module.exports = 2; // AI が直接直した\n');
  let r = blockingIds(t);
  assert.ok(r.ids.includes('guard:node-modules-edited'), r.ids);
  assert.match(r.j.findings.find((f) => f.id === 'guard:node-modules-edited').where, /@scope\/util/);
  t = started(setup);
  write(t, 'node_modules/left-pad/index.js', 'module.exports = (s) => s.trim();\n');
  write(t, 'package-lock.json', '{"lockfileVersion":3,"packages":{}}');
  r = blockingIds(t);
  assert.equal(r.status, 0);
  assert.ok(r.j.notices.some((n) => n.id === 'guard:deps-changed'));
});

test('人が accept すると、見張りの記録を今の状態にし、理由を残す（命令の変更を受け入れる）', () => {
  const t = started();
  setScript(t, 'node --test --test-reporter=spec test/');
  assert.equal(blockingIds(t).status, 1);
  const a = run(t, ['accept', '--reason', '表示を見やすくするため', '--non-interactive']);
  assert.equal(a.status, 0, a.stdout + a.stderr);
  assert.match(a.stdout, /確認の命令/);
  assert.equal(blockingIds(t).status, 0);
});

test('git：.env を git に入れると止める。--base と比べ、変更の中の .skip・消した試験・本流の基準からの緩めを見つける', () => {
  const t = tmp();
  sampleProject(t);
  git(t, 'init', '-q', '-b', 'main');
  git(t, 'add', '-A');
  git(t, 'commit', '-q', '-m', 'first');
  assert.equal(run(t, ['init']).status, 0);
  git(t, 'add', '-A');
  git(t, 'commit', '-q', '-m', 'tenukiban');
  assert.equal(blockingIds(t).status, 0);
  // 作業枝で AI がしたこと（の真似）
  git(t, 'checkout', '-q', '-b', 'ai-work');
  write(t, '.env', 'API_KEY=dummy-for-test\n');
  git(t, 'add', '-A', '-f');
  git(t, 'commit', '-q', '-m', 'oops');
  let r = blockingIds(t);
  assert.ok(r.ids.includes('guard:forbidden-tracked'), r.ids);
  git(t, 'rm', '-q', '--cached', '.env');
  fs.rmSync(path.join(t.proj, '.env'));
  write(t, 'test/order.test.js', "import { test } from 'node:test';\ntest('保存する', () => {});\ntest.skip('空なら断る', () => {});\n");
  // 基準も手で緩め、PC の控えも消す（いちばん悪いやり方）。本流（main）の基準と比べれば分かる
  const bp = path.join(t.proj, '.tenukiban', 'baseline.json');
  const b = JSON.parse(fs.readFileSync(bp, 'utf8'));
  b.tests.current.skipped = 1; b.tests.best.skipped = 1;
  fs.writeFileSync(bp, JSON.stringify(b));
  git(t, 'add', '-A');
  git(t, 'commit', '-q', '-m', 'skip');
  fs.rmSync(t.home, { recursive: true, force: true });
  r = blockingIds(t, ['--base', 'main']);
  assert.equal(r.status, 1);
  assert.ok(r.ids.includes('guard:test-weakened-diff'), r.ids);
  assert.ok(r.ids.includes('guard:baseline-tampered'), r.ids);
  assert.ok(r.ids.includes('guard:anchor-missing'), r.ids);
  assert.ok(r.j.findings.some((f) => f.id === 'guard:baseline-tampered' && /git の main/.test(f.where)));
  fs.rmSync(path.join(t.proj, 'test', 'order.test.js'));
  git(t, 'add', '-A');
  git(t, 'commit', '-q', '-m', 'rm test');
  assert.ok(blockingIds(t, ['--base', 'main']).ids.includes('guard:test-deleted-diff'));
});
