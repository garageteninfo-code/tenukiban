// AI への指示の段落と、Claude Code のフックの設定を作る（init が使う）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TPL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'templates');

/** フックなどに書く「手抜き番を走らせる命令」。npm に公開する前は、このパソコンの中の場所を指す。 */
export function defaultCliCommand() {
  const bin = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'tenukiban.mjs').split(path.sep).join('/');
  return `node "${bin}"`;
}

export function snippetText(cli = defaultCliCommand()) {
  return fs.readFileSync(path.join(TPL, 'CLAUDE.md断片.md'), 'utf8').split('{{CLI}}').join(cli);
}

/**
 * Claude Code の .claude/settings.json の形。2026-11-14 に公式の説明で確かめた：
 *   https://code.claude.com/docs/en/hooks ・ https://code.claude.com/docs/en/permissions
 * - Stop：AI が「終わった」と返す直前に走る。Stop には matcher が無い（書いても無視される）。
 *   終了コード 2 で止めると、標準エラーの文が「続ける理由」として AI に渡る。timeout は秒（既定 600）。
 *   Claude Code 側にも「8 回続けて止めたら終わらせる」上限があり、入力の stop_hook_active で続きかどうかが分かる。
 * - permissions.deny：AI が基準を書き換える・accept を打つのを断る。
 *   ・Bash の「accept *」（末尾の空白＋*）は「accept:*」と同じ意味。説明の画面が書く形に合わせた。
 *   ・ファイルの書き換えは Edit(path) で断る（Write(path) の規則は書いても当たらない、と説明にある）。
 *   ・先頭の / は「設定ファイルのある場所（プロジェクト）から」の意味。./ は「今いるフォルダから」。
 *   ・完全には防げない（node のスクリプトの中からの書き換えなどには効かない。説明.md の限界を参照）。
 */
export function hookSettings(cli = defaultCliCommand()) {
  return {
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: `${cli} check --hook`, timeout: 180 }] }],
    },
    permissions: {
      deny: [
        `Bash(${cli} accept *)`,
        'Bash(npx tenukiban accept *)',
        'Bash(tenukiban accept *)',
        'PowerShell(npx tenukiban accept *)',
        'PowerShell(tenukiban accept *)',
        'Edit(/.tenukiban/**)',
        'Edit(/tenukiban.config.json)',
      ],
    },
  };
}
