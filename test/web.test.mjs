// ブラウザ版の試験。本物のブラウザは使わず、(1) 作った index.html の決まり（CSP）を読み、
// (2) 埋め込んだスクリプトを、最小の偽の画面（DOM）の上で Node の vm で動かす。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { ROOT } from './helpers.mjs';
import { buildHtml } from '../web/build.mjs';

const HTML = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');
const SCRIPT = HTML.match(/<script>([\s\S]*)<\/script>/)[1];
const STYLE = HTML.match(/<style>([\s\S]*)<\/style>/)[1];
const CSP = HTML.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];

test('index.html は今の部品から作った最新の物', () => {
  assert.equal(HTML, buildHtml(), 'node web/build.mjs を実行してください');
});

test('CSP：通信・外のスクリプト・画像をすべて禁止し、埋め込んだ物は指紋（sha256）で許す', () => {
  for (const d of ["default-src 'none'", "connect-src 'none'", "img-src 'none'", "form-action 'none'", "base-uri 'none'", "object-src 'none'"]) assert.ok(CSP.includes(d), d);
  assert.ok(!/unsafe-inline|unsafe-eval|https?:|\*/.test(CSP), CSP);
  const h = (s) => `'sha256-${crypto.createHash('sha256').update(s, 'utf8').digest('base64')}'`;
  assert.ok(CSP.includes(`script-src ${h(SCRIPT)}`));
  assert.ok(CSP.includes(`style-src ${h(STYLE)}`));
  assert.equal((HTML.match(/<script/g) || []).length, 1, 'スクリプトは埋め込んだ 1 つだけ');
  assert.ok(!/<(link|img|iframe|object|embed|form)\b/i.test(HTML));
  assert.ok(!/\son[a-z]+\s*=/i.test(HTML.replace(SCRIPT, '')), 'onclick などのインラインの動きが無い');
  // 説明のコメントと、規則のデータ（正規表現の中に fetch\( などの文字がある）を除いたコードで確かめる
  const CODE = SCRIPT.split('\n').filter((l) => !/^\s*(\/\/|var RULE_SETS)/.test(l)).join('\n');
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|new\s+Image\b|import\s*\(|\.src\s*=/.test(CODE), '通信に使える書き方が無い');
  assert.match(HTML, /どこにも送りません/);
});

// ---- 最小の偽の画面 ----
function fakeDom() {
  const byId = {};
  const mk = (tag) => {
    const e = {
      tagName: tag, className: '', textContent: '', hidden: false, children: [], listeners: {}, value: '', type: '',
      classList: { add() {}, remove() {} },
      appendChild(c) { this.children.push(c); return c; },
      insertBefore(c, ref) { const i = ref ? this.children.indexOf(ref) : -1; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; },
      removeChild(c) { this.children = this.children.filter((x) => x !== c); },
      addEventListener(t, fn) { (this.listeners[t] ||= []).push(fn); },
      select() {},
    };
    Object.defineProperty(e, 'textContent', { get() { return [e._t || '', ...e.children.map((c) => c.textContent)].join('\n'); }, set(v) { e._t = v; if (v === '') e.children = []; } });
    return e;
  };
  for (const id of ['picker', 'drop', 'status', 'result']) byId[id] = mk('div');
  const document = { getElementById: (id) => byId[id], createElement: mk, body: mk('body'), execCommand: () => true };
  class FileReader { readAsText(f) { setTimeout(() => { this.result = f._text; this.onload(); }, 0); } }
  return { byId, ctx: { document, FileReader, navigator: {}, setTimeout, Promise, console } };
}
/** 読み終わる（status が空になる）まで待つ。最長 3 秒。 */
async function settled(byId) {
  for (let i = 0; i < 300 && !byId.result.textContent; i++) await new Promise((r) => setTimeout(r, 10));
}
const file = (p, text) => ({ name: path.basename(p), webkitRelativePath: p, size: Buffer.byteLength(text), _text: text });

test('フォルダを選ぶと、日本語の結果（場所・説明・AIへの頼み方）を出す。.env と node_modules は読まない', async () => {
  const { byId, ctx } = fakeDom();
  vm.runInNewContext(SCRIPT, ctx);
  const files = [
    file('myshop/src/pay.js', "export function charge() {\n  // TODO 決済\n  return { success: true };\n}\n"),
    file('myshop/public/index.html', '<p>100%安全なAI受付です</p>\n'),
    file('myshop/test/a.test.js', "test.skip('x', () => {});\n"),
    file('myshop/package.json', '{"scripts":{"test":"echo ok"}}'),
    file('myshop/.env', 'SECRET=should-not-be-read'),
    file('myshop/node_modules/x/index.js', 'try{}catch{}'),
    file('myshop/src/ok.js', 'export const add = (a, b) => a + b;\n'),
  ];
  let readEnv = false;
  Object.defineProperty(files[4], '_text', { get() { readEnv = true; return ''; } });
  byId.picker.listeners.change[0]({ target: { files } });
  await settled(byId);
  const out = byId.result.textContent;
  assert.equal(readEnv, false, '.env の中身は読まない');
  assert.match(out, /見つかったもの：4 件/);
  assert.match(out, /src\/pay\.js 3行目/);
  assert.match(out, /public\/index\.html 1行目/);
  assert.match(out, /試験を飛ばす印/);
  assert.match(out, /package\.json の "test"/);
  assert.match(out, /AIにこう頼んでください/);
  assert.match(out, /秘密らしいファイル/);
  assert.match(out, /\.env/);
  assert.match(out, /4 ファイルを読みました/);
  assert.ok(!/node_modules\/x/.test(out));
});

test('何も見つからなくても「問題がない」とは言わない。0 件しか読めなければそう言う', async () => {
  const { byId, ctx } = fakeDom();
  vm.runInNewContext(SCRIPT, ctx);
  byId.picker.listeners.change[0]({ target: { files: [file('p/readme.txt', 'hi')] } });
  await settled(byId);
  assert.match(byId.result.textContent, /0 件で「問題なし」とは言いません/);
  assert.match(byId.result.textContent, /「問題がない」とは言えません/);
});
