// Python 対応・納品前の報告書・フックの形（公式の説明どおりか）の試験。2026-11-14 手抜き番で足した。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { scanText, countTests, findWeakenedTests, pyGateNoop, pyGateSections, isTestPath } from '../lib/scan-core.mjs';
import { hookSettings } from '../lib/templates.mjs';
import { measure, defaultRules } from './ラベル付き/測る.mjs';
import { CASES as SELF } from './ラベル付き/自作.mjs';
import { CASES as UNSEEN } from './ラベル付き/見ていない.mjs';
import { tmp, run, write, ROOT } from './helpers.mjs';

const rules = defaultRules();
const ids = (src, opts) => scanText(src, rules, opts).map((h) => h.rule.id);

test('ラベル付きの片：記録した数字のまま（自作＝規則の前に作った・甘い数字／見ていない＝規則の後に作り、直していない）', () => {
  const s = measure(SELF, rules);
  assert.deepEqual(s.by.Python, { bad: 24, caught: 24, ok: 17, fa: 0 });
  assert.deepEqual(s.by['JS・TS・HTML'], { bad: 9, caught: 5, ok: 8, fa: 0 });
  const u = measure(UNSEEN, rules);
  assert.deepEqual(u.by.Python, { bad: 20, caught: 10, ok: 14, fa: 1 });
  assert.deepEqual(u.by['JS・TS・HTML'], { bad: 6, caught: 3, ok: 4, fa: 0 });
});

test('Python の規則は .py にだけ当たる（JS や拡張子なしには当てない＝同僚の数字は変わらない）', () => {
  const src = 'try:\n    save()\nexcept:\n    pass\n';
  assert.ok(ids(src, { ext: '.py' }).includes('py-except-pass'));
  assert.deepEqual(ids(src, { ext: '.js' }), []);
  assert.deepEqual(ids(src), []);
  // 理由のコメントがあれば止めない
  assert.deepEqual(ids('try:\n    os.remove(p)\nexcept FileNotFoundError:\n    pass  # 無ければそれでよい\n', { ext: '.py' }), []);
  // 免除コメントは Python の # でも効く
  assert.deepEqual(ids('def is_admin(u):\n    return True  # tenukiban-allow: 試験用の偽物\n', { ext: '.py' }), []);
});

test('Python の試験の数・飛ばす印（skipif は条件付きなので数えない）', () => {
  const c = countTests('import pytest\n@pytest.mark.skip\ndef test_a():\n    pass\nasync def test_b():\n    pass\n@pytest.mark.skipif(sys.platform == "win32", reason="x")\ndef test_c():\n    pass\nclass T(unittest.TestCase):\n    @unittest.skip("x")\n    def test_d(self):\n        self.skipTest("y")\n', 'tests/test_a.py');
  assert.equal(c.cases, 4);
  assert.deepEqual(c.skippedLines, [2, 11, 13]);
  for (const f of ['tests/helpers.py', 'test_api.py', 'app/api_test.py', 'conftest.py']) assert.ok(isTestPath(f), f);
  for (const f of ['app/testing_utils.py', 'src/contest.py']) assert.equal(isTestPath(f), false, f);
  const diff = '+++ b/tests/test_pay.py\n@@ -3 +3,2 @@\n+@pytest.mark.xfail\n+def test_pay():\n';
  assert.deepEqual(findWeakenedTests(diff).map((w) => [w.file, w.line]), [['tests/test_pay.py', 3]]);
});

test('Python の試験の設定：失敗を隠す・試験を外す設定を見つけ、普通の設定は止めない', () => {
  const tox = '[tox]\nenvlist = py311\n[testenv]\ndeps = pytest\ncommands =\n    - pytest\n';
  assert.match(pyGateNoop('tox.ini', tox)[0].reason, /「-」/);
  assert.deepEqual(pyGateNoop('tox.ini', '[testenv]\ncommands = pytest -q\n'), []);
  const pp = '[project]\nname = "x"\ndependencies = ["requests"]\n[tool.pytest.ini_options]\naddopts = "-q -k \'not slow\'"\n[tool.coverage.report]\nfail_under = 0\n';
  assert.deepEqual(pyGateNoop('pyproject.toml', pp).map((n) => n.section), ['tool.pytest.ini_options', 'tool.coverage.report']);
  assert.deepEqual(Object.keys(pyGateSections('pyproject.toml', pp)), ['tool.pytest.ini_options', 'tool.coverage.report']);
  assert.deepEqual(pyGateNoop('setup.cfg', '[aliases]\ntest = echo ok\n').map((n) => n.key), ['test']);
});

function pyProject(t) {
  write(t, 'pyproject.toml', '[project]\nname = "sample"\ndependencies = ["requests"]\n\n[tool.pytest.ini_options]\naddopts = "-q"\ntestpaths = ["tests"]\n');
  write(t, 'app/orders.py', 'def save_order(db, order):\n    db.insert(order)\n    db.commit()\n    return {"ok": True}\n');
  write(t, 'tests/test_orders.py', 'def test_save():\n    assert save_order(FakeDb(), {"id": 1})["ok"] is True\n\ndef test_empty():\n    assert total([]) == 0\n');
}

