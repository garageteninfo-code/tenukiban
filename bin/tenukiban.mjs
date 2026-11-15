#!/usr/bin/env node
// 手抜き番（tenukiban）— AI が書いたコードが、黙って悪くなる・成功のふりをするのを止める。依存なし。
//
//   tenukiban check   [--all] [--json] [--hook] [--base <git の ref>] [--compare-to <基準ファイル>] [--no-write] [--ci]
//   tenukiban init    [--apply] [--reason "やり直す理由"]
//   tenukiban accept  --reason "なぜ緩めるか"   （人だけが使う。画面で「はい」と打つ）
//   tenukiban report  [--out 報告書.md] [--base <git の ref>] [--project "案件名"]   納品前の手抜きチェック報告書（読むだけ）
// 共通: --root <フォルダ>  --config <設定ファイル>
// 終了コード: 0 通過 / 1 止めた（悪化・違反） / 2 使い方・設定の誤り（0 件しか読めなかった、を含む）
// --hook（Claude Code のフック）: 止めたときは 2 を返し、理由を AI に渡す（標準エラー）。
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { runCheck, runInit, runAccept } from '../lib/engine.mjs';
import { renderCheck, renderHook, renderInit, renderAccept } from '../lib/report.mjs';
import { defaultCliCommand } from '../lib/templates.mjs';
import { buildDeliveryReport } from '../lib/delivery.mjs';

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const s = argv[i];
    if (s.startsWith('--')) {
      const k = s.slice(2);
      if (['reason', 'config', 'root', 'compare-to', 'base', 'cli', 'out', 'project'].includes(k)) a[k] = argv[++i];
      else a[k] = true;
    } else a._.push(s);
  }
  return a;
}

const HELP = `手抜き番（tenukiban）
  tenukiban init                始める（今の状態を基準にする。--apply で CLAUDE.md・AGENTS.md・フックも書く）
  tenukiban check               確かめる（前より悪くなった・成功のふり・見張りの穴を探す）
  tenukiban accept --reason ""  人が理由を残して基準を緩める（AI は使わない）
  tenukiban report --out 報告書.md   納品前の手抜きチェック報告書を作る（基準は書き換えない）
詳しくは 説明.md`;

function readHookInput() {
  if (process.stdin.isTTY) return {};
  try { const t = fs.readFileSync(0, 'utf8'); return t.trim() ? JSON.parse(t) : {}; } catch { return {}; } // フックの入力が無い・JSON でない → 空として続ける
}

/** フックが同じ失敗で何度も AI を止め続けないように、続けて止めた回数を数える（3 回で人に渡す）。 */
function hookCounter(root, failed) {
  const f = path.join(root, '.tenukiban', 'hook-state.json');
  let n = 0;
  try { n = JSON.parse(fs.readFileSync(f, 'utf8')).blocks || 0; } catch { n = 0; } // 初回は無い
  n = failed ? n + 1 : 0;
  try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify({ blocks: n }) + '\n'); } catch (e) { process.stderr.write(`[手抜き番] 回数の記録を書けません: ${e.message}\n`); }
  return n;
}

async function askYes(plan) {
  console.log('次の内容で基準を緩めます:');
  for (const p of plan) console.log(`  ${p}`);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans = await new Promise((res) => rl.question('よろしければ「はい」と入力してください: ', res));
  rl.close();
  return /^(はい|yes|y)$/i.test(ans.trim());
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0] || 'check';
  const hookIn = args.hook ? readHookInput() : {};
  const root = path.resolve(args.root || (args.hook && (process.env.CLAUDE_PROJECT_DIR || hookIn.cwd)) || process.cwd());
  const ci = !!args.ci || /^(1|true)$/i.test(process.env.CI || '');
  const cli = args.cli || defaultCliCommand();

  if (cmd === 'help' || args.help) { console.log(HELP); return 0; }

  if (cmd === 'init') {
    const r = runInit({ root, configPath: args.config, apply: !!args.apply, reason: args.reason || null, cliCommand: cli, ci });
    console.log(renderInit(r));
    return r.exit;
  }

  if (cmd === 'accept') {
    const tty = !!process.stdin.isTTY;
    if (!tty && !args['non-interactive']) {
      console.error('[手抜き番] accept は、人が画面で内容を見て「はい」と打つ命令です。AI は実行しないでください。\n' +
        '  （画面の無い所でどうしても使うなら --non-interactive を付けます。記録に「画面の確認なし」と残り、毎回の check で表示されます）');
      return 2;
    }
    const r = await runAccept({ root, configPath: args.config, reason: args.reason, interactive: tty, confirm: tty ? askYes : async () => true, base: args.base || null, ci });
    console.log(renderAccept(r));
    return r.exit;
  }

  if (cmd === 'report') {
    const rep = buildDeliveryReport({ root, configPath: args.config, base: args.base || null, project: args.project || null });
    if (args.out) {
      const out = path.resolve(args.out);
      fs.writeFileSync(out, rep.markdown);
      console.log(`報告書を書きました: ${out}（終了コード ${rep.exit}）`);
    } else console.log(rep.markdown);
    return rep.exit;
  }

  if (cmd === 'check') {
    const r = runCheck({ root, configPath: args.config, base: args.base || null, compareTo: args['compare-to'] || null, ci, write: !args['no-write'] });
    if (args.json) { console.log(JSON.stringify(r, null, 2)); return r.exit; }
    if (args.hook) {
      if (r.exit === 0) { hookCounter(root, false); return 0; }
      const n = hookCounter(root, true);
      const text = renderHook(r);
      if (n > 3) {
        // 3 回続けて直せなかった → AI を止め続けず、人に知らせる（Claude Code では終了コード 1 は人に見せるだけ）
        process.stderr.write(`${text}\n[手抜き番] AI が ${n - 1} 回続けて直せませんでした。人が \`tenukiban check\` の結果を見てください。\n`);
        return 1;
      }
      process.stderr.write(text + '\n');
      return 2;
    }
    console.log(renderCheck(r, { all: !!args.all }));
    return r.exit;
  }

  console.error(`知らない命令です: ${cmd}\n${HELP}`);
  return 2;
}

main().then((code) => process.exit(code), (e) => { console.error(`[手抜き番] 止まりました: ${e.message}`); process.exit(2); });
