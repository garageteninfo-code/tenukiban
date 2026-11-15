// 歯止め（ラチェット）の芯。同僚の 歯止め/改良/lib/ratchet.mjs を写して、手抜き番用に 2 点だけ足した:
//   - zero: true の関門（正直さ）は「基準に無い項目 = 0」として比べる（新しいファイルの違反を「新しい指標」として素通りさせない）
//   - 緩めた記録に interactive（画面で人が確かめたか）を残す
//
// 守ること:
//   1. 基準より悪くなったら失敗。良くなったら基準を引き締める（自動）。
//   2. 過去最良（best）は良い方向にしか動かない。
//   3. 悪い方向の更新は理由（--reason）が無いと断る。緩めたら history に「いつ・何を・いくつから・いくつへ・なぜ」を残す。
//   4. 基準ファイルが消えたら失敗（緑にしない）。
//   5. 控え（PC の別の場所・git の本流）と比べ、理由の記録なしに緩んでいたら失敗。
import fs from 'node:fs';
import path from 'node:path';

export const VERSION = 1;

export function readBaselineFile(file) {
  if (!fs.existsSync(file)) return null;
  return parseBaseline(fs.readFileSync(file, 'utf8'), file);
}

export function parseBaseline(text, where = '基準') {
  let j;
  try { j = JSON.parse(text); } catch (e) { throw new Error(`${where} が JSON として読めません（書き換えられた可能性）: ${e.message}`); }
  if (!j || typeof j !== 'object') throw new Error(`${where} の形が不正です`);
  j.history ||= [];
  return j;
}

export function serializeBaseline(data) {
  const out = { version: VERSION, tool: 'tenukiban', ...data, _note: '手抜き番の基準。best は過去最良で良い方向にしか動かない。緩めた記録は history に残る。手で書き換えないこと（控えと比べて見つかります）。' };
  return JSON.stringify(out, null, 2) + '\n';
}

export function writeBaselineFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, serializeBaseline(data));
}

const better = (dir, a, b) => (dir === 'higher' ? Math.max(a, b) : Math.min(a, b));
export const isWorse = (dir, a, b, slack = 0) => (dir === 'higher' ? a < b - slack : a > b + slack);

/** 今の値を基準と比べる。zero: true なら基準に無い項目は 0 とみなす。 */
export function compare(current, section, { directions, slack = 0, gateOn = 'baseline', zero = false }) {
  const rows = [];
  let failed = false;
  const keys = new Set(Object.keys(directions));
  if (zero) for (const k of Object.keys(section?.current || {})) keys.add(k);
  for (const m of keys) {
    const dir = directions[m] || 'lower';
    const now = current[m] ?? (zero ? 0 : undefined);
    if (now === undefined) continue;
    let base = section?.current?.[m];
    let best = section?.best?.[m];
    if (zero) { base ??= 0; best ??= 0; }
    const against = gateOn === 'best' && best !== undefined ? best : base;
    const worse = against !== undefined && isWorse(dir, now, against, slack);
    const behindBest = best !== undefined && isWorse(dir, now, best, slack);
    if (worse) failed = true;
    rows.push({ metric: m, dir, now, base, best, worse, behindBest, newMetric: base === undefined });
  }
  return { rows, failed };
}

/**
 * 基準を更新する。引き締めは自由。緩めるのは reason があるときだけ。
 * zero: true なら 0 の項目は書かない（無い = 0）。
 */
export function update(current, section, { directions, reason, gate, zero = false, interactive = null, now = new Date() }) {
  const prevCur = section?.current || {};
  const prevBest = section?.best || {};
  const first = !section;
  const next = { current: zero ? {} : { ...prevCur }, best: { ...prevBest } };
  const refused = [], loosened = [];
  const keys = new Set(Object.keys(directions));
  if (zero) for (const k of Object.keys(prevCur)) keys.add(k);
  for (const m of keys) {
    const dir = directions[m] || 'lower';
    const v = current[m] ?? (zero ? 0 : undefined);
    if (v === undefined) continue;
    const old = prevCur[m] ?? (zero && !first ? 0 : undefined);
    if (old !== undefined && isWorse(dir, v, old)) {
      if (!reason) { refused.push(m); if (zero && old) next.current[m] = old; continue; }
      const entry = { at: now.toISOString().slice(0, 10), gate, metric: m, from: old, to: v, reason };
      if (interactive !== null) entry.interactive = interactive;
      loosened.push(entry);
    }
    if (!(zero && v === 0)) next.current[m] = v;
    const pb = prevBest[m] ?? (zero && !first ? 0 : undefined);
    const nb = pb === undefined ? v : better(dir, pb, v);
    if (zero && nb === 0) delete next.best[m]; else next.best[m] = nb;
  }
  return { section: next, refused, loosened };
}

/**
 * 控え（ref）と作業中の基準（work）を比べ、理由の記録なしに緩められていないかを見る。
 * @param {Record<string, Record<string,'lower'|'higher'>>} gates
 * @param {{zeroGates?: string[]}} opt  zeroGates の関門は「無い項目 = 0」
 */
export function tamperCheck(work, ref, gates, { zeroGates = [] } = {}) {
  const problems = [];
  if (!ref) return problems;
  if (!work) { problems.push('基準ファイルが消されています（控えにはあります）。'); return problems; }
  const refHist = new Set((ref.history || []).map((h) => JSON.stringify(h)));
  const newHist = (work.history || []).filter((h) => !refHist.has(JSON.stringify(h)));
  // history（緩めた記録）そのものを消していないか
  const workHist = new Set((work.history || []).map((h) => JSON.stringify(h)));
  const lostHist = (ref.history || []).filter((h) => !workHist.has(JSON.stringify(h)));
  if (lostHist.length) problems.push(`緩めた記録（history）が ${lostHist.length} 件消されています。`);
  for (const [gate, directions] of Object.entries(gates)) {
    const w = work[gate], r = ref[gate];
    if (!r) continue;
    const zero = zeroGates.includes(gate);
    if (!w) { problems.push(`${gate}: 控えにある基準が消されています。`); continue; }
    const keys = new Set([...Object.keys(directions), ...Object.keys(r.current || {}), ...Object.keys(r.best || {})]);
    for (const m of keys) {
      const dir = directions[m] || 'lower';
      let rb = r.best?.[m], wb = w.best?.[m];
      if (zero) { rb ??= 0; wb ??= 0; }
      if (rb !== undefined && (wb === undefined || isWorse(dir, wb, rb))) {
        problems.push(`${gate}.${m}: 過去最良が ${rb} から ${wb ?? '（削除）'} に書き換えられています（最良は良い方向にしか動きません）。`);
      }
      let rc = r.current?.[m], wc = w.current?.[m];
      if (zero) { rc ??= 0; wc ??= 0; }
      if (rc !== undefined && (wc === undefined || isWorse(dir, wc, rc))) {
        const why = newHist.find((h) => h.gate === gate && h.metric === m);
        if (!why) problems.push(`${gate}.${m}: 基準が ${rc} から ${wc ?? '（削除）'} に緩められていますが、理由の記録がありません。`);
      }
    }
  }
  // 見張りの記録（scripts・守るファイル・部品）は、等しいかどうかで見る
  if (ref.guards && JSON.stringify(work.guards || null) !== JSON.stringify(ref.guards)) {
    const why = newHist.find((h) => h.gate === 'guards');
    if (!why) problems.push('guards: 見張りの記録（確認の命令・守るファイル・部品）が、理由の記録なしに書き換えられています。');
  }
  return problems;
}
