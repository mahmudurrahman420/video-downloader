// Echo TAP output and turn each failing test into a GitHub annotation (readable via the checks API).
import { createInterface } from 'node:readline';
const rl = createInterface({ input: process.stdin });
let current = null;
const results = [];
const flush = () => {
  if (!current) return;
  const msg = current.lines.join(' | ').replace(/\r?\n/g, ' ').slice(0, 900);
  console.log(`::error title=${current.name.replace(/[:,]/g, ' ')}::${msg}`);
  current = null;
};
for await (const line of rl) {
  console.log(line);
  const m = line.match(/^\s*not ok \d+ - (.*)$/);
  if (m) { flush(); current = { name: m[1], lines: [] }; continue; }
  if (current) {
    if (/^\s*(ok|not ok) \d+/.test(line) || /^# (tests|pass|fail)/.test(line)) { flush(); continue; }
    if (/error:|message|expected|actual|code:|cause/i.test(line)) current.lines.push(line.trim());
  }
  const ok = line.match(/^\s*ok \d+ - (LIVE.*)$/);
  if (ok) { results.push(`PASS ${ok[1]}`); console.log(`::notice title=PASSED::${ok[1]}`); }
  const bad = line.match(/^\s*not ok \d+ - (LIVE.*)$/);
  if (bad) results.push(`FAIL ${bad[1]}`);
}
flush();
console.log(`::notice title=LIVE SUMMARY::${results.join(' ; ') || 'no results parsed'}`);
