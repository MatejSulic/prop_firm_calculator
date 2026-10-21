// Spuštění: node --test
const test = require('node:test');
const assert = require('node:assert/strict');
const Sim = require('./sim.js');

const base = (over) => Sim.buildConfig({ ...Sim.DEFAULTS, ...over });

test('p = 1.0 → evaluace 100 %', () => {
  const r = Sim.simulate(base({ winRate: 100 }), 5000, 1);
  assert.equal(r.pEval, 1);
});

test('p = 0 → evaluace 0 %', () => {
  const r = Sim.simulate(base({ winRate: 0 }), 5000, 1);
  assert.equal(r.pEval, 0);
});

test('p = 0.7, R:R 1, 1 obchod/den, risk 350, consistency vypnutá → evaluace zhruba 80–85 %', () => {
  const cfg = base({ winRate: 70, rr: 1, tradesPerDay: 1, riskEval: 350, profitTarget: 1250, maxLoss: 1000, consistency: 100 });
  const r = Sim.simulate(cfg, 50000, 42);
  console.log(`    evaluace = ${(r.pEval * 100).toFixed(2)} %`);
  assert.ok(r.pEval >= 0.80 && r.pEval <= 0.85, `pEval = ${r.pEval}`);
});

test('zamčení drawdownu: po zavíracím zůstatku +1100 je hranice start + 100 a dál se nehýbe', () => {
  const cfg = base({});
  const acc = Sim.newAccount(cfg);
  assert.equal(acc.threshold, -1000);

  acc.balance = 600; Sim.endOfDay(acc, cfg);
  assert.equal(acc.threshold, -400);
  assert.equal(acc.locked, false);

  acc.balance = 1099; Sim.endOfDay(acc, cfg);
  assert.equal(acc.threshold, 99);
  assert.equal(acc.locked, false);

  acc.balance = 1100; Sim.endOfDay(acc, cfg);
  assert.equal(acc.locked, true);
  assert.equal(acc.threshold, 100);

  for (const b of [2000, 5000, 300]) {
    acc.balance = b; Sim.endOfDay(acc, cfg);
    assert.equal(acc.threshold, 100);
  }
});

test('hranice se během dne neposouvá (EOD), ale pád je okamžitý', () => {
  const cfg = base({ tradesPerDay: 3, dailyLoss: 0 });
  const acc = Sim.newAccount(cfg);
  // den 1: výhra, výhra, ztráta → zavírací zůstatek +350; hranice se během dne nemění
  const seq = [0, 0, 0.99];
  let i = 0;
  const r = Sim.simulateDay(acc, 350, cfg, () => seq[i++], null);
  assert.equal(r.failed, false);
  assert.equal(acc.balance, 350);
  assert.equal(acc.threshold, -1000);
  Sim.endOfDay(acc, cfg);
  assert.equal(acc.threshold, -650);
  // další den: 3 ztráty → 350 - 1050 = -700 <= -650 → pád uvnitř dne
  const r2 = Sim.simulateDay(acc, 350, cfg, () => 0.99, null);
  assert.equal(r2.failed, true);
  assert.equal(r2.trades, 3);
});

test('DLL: po dosažení denní ztráty se ten den už neobchoduje (účet nespadne)', () => {
  const cfg = base({ tradesPerDay: 5, dailyLoss: 600, maxLoss: 1000 });
  const acc = Sim.newAccount(cfg);
  const r = Sim.simulateDay(acc, 350, cfg, () => 0.99, null); // samé ztráty
  assert.equal(r.trades, 2); // -350, -700 → stop
  assert.equal(r.failed, false);
  assert.equal(acc.balance, -700);
});

test('consistency: target splněný, ale jeden velký den → obchoduje se dál', () => {
  // risk 1300 na jeden výherní obchod = celý zisk za 1 den → 100 % > 40 %
  const cfg = base({ winRate: 100, riskEval: 1300, maxLoss: 5000 });
  const r = Sim.runEval(cfg, () => 0);
  assert.equal(r.passed, true);
  assert.ok(r.days > 1, `days = ${r.days}`);
  // bez consistency projde hned první den
  const r2 = Sim.runEval({ ...cfg, consistency: 1 }, () => 0);
  assert.equal(r2.days, 1);
});

