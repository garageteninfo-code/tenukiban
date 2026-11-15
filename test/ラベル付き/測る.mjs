// ラベル付きの片を測る。「手抜き番がこの片に文句を言うか」＝ 正直さの規則に当たる、
// または（試験のファイルの片なら）試験を飛ばす印を数える。
//   node test/ラベル付き/測る.mjs      → 組ごと・言語ごとの表と、外れた片の一覧を出す
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../../lib/config.mjs';
import { loadRules } from '../../lib/honesty.mjs';
import { scanText, countTests } from '../../lib/scan-core.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export function flagged(c, rules) {
  const ext = '.' + c.ext;
  const file = c.test ? `tests/test_case${ext}` : `src/case${ext}`;
  if (scanText(c.code + '\n', rules, { isTest: !!c.test, ext }).length) return true;
  if (c.test && countTests(c.code, file).skipped > 0) return true;
  return false;
}

export function measure(cases, rules) {
  const by = {};
  const misses = [], falseAlarms = [];
  for (const c of cases) {
    const lang = c.ext === 'py' ? 'Python' : 'JS・TS・HTML';
    const b = (by[lang] ||= { bad: 0, caught: 0, ok: 0, fa: 0 });
    const hit = flagged(c, rules);
    if (c.label === 'bad') { b.bad++; if (hit) b.caught++; else misses.push(c.id); }
    else { b.ok++; if (hit) { b.fa++; falseAlarms.push(c.id); } }
  }
  return { by, misses, falseAlarms };
}

export const defaultRules = () => loadRules(loadConfig({ root: HERE }));

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rules = defaultRules();
  for (const set of ['自作', '見ていない']) {
    let mod;
    try { mod = await import(`./${set}.mjs`); } catch { console.log(`${set}: まだありません`); continue; }
    const r = measure(mod.CASES, rules);
    console.log(`\n== ${set} ==`);
    for (const [lang, b] of Object.entries(r.by)) console.log(`${lang}: 捕まえた ${b.caught}/${b.bad}（${Math.round(100 * b.caught / b.bad)}%）・誤って止めた ${b.fa}/${b.ok}（${Math.round(100 * b.fa / b.ok)}%）`);
    console.log(`見逃し: ${r.misses.join(' ') || 'なし'}`);
    console.log(`誤検知: ${r.falseAlarms.join(' ') || 'なし'}`);
  }
}
