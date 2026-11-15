// ブラウザ版（web/index.html）を作る。1 つのファイルに全部を埋め込み、外の物は何も読まない。
// CSP（ページの決まり）で、通信（connect-src）・画像・外のスクリプトをすべて禁止する。
// スクリプトとスタイルは sha256 の指紋で許す（'unsafe-inline' は使わない）。
//   node web/build.mjs          index.html を書く
//   node web/build.mjs --check  今の index.html が最新か確かめる（違えば 1）
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

/** ES モジュールの書き方を外して、ふつうの関数の並びにする（import の行を消し、export を外す）。 */
const unmodule = (src) => src.split('\n').filter((l) => !/^import\s/.test(l)).join('\n').replace(/^export\s+/gm, '');

export function buildHtml() {
  const ruleSets = ['code', 'ja', 'en', 'python'].map((n) => JSON.parse(read(`rules/honesty.${n}.json`)));
  const script = [
    '"use strict";',
    `var RULE_SETS = ${JSON.stringify(ruleSets)};`,
    unmodule(read('lib/scan-core.mjs')),
    unmodule(read('lib/explain.mjs')),
    read('web/src/app.js'),
  ].join('\n');
  // </script> が中に入っていると HTML が切れるので、念のため確かめる
  if (/<\/script/i.test(script)) throw new Error('スクリプトの中に </script が入っています');
  const style = read('web/src/style.css');
  const hash = (s) => `'sha256-${crypto.createHash('sha256').update(s, 'utf8').digest('base64')}'`;
  const csp = [
    "default-src 'none'",
    `script-src ${hash(script)}`,
    `style-src ${hash(style)}`,
    "img-src 'none'", "font-src 'none'", "connect-src 'none'", "media-src 'none'", "object-src 'none'",
    "frame-src 'none'", "worker-src 'none'", "manifest-src 'none'", "form-action 'none'", "base-uri 'none'",
  ].join('; ');
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>手抜き番</title>
<style>${style}</style>
</head>
<body>
<main>
<h1>手抜き番（ブラウザ版・試作）</h1>
<p class="lead">AI に書かせたコードの中から、「できていないのに成功と返す」「エラーを黙って捨てる」「完璧・100%安全と言い切る」などを探して、日本語で説明します。</p>
<div class="promise"><strong>中身はどこにも送りません。</strong>選んだフォルダは、このパソコンの中（このページの中）だけで読みます。このページは決まり（CSP）で通信そのものを禁止しているので、送ろうとしても送れません。インターネットを切っても同じように動きます。</div>
<div id="drop">
<p>プロジェクトのフォルダを、ここにドラッグしてください。</p>
<label>フォルダを選ぶ<input id="picker" type="file" webkitdirectory directory multiple></label>
<p class="foot">ブラウザが「ファイルをアップロードしますか」と聞くことがあります。これはブラウザの決まった言い方で、実際にはどこにも送りません。</p>
</div>
<p id="status" role="status"></p>
<section id="result" hidden></section>
<section class="limits">
<h2>このページでできないこと（正直に）</h2>
<ul>
<li>見つけられるのは一部です。社内の試験では、見ていない書き方のうち約半分（18 件中 10 件）を見つけ、正しいコードの 12 件中 1 件を誤って指摘しました。0 件でも「問題がない」とは言えません。</li>
<li>「前より悪くなったか」（歯止め）と、「AI が試験や基準を書き換えて通したか」は、ブラウザ版では見ません。毎回の比べ合わせが要るので、パソコンの中で動く命令版（tenukiban check）で見ます。</li>
<li>読むのは JS・TS・HTML・Python などのファイルだけです。node_modules・.venv・.env・鍵のファイルは読みません。Python の規則は社内の試験で、見ていない書き方の 20 件中 10 件を見つけ、正しいコードの 14 件中 1 件を誤って指摘しました。</li>
</ul>
</section>
</main>
<script>${script}</script>
</body>
</html>
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const html = buildHtml();
  const out = path.join(HERE, 'index.html');
  if (process.argv.includes('--check')) {
    const cur = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    if (cur !== html) { console.error('web/index.html が古いです。node web/build.mjs を実行してください。'); process.exit(1); }
    console.log('web/index.html は最新です。');
  } else {
    fs.writeFileSync(out, html);
    console.log(`web/index.html を書きました（${Buffer.byteLength(html)} バイト）。`);
  }
}
