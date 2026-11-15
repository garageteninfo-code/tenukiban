// 手抜き番の本体：check（確かめる）・init（始める）・accept（理由を残して緩める）。
// 画面への表示は report.mjs。ここは「何が見つかったか」を組み立てるだけ。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadConfig, listFiles, toRel, CONFIG_NAME, DEFAULTS } from './config.mjs';
import { parseBaseline, serializeBaseline, compare, update, tamperCheck } from './ratchet.mjs';
import { measureDebt, measureCoverage } from './gates.mjs';
import { runHonesty } from './honesty.mjs';
import { measureTests, snapshotGuards, compareGuards, gitInfo, baselineAt, guardKnownKeys } from './guards.mjs';
import { idForRoot, readAnchor, writeAnchor } from './anchor.mjs';
import { explainFor } from './explain.mjs';
import { snippetText, hookSettings } from './templates.mjs';

const today = (now) => now.toISOString().slice(0, 10);

export function measureAll(cfg) {
  const files = listFiles(cfg);
  return {
    files: files.length,
    debt: measureDebt(cfg),
    honesty: runHonesty(cfg, files),
    tests: measureTests(cfg, files),
    guards: snapshotGuards(cfg),
  };
}

const honestyDirs = (counts, section) => Object.fromEntries([...new Set([...Object.keys(counts), ...Object.keys(section?.current || {})])].map((k) => [k, 'lower']));
const uniqSorted = (a) => [...new Set(a)].sort();

function readBaselineSafe(file) {
  if (!fs.existsSync(file)) return { text: null, data: null };
  const text = fs.readFileSync(file, 'utf8');
  try { return { text, data: parseBaseline(text, '基準ファイル') }; } catch (e) { return { text, data: null, error: e.message }; }
}

function collectAnchors(cfg, { baseline, baselineText, gitState, base, compareTo, useHome }) {
  const anchors = [], info = [], findings = [];
  const rel = toRel(cfg._root, path.resolve(cfg._root, cfg.baselineFile));
  if (useHome) {
    const id = baseline?.id || idForRoot(cfg._root);
    const text = readAnchor(id);
    if (text) anchors.push({ name: 'PC の控え', text });
    else if (baseline) findings.push({ group: 'guard', id: 'guard:anchor-missing', where: 'PC の控え（ホームの .tenukiban）', blocking: true, isNew: true });
  } else info.push('PC の控えとは比べていません（CI、または設定で止めています）。');
  if (gitState.isRepo) {
    const head = baselineAt(cfg._root, 'HEAD', rel);
    if (head && head !== baselineText) anchors.push({ name: 'git の HEAD', text: head });
    if (base) {
      const b = baselineAt(cfg._root, base, rel);
      if (b) anchors.push({ name: `git の ${base}`, text: b });
      else info.push(`git の ${base} に基準ファイルが無いので、本流とは比べていません。`);
    }
  }
  if (compareTo) {
    const f = path.resolve(compareTo);
    if (fs.existsSync(f)) anchors.push({ name: path.basename(f), text: fs.readFileSync(f, 'utf8') });
    else info.push(`--compare-to のファイルがありません: ${compareTo}`);
  }
  return { anchors, info, findings };
}

function tamperFindings(baseline, anchors, m) {
  const out = [];
  const gates = { debt: m.debt.directions, tests: m.tests.directions, honesty: {} };
  for (const a of anchors) {
    let ref;
    try { ref = parseBaseline(a.text, a.name); } catch (e) { out.push({ group: 'guard', id: 'guard:baseline-tampered', where: `${a.name}が読めません`, blocking: true, isNew: true }); continue; }
    const problems = tamperCheck(baseline, ref, gates, { zeroGates: ['honesty'] });
    if (ref.id && baseline.id !== ref.id) problems.push('基準の id が書き換えられています。');
    for (const p of problems) out.push({ group: 'guard', id: 'guard:baseline-tampered', where: `${a.name}と比べて：${p}`, blocking: true, isNew: true, anchor: a.name });
  }
  return out;
}

