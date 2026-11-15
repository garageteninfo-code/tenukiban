// 正直さ検査の Node 側（ファイルを読んで scan-core の scanText に渡す）。
// 規則は rules/*.json。同僚が測った規則ファイルを 1 文字も変えずに使っている（test で照らし合わせる）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listFiles, toRel, isTestFile } from './config.mjs';
import { compileRules, scanText, fingerprint } from './scan-core.mjs';

export const RULES_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'rules');

export function loadRuleSets(cfg) {
  return cfg.honesty.rules.map((ref) => {
    const file = ref.startsWith('builtin:') ? path.join(RULES_DIR, `honesty.${ref.slice(8)}.json`) : path.resolve(cfg._root, ref);
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  });
}

export const loadRules = (cfg) => compileRules(loadRuleSets(cfg), { disable: cfg.honesty.disable });

export function runHonesty(cfg, files = listFiles(cfg)) {
  const rules = loadRules(cfg);
  const violations = [];
  for (const f of files) {
    const rel = toRel(cfg._root, f);
    const hits = scanText(fs.readFileSync(f, 'utf8'), rules, { waiverTokens: cfg.honesty.waiverTokens, isTest: isTestFile(cfg, rel), ext: path.extname(f) });
    for (const h of hits) {
      violations.push({
        file: rel, line: h.line, rule: h.rule.id, kind: h.rule.kind, message: h.rule.message, fix: h.rule.fix, text: h.text,
        key: `${h.rule.id}@${rel}`, fp: fingerprint(`${rel}\0${h.rule.id}\0${h.text}`),
      });
    }
  }
  const counts = {};
  for (const v of violations) counts[v.key] = (counts[v.key] || 0) + 1;
  return { files: files.length, rules: rules.length, violations, counts };
}
