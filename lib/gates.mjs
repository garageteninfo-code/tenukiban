// 各関門の「測る」部分（同僚の 歯止め/改良/lib/gates.mjs の写し。debt の拡張子を設定の extensions に合わせた所だけ変えた）。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { listFiles, toRel, isTestFile } from './config.mjs';

// ---------------- debt（負債の数） ----------------
// 元の debt-budget.mjs: packages/ 以下の .ts/.tsx だけ・指標 3 つを中に書き込み。
// ここでは指標を設定（正規表現）から取り、JS も数える。大きなファイルの数（bigFiles）だけは組み込み。
export function measureDebt(cfg) {
  const d = cfg.debt;
  const files = listFiles(cfg, { extensions: d.extensions || cfg.extensions }).filter((f) => !isTestFile(cfg, toRel(cfg._root, f)));
  const metrics = d.metrics.map((m) => ({ ...m, re: new RegExp(m.pattern, (m.flags || '').replace('g', '') + 'g') }));
  const out = { bigFiles: 0 };
  for (const m of metrics) out[m.id] = 0;
  let totalLines = 0;
  const where = {};
  for (const f of files) {
    const rel = toRel(cfg._root, f);
    const src = fs.readFileSync(f, 'utf8');
    const lines = src.split('\n').length;
    totalLines += lines;
    if (lines > d.bigFileLines && !d.dataOnly.some((p) => rel.includes(p))) { out.bigFiles++; (where.bigFiles ||= []).push(`${rel} (${lines}行)`); }
    for (const m of metrics) {
      const n = (src.match(m.re) || []).length;
      if (n) { out[m.id] += n; (where[m.id] ||= []).push(`${rel} (${n})`); }
    }
  }
  const directions = Object.fromEntries(Object.keys(out).map((k) => [k, 'lower']));
  return { files: files.length, totalLines, values: out, directions, where };
}

// ---------------- coverage（試験で通った割合） ----------------
// 元の作り：決まったフォルダで node --test を決め打ちで走らせ、出力の表を読む。
// ここでは (1) 既にある要約ファイル（lcov.info / coverage-summary.json / node の出力）を読む、
// または (2) 設定の command を走らせてその出力を読む。どちらも行・分岐・関数の 3 つ。
export function parseCoverage(text, hint = '') {
  if (/\.info$/i.test(hint) || /^SF:/m.test(text)) {
    let LF = 0, LH = 0, BRF = 0, BRH = 0, FNF = 0, FNH = 0;
    for (const m of text.matchAll(/^(LF|LH|BRF|BRH|FNF|FNH):(\d+)/gm)) {
      const v = Number(m[2]);
      ({ LF: () => (LF += v), LH: () => (LH += v), BRF: () => (BRF += v), BRH: () => (BRH += v), FNF: () => (FNF += v), FNH: () => (FNH += v) })[m[1]]();
    }
    if (!LF) return null;
    const pct = (h, f) => (f ? +(100 * h / f).toFixed(2) : 100);
    return { line: pct(LH, LF), branch: pct(BRH, BRF), funcs: pct(FNH, FNF) };
  }
  const t = text.trim();
  if (t.startsWith('{')) {
    const j = JSON.parse(t);
    if (j.total?.lines) return { line: j.total.lines.pct, branch: j.total.branches.pct, funcs: j.total.functions.pct };
    return null;
  }
  const m = text.match(/all files\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)\s*\|/);
  return m ? { line: Number(m[1]), branch: Number(m[2]), funcs: Number(m[3]) } : null;
}