test('命令：Python の案件で、握りつぶし・試験を飛ばす・設定を緩める、を止め、依存の追加は止めない', () => {
  const t = tmp();
  pyProject(t);
  assert.equal(run(t, ['init']).status, 0);
  assert.equal(run(t, ['check']).status, 0);
  // 依存を足すだけ（試験の段落は同じ）→ 通す
  write(t, 'pyproject.toml', '[project]\nname = "sample"\ndependencies = ["requests", "httpx"]\n\n[tool.pytest.ini_options]\naddopts = "-q"\ntestpaths = ["tests"]\n');
  assert.equal(run(t, ['check']).status, 0, run(t, ['check']).stdout);
  // except: pass を足す → 止める
  write(t, 'app/sync.py', 'def sync():\n    try:\n        push()\n    except Exception:\n        pass\n');
  let r = run(t, ['check']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /エラーを黙って捨てている/);
  fs.rmSync(path.join(t.proj, 'app', 'sync.py'));
  // 試験に skip を足す → 止める
  write(t, 'tests/test_orders.py', 'import pytest\n\n@pytest.mark.skip(reason="あとで")\ndef test_save():\n    assert save_order(FakeDb(), {"id": 1})["ok"] is True\n\ndef test_empty():\n    assert total([]) == 0\n');
  r = run(t, ['check']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /試験を飛ばす印/);
  write(t, 'tests/test_orders.py', 'def test_save():\n    assert save_order(FakeDb(), {"id": 1})["ok"] is True\n\ndef test_empty():\n    assert total([]) == 0\n');
  assert.equal(run(t, ['check']).status, 0);
  // pytest の設定で試験を外す → 止める（書き換え＋何もしない設定）
  write(t, 'pyproject.toml', '[project]\nname = "sample"\ndependencies = ["requests", "httpx"]\n\n[tool.pytest.ini_options]\naddopts = "-q --deselect tests/test_orders.py::test_save"\ntestpaths = ["tests"]\n');
  r = run(t, ['check']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Python の試験・点検の設定が書き換えられた/);
  assert.match(r.stdout, /試験の一部を外す指定/);
});

test('命令：tox の「- pytest」（失敗しても成功）を止める', () => {
  const t = tmp();
  pyProject(t);
  write(t, 'tox.ini', '[tox]\nenvlist = py311\n\n[testenv]\ndeps = pytest\ncommands = pytest\n');
  assert.equal(run(t, ['init']).status, 0);
  write(t, 'tox.ini', '[tox]\nenvlist = py311\n\n[testenv]\ndeps = pytest\ncommands = - pytest\n');
  const r = run(t, ['check']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /tox の命令の頭に「-」/);
});

test('納品前の手抜きチェック報告書：読むだけで基準を書き換えず、結論・数・緩めた記録・言えないことを書く', () => {
  const t = tmp();
  pyProject(t);
  assert.equal(run(t, ['init']).status, 0);
  const bl = path.join(t.proj, '.tenukiban', 'baseline.json');
  const before = fs.readFileSync(bl, 'utf8');
  const out = path.join(t.proj, '報告書.md');
  let r = run(t, ['report', '--out', out, '--project', '架空の受注案件A']);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  let md = fs.readFileSync(out, 'utf8');
  assert.match(md, /^# 納品前の手抜きチェック報告書/);
  assert.match(md, /架空の受注案件A/);
  assert.match(md, /手抜き番の確かめを通りました/);
  assert.match(md, /「問題がない」「安全」という意味ではありません/);
  assert.match(md, /人が基準を緩めた記録（0 件）/);
  assert.match(md, /sha256：[0-9a-f]{64}/);
  assert.equal(fs.readFileSync(bl, 'utf8'), before);
  write(t, 'app/pay.py', 'def charge(card, amount):\n    return {"ok": True}\n');
  r = run(t, ['report', '--out', out]);
  assert.equal(r.status, 1);
  md = fs.readFileSync(out, 'utf8');
  assert.match(md, /止める物が 1 件ありました/);
  assert.match(md, /app\/pay\.py/);
  assert.equal(fs.readFileSync(bl, 'utf8'), before);
});

test('フックの見本は、公式の説明（code.claude.com/docs/en/hooks・permissions）の形に合っている', () => {
  const dir = path.join(ROOT, 'templates');
  const all = ['claude-settings.例.json', 'claude-settings.編集のたび.例.json'].map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  all.push(hookSettings('npx tenukiban'));
  for (const j of all) {
    // Stop には matcher が無い（書いても無視される）。timeout は秒。
    for (const g of j.hooks.Stop) { assert.equal(g.matcher, undefined); for (const h of g.hooks) { assert.equal(h.type, 'command'); assert.ok(Number.isInteger(h.timeout) && h.timeout > 0 && h.timeout <= 600); } }
    for (const g of j.hooks.PostToolUse || []) assert.equal(g.matcher, 'Edit|Write');
    for (const d of j.permissions.deny) {
      assert.doesNotMatch(d, /^Write\(/, 'Write(path) の規則は当たらない。Edit(path) を使う');
      assert.doesNotMatch(d, /MultiEdit/);
      assert.match(d, /^(Bash|PowerShell|Edit)\(.+\)$/);
    }
    assert.ok(j.permissions.deny.includes('Edit(/.tenukiban/**)'));
  }
});
