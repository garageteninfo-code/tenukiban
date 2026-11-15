// ブラウザ版の画面の動き。build.mjs が scan-core・explain・規則と一緒に index.html の中へ埋め込む。
// ⚠ 通信はしない（fetch・XMLHttpRequest・画像の読み込みなどを使わない）。ページの CSP でも禁止している。
(function () {
  'use strict';
  var EXCLUDE_DIRS = ['node_modules', 'dist', 'build', 'out', 'coverage', '.git', '.next', '.tenukiban', '.hadome', 'vendor', 'data', 'backups', 'tmp', '.venv', 'venv', '__pycache__', '.tox', '.nox', '.mypy_cache', '.pytest_cache', '.ruff_cache', 'site-packages'];
  var EXTS = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.html', '.py'];
  var NEVER_READ = /(^|\/)(\.env[^/]*|\.system_key[^/]*|[^/]*\.(pem|key|p12|pfx))$/i;
  var MAX_BYTES = 1024 * 1024;
  var RULES = compileRules(RULE_SETS, {});

  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function ext(p) { var i = p.lastIndexOf('.'); return i < 0 ? '' : p.slice(i).toLowerCase(); }

  /** 上の 1 段（選んだフォルダの名前）を外した、フォルダの中での場所。 */
  function relPath(p) { var s = p.replace(/\\/g, '/'); var i = s.indexOf('/'); return i < 0 ? s : s.slice(i + 1); }

  function classify(rel) {
    var parts = rel.split('/');
    for (var i = 0; i < parts.length - 1; i++) if (EXCLUDE_DIRS.indexOf(parts[i]) >= 0) return { skip: true, why: parts[i] };
    if (NEVER_READ.test(rel)) return { skip: true, secret: true };
    if (/\.min\.js$/i.test(rel)) return { skip: true, why: 'min' };
    if (parts[parts.length - 1] === 'package.json' && parts.length === 1) return { pkg: true };
    if (parts.length === 1 && PY_GATE_FILES.indexOf(parts[0]) >= 0) return { pyGate: parts[0] };
    if (EXTS.indexOf(ext(rel)) < 0) return { skip: true, why: 'ext' };
    return { read: true };
  }

  function readText(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result)); };
      r.onerror = function () { reject(r.error); };
      r.readAsText(file);
    });
  }

  // ---- フォルダを読む（ファイルの選択・ドラッグの両方） ----
  function entriesToFiles(entries) {
    var out = [];
    function walk(entry, prefix) {
      return new Promise(function (resolve) {
        if (entry.isFile) {
          entry.file(function (f) { out.push({ file: f, path: prefix + entry.name }); resolve(); }, function () { resolve(); });
        } else if (entry.isDirectory) {
          if (EXCLUDE_DIRS.indexOf(entry.name) >= 0) { out.push({ skippedDir: prefix + entry.name }); resolve(); return; }
          var reader = entry.createReader();
          var all = [];
          (function more() {
            reader.readEntries(function (batch) {
              if (!batch.length) { Promise.all(all.map(function (e) { return walk(e, prefix + entry.name + '/'); })).then(function () { resolve(); }); return; }
              all = all.concat(Array.prototype.slice.call(batch));
              more();
            }, function () { resolve(); });
          })();
        } else resolve();
      });
    }
    return Promise.all(entries.map(function (e) { return walk(e, ''); })).then(function () { return out; });
  }

  async function analyze(items) {
    var report = { read: 0, skippedSecret: [], skippedOther: 0, findings: [], tests: { files: 0, cases: 0, skipped: [] }, scripts: null, folder: '' };
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.skippedDir) { report.skippedOther++; continue; }
      var full = it.path || it.file.webkitRelativePath || it.file.name;
      if (!report.folder && full.indexOf('/') > 0) report.folder = full.split('/')[0];
      var rel = full.indexOf('/') > 0 ? relPath(full) : full;
      var c = classify(rel);
      if (c.secret) { report.skippedSecret.push(rel); continue; }
      if (c.skip) { report.skippedOther++; continue; }
      if (it.file.size > MAX_BYTES) { report.skippedOther++; continue; }
      var text;
      try { text = await readText(it.file); } catch (e) { report.skippedOther++; continue; } // 読めないファイルは数だけ数える（下に件数を出す）
      if (c.pkg) {
        try {
          var j = JSON.parse(text);
          report.scripts = {};
          DEFAULT_GATE_SCRIPTS.forEach(function (n) { if (j.scripts && Object.prototype.hasOwnProperty.call(j.scripts, n)) report.scripts[n] = String(j.scripts[n]); });
        } catch (e) { report.scripts = { _error: 'package.json が JSON として読めません' }; }
        continue;
      }
      if (c.pyGate) {
        pyGateNoop(c.pyGate, text).forEach(function (n) {
          report.findings.push({ id: 'guard:py-gate-noop', group: '見張りの穴', where: c.pyGate + ' の [' + n.section + '] ' + n.key, text: n.value + '（' + n.reason + '）' });
        });
        continue;
      }
      report.read++;
      var isTest = isTestPath(rel);
      scanText(text, RULES, { isTest: isTest, ext: ext(rel) }).forEach(function (h) {
        report.findings.push({ id: h.rule.id, group: '正直さ', where: rel + ' ' + h.line + '行目', text: h.text });
      });
      if (isTest && /\.([cm]?[jt]sx?|py)$/i.test(rel)) {
        var t = countTests(text, rel);
        report.tests.files++;
        report.tests.cases += t.cases;
        t.skippedLines.forEach(function (l) { report.tests.skipped.push(rel + ' ' + l + '行目'); });
      }
    }
    if (report.tests.skipped.length) report.findings.push({ id: 'tests:skipped', title: '試験を飛ばす印（skip・only など）がある', group: '試験の数', where: report.tests.skipped.slice(0, 5).join('、') + (report.tests.skipped.length > 5 ? ' ほか' + (report.tests.skipped.length - 5) + '件' : '') });
    if (report.scripts && !report.scripts._error) {
      Object.keys(report.scripts).forEach(function (n) {
        var why = noopReason(report.scripts[n]);
        if (why) report.findings.push({ id: 'guard:gate-script-noop', group: '見張りの穴', where: 'package.json の "' + n + '"', text: report.scripts[n] + '（' + why + '）' });
      });
    }
    return report;
  }

  // ---- 表示 ----
  function copy(text, btn) {
    var done = function () { btn.textContent = 'コピーしました'; setTimeout(function () { btn.textContent = 'AIへの頼み方をコピー'; }, 1500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallback(); });
    else fallback();
    function fallback() {
      var ta = el('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { btn.textContent = 'コピーできません。文を選んでコピーしてください'; }
      document.body.removeChild(ta);
    }
  }

  function render(rep) {
    var out = $('result');
    out.textContent = '';
    out.hidden = false;
    var head = el('div', 'summary ' + (rep.findings.length ? 'bad' : 'good'));
    head.appendChild(el('h2', null, rep.findings.length ? '見つかったもの：' + rep.findings.length + ' 件' : '見つかったもの：0 件'));
    var meta = 'フォルダ「' + (rep.folder || '（名前なし）') + '」の ' + rep.read + ' ファイルを読みました（JS・TS・HTML・Python など）。';
    if (rep.tests.files) meta += ' 試験のファイル ' + rep.tests.files + '・試験の数 ' + rep.tests.cases + '。';
    head.appendChild(el('p', null, meta));
    if (!rep.findings.length) head.appendChild(el('p', null, 'ただし、手抜き番が見つけられるのは一部です。0 件でも「問題がない」とは言えません。'));
    if (rep.read === 0) head.appendChild(el('p', 'warn', '読めたファイルが 0 件でした。JS・TS・HTML・Python などのファイルが入ったフォルダを選んでください（0 件で「問題なし」とは言いません）。'));
    out.appendChild(head);

    if (rep.skippedSecret.length) {
      var s = el('div', 'notice');
      s.appendChild(el('h3', null, '秘密らしいファイルがありました（中身は読んでいません）'));
      s.appendChild(el('p', null, rep.skippedSecret.slice(0, 10).join('、') + (rep.skippedSecret.length > 10 ? ' ほか' : '') + '。このフォルダを人に渡す・GitHub に上げる前に、入れてよいか確かめてください。'));
      out.appendChild(s);
    }

    var all = [];
    rep.findings.forEach(function (f, i) {
      var e = explainFor(f.id);
      var ask = askText(f.id, f.where);
      all.push((i + 1) + '. ' + ask);
      var card = el('article', 'card');
      card.appendChild(el('h3', null, '[' + (i + 1) + '] ' + (f.title || e.title) + '（' + f.group + '）'));
      card.appendChild(el('p', 'where', '場所: ' + f.where));
      if (f.text) card.appendChild(el('pre', 'code', f.text));
      card.appendChild(el('p', 'plain', 'かんたんに言うと：' + e.plain));
      var box = el('div', 'ask');
      box.appendChild(el('p', 'ask-label', 'AIにこう頼んでください'));
      box.appendChild(el('p', 'ask-text', ask));
      var b = el('button', 'copy', 'AIへの頼み方をコピー');
      b.type = 'button';
      b.addEventListener('click', function () { copy(ask, b); });
      box.appendChild(b);
      card.appendChild(box);
      out.appendChild(card);
    });
    if (all.length > 1) {
      var allBtn = el('button', 'copy all', 'まとめてコピー（' + all.length + ' 件）');
      allBtn.type = 'button';
      allBtn.addEventListener('click', function () { copy('次の点を直してください。\n' + all.join('\n'), allBtn); });
      out.insertBefore(allBtn, out.children[1] || null);
    }
    out.appendChild(el('p', 'foot', '読まなかったファイル：秘密らしいもの ' + rep.skippedSecret.length + ' 件・対象外（node_modules・画像・大きすぎるもの など）' + rep.skippedOther + ' 件。'));
  }

  function run(items) {
    $('status').textContent = '読んでいます…（このパソコンの中だけで読んでいます）';
    analyze(items).then(function (rep) { render(rep); $('status').textContent = ''; }, function (e) { $('status').textContent = '止まりました：' + e.message; });
  }

  $('picker').addEventListener('change', function (ev) {
    var files = Array.prototype.slice.call(ev.target.files || []);
    run(files.map(function (f) { return { file: f, path: f.webkitRelativePath || f.name }; }));
  });
  var drop = $('drop');
  ['dragenter', 'dragover'].forEach(function (t) { drop.addEventListener(t, function (e) { e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (t) { drop.addEventListener(t, function () { drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function (e) {
    e.preventDefault();
    var items = Array.prototype.slice.call(e.dataTransfer.items || []);
    var entries = items.map(function (it) { return it.webkitGetAsEntry ? it.webkitGetAsEntry() : null; }).filter(Boolean);
    if (!entries.length) { $('status').textContent = 'フォルダを読めませんでした。上の「フォルダを選ぶ」を使ってください。'; return; }
    entriesToFiles(entries).then(run);
  });
})();