export function measureCoverage(cfg) {
  const c = cfg.coverage;
  if (!c) throw Object.assign(new Error('設定に coverage がありません（summaryFile か command を書いてください）。'), { usage: true });
  let text, hint = '';
  if (c.command) {
    const [cmd, ...args] = c.command;
    if (c.summaryFile) fs.mkdirSync(path.dirname(path.resolve(cfg._root, c.summaryFile)), { recursive: true }); // 出力先が無いと node は書けない
    const r = spawnSync(cmd === 'node' ? process.execPath : cmd, args, { cwd: cfg._root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.error) throw Object.assign(new Error(`command を走らせられませんでした: ${r.error.message}`), { usage: true });
    text = (r.stdout || '') + (r.stderr || '');
    const fail = text.match(/^ℹ fail (\d+)$/m);
    if (fail && Number(fail[1]) > 0) {
      const names = [...new Set([...text.matchAll(/^✖ (.+)$/gm)].map((x) => x[1]))].slice(0, 20);
      throw Object.assign(new Error(`試験が ${fail[1]} 件失敗しています（割合以前の問題）。\n` + names.map((n) => '  ✖ ' + n).join('\n')), { gateFail: true });
    }
    if (c.summaryFile) {
      const f = path.resolve(cfg._root, c.summaryFile);
      if (!fs.existsSync(f)) throw Object.assign(new Error(`command は終わりましたが、要約ファイル ${c.summaryFile} ができていません。末尾の出力:\n${text.split('\n').slice(-15).join('\n')}`), { gateFail: true });
      text = fs.readFileSync(f, 'utf8'); hint = c.summaryFile;
    }
  } else if (c.summaryFile) {
    const f = path.resolve(cfg._root, c.summaryFile);
    if (!fs.existsSync(f)) throw Object.assign(new Error(`カバレッジの要約ファイルがありません: ${c.summaryFile}（先に試験を走らせてください）`), { gateFail: true });
    text = fs.readFileSync(f, 'utf8'); hint = f;
  } else throw Object.assign(new Error('coverage に summaryFile か command が要ります。'), { usage: true });
  const v = parseCoverage(text, hint);
  if (!v) throw Object.assign(new Error('カバレッジの数字を読めませんでした（形式が違う・0 行）。黙って通さず止めます。'), { gateFail: true });
  return { values: v, directions: { line: 'higher', branch: 'higher', funcs: 'higher' }, slack: c.slack ?? 0.3 };
}

// ---------------- api（API が試験で呼ばれているか） ----------------
// 元の api-coverage.mjs の数え方（メソッドと段数を一致させる・:id は 1 段だけ）を引き継ぎ、
// 定義と呼び出しの見つけ方を設定の正規表現（名前つきの組 method / path）にした。
export const API_DEFAULTS = {
  defPatterns: [
    '\\b(?:app|router|r|api|route|routes|[a-z]\\w*Router)\\.(?<method>get|post|put|patch|delete|all)\\(\\s*([\'"`])(?<path>/[^\'"`]*)\\2',
    'req\\.method\\s*===\\s*[\'"](?<method>[A-Z]+)[\'"]\\s*&&\\s*[\\w.]*pathname\\s*===\\s*[\'"](?<path>/[^\'"]+)[\'"]',
    '[\\w.]*pathname\\s*===\\s*[\'"](?<path>/api/[^\'"]+)[\'"]',
  ],
  callPatterns: [
    '\\.\\s*(?<method>get|post|put|patch|delete)\\(\\s*([\'"`])(?<path>[^\'"`]*/api/[^\'"`]*)\\2',
    'fetch\\(\\s*([\'"`])(?<path>[^\'"`]*/api/[^\'"`]*)\\1(?:\\s*,\\s*\\{[^}]*method:\\s*[\'"](?<method>[A-Za-z]+)[\'"])?',
  ],
};

const segs = (p) => p.split('/').filter(Boolean);
function routeMatch(defPath, callPath) {
  const a = segs(defPath), b = segs(callPath);
  if (a.length !== b.length && !(a[a.length - 1] === '*' && b.length >= a.length - 1)) return false;
  for (let i = 0; i < a.length; i++) {
    const s = a[i], t = b[i] ?? '';
    if (s === '*') return true;
    if (s.startsWith(':')) { if (!t) return false; continue; }
    if (s !== t) return false;
  }
  return true;
}

export function measureApi(cfg) {
  const a = { ...API_DEFAULTS, ...(cfg.api || {}) };
  const files = listFiles(cfg, { extensions: ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx'] });
  const defs = [], calls = [];
  const seen = new Set();
  const cut = (p) => { const i = p.indexOf('/api/'); return (i < 0 ? p : p.slice(i)).split('?')[0].replace(/\$\{[^}]*\}/g, 'x'); };
  for (const f of files) {
    const rel = toRel(cfg._root, f);
    const src = fs.readFileSync(f, 'utf8');
    const test = isTestFile(cfg, rel);
    for (const p of test ? a.callPatterns : a.defPatterns) {
      const re = new RegExp(p, 'g');
      let m;
      while ((m = re.exec(src))) {
        const method = (m.groups?.method || 'ANY').toUpperCase();
        const pth = m.groups?.path;
        if (!pth) continue;
        if (test) calls.push({ method, path: cut(pth) });
        else {
          if (/^https?:/.test(pth)) continue;
          // 同じファイル・同じ道で、メソッド付きの定義があれば「ANY」は数えない
          const k = `${pth} ${rel}`;
          if (seen.has(`${method} ${k}`) || (method === 'ANY' && [...seen].some((s) => s.endsWith(` ${k}`)))) continue;
          seen.add(`${method} ${k}`);
          defs.push({ file: rel, method, path: pth });
        }
      }
    }
  }
  const same = (d, c) => c.method === 'ANY' || d.method === 'ALL' || d.method === 'ANY' || c.method === d.method;
  const untested = [];
  let tested = 0;
  for (const d of defs) {
    const forms = d.path.startsWith('/api/') ? [d.path] : [d.path, '/api' + d.path];
    if (calls.some((c) => same(d, c) && forms.some((p) => routeMatch(p, c.path)))) tested++; else untested.push(d);
  }
  return { values: { untested: untested.length }, info: { total: defs.length, tested }, untested, directions: { untested: 'lower' } };
}
