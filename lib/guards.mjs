// 見張りの穴（AI が見張りそのものを外して「通った」ことにする）を見つける。
// 考え方は同僚の 中継と自動修理/改良版/scripts/self-repair（関門の中身を空にする・試験を消す/飛ばす・
// 禁止のファイル・node_modules 経由の書き換え）から。あちらは「AI の修正を捨てる」一本道の中の歯止めで、
// ここでは、ふだん AI に書かせている作業フォルダを、いつでも外から確かめられる形にした。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { listFiles, toRel, isTestFile, globToRe } from './config.mjs';
import { countTests, noopReason, isSecretFile, findWeakenedTests, isTestPath, PY_GATE_FILES, pyGateSections, pyGateNoop } from './scan-core.mjs';

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex').slice(0, 24);
const normText = (s) => s.replace(/\r\n/g, '\n');

// ---------------- 試験（テスト）の数 ----------------
export function measureTests(cfg, files = listFiles(cfg)) {
  let testFiles = 0, testCases = 0, skipped = 0;
  const where = { skipped: [], testFiles: [] };
  for (const f of files) {
    const rel = toRel(cfg._root, f);
    if (!isTestFile(cfg, rel)) continue;
    if (!/\.([cm]?[jt]sx?|py)$/i.test(rel)) continue;
    testFiles++;
    where.testFiles.push(rel);
    const c = countTests(fs.readFileSync(f, 'utf8'), rel);
    testCases += c.cases;
    skipped += c.skipped;
    for (const l of c.skippedLines) where.skipped.push(`${rel} ${l}行目`);
  }
  return {
    values: { testFiles, testCases, skipped },
    directions: { testFiles: 'higher', testCases: 'higher', skipped: 'lower' },
    where,
  };
}

// ---------------- 記録（スナップショット） ----------------
function readPkgScripts(root, names) {
  const f = path.join(root, 'package.json');
  if (!fs.existsSync(f)) return null;
  let j;
  try { j = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return { _error: 'package.json が JSON として読めません' }; }
  const out = {};
  for (const n of names) if (j.scripts && Object.prototype.hasOwnProperty.call(j.scripts, n)) out[n] = String(j.scripts[n]);
  return out;
}

function listProtected(root, patterns) {
  const out = {};
  for (const p of patterns) {
    const i = p.lastIndexOf('/');
    const dir = i < 0 ? '' : p.slice(0, i);
    const re = globToRe(i < 0 ? p : p.slice(i + 1));
    let ents;
    try { ents = fs.readdirSync(path.join(root, dir), { withFileTypes: true }); } catch { continue; } // フォルダが無ければ守る物も無い
    for (const e of ents) {
      if (!e.isFile() || !re.test(e.name)) continue;
      const rel = dir ? `${dir}/${e.name}` : e.name;
      out[rel] = sha(normText(fs.readFileSync(path.join(root, rel), 'utf8')));
    }
  }
  return out;
}

function readMarkers(root, files) {
  const out = {};
  for (const f of [...files, '.claude/settings.json']) {
    const p = path.join(root, f);
    if (fs.existsSync(p)) out[f] = /tenukiban/i.test(fs.readFileSync(p, 'utf8'));
  }
  return out;
}

function lockHash(root) {
  for (const f of ['package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock']) {
    const p = path.join(root, f);
    if (fs.existsSync(p)) return `${f}:${sha(normText(fs.readFileSync(p, 'utf8')))}`;
  }
  return null;
}

/** node_modules の中身の指紋（部品ごと）。中身の読み書きはしない（読むだけ）。 */
export function nodeModulesPrint(root, maxFiles = 60000) {
  const nm = path.join(root, 'node_modules');
  if (!fs.existsSync(nm)) return null;
  const pkgs = {};
  let files = 0;
  let tooMany = false;
  const hashDir = (dir, h) => {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1)); } catch { return; } // 読めないフォルダは指紋に入れない
    for (const e of ents) {
      if (tooMany) return;
      const p = path.join(dir, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (e.name === '.cache') continue; hashDir(p, h); continue; }
      if (!e.isFile()) continue;
      if (++files > maxFiles) { tooMany = true; return; }
      h.update(toRel(nm, p) + '\0');
      try {
        const st = fs.statSync(p);
        h.update(String(st.size));
        if (st.size <= 2 * 1024 * 1024) h.update(fs.readFileSync(p));
      } catch { h.update('?'); } // 読めないファイルは「?」として指紋に入れる
    }
  };
  let top;
  try { top = fs.readdirSync(nm, { withFileTypes: true }); } catch { return null; }
  for (const e of top) {
    if (e.name.startsWith('.') || !e.isDirectory()) continue;
    const names = e.name.startsWith('@')
      ? fs.readdirSync(path.join(nm, e.name), { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => `${e.name}/${x.name}`)
      : [e.name];
    for (const n of names) {
      const h = crypto.createHash('sha256');
      hashDir(path.join(nm, n), h);
      pkgs[n] = h.digest('hex').slice(0, 16);
    }
  }
  if (tooMany) return { tooMany: true, maxFiles };
  return { lock: lockHash(root), files, pkgs };
}

