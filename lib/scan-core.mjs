// 手抜き番の「中身を読むだけ」の部分。Node とブラウザ（web/index.html）の両方で同じコードを使う。
// ここでは fs・ネットワークなどは一切使わない（ブラウザ版に埋め込むため）。
//
// scanText は同僚の 改良/lib/honesty.mjs の scanText と同じ動き（写して、ファイルを読む部分だけ外した）。

// 後ろの「|(^|/)(test_…|…_test|conftest)\.py$」は 2026-11-14 に Python（pytest・unittest）のために足した。
export const DEFAULT_TEST_PATTERN = '(^|/)(test|tests|__tests__|spec|e2e)/|\\.(test|spec|itest|e2e)\\.[cm]?[jt]sx?$|(^|/)(test_[^/]*|[^/]*_test|conftest)\\.py$';
export const DEFAULT_WAIVERS = ['tenukiban-allow', 'hadome-allow', 'honesty-allow'];

export const lineOf = (text, index) => { let n = 1; for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++; return n; };
export const isTestPath = (rel, pattern = DEFAULT_TEST_PATTERN) => new RegExp(pattern).test(rel);

/** 規則ファイル（{rules:[...]} の配列）から、使える形の規則を作る。 */
export function compileRules(ruleSets, { disable = [] } = {}) {
  const off = new Set(disable);
  const ids = new Set();
  const out = [];
  for (const set of ruleSets) {
    for (const r of set.rules) {
      if (off.has(r.id)) continue;
      if (ids.has(r.id)) throw new Error(`規則の id が重複しています: ${r.id}`);
      ids.add(r.id);
      const flags = (r.flags || '').replace('g', '');
      out.push({
        ...r,
        _set: set.name,
        re: new RegExp(r.pattern, flags + (r.scope === 'file' ? 'g' : '')),
        nearRe: r.near ? new RegExp(r.near, flags) : null,
        notNearRe: r.notNear ? new RegExp(r.notNear, flags) : null,
        unlessRe: r.unless ? new RegExp(r.unless, flags) : null,
        win: r.window || [0, 0],
        _exts: r.exts ? new Set(r.exts.map((e) => e.toLowerCase())) : null,
      });
    }
  }
  return out;
}

/**
 * 1 ファイルの中身に規則を当てる。
 * ext（'.py' など）を渡すと、exts の付いた規則（Python 用など）はその拡張子のときだけ当てる。
 * ext を渡さないときは exts の付いた規則は当てない（同僚の片で測った数字が変わらないように）。
 */
export function scanText(text, rules, { waiverTokens = DEFAULT_WAIVERS, isTest = false, ext = null } = {}) {
  const fileExt = ext ? String(ext).toLowerCase() : null;
  const lines = text.split(/\r?\n/);
  const hits = [];
  const waived = (i) => waiverTokens.some((t) => (lines[i] || '').includes(t));
  const ctx = (i, [b, a]) => lines.slice(Math.max(0, i - b), i + a + 1).join('\n');
  const accept = (r, i) => {
    if (waived(i)) return false;
    if (r.unlessRe && r.unlessRe.test(lines[i])) return false;
    if (r.nearRe && !r.nearRe.test(ctx(i, r.win))) return false;
    if (r.notNearRe && r.notNearRe.test(ctx(i, r.win))) return false;
    return true;
  };
  for (const r of rules) {
    if (isTest && !r.includeTests) continue;
    if (r._exts && !(fileExt && r._exts.has(fileExt))) continue;
    if (r.scope === 'file') {
      r.re.lastIndex = 0;
      let m;
      const done = new Set();
      while ((m = r.re.exec(text))) {
        if (m[0] === '') { r.re.lastIndex++; continue; }
        const first = lineOf(text, m.index) - 1;
        const last = first + (m[0].match(/\n/g) || []).length;
        if (done.has(first)) continue;
        done.add(first);
        let ok = true;
        for (let i = first; i <= last; i++) if (waived(i)) ok = false;
        if (ok && accept(r, first)) hits.push({ rule: r, line: first + 1, text: lines[first].trim().slice(0, 140) });
      }
    } else {
      lines.forEach((l, i) => {
        if (r.re.test(l) && accept(r, i)) hits.push({ rule: r, line: i + 1, text: l.trim().slice(0, 140) });
      });
    }
  }
  return hits.sort((a, b) => a.line - b.line);
}