test('peníze: cena pokusu, počet pokusů a výplata', () => {
  const m = Sim.computeMoney(Sim.DEFAULTS, 0.5);
  assert.ok(Math.abs(m.attemptCzk - 39 * 21 * 1.02) < 1e-9);
  assert.equal(m.attempts, 5);
  assert.ok(Math.abs(m.payoutCzk - 500 * 0.9 * 0.85 * 21) < 1e-9);
  assert.ok(Math.abs(m.pAny - (1 - 0.5 ** 5)) < 1e-12);
  const m2 = Sim.computeMoney({ ...Sim.DEFAULTS, maxAttempts: 3 }, 0.5);
  assert.equal(m2.attempts, 3);
});

test('stejný seed → stejný výsledek', () => {
  const a = Sim.simulate(base({}), 3000, 123);
  const b = Sim.simulate(base({}), 3000, 123);
  assert.equal(a.pTotal, b.pTotal);
});

test('úspěšnost funded je oddělená od evaluace', () => {
  const r = Sim.simulate(base({ winRate: 100, winRateFunded: 0 }), 2000, 5);
  assert.equal(r.pEval, 1);
  assert.equal(r.pFunded, 0);
  const r2 = Sim.simulate(base({ winRate: 100, winRateFunded: 100 }), 2000, 5);
  assert.equal(r2.pFunded, 1);
});

test('funded: víc výplat až do limitu, s minimálním odstupem dní', () => {
  const cfg = base({ winRateFunded: 100, maxPayouts: 3, minDaysBetween: 5 });
  const r = Sim.runFundedLife(cfg, Math.random);
  assert.equal(r.payouts, 3);
  assert.equal(r.end, 'max');
  for (let i = 1; i < r.payoutDays.length; i++) assert.ok(r.payoutDays[i] - r.payoutDays[i - 1] >= 5);
});

test('funded: výplata sníží zůstatek, při p = 0 žádná výplata', () => {
  const r = Sim.runFundedLife(base({ winRateFunded: 0 }), Math.random);
  assert.equal(r.payouts, 0);
  assert.equal(r.end, 'fail');
  // horizont omezí počet výplat, když limit není
  const r2 = Sim.runFundedLife(base({ winRateFunded: 100, maxPayouts: 0, horizonDays: 30, minDaysBetween: 0 }), Math.random);
  assert.equal(r2.end, 'horizon');
  assert.ok(r2.payouts > 1);
});

test('optimalizace rizika: mřížka a pravděpodobnosti v rozsahu', () => {
  const o = Sim.optimizeRisk(base({}), 2000, 3);
  assert.deepEqual(o.grid, [100, 150, 200, 250, 300, 350, 400, 450, 500]);
  assert.equal(o.after[1], 200); // 150 × 300/225
  for (const e of o.evals) assert.ok(e.p >= 0 && e.p <= 1);
  for (const f of o.funded) assert.ok(f.meanPayouts >= f.pFunded);
});

test('zisk za den: hodnoty pro optimalizaci jsou konzistentní', () => {
  const r = Sim.runAll({ ...Sim.DEFAULTS, runs: 4000 }, 9);
  assert.ok(r.life.daysPerAttempt > 0);
  assert.ok(Math.abs(r.life.profitPerDay - r.life.evPerAttempt / r.life.daysPerAttempt) < 1e-9);
  for (const e of r.optimizer.evals) assert.ok(e.meanDaysAll > 0);
  for (const f of r.optimizer.funded) assert.ok(f.meanLifeDays > 0);
});

test('optimalizace: medián dní pro každou buňku, menší riziko = pomalejší', () => {
  const o = Sim.optimizeRisk(base({}), 3000, 4);
  assert.equal(o.daysQ.length, o.grid.length);
  const slow = o.daysQ[0][0].median, fast = o.daysQ[o.grid.length - 1][o.grid.length - 1].median;
  assert.ok(slow > fast, `${slow} > ${fast}`);
  assert.ok(o.daysQ[3][3].p80 >= o.daysQ[3][3].median);
});

test('hranice úspěšnosti: kladný zisk při vyšší úspěšnosti, pořadí hranic dává smysl', () => {
  const cfg = base({});
  const b = Sim.breakEven(cfg, Sim.DEFAULTS, 1500, 11);
  assert.ok(b.evAll.wr > 40 && b.evAll.wr < 70, `evAll ${b.evAll.wr}`);
  assert.ok(b.evFirst.wr >= b.evAll.wr - 1, 'jen 1. výplata potřebuje aspoň stejnou úspěšnost');
  assert.ok(b.pAny90.wr > b.pAny50.wr);
  assert.equal(b.perTrade, 50);
});