/** 確かめる。write: true なら、通ったときに基準を引き締める（良くなった所を新しい基準にする）。 */
export function runCheck({ root, configPath, base = null, compareTo = null, ci = false, write = true, now = new Date() }) {
  const cfg = loadConfig({ root, configPath });
  const baselinePath = path.resolve(cfg._root, cfg.baselineFile);
  const result = { root: cfg._root, files: 0, findings: [], notices: [], info: [], rows: {}, history: [], exit: 0, wrote: false, usage: null };
  const { text: baselineText, data: baseline, error } = readBaselineSafe(baselinePath);
  if (error) {
    result.findings.push({ group: 'guard', id: 'guard:baseline-tampered', where: `基準ファイルが壊れています（${error}）`, blocking: true, isNew: true });
    result.exit = 1;
    return result;
  }
  const useHome = !ci && cfg.guards.homeAnchor !== false;
  const gitState = gitInfo(cfg._root);
  const an = collectAnchors(cfg, { baseline, baselineText, gitState, base, compareTo, useHome });
  result.info.push(...an.info);
  if (!baseline) {
    if (an.anchors.length) {
      result.findings.push({ group: 'guard', id: 'guard:baseline-missing', where: `${cfg.baselineFile}（控え: ${an.anchors.map((a) => a.name).join('・')}）`, blocking: true, isNew: true });
      result.exit = 1;
    } else {
      result.usage = 'まだ見張りを始めていません。先に `tenukiban init` を実行してください（基準なしで「問題なし」とは言いません）。';
      result.exit = 2;
    }
    return result;
  }
  result.findings.push(...an.findings);

  const m = measureAll(cfg);
  result.files = m.files;
  if (m.files < cfg.minFiles) {
    result.usage = `読めたファイルが ${m.files} 件でした。設定の include / extensions を確かめてください（0 件で「問題なし」とは言いません）。`;
    result.exit = 2;
    return result;
  }

  // 歯止め：負債の数
  const cd = compare(m.debt.values, baseline.debt, { directions: m.debt.directions, gateOn: cfg.debt.gateOn });
  result.rows.debt = cd.rows;
  for (const r of cd.rows) if (r.worse) result.findings.push({ group: 'debt', id: `debt:${r.metric}`, where: (m.debt.where[r.metric] || []).slice(0, 3).join('、'), detail: `${r.base} → ${r.now}`, blocking: true, isNew: true });

  // 歯止め：試験の数
  const ct = compare(m.tests.values, baseline.tests, { directions: m.tests.directions });
  result.rows.tests = ct.rows;
  for (const r of ct.rows) {
    if (!r.worse) continue;
    let where = `${r.base} → ${r.now}`;
    if (r.metric === 'testFiles') { const gone = (baseline.tests?.files || []).filter((f) => !m.tests.where.testFiles.includes(f)); if (gone.length) where += `。消えたファイル: ${gone.slice(0, 5).join('、')}`; }
    if (r.metric === 'skipped') where += `。場所: ${m.tests.where.skipped.slice(0, 5).join('、')}`;
    result.findings.push({ group: 'tests', id: `tests:${r.metric}`, where, blocking: true, isNew: true });
  }

  // 正直さ（ファイルごと・規則ごとの数を歯止めにする。基準に無い = 0）
  const dirs = honestyDirs(m.honesty.counts, baseline.honesty);
  const ch = compare(m.honesty.counts, baseline.honesty, { directions: dirs, zero: true });
  const worseKeys = new Set(ch.rows.filter((r) => r.worse).map((r) => r.metric));
  const known = new Set(baseline.honesty?.known || []);
  const newInKey = {};
  for (const v of m.honesty.violations) if (!known.has(v.fp)) newInKey[v.key] = (newInKey[v.key] || 0) + 1;
  for (const v of m.honesty.violations) {
    const isNew = !known.has(v.fp);
    const blocking = worseKeys.has(v.key) && (isNew || !newInKey[v.key]);
    result.findings.push({ group: 'honesty', id: v.rule, kind: v.kind, where: `${v.file} ${v.line}行目`, file: v.file, line: v.line, text: v.text, blocking, isNew });
  }
  result.rows.honesty = { now: m.honesty.violations.length, base: Object.values(baseline.honesty?.current || {}).reduce((a, b) => a + b, 0), rules: m.honesty.rules };

  // 見張りの穴
  const g = compareGuards(baseline.guards, m.guards, { gitState, known: baseline.guards?.known || [], base, cfg });
  result.findings.push(...g.findings);
  result.notices.push(...g.notices);
  result.info.push(...g.info);

  // 控えと比べる（基準の書き換え）
  result.findings.push(...tamperFindings(baseline, an.anchors, m));

  // 任意：カバレッジ（設定にあるときだけ）
  if (cfg.coverage) {
    try {
      const c = measureCoverage(cfg);
      const cc = compare(c.values, baseline.coverage, { directions: c.directions, slack: c.slack });
      result.rows.coverage = cc.rows;
      for (const r of cc.rows) if (r.worse) result.findings.push({ group: 'debt', id: 'coverage', where: `${r.metric} ${r.base}% → ${r.now}%`, blocking: true, isNew: true });
      m.coverage = c;
    } catch (e) {
      result.findings.push({ group: 'debt', id: 'coverage', where: e.message, blocking: true, isNew: true });
    }
  }

  // 画面の確認なしで緩めた記録
  result.history = baseline.history || [];
  const nonInt = result.history.filter((h) => h.interactive === false);
  if (nonInt.length) {
    const l = nonInt.at(-1);
    result.notices.push({ group: 'guard', id: 'guard:accept-noninteractive', where: `${nonInt.length} 件。最新: ${l.at} ${l.gate}.${l.metric}「${l.reason}」`, blocking: false });
  }

  result.exit = result.findings.some((f) => f.blocking) ? 1 : 0;

  // 通ったら引き締める（良くなった所が新しい基準になる。過去最良は戻らない）
  if (result.exit === 0 && write && !ci) {
    const next = { ...baseline };
    next.debt = update(m.debt.values, baseline.debt, { directions: m.debt.directions, gate: 'debt' }).section;
    next.tests = { ...update(m.tests.values, baseline.tests, { directions: m.tests.directions, gate: 'tests' }).section, files: m.tests.where.testFiles };
    next.honesty = { ...update(m.honesty.counts, baseline.honesty, { directions: dirs, zero: true, gate: 'honesty' }).section, known: uniqSorted(m.honesty.violations.map((v) => v.fp)) };
    if (m.coverage) next.coverage = update(m.coverage.values, baseline.coverage, { directions: m.coverage.directions, gate: 'coverage' }).section;
    const strip = (b) => JSON.stringify({ ...b, updatedAt: undefined });
    if (strip(next) !== strip(baseline)) {
      next.updatedAt = today(now);
      const text = serializeBaseline(next);
      fs.writeFileSync(baselinePath, text);
      if (useHome) writeAnchor(cfg._root, next.id, text);
      result.wrote = true;
    }
  }
  return result;
}

