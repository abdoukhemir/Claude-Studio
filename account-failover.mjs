// Keeps one Studio tab working through usage limits: when its account's session limit is used up,
// the tab moves to another account that still has room and is told to carry on. No Claude credits used.
// Usage: node account-failover.mjs <sid>   (log: data/failover.log)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SID = process.argv[2];
const STUDIO = 'http://localhost:4600';
const HELPER = 'http://localhost:4548';
const LOG = path.join(path.dirname(fileURLToPath(import.meta.url)), 'data', 'failover.log');
const log = (m) => fs.appendFileSync(LOG, `${new Date().toISOString()} ${m}\n`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = async (url, body) => (await fetch(url, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : undefined)).json();

const sessionPct = (u) => u?.limits?.find((l) => /session/i.test(l.label))?.pct ?? 0;
const weekPct = (u) => u?.limits?.find((l) => /week/i.test(l.label))?.pct ?? 0;
const full = (u) => sessionPct(u) >= 100 || weekPct(u) >= 100;

async function tab() {
  for (const p of await json(`${STUDIO}/api/projects`)) {
    const list = await json(`${STUDIO}/api/p/${p.id}/sessions`).catch(() => []);
    const s = (list.sessions ?? list).find((x) => x.sid === SID);
    if (s) return s;
  }
  return null;
}

log(`watching tab ${SID}`);
let lastSwitch = 0;
for (;;) {
  try {
    const s = await tab();
    if (!s) log('tab not found');
    else {
      const here = await json(`${HELPER}/usage?account=${s.account}`);
      if (full(here) && Date.now() - lastSwitch > 15 * 60_000) {
        const { list } = await json(`${STUDIO}/api/accounts`);
        let to = null;
        for (const a of list.filter((a) => a.id !== s.account && a.loggedIn)) {
          if (!full(await json(`${HELPER}/usage?account=${a.id}`))) (to = a.id), true;
          if (to) break;
        }
        if (!to) log(`${s.account} is full and no other account has room; waiting`);
        else {
          log(`${s.account} is full: moving the tab to ${to}`);
          await json(`${STUDIO}/api/s/${SID}/restart`, { account: to });
          lastSwitch = Date.now();
          await sleep(25_000);
          await json(`${STUDIO}/api/s/${SID}/input`, {
            text: `The usage limit was reached on the other account, so this tab moved to account "${to}". Carry on with the pending work exactly where you stopped.`,
          });
          log('told Claude to carry on');
        }
      }
    }
  } catch (e) {
    log(`error: ${e.message}`);
  }
  await sleep(120_000);
}
