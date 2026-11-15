// 結果を日本語の文にする（画面・フック・JSON）。
import { explainFor, askText } from './explain.mjs';

const GROUP = { honesty: '正直さ', debt: '歯止め', tests: '試験の数', guard: '見張りの穴' };
const METRIC = {
  bigFiles: '大きすぎるファイル', asAny: 'as any', tsIgnore: '@ts-ignore', lintDisable: 'eslint-disable', emptyCatch: '空の catch', todo: 'TODO・FIXME', waivers: '免除コメント',
  testFiles: '試験のファイル', testCases: '試験の数', skipped: '飛ばした試験',
};
const fmt = (v) => (v === undefined ? '-' : Number.isInteger(v) ? String(v) : v.toFixed(2));

function findingBlock(f, n) {
  const e = explainFor(f.id);
  const lines = [];
  lines.push(`[${n}] ${f.isNew === false ? '' : '🆕 '}${e.title}（${GROUP[f.group] || f.group}）`);
  if (f.where) lines.push(`    場所: ${f.where}`);
  if (f.text) lines.push(`      > ${f.text}`);
  if (f.detail) lines.push(`      ${f.detail}`);
  lines.push(`    かんたんに言うと: ${e.plain}`);
  lines.push('    AIにこう頼んでください:');
  lines.push(`      「${askText(f.id, f.where)}」`);
  return lines.join('\n');
}

export function renderCheck(r, { all = false } = {}) {
  const out = [];
  out.push('━━ 手抜き番 ━━');
  out.push(`対象: ${r.root}${r.files ? `（${r.files} ファイルを読みました）` : ''}`);
  if (r.usage) { out.push(''); out.push(`⚠ ${r.usage}`); }
  const blocking = r.findings.filter((f) => f.blocking);
  const known = r.findings.filter((f) => !f.blocking);
  if (r.exit === 1) out.push(`結果: ❌ 止めました — 直してほしいものが ${blocking.length} 件あります`);
  else if (r.exit === 0) out.push(`結果: ✅ 通りました — 前より悪くなっていません${known.length ? `（前からあるもの ${known.length} 件は記録済み）` : ''}`);
  if (blocking.length) {
    out.push('');
    out.push(`▼ 直してほしいもの（${blocking.length} 件）`);
    blocking.forEach((f, i) => out.push(findingBlock(f, i + 1)));
  }
  if (r.notices?.length) {
    out.push('');
    out.push('▼ お知らせ（止めはしません）');
    for (const f of r.notices) out.push(`  ・${explainFor(f.id).title}：${f.where}。${explainFor(f.id).plain}`);
  }
  if (known.length) {
    out.push('');
    out.push(`▼ 前からあるもの（基準に記録済み・今回は止めません）: ${known.length} 件`);
    if (all) known.forEach((f, i) => out.push(findingBlock(f, i + 1)));
    else {
      const byTitle = {};
      for (const f of known) { const t = explainFor(f.id).title; byTitle[t] = (byTitle[t] || 0) + 1; }
      for (const [t, n] of Object.entries(byTitle)) out.push(`  ・${t}: ${n} 件`);
      out.push('  （1件ずつの場所と頼み方は `tenukiban check --all` で出ます。少しずつ直すと、直した分が新しい基準になります）');
    }
  }
  const rows = [...(r.rows.tests || []), ...(r.rows.debt || [])];
  if (rows.length) {
    out.push('');
    out.push('▼ 数の記録（今 / 基準 / 過去最良）');
    for (const x of rows) {
      if (r.rows.debt?.includes(x) && !x.now && !x.base && !x.best) continue; // 0 のままの負債は出さない（読みやすさのため）
      const mark = x.newMetric ? '新しい項目' : x.worse ? '❌ 悪化' : x.now === x.base ? '維持' : '✅ 改善';
      out.push(`  ・${METRIC[x.metric] || x.metric}: ${fmt(x.now)}（基準 ${fmt(x.base)}・過去最良 ${fmt(x.best)}）${mark}`);
    }
    if (r.rows.honesty) out.push(`  ・正直さの指摘: ${r.rows.honesty.now}（基準 ${r.rows.honesty.base}・規則 ${r.rows.honesty.rules} 本）`);
  }
  if (r.history?.length) {
    const l = r.history.at(-1);
    out.push('');
    out.push(`▼ 緩めた記録: ${r.history.length} 件（最新: ${l.at} ${l.gate}.${l.metric}「${l.reason}」${l.interactive === false ? '・画面の確認なし' : ''}）`);
  }
  if (r.info?.length) {
    out.push('');
    out.push('▼ 確かめていないこと');
    for (const s of r.info) out.push(`  ・${s}`);
  }
  if (r.wrote) { out.push(''); out.push('良くなった所を新しい基準にしました（過去最良は戻りません）。'); }
  out.push('');
  out.push('※ 手抜き番が見つけられるのは一部です（同僚の試験では、見ていない書き方の約半分）。通っても「完璧」ではありません。');
  return out.join('\n');
}