/** 始める：設定・基準・控え・AI への指示の見本を書く。 */
export function runInit({ root, configPath, apply = false, reason = null, cliCommand, ci = false, now = new Date() }) {
  const absRoot = path.resolve(root);
  const result = { root: absRoot, exit: 0, usage: null, wrote: [], skipped: [], summary: null, knownFindings: [] };
  const cfgFile = configPath ? path.resolve(configPath) : path.join(absRoot, CONFIG_NAME);
  let cfg = loadConfig({ root: absRoot, configPath: fs.existsSync(cfgFile) ? cfgFile : undefined });
  const baselinePath = path.resolve(absRoot, cfg.baselineFile);
  if (fs.existsSync(baselinePath)) {
    result.usage = `もう見張りを始めています（${cfg.baselineFile} があります）。基準を緩めたいときは、人が \`tenukiban accept --reason "理由"\` を使ってください。`;
    result.exit = 2;
    return result;
  }
  const oldId = idForRoot(absRoot);
  if (!ci && oldId && readAnchor(oldId) && !reason) {
    result.usage = 'このフォルダは前に見張っていた記録（PC の控え）があります。基準ファイルが消された可能性があります。git などで基準ファイルを戻すか、本当に最初からやり直すなら `tenukiban init --reason "やり直す理由"` としてください（記録に残ります）。';
    result.exit = 2;
    return result;
  }

  // 1) 設定
  if (!fs.existsSync(cfgFile)) {
    const starter = {
      _説明: '手抜き番の設定。分からなければ触らなくて大丈夫です。変えると手抜き番が「設定が変わった」と止めます（人が accept で記録します）。',
      include: DEFAULTS.include,
      exclude: DEFAULTS.exclude,
      honesty: { disable: [] },
    };
    fs.writeFileSync(cfgFile, JSON.stringify(starter, null, 2) + '\n');
    result.wrote.push(path.relative(absRoot, cfgFile));
  } else result.skipped.push(`${path.relative(absRoot, cfgFile)}（既にあるので、そのまま使います）`);

  // 2) AI への指示とフックの見本
  const dir = path.join(absRoot, '.tenukiban');
  fs.mkdirSync(dir, { recursive: true });
  const snippet = snippetText(cliCommand);
  const hook = JSON.stringify(hookSettings(cliCommand), null, 2) + '\n';
  fs.writeFileSync(path.join(dir, 'AIへの指示（CLAUDE.md・AGENTS.md に貼る）.md'), snippet);
  fs.writeFileSync(path.join(dir, 'Claude Code のフックの例（.claude-settings.json）.json'), hook);
  result.wrote.push('.tenukiban/AIへの指示（CLAUDE.md・AGENTS.md に貼る）.md', '.tenukiban/Claude Code のフックの例（.claude-settings.json）.json');
  if (apply) {
    for (const f of ['CLAUDE.md', 'AGENTS.md']) {
      const p = path.join(absRoot, f);
      const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
      if (/tenukiban:start/.test(cur)) { result.skipped.push(`${f}（手抜き番の段落が既にあります）`); continue; }
      fs.writeFileSync(p, (cur ? cur.replace(/\s*$/, '\n\n') : '') + snippet);
      result.wrote.push(`${f}（${cur ? '末尾に追記' : '新規'}）`);
    }
    const sp = path.join(absRoot, '.claude', 'settings.json');
    if (!fs.existsSync(sp)) {
      fs.mkdirSync(path.dirname(sp), { recursive: true });
      fs.writeFileSync(sp, hook);
      result.wrote.push('.claude/settings.json（新規・フック）');
    } else if (/tenukiban/i.test(fs.readFileSync(sp, 'utf8'))) result.skipped.push('.claude/settings.json（手抜き番のフックが既にあります）');
    else result.skipped.push('.claude/settings.json（既にあるので書き換えていません。.tenukiban/ のフックの例を見て、人が足してください）');
  }

  // 3) 測って、今を基準にする
  cfg = loadConfig({ root: absRoot, configPath: cfgFile });
  const m = measureAll(cfg);
  if (m.files < cfg.minFiles) {
    result.usage = `読めたファイルが ${m.files} 件でした。設定の include / extensions を確かめてください（基準は作っていません）。`;
    result.exit = 2;
    return result;
  }
  const gitState = gitInfo(absRoot);
  const g = compareGuards(null, m.guards, { gitState, known: [], cfg });
  result.knownFindings = [...g.findings, ...m.honesty.violations.map((v) => ({ group: 'honesty', id: v.rule, where: `${v.file} ${v.line}行目`, text: v.text }))];
  const dirs = honestyDirs(m.honesty.counts, null);
  const baseline = {
    id: crypto.randomBytes(8).toString('hex'),
    createdAt: today(now),
    debt: update(m.debt.values, undefined, { directions: m.debt.directions, gate: 'debt' }).section,
    tests: { ...update(m.tests.values, undefined, { directions: m.tests.directions, gate: 'tests' }).section, files: m.tests.where.testFiles },
    honesty: { ...update(m.honesty.counts, undefined, { directions: dirs, zero: true, gate: 'honesty' }).section, known: uniqSorted(m.honesty.violations.map((v) => v.fp)) },
    guards: { ...m.guards, known: guardKnownKeys(g.findings) },
    history: reason ? [{ at: today(now), gate: 'init', metric: 'やり直し', from: oldId, to: null, reason, interactive: null }] : [],
  };
  const text = serializeBaseline(baseline);
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, text);
  if (!ci) writeAnchor(absRoot, baseline.id, text);
  result.wrote.push(cfg.baselineFile);
  result.summary = { files: m.files, debt: m.debt.values, tests: m.tests.values, honesty: m.honesty.violations.length, guards: g.findings.length, info: g.info };
  return result;
}