/** Python の試験・点検の設定（pyproject.toml・tox.ini・setup.cfg の関係する段落だけ）の指紋と、何もしない設定。 */
export function pyGatesPrint(root) {
  const sections = {}, noop = [];
  let any = false;
  for (const name of PY_GATE_FILES) {
    const p = path.join(root, name);
    if (!fs.existsSync(p)) continue;
    any = true;
    const text = fs.readFileSync(p, 'utf8');
    for (const [sec, body] of Object.entries(pyGateSections(name, text))) sections[`${name} [${sec}]`] = sha(body);
    for (const n of pyGateNoop(name, text)) noop.push({ ...n, file: name });
  }
  return any ? { sections, noop } : null;
}

export function snapshotGuards(cfg) {
  const g = cfg.guards;
  return {
    scripts: readPkgScripts(cfg._root, g.gateScripts),
    protected: listProtected(cfg._root, g.protected),
    markers: readMarkers(cfg._root, g.markerFiles),
    pyGates: pyGatesPrint(cfg._root),
    nodeModules: g.nodeModules ? nodeModulesPrint(cfg._root, g.nodeModulesMaxFiles) : null,
  };
}

// ---------------- git ----------------
export function git(root, args) {
  const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  return { ok: !r.error && r.status === 0, stdout: r.stdout || '', stderr: r.stderr || '', missing: !!r.error };
}

export function gitInfo(root) {
  const r = git(root, ['rev-parse', '--is-inside-work-tree']);
  if (!r.ok || r.stdout.trim() !== 'true') return { isRepo: false, missing: r.missing };
  const ls = git(root, ['ls-files', '-z']);
  return { isRepo: true, tracked: ls.stdout.split('\0').filter(Boolean) };
}

/** git の ref（HEAD・origin/main など）にある基準ファイルを読む。無ければ null。 */
export function baselineAt(root, ref, rel) {
  const r = git(root, ['show', `${ref}:./${rel}`]);
  return r.ok ? r.stdout : null;
}

// ---------------- 比べる ----------------
/**
 * 記録（before）と今（now）を比べて、見張りの穴を探す。
 * @returns {{findings: object[], notices: object[], info: string[]}}
 */