/** 短い指紋（FNV-1a 32bit を 2 回）。暗号ではない。同じ所の同じ指摘かどうかを見分けるだけ。 */
export function fingerprint(s) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

// ---------------- 試験（テスト）の数 ----------------
// 同僚の 改良版/scripts/self-repair/prompt.mjs の TEST_WEAKEN_RE と同じ（試験を飛ばす・絞る書き方）。
export const TEST_WEAKEN_RE = /\b(?:test|it|describe|suite|context)\.(?:skip|only|todo)\b|\bx(?:it|describe|test)\s*\(|\{\s*(?:skip|todo)\s*:\s*(?:true|['"`])/;
const TEST_CASE_RE = /\b(?:test|it)(?:\.(?:each\s*\([^)]*\)|concurrent|skip|only|todo))?\s*\(\s*['"`]/g;

// Python（pytest・unittest）の「試験を飛ばす・失敗を隠す」書き方（2026-11-14 手抜き番で足した）。
// skipif・skipIf は条件付きなので数えない（skipif(True …) のように必ず飛ばす形だけ数える）。
export const PY_TEST_WEAKEN_RE = /\bpytest\.mark\.(?:skip|xfail)\b|\bpytest\.(?:skip|xfail)\s*\(|@unittest\.(?:skip|expectedFailure)\b|\bunittest\.skip\s*\(|\bself\.skipTest\s*\(|\bpytest\.mark\.skipif\s*\(\s*(?:True|1)\b|@unittest\.skipIf\s*\(\s*(?:True|1)\b|@unittest\.skipUnless\s*\(\s*(?:False|0)\b|^\s*collect_ignore(?:_glob)?\s*=|\b__test__\s*=\s*False\b/;
const PY_TEST_CASE_RE = /^[ \t]*(?:async[ \t]+)?def[ \t]+test\w*[ \t]*\(/gm;
export const isPyFile = (file) => /\.py$/i.test(String(file || ''));
export const weakenReFor = (file) => (isPyFile(file) ? PY_TEST_WEAKEN_RE : TEST_WEAKEN_RE);

/** 試験のファイル 1 つの中の、試験の数と、飛ばす印の数。file（名前）が .py なら Python の書き方で数える。 */
export function countTests(text, file = '') {
  const py = isPyFile(file);
  const cases = (text.match(py ? PY_TEST_CASE_RE : TEST_CASE_RE) || []).length;
  const re = py ? PY_TEST_WEAKEN_RE : TEST_WEAKEN_RE;
  let skipped = 0;
  const skippedLines = [];
  text.split(/\r?\n/).forEach((l, i) => { if (re.test(l)) { skipped++; skippedLines.push(i + 1); } });
  return { cases, skipped, skippedLines };
}

/**
 * git diff -U0 の出力から、試験のファイルに足された「試験を飛ばす」行を探す。
 * 同僚の self-repair/prompt.mjs の findWeakenedTests と同じ考え方（試験ファイルの判定は設定の型を使う）。
 */
export function findWeakenedTests(diffText, testPattern = DEFAULT_TEST_PATTERN) {
  const hits = new Map();
  let file = null;
  let lineNo = 0;
  for (const line of String(diffText || '').split(/\r?\n/)) {
    if (line.startsWith('+++ ')) { file = line.replace(/^\+\+\+ (b\/)?/, '').replace(/^"|"$/g, ''); continue; }
    const hunk = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunk) { lineNo = Number(hunk[1]); continue; }
    if (!file || file === '/dev/null') continue;
    if (line.startsWith('+')) {
      if (isTestPath(file, testPattern) && weakenReFor(file).test(line.slice(1)) && !hits.has(file)) hits.set(file, { file, line: lineNo, text: line.slice(1).trim().slice(0, 140) });
      lineNo++;
    }
  }
  return [...hits.values()];
}

// ---------------- 確認の命令（package.json の scripts） ----------------
/** 何も確かめない命令なら、その理由を返す。普通の命令なら null。 */
export function noopReason(cmd) {
  const c = String(cmd ?? '').trim();
  if (!c) return '中身が空';
  if (/^(true|:|exit\s+0)$/i.test(c)) return `「${c}」は何もせずに成功します`;
  if (/^echo\b/i.test(c) && !/&&|\|\||;|\bexit\s+[1-9]/.test(c)) return '文字を出すだけで、何も確かめていません';
  if (/\|\|\s*(true|:|exit\s+0|echo\b[^&|;]*)\s*$/i.test(c)) return '「|| true」などで、失敗しても成功に変えています';
  if (/;\s*(exit\s+0|true)\s*$/i.test(c)) return '最後に「exit 0」などで、失敗しても成功に変えています';
  if (/--passWithNoTests\b/.test(c)) return '試験が 1 つも無くても成功する指定（--passWithNoTests）が付いています';
  if (/^node\s+-e\s+(['"])\s*(process\.exit\(\s*0?\s*\))?;?\s*\1$/i.test(c)) return '何もしない node の命令です';
  return null;
}

export const DEFAULT_GATE_SCRIPTS = ['test', 'verify', 'check', 'lint', 'typecheck', 'build', 'ci'];

// ---------------- 秘密のファイル ----------------
const SECRET_FILE_RE = /(^|\/)(\.env(\.[^/]*)?|secrets?\.json|credentials\.json|service-account[^/]*\.json|id_(rsa|ed25519|ecdsa)|[^/]*\.(pem|key|p12|pfx|keystore|jks))$/i;
const SECRET_FILE_OK_RE = /(^|\/)\.env\.(example|sample|template|dist)$|\.(example|sample)\.json$/i;
export const isSecretFile = (rel) => SECRET_FILE_RE.test(rel) && !SECRET_FILE_OK_RE.test(rel);

// ---------------- Python の試験の設定（pyproject.toml・tox.ini・setup.cfg） ----------------
// 2026-11-14 手抜き番で足した。ファイル全体ではなく「試験・点検に関係する段落」だけを見る
// （pyproject.toml は依存の追加などでよく変わるので、全体を守ると止まりすぎるため）。
export const PY_GATE_FILES = ['pyproject.toml', 'tox.ini', 'setup.cfg'];
const PY_GATE_SECTION = {
  'pyproject.toml': /^tool\.(?:pytest|coverage|mypy|ruff|pyright|pylint|flake8|tox|poe|pdm\.scripts|taskipy)(?:\.|$)|^tool\.hatch\.envs\.[^.]+\.scripts$/,
  'tox.ini': /^(?:tox|testenv.*|pytest|coverage:.*|flake8|mypy.*|gh-actions)$/,
  'setup.cfg': /^(?:tool:pytest|coverage:.*|flake8|mypy.*|aliases)$/,
};

/** 試験・点検に関係する段落だけを取り出す。{ "段落名": "中身（コメント・空行を除く）" } */
export function pyGateSections(name, text) {
  const want = PY_GATE_SECTION[name];
  const out = {};
  if (!want) return out;
  let cur = null;
  for (const raw of String(text || '').split(/\r?\n/)) {
    const h = raw.match(/^\s*\[{1,2}\s*([^\]]+?)\s*\]{1,2}\s*(?:[#;].*)?$/);
    if (h) { const sec = h[1].replace(/["']/g, ''); cur = want.test(sec) ? sec : null; if (cur && !(cur in out)) out[cur] = ''; continue; }
    if (!cur) continue;
    if (/^\s*([#;].*)?$/.test(raw)) continue;
    out[cur] += raw.replace(/\s+$/, '') + '\n';
  }
  return out;
}

/** key = value（ini の続きの行・TOML の文字列や配列を含む）を素朴に読む。 */
function pyKeyValues(body) {
  const kv = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_.\-"']+)\s*[=:]\s*(.*)$/);
    if (m) kv.push([m[1].replace(/["']/g, '').toLowerCase(), m[2]]);
    else if (kv.length && /^\s+\S/.test(line)) kv[kv.length - 1][1] += '\n' + line.trim();
  }
  return kv;
}
function unquote(v) {
  const t = v.trim();
  if (/^\[/.test(t)) return [...t.matchAll(/["']([^"']*)["']/g)].map((x) => x[1]).join(' ');
  return t.replace(/^(?:"""|'''|"|')|(?:"""|'''|"|')$/g, '').trim();
}
const PY_SCRIPT_NAMES = /^(?:test|tests|check|lint|ci|verify|typecheck|cov|coverage)$/;

/**
 * 段落の中の「何も確かめない・失敗を隠す」設定を探す。[{ section, key, value, reason }]
 * package.json の noopReason と同じ考え方を、pytest・tox・coverage・各種の命令表に当てる。
 */
export function pyGateNoop(name, text) {
  const out = [];
  const push = (section, key, value, reason) => out.push({ section, key, value: String(value).trim().slice(0, 140), reason });
  for (const [sec, body] of Object.entries(pyGateSections(name, text))) {
    for (const [k, rawV] of pyKeyValues(body)) {
      const v = unquote(rawV);
      if (/pytest/.test(sec) && k === 'addopts') {
        if (/(?:^|\s)--(?:collect-only|co)\b/.test(v)) push(sec, k, v, '試験を集めるだけで、走らせない指定（--collect-only）です');
        if (/--deselect\b|(?:^|\s)--ignore(?:-glob)?[= ]/.test(v)) push(sec, k, v, '試験の一部を外す指定（--ignore・--deselect）です');
        if (/(?:^|\s)-k\s*["']?\s*not\b/.test(v)) push(sec, k, v, '名前で試験を外す指定（-k "not …"）です');
        if (/--continue-on-collection-errors\b/.test(v)) push(sec, k, v, '読み込めない試験があっても続ける指定です');
        if (/--cov-fail-under[= ]0(?:\.0+)?\b/.test(v)) push(sec, k, v, 'カバレッジの合格線が 0 です');
      }
      if (/coverage/.test(sec) && k === 'fail_under' && /^0(?:\.0+)?$/.test(v)) push(sec, k, v, 'カバレッジの合格線が 0 です');
      if (/^(?:tox|testenv)/.test(sec)) {
        if (k === 'ignore_outcome' && /^true$/i.test(v)) push(sec, k, v, 'tox の ignore_outcome = true で、試験が落ちても成功になります');
        if (k === 'ignore_errors' && /^true$/i.test(v)) push(sec, k, v, 'tox の ignore_errors = true で、失敗を無視します');
        if (k === 'commands') {
          const cmds = rawV.split('\n').map((c) => c.trim()).filter(Boolean);
          if (!cmds.length) push(sec, k, '', '中身が空');
          for (const c of cmds) {
            if (/^-\s*\S/.test(c)) push(sec, k, c, 'tox の命令の頭に「-」が付いていて、失敗しても成功になります');
            else if (/^python[0-9.]*\s+-c\s+(["'])\s*(?:pass)?\s*\1$/.test(c)) push(sec, k, c, '何もしない python の命令です');
            else { const why = noopReason(c); if (why) push(sec, k, c, why); }
          }
        }
      }
      if ((/^tool\.(?:poe|pdm\.scripts|taskipy|hatch)/.test(sec) || sec === 'aliases') && PY_SCRIPT_NAMES.test(k)) {
        const why = noopReason(v);
        if (why) push(sec, k, v, why);
      }
    }
  }
  return out;
}
