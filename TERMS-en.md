# tenukiban — Terms of use

tenukiban (手抜き番) — a tool that finds shortcuts and fake success in AI-written code (free prototype).

This English text was translated with AI and has not been checked by a native speaker. If this English version and the Japanese version differ, the Japanese version ([利用条件.md](利用条件.md)) is the original.

## 1. What this tool does

- It runs on your own computer, reads the files in the folder you choose, compares them with the "baseline" recorded when you started, and reports (in Japanese) regressions, fake-success code and weakened checks.
- It writes `.tenukiban/` and `tenukiban.config.json` in your project and a baseline copy in `.tenukiban` in your home folder. With `init --apply` it also writes to `CLAUDE.md`, `AGENTS.md` and `.claude/settings.json`. With `report --out` it writes the report file you name.
- Before using it, make sure your project can be restored (for example with git).

## 2. We do not collect or send your data

- tenukiban does not send your code, results or reports anywhere, including to the provider. It contains no code that connects to the internet and does not call any AI service. The browser page (`web/index.html`) also blocks network access with its Content Security Policy.
- The tool is distributed through GitHub (a service of GitHub, Inc.). GitHub may keep connection records (such as IP addresses) of people who view or download it, for security purposes. Please see GitHub's privacy statement. GitHub may show repository owners aggregated statistics such as view counts; the provider does not use them to identify individuals.

## 3. No guarantee

- This tool is not a certification or a guarantee. It only finds fixed patterns (in the developer's own tests it missed about half of unseen bad patterns and wrongly flagged about 7–8% of correct code; see "数字" in the README). **Passing does not mean the code is correct or safe.**
- The report is not a signature. Check its contents yourself (or have the recipient check) before relying on it.
- The developer has tested it only on Windows with Node 24.
- The tool is provided "as is", free of charge.
- If the provider is liable for any damage you suffer from using, or being unable to use, this tool, the provider's total liability is limited to JPY 10,000.
- This cap applies only to damage caused by the provider's ordinary (slight) negligence. It does not apply to damage caused by the provider's willful misconduct or gross negligence.
- Nothing in these terms limits any rights you have under mandatory consumer-protection laws of your country or region.
- The tool does not decide whether your use of AI services complies with your organisation's or your clients' rules, and does not give legal advice.

## 4. What you may do

- You may view the code and use the tool for yourself or within your own organisation free of charge.
- Redistribution, distributing modified versions, resale, incorporation into other products and reuse of the code require the provider's written permission ([LICENSE](LICENSE)).

## 5. Provider

HARVEST (Japan) / Contact: garageten.info@gmail.com (this address dates from our former name, GARAGE TEN)

This tool is free.

## 6. Changes

These terms may change. Changes will be recorded in this file with a date.

Last updated: November 15, 2026