/** Claude Code のフック用。AI に返す短い文。 */
export function renderHook(r) {
  const blocking = r.findings.filter((f) => f.blocking);
  const out = [];
  if (r.usage) out.push(`[手抜き番] ${r.usage}`);
  if (blocking.length) {
    out.push(`[手抜き番] ❌ 止めました。直してほしいものが ${blocking.length} 件あります。コードの方を直してください（試験・基準・設定・フックを変えて通さないこと）。`);
    blocking.slice(0, 10).forEach((f, i) => {
      const e = explainFor(f.id);
      out.push(`${i + 1}. ${e.title} — ${f.where}${f.text ? `\n   > ${f.text}` : ''}${f.detail ? `\n   ${f.detail}` : ''}\n   直し方: ${askText(f.id, f.where)}`);
    });
    if (blocking.length > 10) out.push(`ほか ${blocking.length - 10} 件。\`tenukiban check\` で全部出ます。`);
  }
  return out.join('\n');
}

export function renderInit(r) {
  const out = ['━━ 手抜き番：はじめる ━━', `対象: ${r.root}`];
  if (r.usage) { out.push(`⚠ ${r.usage}`); return out.join('\n'); }
  out.push('', '書いたもの:');
  for (const w of r.wrote) out.push(`  ・${w}`);
  if (r.skipped.length) { out.push('書かなかったもの:'); for (const s of r.skipped) out.push(`  ・${s}`); }
  const s = r.summary;
  out.push('', `今の状態を「基準」にしました（${s.files} ファイル）。これより悪くなると止めます。`);
  out.push(`  試験のファイル ${s.tests.testFiles}・試験の数 ${s.tests.testCases}・飛ばした試験 ${s.tests.skipped}`);
  out.push(`  正直さの指摘 ${s.honesty} 件・見張りの穴 ${s.guards} 件（どちらも「前からあるもの」として記録。止めません）`);
  if (r.knownFindings.length) {
    out.push('', '▼ 前からあるもの（いつか直すとよいもの。最初の 10 件）');
    r.knownFindings.slice(0, 10).forEach((f) => out.push(`  ・${explainFor(f.id).title}：${f.where}`));
  }
  if (s.info.length) { out.push('', '▼ 確かめていないこと'); for (const x of s.info) out.push(`  ・${x}`); }
  out.push('', '次にすること:');
  out.push('  1. .tenukiban/ の「AIへの指示」を CLAUDE.md（Codex なら AGENTS.md）に貼る（init --apply なら自動で貼ります）');
  out.push('  2. Claude Code なら、.tenukiban/ の「フックの例」を .claude/settings.json に入れる');
  out.push('  3. AI に作業させたら `tenukiban check`。基準を緩めるのは人だけ（`tenukiban accept --reason "理由"`）');
  return out.join('\n');
}

export function renderAccept(r) {
  const out = ['━━ 手抜き番：理由を残して緩める ━━'];
  if (r.plan.length) { out.push('内容:'); for (const p of r.plan) out.push(`  ${p}`); }
  if (r.usage) out.push(`⚠ ${r.usage}`);
  if (r.wrote) out.push('', '基準を書き直し、理由を記録しました。これから毎回の check で「緩めた記録」として表示されます。');
  return out.join('\n');
}