export function compareGuards(before, now, { gitState, known = [], base = null, cfg }) {
  const findings = [], notices = [], info = [];
  const knownSet = new Set(known);
  const push = (id, where, extra = {}) => findings.push({ group: 'guard', id: `guard:${id}`, where, blocking: true, isNew: true, ...extra });

  // 1. 確認の命令（package.json の scripts）
  const bs = before?.scripts, ns = now.scripts;
  if (ns && ns._error) push('gate-script-changed', 'package.json', { detail: ns._error });
  else if (bs && !bs._error) {
    for (const [name, cmd] of Object.entries(bs)) {
      if (!ns || !(name in ns)) { push('gate-script-removed', `package.json の "${name}"`, { detail: `前: ${cmd}` }); continue; }
      if (ns[name] === cmd) continue;
      const why = noopReason(ns[name]);
      if (why) push('gate-script-noop', `package.json の "${name}"`, { detail: `前: ${cmd} → 今: ${ns[name]}（${why}）` });
      else push('gate-script-changed', `package.json の "${name}"`, { detail: `前: ${cmd} → 今: ${ns[name]}` });
    }
  }
  if (ns && !ns._error) {
    for (const [name, cmd] of Object.entries(ns)) {
      const why = noopReason(cmd);
      if (!why) continue;
      if (bs && bs[name] !== undefined && bs[name] !== cmd) continue; // 上で出した
      const key = `noop:${name}:${cmd}`;
      const f = { group: 'guard', id: 'guard:gate-script-noop', where: `package.json の "${name}"`, detail: `${cmd}（${why}）`, blocking: !knownSet.has(key), isNew: !knownSet.has(key), key };
      findings.push(f);
    }
  }

  // 2. 守るファイル・フック・指示書の決まり
  const bp = before?.protected || {}, np = now.protected || {};
  const bm = before?.markers || {}, nm = now.markers || {};
  const hookGone = bm['.claude/settings.json'] === true && nm['.claude/settings.json'] !== true;
  if (hookGone) push('hook-removed', '.claude/settings.json');
  for (const [f, h] of Object.entries(bp)) {
    if (f === '.claude/settings.json' && hookGone) continue;
    if (!(f in np)) push('protected-removed', f);
    else if (np[f] !== h) push('protected-changed', f);
  }
  if (before) for (const f of Object.keys(np)) if (!(f in bp)) push('protected-added', f);
  for (const [f, had] of Object.entries(bm)) {
    if (f === '.claude/settings.json') continue;
    if (had && nm[f] !== true) push('marker-removed', f);
  }

  // 2b. Python の試験・点検の設定（段落ごと）
  const bpy = before?.pyGates, npy = now.pyGates;
  if (npy) {
    for (const n of npy.noop) {
      const key = `pynoop:${n.file}:${n.section}:${n.key}:${n.value}`;
      findings.push({ group: 'guard', id: 'guard:py-gate-noop', where: `${n.file} の [${n.section}] ${n.key}`, detail: `${n.value}（${n.reason}）`, key, blocking: !knownSet.has(key), isNew: !knownSet.has(key) });
    }
  }
  if (before && before.pyGates === undefined && npy && Object.keys(npy.sections).length) info.push('Python の試験の設定（pyproject.toml など）の記録がまだありません（人が accept すると記録します）。');
  else if (before) {
    const bs3 = bpy?.sections || {}, ns3 = npy?.sections || {};
    for (const [k, h] of Object.entries(bs3)) {
      if (!(k in ns3)) push('py-gate-removed', k);
      else if (ns3[k] !== h) push('py-gate-changed', k);
    }
    for (const k of Object.keys(ns3)) if (!(k in bs3)) push('py-gate-changed', k, { detail: '新しく足された段落' });
  }

  // 3. git に入れてはいけないファイル
  if (gitState?.isRepo) {
    for (const t of gitState.tracked) {
      if (isSecretFile(t)) {
        const key = `forbidden-tracked:${t}`;
        findings.push({ group: 'guard', id: 'guard:forbidden-tracked', where: t, key, blocking: !knownSet.has(key), isNew: !knownSet.has(key) });
      }
    }
    const nmTracked = gitState.tracked.filter((t) => /(^|\/)node_modules\//.test(t));
    if (nmTracked.length) {
      const key = 'node-modules-tracked';
      findings.push({ group: 'guard', id: 'guard:node-modules-tracked', where: `${nmTracked.length} ファイル（例: ${nmTracked[0]}）`, key, blocking: !knownSet.has(key), isNew: !knownSet.has(key) });
    }
  } else info.push(gitState?.missing ? 'git が見つからないので、「秘密のファイルが git に入っていないか」は確かめていません。' : 'git を使っていないフォルダなので、「秘密のファイルが git に入っていないか」は確かめていません。');

  // 4. node_modules
  const bn = before?.nodeModules, nn = now.nodeModules;
  if (!cfg.guards.nodeModules) info.push('node_modules の確かめは設定で止めています。');
  else if (nn?.tooMany) info.push(`node_modules のファイルが ${nn.maxFiles} 件を超えたので、中身の書き換えは確かめていません。`);
  else if (!nn) { if (bn) info.push('node_modules がありません（消したか、まだ入れていない）。中身の書き換えは確かめていません。'); else info.push('node_modules が無いので、部品の書き換えは確かめていません。'); }
  else if (!bn || bn.tooMany) info.push('node_modules の記録がまだありません（人が accept すると記録します）。');
  else if (bn.lock !== nn.lock) notices.push({ group: 'guard', id: 'guard:deps-changed', where: '依存の固定ファイル（package-lock.json など）', blocking: false });
  else {
    const changed = [...new Set([...Object.keys(bn.pkgs), ...Object.keys(nn.pkgs)])].filter((k) => bn.pkgs[k] !== nn.pkgs[k]);
    if (changed.length) push('node-modules-edited', `node_modules/${changed.slice(0, 5).join('、node_modules/')}${changed.length > 5 ? ` ほか ${changed.length - 5} 個` : ''}`);
  }

  // 5. git の本流（--base）との差分
  if (base && gitState?.isRepo) {
    const diff = git(cfg._root, ['diff', '-U0', '--no-color', '--no-ext-diff', base]);
    if (!diff.ok) info.push(`--base ${base} と比べられませんでした（${diff.stderr.trim().split('\n')[0]}）。`);
    else {
      for (const w of findWeakenedTests(diff.stdout, cfg.testFilePattern)) push('test-weakened-diff', `${w.file} ${w.line}行目`, { text: w.text });
      const ns2 = git(cfg._root, ['diff', '--name-status', '--no-renames', base]);
      for (const l of ns2.stdout.split(/\r?\n/)) {
        const m = l.match(/^D\s+(.+)$/);
        if (m && isTestPath(m[1], cfg.testFilePattern)) push('test-deleted-diff', m[1]);
      }
    }
  }
  return { findings, notices, info };
}

/** 記録しておく「前からあるもの」の鍵（accept・init のときに使う）。 */
export function guardKnownKeys(findings) {
  return findings.filter((f) => f.key).map((f) => f.key);
}
