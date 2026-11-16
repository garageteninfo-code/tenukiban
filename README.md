# 手抜き番（tenukiban）0.2.0

AI（Claude Code・Codex・Cursor・Copilot など）に書かせたコードが、

- **黙って前より悪くなる**（エラーの握りつぶし・TODO・型逃げが増える）
- **成功のふりをする**（何もせずに `{ ok: true }` を返す・「送信しました」と出すだけ・点数を書き込む）
- **見張りそのものを外す**（試験を消す・飛ばす、`npm test` を `echo ok` にする、tox を `- pytest` にする、基準ファイルを書き換える）

のを見つけて止める、小さな道具です。止めたときは **日本語で1行の説明** と、**「AIにこう頼んでください」という頼み方の文** を出します。変更の中身（差分）が読めなくても使えるように作りました。

- 提供：HARVEST（ハーベスト）／お問い合わせ：garageten.info@gmail.com（旧称 GARAGE TEN のときのアドレスです）
- 料金：今のところ無料です。
- 読む言語：JavaScript・TypeScript・HTML（.vue .svelte を含む）・Python
- 言葉：日本語と英語の誇大表現（「完璧」「100%安全」「never fails」など）
- 必要な物：**Node.js だけ**（部品のインストールは不要。ネットにはつながりません。AI も呼びません）

> ⚠ **これは認証や保証ではありません。** 手抜き番が見つけられるのは「決まった型」だけです。作った側の試験では、規則を見ていない書き方のうち **約半分** を見つけ、正しいコードの **約 7〜8%** を誤って指摘しました（下の「数字」）。**通っても「問題がない」「安全」という意味ではありません。**

## 誰のためか

- AI にコードを書かせているが、変更の中身を読めない人（社内の道具を作る事務の人・一人で作る人・小さな会社）
- 日本語で説明してほしい人
- 大きな品質の道具を設定する人がいない、小さなチーム
- 下請けの開発会社：`report` で「納品前の手抜きチェック報告書」を作り、納品物に添えられます（基準を緩めた記録も載ります）
- 社外にコードを出せない決まりの職場（ネットにつながらずに動きます）

## 入れ方（Node.js）

