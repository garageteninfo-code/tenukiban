// 設定（tenukiban.config.json）の読み込みと、対象ファイルの列挙。
// 同僚の 歯止め/改良/lib/config.mjs を写して、手抜き番用に既定値を足した。
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_TEST_PATTERN, DEFAULT_WAIVERS, DEFAULT_GATE_SCRIPTS } from './scan-core.mjs';

export const CONFIG_NAME = 'tenukiban.config.json';

export const DEFAULTS = {
  include: ['.'],
  exclude: ['node_modules', 'dist', 'build', 'out', 'coverage', '.git', '.next', '.tenukiban', '.hadome', 'vendor', 'data', 'backups', 'tmp', '.venv', 'venv', '__pycache__', '.tox', '.nox', '.mypy_cache', '.pytest_cache', '.ruff_cache', 'site-packages'],
  excludePaths: [],
  extensions: ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.tsx', '.vue', '.svelte', '.html', '.py'],
  testFilePattern: DEFAULT_TEST_PATTERN,
  maxFileBytes: 1024 * 1024,
  minFiles: 1,
  baselineFile: '.tenukiban/baseline.json',
  debt: {
    bigFileLines: 800,
    dataOnly: ['locales/', 'i18n/'],
    metrics: [
      { id: 'asAny', pattern: '\\bas\\s+any\\b', note: '型逃げ（TypeScript）' },
      { id: 'tsIgnore', pattern: '@ts-(ignore|nocheck)', note: '型検査の無効化' },
      { id: 'lintDisable', pattern: 'eslint-disable', note: 'リンターの無効化' },
      { id: 'emptyCatch', pattern: '\\bcatch\\s*(\\(\\s*[^)]*\\))?\\s*\\{(\\s|/\\*\\s*\\*/)*\\}', note: '空の catch（エラーの握りつぶし）' },
      { id: 'todo', pattern: '\\b(TODO|FIXME|XXX|HACK)\\b', note: '残したままの TODO' },
      { id: 'waivers', pattern: 'tenukiban-allow|hadome-allow|honesty-allow', note: '免除コメントの数（黙って増やさない）' },
      // Python（2026-11-14 手抜き番で足した）
      { id: 'pyBareExcept', pattern: '^[ \t]*except[ \t]*:', flags: 'm', note: '何でも受け止める except:（Python）' },
      { id: 'pyNoqa', pattern: '#[ \t]*noqa\b', note: '点検を止める印 # noqa（Python）' },
      { id: 'pyTypeIgnore', pattern: '#[ \t]*type:[ \t]*ignore', note: '型の確かめを止める印 # type: ignore（Python）' },
      { id: 'pyNoCover', pattern: 'pragma:[ \t]*no[ \t]*cover', note: 'カバレッジから外す印 # pragma: no cover（Python）' },
    ],
  },
  honesty: {
    rules: ['builtin:code', 'builtin:ja', 'builtin:en', 'builtin:python'],
    disable: [],
    waiverTokens: DEFAULT_WAIVERS,
  },
  guards: {
    gateScripts: DEFAULT_GATE_SCRIPTS,
    protected: [
      'tenukiban.config.json',
      '.claude/settings.json',
      '.claude/settings.local.json',
      '.github/workflows/*',
      '.husky/*',
      '.githooks/*',
      '{vitest,jest,playwright,karma,cypress}.config.*',
      '.mocharc*',
      'tsconfig*.json',
      'eslint.config.*',
      '.eslintrc*',
      // Python の試験・点検の設定（ファイル全体）。pyproject.toml・tox.ini・setup.cfg は段落だけを見る（guards.mjs）
      'pytest.ini',
      '.coveragerc',
      'noxfile.py',
      'mypy.ini',
      '.flake8',
      '{ruff,.ruff}.toml',
      '.pre-commit-config.yaml',
    ],
    markerFiles: ['CLAUDE.md', 'AGENTS.md', '.github/copilot-instructions.md', '.cursorrules'],
    nodeModules: true,
    nodeModulesMaxFiles: 60000,
  },
  coverage: null,
  api: null,
};

function merge(a, b) {
  if (b === undefined) return a;
  if (Array.isArray(a) || Array.isArray(b) || typeof a !== 'object' || a === null || typeof b !== 'object' || b === null) return b;
  const out = { ...a };
  for (const k of Object.keys(b)) out[k] = merge(a[k], b[k]);
  return out;
}

export function loadConfig({ root, configPath }) {
  const file = configPath ? path.resolve(configPath) : path.join(root, CONFIG_NAME);
  let user = {};
  if (fs.existsSync(file)) {
    try { user = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`${path.basename(file)} が JSON として読めません: ${e.message}`); }
  } else if (configPath) throw new Error(`設定ファイルが見つかりません: ${file}`);
  const cfg = merge(DEFAULTS, user);
  cfg._file = fs.existsSync(file) ? file : null;
  cfg._root = path.resolve(root);
  return cfg;
}

const NEVER_READ = /(^|[\\/])(\.env[^\\/]*|\.system_key[^\\/]*|[^\\/]*\.(pem|key|p12|pfx))$/i;

/** 設定にしたがって対象ファイル（絶対パス）を列挙する。.env・鍵ファイルは設定に関係なく読まない。 */
export function listFiles(cfg, { extensions = cfg.extensions } = {}) {
  const root = cfg._root;
  const skipNames = new Set(cfg.exclude);
  const skipPaths = (cfg.excludePaths || []).map((p) => new RegExp(p));
  const exts = new Set(extensions.map((e) => e.toLowerCase()));
  const out = [];
  const seen = new Set();
  function walk(dir) {
    let ents;
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } // 読めないフォルダは飛ばす（件数 0 なら呼び出し側で失敗させる）
    for (const e of ents) {
      if (skipNames.has(e.name)) continue;
      const p = path.join(dir, e.name);
      const rel = toRel(root, p);
      if (skipPaths.some((r) => r.test(rel))) continue;
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        if (NEVER_READ.test(e.name)) continue;
        if (/\.min\.js$/i.test(e.name)) continue;
        if (!exts.has(path.extname(e.name).toLowerCase())) continue;
        if (seen.has(p)) continue;
        seen.add(p);
        try { if (fs.statSync(p).size > cfg.maxFileBytes) continue; } catch { continue; } // 消えたファイルは数えない
        out.push(p);
      }
    }
  }
  for (const inc of cfg.include) {
    const abs = path.resolve(root, inc);
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) out.push(abs);
    else walk(abs);
  }
  return out.sort();
}

export const toRel = (root, p) => path.relative(root, p).split(path.sep).join('/');

/** 簡単なワイルドカード（* と {a,b}）を正規表現に。パスの区切りは / */
export function globToRe(glob) {
  let s = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') s += '[^/]*';
    else if (c === '{') { const j = glob.indexOf('}', i); s += '(' + glob.slice(i + 1, j).split(',').map((x) => x.replace(/[.+^$()|[\]\\]/g, '\\$&')).join('|') + ')'; i = j; }
    else s += c.replace(/[.+^$()|[\]\\?]/g, '\\$&');
  }
  return new RegExp('^' + s + '$', 'i');
}
export const isTestFile = (cfg, rel) => new RegExp(cfg.testFilePattern).test(rel);
export const lineOf = (text, index) => { let n = 1; for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++; return n; };