/**
 * 理由を残して緩める。今の状態を新しい基準にし、悪くなった所は history に記録する。
 * confirm(plan) が false を返したら何も書かない。
 */
export async function runAccept({ root, configPath, reason, interactive, confirm = async () => true, base = null, ci = false, now = new Date() }) {
  const cfg = loadConfig({ root, configPath });
  const baselinePath = path.resolve(cfg._root, cfg.baselineFile);
  const result = { root: cfg._root, exit: 0, usage: null, plan: [], wrote: false };
  if (!reason || reason.trim().length < 4) {
    result.usage = '緩める理由を --reason "…" で書いてください（4 文字以上。記録に残り、毎回表示されます）。';
    result.exit = 2;
    return result;
  }
  const { text: baselineText, data: fileBaseline, error } = readBaselineSafe(baselinePath);
  const useHome = !ci && cfg.guards.homeAnchor !== false;
  const anchorText = useHome ? readAnchor(fileBaseline?.id || idForRoot(cfg._root)) : null;
  let baseline = fileBaseline;
  const m = measureAll(cfg);
  // 基準ファイルが壊れている・書き換えられている → 手抜き番が最後に書いた控えから始める（書き換えをそのまま受け入れない）
  if (anchorText) {
    const anchor = parseBaseline(anchorText, 'PC の控え');
    const tampered = !baseline || tamperFindings(baseline, [{ name: 'PC の控え', text: anchorText }], m).length > 0;
    if (tampered) { baseline = anchor; result.plan.push('基準ファイルが書き換えられていた（または壊れていた）ので、PC の控えから始めます。'); }
  }
  if (!baseline) {
    result.usage = error ? `基準ファイルが読めません（${error}）。git などで戻してください。` : 'まだ見張りを始めていません。先に `tenukiban init` を実行してください。';
    result.exit = 2;
    return result;
  }
  void baselineText;
  const at = today(now);
  const debtU = update(m.debt.values, baseline.debt, { directions: m.debt.directions, reason, gate: 'debt', interactive, now });
  const testsU = update(m.tests.values, baseline.tests, { directions: m.tests.directions, reason, gate: 'tests', interactive, now });
  const dirs = honestyDirs(m.honesty.counts, baseline.honesty);
  const honU = update(m.honesty.counts, baseline.honesty, { directions: dirs, zero: true, reason, gate: 'honesty', interactive, now });
  const gitState = gitInfo(cfg._root);
  const g = compareGuards(baseline.guards, m.guards, { gitState, known: baseline.guards?.known || [], base, cfg });
  const newGuards = { ...m.guards, known: uniqSorted(guardKnownKeys(g.findings)) };
  const loosened = [...debtU.loosened, ...testsU.loosened, ...honU.loosened];
  const guardChanges = [...g.findings, ...g.notices].filter((f) => f.blocking || f.id === 'guard:deps-changed');
  if (JSON.stringify(newGuards) !== JSON.stringify(baseline.guards)) {
    const entry = { at, gate: 'guards', metric: '記録', from: '前の記録', to: '今の状態', reason, detail: guardChanges.map((f) => `${explainFor(f.id).title}：${f.where}`).slice(0, 10) };
    if (interactive !== null) entry.interactive = interactive;
    loosened.push(entry);
  }
  for (const l of loosened) {
    if (l.gate === 'guards') { result.plan.push(`見張りの記録を今の状態にします${l.detail.length ? '：' : '。'}`); for (const d of l.detail) result.plan.push(`  ・${d}`); }
    else if (l.gate !== 'anchor') result.plan.push(`${l.gate}.${l.metric} を ${l.from} → ${l.to} に緩めます`);
  }
  if (useHome && !anchorText) {
    loosened.push({ at, gate: 'anchor', metric: 'PC の控え', from: null, to: '作り直し', reason, interactive });
    result.plan.push('PC の控えが無いので、今の基準から作り直します（別の PC に移した・控えが消えた）。');
  }
  if (!loosened.length && !result.plan.length) {
    result.plan.push('緩めるものはありません（悪くなった所がありません）。');
    return result;
  }
  if (!(await confirm(result.plan))) {
    result.usage = 'やめました。何も書いていません。';
    result.exit = 1;
    return result;
  }
  const next = {
    ...baseline,
    debt: debtU.section,
    tests: { ...testsU.section, files: m.tests.where.testFiles },
    honesty: { ...honU.section, known: uniqSorted(m.honesty.violations.map((v) => v.fp)) },
    guards: newGuards,
    history: [...(baseline.history || []), ...loosened],
    updatedAt: at,
  };
  const text = serializeBaseline(next);
  fs.mkdirSync(path.dirname(baselinePath), { recursive: true });
  fs.writeFileSync(baselinePath, text);
  if (useHome) writeAnchor(cfg._root, next.id, text);
  result.wrote = true;
  result.loosened = loosened;
  return result;
}