1. [Node.js](https://nodejs.org/) を入れます（作った側が試したのは **Windows・Node 24** だけです。Node 18.17 以上で動く作りですが、ほかの版・Mac・Linux では確かめていません）。
2. このリポジトリの **Releases** から `tenukiban-0.2.0.zip` をダウンロードして、好きな場所に展開します（例：`C:\tools\tenukiban`）。
3. 確かめたい作業フォルダで、次のように動かします。

※ npm にはまだ公開していません。`npx tenukiban` は使えないので、展開した場所の `bin/tenukiban.mjs` を `node` で動かします。

```
node C:\tools\tenukiban\bin\tenukiban.mjs init              始める（今の状態を「基準」にする）
node C:\tools\tenukiban\bin\tenukiban.mjs init --apply      さらに CLAUDE.md・AGENTS.md に決まりを書き、.claude/settings.json が無ければフックも書く
node C:\tools\tenukiban\bin\tenukiban.mjs check             確かめる（前より悪くなった・成功のふり・見張りの穴）
node C:\tools\tenukiban\bin\tenukiban.mjs report --out 報告書.md   納品前の手抜きチェック報告書を作る（基準は書き換えない）
node C:\tools\tenukiban\bin\tenukiban.mjs accept --reason "理由"   人だけが使う：理由を残して基準を緩める（画面で「はい」と打つ）
```

- 別のフォルダを確かめるときは `--root <フォルダ>` を付けます。
- 終了コード：`0` 通った／`1` 止めた／`2` 使い方・設定の誤り（**始めていない・0 件しか読めない、を「問題なし」とは言いません**）
- `--base origin/main`：git の本流と比べる（いちばん強い使い方）。`--ci`：基準も控えも書かない。
- **過去の最良は消せません**：良くなると自動で基準が引き締まり、戻すと止まります。緩めるのは人が `accept` で理由を残したときだけで、その記録は毎回表示され、報告書にも載ります。
- 書き込む場所：作業フォルダの `.tenukiban/`・`tenukiban.config.json`、ホームの `.tenukiban`（基準の控え）。`init --apply` のときは `CLAUDE.md`・`AGENTS.md`・`.claude/settings.json` にも書きます。**始める前に git などで元に戻せる状態にしておいてください。**

### Claude Code に組み込む

`init --apply` は、このパソコンの中の手抜き番の場所を指すフックを `.claude/settings.json` に書きます（すでにある時は書きません）。手で書くときは `templates/claude-settings.例.json` を見本にし、`npx tenukiban` の所を `node "C:/tools/tenukiban/bin/tenukiban.mjs"` のように、展開した場所に書き換えてください。

- AI が「終わりました」と言う直前（Stop）に手抜き番が走り、止めた理由を AI に返して直させます（終了コード 2）。
- 形は Claude Code の公式の説明に合わせました（2026-11-14 に確認）：[Hooks reference](https://code.claude.com/docs/en/hooks)・[Configure permissions](https://code.claude.com/docs/en/permissions)。**本物の Claude Code に入れて動かしてはいません**（説明を読んで形を合わせただけ）。
- 断る設定（`permissions.deny`）は、node や python のスクリプトの中からの書き換えには効きません。

### GitHub の上で回す

`templates/github-actions.例.yml` が見本です（手抜き番をリポジトリの中、例えば `tools/tenukiban/` に置いて使う形）。

## 何を見つけるか（主な物）

| 種類 | JS・TS | Python |
|---|---|---|
| 成功のふり | 仮の印のそばの `return { ok: true }`・「送信しました」だけ・待つだけで完了 | 「送る・払う」関数がすぐ `return {"ok": True}`・`# TODO` のそばの決まった値・`print("送信しました")` だけ |
| 握りつぶし | 空の `catch {}`・`.catch(() => {})`・catch で成功を返す | `except: pass`・`except Exception: pass`・except で `True` や `[]`・`sys.exit(0)`・`suppress(Exception)` |
| 固定の点数 | `score: 92`・いつも同じ数を返す関数 | `"accuracy": 0.95`・いつも同じ数を返す関数 |
| 偽の認証 | 何も調べずに `return true` の `isAdmin` | `is_admin` / `verify_*` がすぐ `return True`・`or "admin"` |
| 試験の手抜き | `.skip` `.only` `xit`・試験を減らす／消す | `@pytest.mark.skip`・`xfail`・`pytest.skip()`・`@unittest.skip`・`assert True`・`… or True` |
| 見張りを外す | `package.json` の `test` を空・`echo`・`\|\| true` に／試験の道具・eslint・tsconfig・CI の設定を変える | `pyproject.toml`・`tox.ini`・`setup.cfg` の試験の段落を変える／`- pytest`・`ignore_outcome = true`・`--deselect`・`-k "not …"`・`fail_under = 0` |
| 負債の数 | `as any`・`@ts-ignore`・`eslint-disable`・TODO | `except:`・`# noqa`・`# type: ignore`・`# pragma: no cover` |

ほかに、基準ファイルの書き換え・削除（ホームの控えと git と比べる）、`node_modules` の直接の書き換え、`.env`・鍵のファイルを git に入れること、も止めます。

## 数字（正直に）

すべて作った側が用意した**架空の片**での測定です。**第三者の片では測っていません。** 数も少ない（合わせて百数十件）です。

| 片の組 | 中身（止めるべき / 正しい） | 捕まえた | 誤って止めた |
|---|---|---|---|
| JS・TS：規則を見ていない言い方 | 18 / 12 | **10/18（56%）** | **1/12（8%）** |
| Python：規則を書いた後に作り、直していない組 | 20 / 14 | **10/20（50%）** | **1/14（7%）** |
| Python：規則を書く前に作った組（規則をこれに合わせたので甘い数字） | 24 / 17 | 24/24 | 0/17 |

- 本当の力に近いのは上の2行（約半分を捕まえ、7〜8% を誤って止める）です。3行目は宣伝に使える数字ではありません。
- `npm run measure` で、Python の2組と、同じ時に作った JS・TS の小さな組（`test/ラベル付き/`）の数字を出せます。1行目の JS・TS の組は、このリポジトリには入っていません。
- 試験（`npm test`）：作った側のパソコン（Windows・Node 24）で 49 件合格。このリポジトリだけで動かすと、上の「入っていない組」と照らし合わせる 2 件は飛ばし（skip）になります。

## ブラウザ版

`web/index.html` をダブルクリックで開き、フォルダをドラッグすると、正直さの検査・試験を飛ばす印・何もしない確認の命令（package.json・pyproject.toml・tox.ini・setup.cfg）を日本語で出します。**中身はどこにも送りません**（ページの決まり CSP で通信そのものを禁止）。「前より悪くなったか」はブラウザ版では見ません。本物のブラウザでの動き（ドラッグ・コピーのボタン）は、まだ確かめていません。

## 限界

- 見つけられるのは決まった型だけ（上の数字）。動作が仕様どおりかは見ません。中身の無い試験も、`assert True` のような分かりやすい物しか分かりません。
- 同じパソコンの上の基準と控えを、両方同じように書き換えられると見抜けません。`--base` で git の本流と比べてください。
- `accept` の「画面で『はい』」は `--non-interactive` で通せます（防ぐのではなく、「画面の確認なし」と記録に残して毎回知らせる仕組みです）。
- Python の試験の設定は、関係する段落を素朴に読むだけです（TOML・INI を完全には読みません）。`conftest.py` の中の細工は、`collect_ignore` など一部しか見ません。
- `package.json` は一番上の1つだけ見ます（複数のパッケージを持つ構成は未対応）。
- 報告書は署名ではありません。基準と控えの両方を書き換えれば、きれいな報告書も作れてしまいます。信じてよいのは `--base` で本流と比べた報告書か、受け取る側が自分で `check --ci --base …` を走らせて同じ結果になった時です。
- 試したのは Windows・Node 24 だけです。Codex・Copilot・Cursor は AGENTS.md などへの決まりの文だけで、フックの仕組みは試していません。

## 試験の動かし方

```
npm test           試験（一時のフォルダはこのフォルダの中の 試験/test-tmp に作ります。終わったら消してかまいません）
npm run measure    ラベル付きの片の数字
npm run build:web  ブラウザ版を作り直す（node web/build.mjs --check で最新か確かめる）
```

## 権利・利用条件

- 権利：**All rights reserved**（松岡颯大（HARVEST））。閲覧と、自分・自分の組織の中で道具として使うことは無料でできます。再配布・改変したものの配布・販売・ほかの製品への組み込みは、HARVEST の書面の許可が必要です。→ [LICENSE](LICENSE)
- 利用条件（保証しないこと・責任の上限など）→ [利用条件.md](利用条件.md)（英語：[TERMS-en.md](TERMS-en.md)）
- `package.json` は `"private": true`・`"license": "UNLICENSED"` です（npm には公開していません。UNLICENSED は「誰にも使用許諾を出していない」という npm の書き方で、使ってよい範囲は LICENSE のとおりです）。

---

## English (short)

*This English section was translated with AI.*

**tenukiban** (手抜き番, "the shortcut watchman") is a zero-dependency Node CLI (plus an offline browser page) that stops AI coding agents from quietly making code worse or faking success. Provided free of charge (for now) by HARVEST, Japan. Contact: garageten.info@gmail.com.

- **Ratchet** that can't erase past best: counts of swallowed errors, TODOs, type escapes, skipped tests and honesty findings (per file, per rule) may only go down. Loosening requires a human `accept --reason`, which is recorded and shown every time. Baseline tampering is detected against a copy outside the project and against git.
- **Honesty lint** for fake-success code (stub `{ ok: true }`, log-only "sent", hard-coded scores, always-true auth checks), swallowed errors (`catch {}`, `except: pass`), and hype words in Japanese and English.
- **Gate guards**: emptied `npm test`, `echo ok`, `|| true`, skipped/deleted tests, edited test/lint/CI configs, pytest/tox/coverage settings that hide failures, edits inside `node_modules`.
- Languages: JS / TS / HTML / Python. Messages are in Japanese.

**Install / run**: install Node.js (tested only on Windows with Node 24), download `tenukiban-0.2.0.zip` from Releases, unzip, then run `node <unzipped>/bin/tenukiban.mjs init` and `... check` in your project. Not published to npm, so `npx tenukiban` does not work yet.

**Honest numbers** (in-house fictional snippets only, not third-party): catches about half of unseen bad patterns (JS/TS 10/18, Python 10/20) with ~7–8% false alarms (1/12, 1/14).

**This is not a certification or a guarantee.** Passing does not mean the code is correct or safe.

**License**: All rights reserved. You may view the code and use the tool within your own organisation free of charge; redistribution, modified versions, resale or incorporation into other products require written permission from HARVEST. See [LICENSE](LICENSE) and [TERMS-en.md](TERMS-en.md).
