// 基準の「控え」。作業フォルダの外（既定はホームの .tenukiban）に、手抜き番が書いた最後の基準を写しておく。
// AI が作業フォルダの中の基準ファイルを書き換えても、控えと比べれば分かる。
// ⚠ 控えも同じ PC の上にあるので、AI がわざわざ消し・書き換えれば防げない（説明.md の「限界」）。
//    消えていれば「控えが見つからない」として止める。git の本流（--base）と比べるのが一番強い。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const homeDir = () => path.resolve(process.env.TENUKIBAN_HOME || path.join(os.homedir(), '.tenukiban'));
const indexFile = () => path.join(homeDir(), 'index.json');
const anchorFile = (id) => path.join(homeDir(), 'anchors', `${id}.json`);
const norm = (root) => path.resolve(root).toLowerCase();

export function readIndex() {
  try { return JSON.parse(fs.readFileSync(indexFile(), 'utf8')); } catch { return {}; } // 無い・壊れている → 空として扱い、下で「控えが無い」と出す
}

export function idForRoot(root) { return readIndex()[norm(root)] || null; }

export function readAnchor(id) {
  if (!id) return null;
  const f = anchorFile(id);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null;
}

export function writeAnchor(root, id, text) {
  fs.mkdirSync(path.dirname(anchorFile(id)), { recursive: true });
  fs.writeFileSync(anchorFile(id), text);
  const idx = readIndex();
  if (idx[norm(root)] !== id) {
    idx[norm(root)] = id;
    fs.writeFileSync(indexFile(), JSON.stringify(idx, null, 2) + '\n');
  }
}
