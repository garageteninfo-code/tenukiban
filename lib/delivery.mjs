// 「納品前の手抜きチェック報告書」（Markdown）を作る。下請けの会社が、納品物に添えて元請け・親会社に渡す想定。
// 中身は check と同じ確かめを「読むだけ」で走らせた結果（基準も控えも書き換えない）。
// ⚠ この報告書は「手抜き番が見つけられる型が、この時点で見つからなかった／見つかった」記録であって、
//   品質の保証・安全の証明ではない。報告書の中にもそう書く。
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { runCheck } from './engine.mjs';
import { loadConfig } from './config.mjs';
import { explainFor } from './explain.mjs';
import { git, gitInfo } from './guards.mjs';

const PKG = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'));
const GROUP = { honesty: '正直さ', debt: '歯止め（負債の数）', tests: '試験の数', guard: '見張りの穴' };
const cell = (s) => String(s ?? '').replace(/\|/g, '｜').replace(/\r?\n/g, ' ');

/** 報告書の Markdown と、結果（exit など）を返す。 */
export function buildDeliveryReport({ root, configPath, base = null, now = new Date(), project = null }) {
  const r = runCheck({ root, configPath, base, write: false, now });
  const cfg = loadConfig({ root, configPath });
  const bpath = path.resolve(cfg._root, cfg.baselineFile);
  const btext = fs.existsSync(bpath) ? fs.readFileSync(bpath, 'utf8') : null;
  let bl = null;
  try { bl = btext ? JSON.parse(btext) : null; } catch { bl = null; } // 壊れていれば r.findings に出ている
  const g = gitInfo(cfg._root);
  let commit = 'git を使っていないフォルダです';
  if (g.isRepo) {
    const head = git(cfg._root, ['rev-parse', '--short=12', 'HEAD']);
    const dirty = git(cfg._root, ['status', '--porcelain']);
    commit = head.ok ? `${head.stdout.trim()}${dirty.stdout.trim() ? '（まだ記録していない変更あり）' : ''}` : 'まだ commit がありません';
  }
  const blocking = r.findings.filter((f) => f.blocking);
  const known = r.findings.filter((f) => !f.blocking);
  const L = [];
  L.push('# 納品前の手抜きチェック報告書', '');
  L.push(`- 作成日時：${now.toISOString().replace('T', ' ').slice(0, 16)}（UTC）`);
  L.push(`- 対象：${cell(project || path.basename(cfg._root))}`);
  L.push(`- git の記録：${cell(commit)}${base ? `（比べた本流：${cell(base)}）` : ''}`);
  L.push(`- 道具：手抜き番（tenukiban）${PKG.version}・正直さの規則 ${r.rows.honesty?.rules ?? '-'} 本`);
  L.push(`- 見張りを始めた日：${bl?.createdAt || '（基準がありません）'}　基準の最終更新：${bl?.updatedAt || bl?.createdAt || '-'}`);
  L.push('');
  L.push('## 結論');
  if (r.usage) L.push('', `**確かめられませんでした。** ${r.usage}`);
  else if (r.exit === 0) L.push('', '**手抜き番の確かめを通りました**（前より悪くなった所・新しい「成功のふり」・見張りの穴は、手抜き番が見つけられる範囲では見つかりませんでした）。', '', '※「問題がない」「安全」という意味ではありません（下の「この報告書で言えないこと」）。');
  else L.push('', `**止める物が ${blocking.length} 件ありました。** 納品の前に直すか、直さない理由を下の記録に残してください。`);
  L.push('');
  L.push('## 数');
  L.push('', '| 項目 | 基準（過去） | 今 |', '|---|---|---|');
  L.push(`| 読んだファイル | - | ${r.files} |`);
  for (const row of r.rows.tests || []) L.push(`| 試験：${({ testFiles: '試験のファイル', testCases: '試験の数', skipped: '飛ばした試験' })[row.metric] || row.metric} | ${row.base ?? '-'} | ${row.now}${row.worse ? '（悪化）' : ''} |`);
  if (r.rows.honesty) L.push(`| 正直さの指摘（合計） | ${r.rows.honesty.base} | ${r.rows.honesty.now} |`);
  const note = Object.fromEntries([['bigFiles', `大きすぎるファイル（${cfg.debt.bigFileLines} 行超）`], ...cfg.debt.metrics.map((m) => [m.id, m.note || m.id])]);
  for (const row of r.rows.debt || []) L.push(`| 負債：${cell(note[row.metric] || row.metric)} | ${row.base ?? '-'} | ${row.now}${row.worse ? '（悪化）' : ''} |`);
  L.push('');
  L.push(`## 止めた物（${blocking.length} 件）`);
  if (!blocking.length) L.push('', 'なし。');
  else { L.push('', '| # | 種類 | 内容 | 場所 |', '|---|---|---|---|'); blocking.forEach((f, i) => L.push(`| ${i + 1} | ${GROUP[f.group] || f.group} | ${cell(explainFor(f.id).title)} | ${cell(f.where)}${f.detail ? `（${cell(f.detail)}）` : ''} |`)); }
  L.push('');
  L.push(`## 前からある物（${known.length} 件・止めていない）`);
  L.push('', known.length ? '見張りを始めた時点で既にあった物です。数が増えないことだけを見ています。' : 'なし。');
  if (known.length) { L.push('', '| 種類 | 内容 | 場所 |', '|---|---|---|'); for (const f of known.slice(0, 50)) L.push(`| ${GROUP[f.group] || f.group} | ${cell(explainFor(f.id).title)} | ${cell(f.where)} |`); if (known.length > 50) L.push(`| … | ほか ${known.length - 50} 件 | |`); }
  L.push('');
  L.push(`## 人が基準を緩めた記録（${r.history.length} 件）`);
  if (!r.history.length) L.push('', 'なし（見張りを始めてから、一度も基準を緩めていません）。');
  else { L.push('', '| 日付 | 何を | 前 → 後 | 理由 | 画面で確認 |', '|---|---|---|---|---|'); for (const h of r.history) L.push(`| ${h.at} | ${cell(`${h.gate}.${h.metric}`)} | ${cell(h.from)} → ${cell(h.to)} | ${cell(h.reason)} | ${h.interactive === false ? 'なし' : h.interactive === true ? 'あり' : '-'} |`); }
  L.push('');
  const notes = [...r.notices.map((n) => `${explainFor(n.id).title}：${n.where}`), ...r.info];
  L.push('## 確かめていないこと・お知らせ');
  L.push('', ...(notes.length ? notes.map((n) => `- ${n}`) : ['- なし']));
  L.push('');
  L.push('## この報告書で言えないこと（正直に）');
  L.push('', '- 手抜き番は、決まった型（成功のふり・エラーの握りつぶし・試験を飛ばす・見張りを外す など）を探すだけです。**見つからなくても、バグや手抜きが無いとは言えません。**');
  L.push('- 社内の試験（作った側が用意した片）では、規則を見ていない書き方のうち、JS・TS で約半分（18 件中 10 件）、Python で約半分（20 件中 10 件）を見つけ、正しいコードの約 7〜8%（12 件中 1 件・14 件中 1 件）を誤って指摘しました。第三者の片では測っていません。');
  L.push('- 動作が正しいか（仕様どおりか）は確かめていません。試験の中身が正しいかも分かりません（数と飛ばす印を見ているだけです）。');
  L.push('- 同じパソコンの上の基準と控えは、両方を同じように書き換えられると見抜けません。git の本流と比べた（--base）報告書の方が強い証拠になります。');
  L.push('- この報告書は署名ではありません。下の指紋は「同じ基準ファイルから作ったか」を見比べるためだけの物です。');
  L.push('');
  L.push('## 指紋');
  L.push('', `- 基準ファイル（${cell(cfg.baselineFile)}）の sha256：${btext ? crypto.createHash('sha256').update(btext.replace(/\r\n/g, '\n')).digest('hex') : '（ありません）'}`);
  L.push(`- 終了コード：${r.exit}（0 通過・1 止めた・2 確かめられない）`);
  L.push('');
  return { markdown: L.join('\n'), exit: r.exit, result: r };
}
