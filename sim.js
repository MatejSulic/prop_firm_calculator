/*
 * Simulační jádro prop trading kalkulačky.
 * Funguje v prohlížeči (window.Sim), ve Web Workeru (sim.js i Blob) a v Node (module.exports).
 */
(function (root, factory) {
  const api = factory();
  root.SimFactory = factory;
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.Sim = api;
    if (typeof WorkerGlobalScope !== 'undefined' && root instanceof WorkerGlobalScope) api.workerMain();
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function SimFactory() {
  'use strict';

  const MAX_DAYS = 1000; // pojistka proti nekonečné smyčce (běh se počítá jako neúspěch)
  const SENS_RATES = [50, 55, 60, 65, 70, 75];

  const DEFAULTS = {
    accountPrice: 39, resetPrice: 39, profitTarget: 1250, maxLoss: 1000, lockOffset: 100,
    dailyLoss: 600, consistency: 40, split: 90,
    winRate: 70, winRateFunded: 70, rr: 1.0, tradesPerDay: 1, riskEval: 350, riskFundedBefore: 225, riskFundedAfter: 300,
    payoutTarget: 1600, payoutSize: 500, maxPayouts: 5, minDaysBetween: 5, horizonDays: 250,
    budget: 5000, fxRate: 21, fxFee: 2, taxReserve: 15, maxAttempts: '',
    runs: 50000, fixedSeed: false,
  };

  // Rychlý seedovatelný PRNG
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Převod vstupů z UI (procenta, řetězce) na konfiguraci simulace
  function buildConfig(inp) {
    const n = (k) => Number(inp[k] ?? DEFAULTS[k]);
    return {
      p: n('winRate') / 100,
      pFunded: n('winRateFunded') / 100,
      rr: n('rr'),
      tradesPerDay: Math.max(1, Math.round(n('tradesPerDay'))),
      profitTarget: n('profitTarget'),
      maxLoss: n('maxLoss'),
      lockOffset: n('lockOffset'),
      dailyLoss: n('dailyLoss'),
      consistency: n('consistency') / 100,
      riskEval: n('riskEval'),
      riskFundedBefore: n('riskFundedBefore'),
      riskFundedAfter: n('riskFundedAfter'),
      payoutTarget: n('payoutTarget'),
      payoutSize: n('payoutSize'),
      maxPayouts: Math.max(0, Math.round(n('maxPayouts'))),
      minDaysBetween: Math.max(0, Math.round(n('minDaysBetween'))),
      horizonDays: Math.max(1, Math.round(n('horizonDays'))),
    };
  }

  function newAccount(cfg) {
    return { balance: 0, maxClose: 0, threshold: -cfg.maxLoss, locked: false };
  }

  // EOD trailing drawdown: hranice se posouvá jen podle zavíracího zůstatku, po zamčení je fixní.
  function endOfDay(acc, cfg) {
    if (acc.locked) return;
    if (acc.balance > acc.maxClose) acc.maxClose = acc.balance;
    if (acc.maxClose >= cfg.maxLoss + cfg.lockOffset) {
      acc.locked = true;
      acc.threshold = cfg.lockOffset;
    } else {
      acc.threshold = acc.maxClose - cfg.maxLoss;
    }
  }

  /*
   * Jeden obchodní den. isDone(balance, dayPnl) rozhoduje o splnění cíle (kontroluje se po každém obchodu).
   * Vrací { failed, done, trades, pnl }.
   */
  function simulateDay(acc, risk, cfg, rng, isDone, trace) {
    const start = acc.balance;
    let trades = 0;
    for (let i = 0; i < cfg.tradesPerDay; i++) {
      if (rng() < cfg.p) acc.balance += risk * cfg.rr;
      else acc.balance -= risk;
      trades++;
      if (trace) trace.push(acc.balance, acc.threshold);
      if (acc.balance <= acc.threshold) return { failed: true, done: false, trades, pnl: acc.balance - start };
      if (isDone && isDone(acc.balance, acc.balance - start)) return { failed: false, done: true, trades, pnl: acc.balance - start };
      if (cfg.dailyLoss > 0 && start - acc.balance >= cfg.dailyLoss) break; // DLL: dnes už neobchoduj
    }
    return { failed: false, done: false, trades, pnl: acc.balance - start };
  }

  // Evaluace: target + consistency. trace (volitelné) = pole trojic [x(den), balance, threshold, ...].
  function runEval(cfg, rng, trace) {
    const acc = newAccount(cfg);
    let bestDay = 0;
    const consistencyOn = cfg.consistency < 1;
    const isDone = (bal, dayPnl) => {
      if (bal < cfg.profitTarget) return false;
      if (!consistencyOn) return true;
      return Math.max(bestDay, dayPnl) <= cfg.consistency * bal;
    };
    const dayTrace = trace ? [] : null;
    if (trace) trace.push(0, acc.balance, acc.threshold);
    for (let day = 1; day <= MAX_DAYS; day++) {
      if (dayTrace) dayTrace.length = 0;
      const r = simulateDay(acc, cfg.riskEval, cfg, rng, isDone, dayTrace);
      if (trace) {
        // obchody rozprostři rovnoměrně do dne: x = den (zlomky dne = jednotlivé obchody)
        for (let j = 0; j < r.trades; j++) trace.push(day - 1 + (j + 1) / cfg.tradesPerDay, dayTrace[2 * j], dayTrace[2 * j + 1]);
      }
      if (r.failed) return { passed: false, days: day };
      if (r.done) return { passed: true, days: day };
      if (r.pnl > bestDay) bestDay = r.pnl;
      endOfDay(acc, cfg);
      if (trace) trace.push(day, acc.balance, acc.threshold); // posun hranice na konci dne
    }
    return { passed: false, days: MAX_DAYS, timeout: true };
  }

  /*
   * Funded účet od začátku do konce: výplata, kdykoli zůstatek dosáhne cílového zisku
   * (další výplaty až po min. počtu dní od předchozí), výběr sníží zůstatek o velikost výplaty.
   * Konec = pád, limit počtu výplat nebo horizont. Vrací { payouts, payoutDays, days, end }.
   */
  function runFundedLife(cfg, rng) {
    if (cfg.pFunded != null && cfg.pFunded !== cfg.p) cfg = { ...cfg, p: cfg.pFunded }; // vlastní úspěšnost na funded
    const acc = newAccount(cfg);
    const maxPay = cfg.maxPayouts > 0 ? cfg.maxPayouts : Infinity;
    const horizon = Math.min(MAX_DAYS, cfg.horizonDays || MAX_DAYS);
    const minGap = cfg.minDaysBetween || 0;
    const payoutDays = [];
    let day = 0;
    const isDone = (bal) => bal >= cfg.payoutTarget &&
      (!payoutDays.length || day - payoutDays[payoutDays.length - 1] >= minGap);
    for (day = 1; day <= horizon; day++) {
      const risk = acc.locked ? cfg.riskFundedAfter : cfg.riskFundedBefore;
      const r = simulateDay(acc, risk, cfg, rng, isDone, null);
      if (r.failed) return { payouts: payoutDays.length, payoutDays, days: day, end: 'fail' };
      if (r.done) {
        payoutDays.push(day);
        acc.balance -= cfg.payoutSize || 0;
        if (payoutDays.length >= maxPay) return { payouts: payoutDays.length, payoutDays, days: day, end: 'max' };
      }
      endOfDay(acc, cfg);
    }
    return { payouts: payoutDays.length, payoutDays, days: horizon, end: 'horizon' };
  }

  // Jen do první výplaty (kompatibilní tvar { passed, days })
  function runFunded(cfg, rng) {
    const r = runFundedLife({ ...cfg, maxPayouts: 1 }, rng);
    return r.payouts ? { passed: true, days: r.payoutDays[0] } : { passed: false, days: r.days, timeout: r.end === 'horizon' };
  }

  function percentile(sorted, q) {
    if (!sorted.length) return null;
    const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
    return sorted[idx];
  }

  function stats(arr) {
    const s = Float64Array.from(arr).sort();
    let sum = 0;
    for (const v of s) sum += v;
    return { n: s.length, median: percentile(s, 0.5), p80: percentile(s, 0.8), mean: s.length ? sum / s.length : null };
  }

  function simulate(cfg, runs, seed, opts) {
    const rng = mulberry32(seed);
    const keepDays = !opts || opts.keepDays !== false;
    let evalPass = 0, fundedPass = 0, timeouts = 0, payoutSum = 0, evalDaysAll = 0;
    const evalDays = [], fundedDays = [], totalDays = [], lifeDays = [];
    const payoutDist = [];
    for (let i = 0; i < runs; i++) {
      const e = runEval(cfg, rng);
      evalDaysAll += e.days;
      if (e.timeout) timeouts++;
      if (!e.passed) continue;
      evalPass++;
      if (keepDays) evalDays.push(e.days);
      const f = runFundedLife(cfg, rng);
      payoutDist[f.payouts] = (payoutDist[f.payouts] || 0) + 1;
      payoutSum += f.payouts;
      if (keepDays) lifeDays.push(f.days);
      if (!f.payouts) { if (f.end === 'horizon') timeouts++; continue; }
      fundedPass++;
      if (keepDays) { fundedDays.push(f.payoutDays[0]); totalDays.push(e.days + f.payoutDays[0]); }
    }
    const pEval = evalPass / runs;
    const pFunded = evalPass ? fundedPass / evalPass : 0;
    for (let i = 0; i < payoutDist.length; i++) payoutDist[i] = evalPass ? (payoutDist[i] || 0) / evalPass : 0;
    return {
      runs, pEval, pFunded, pTotal: fundedPass / runs, timeouts, evalDays, fundedDays, totalDays,
      payoutsPerFunded: evalPass ? payoutSum / evalPass : 0, payoutsPerAttempt: payoutSum / runs, payoutDist, lifeDays,
      meanEvalDaysAll: evalDaysAll / runs,
    };
  }

  function simulateEvalOnly(cfg, runs, seed) {
    const rng = mulberry32(seed);
    let pass = 0, days = 0, all = 0;
    const succ = [];
    for (let i = 0; i < runs; i++) {
      const e = runEval(cfg, rng);
      all += e.days;
      if (e.passed) { pass++; days += e.days; succ.push(e.days); }
    }
    return { p: pass / runs, meanDays: pass ? days / pass : null, meanDaysAll: all / runs, succ };
  }

  function simulateFundedOnly(cfg, runs, seed) {
    const rng = mulberry32(seed);
    let any = 0, sum = 0, days = 0, life = 0;
    const succ = [];
    for (let i = 0; i < runs; i++) {
      const f = runFundedLife(cfg, rng);
      life += f.days;
      if (f.payouts) { any++; days += f.payoutDays[0]; succ.push(f.payoutDays[0]); }
      sum += f.payouts;
    }
    return { pFunded: any / runs, meanPayouts: sum / runs, meanDays: any ? days / any : null, meanLifeDays: life / runs, succ };
  }

  /*
   * Optimalizace rizika: evaluace a funded jsou nezávislé, takže stačí 1D simulace pro každou hodnotu
   * a mřížka se složí jako součin. Riziko po zamčení drží aktuální poměr k riziku před zamčením.
   */
  function optimizeRisk(cfg, runs, seed) {
    const ml = cfg.maxLoss;
    const grid = [...new Set([0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5].map((f) => Math.max(5, Math.round(f * ml / 5) * 5)))];
    const ratio = cfg.riskFundedBefore > 0 ? cfg.riskFundedAfter / cfg.riskFundedBefore : 1;
    const afterOf = (r) => Math.max(5, Math.round(r * ratio / 5) * 5);
    const evals = grid.map((r, i) => simulateEvalOnly({ ...cfg, riskEval: r }, runs, seed + 101 * (i + 1)));
    const funded = grid.map((r, i) => simulateFundedOnly({ ...cfg, riskFundedBefore: r, riskFundedAfter: afterOf(r) }, runs, seed + 313 * (i + 1)));
    // Medián / 80. percentil dní do 1. výplaty pro každou buňku: běhy jsou nezávislé,
    // takže k-tý úspěšný běh evaluace + k-tý úspěšný běh funded = vzorek součtu.
    const daysQ = evals.map((e) => funded.map((f) => {
      const n = Math.min(e.succ.length, f.succ.length);
      if (!n) return { median: null, p80: null };
      const sum = new Float64Array(n);
      for (let k = 0; k < n; k++) sum[k] = e.succ[k] + f.succ[k];
      sum.sort();
      return { median: percentile(sum, 0.5), p80: percentile(sum, 0.8) };
    }));
    for (const x of evals) delete x.succ;
    for (const x of funded) delete x.succ;
    return { grid, after: grid.map(afterOf), ratio, evals, funded, daysQ, runs };
  }

  /*
   * Hranice úspěšnosti: projede úspěšnost (funded se posouvá o stejný rozdíl jako teď),
   * se stejnou náhodou pro každý bod (hladší křivka), a najde, kde křivky překročí hranice.
   */
  function breakEven(cfg, inp, runs, seed) {
    const delta = cfg.pFunded * 100 - cfg.p * 100;
    const m0 = computeMoney(inp, 0);
    const curve = [];
    for (let wr = 10; wr <= 95; wr += 2.5) {
      const wrF = Math.min(100, Math.max(0, wr + delta));
      const r = simulate({ ...cfg, p: wr / 100, pFunded: wrF / 100 }, runs, seed, { keepDays: false });
      curve.push({
        wr, wrF,
        pTotal: r.pTotal,
        pAny: 1 - Math.pow(1 - r.pTotal, m0.attempts),
        evAll: r.payoutsPerAttempt * m0.payoutCzk - m0.attemptCzk,
        evFirst: r.pTotal * m0.payoutCzk - m0.attemptCzk,
      });
    }
    const cross = (key, level) => {
      if (curve[0][key] >= level) return { wr: null, below: true };
      for (let i = 1; i < curve.length; i++) {
        const a = curve[i - 1], b = curve[i];
        if (b[key] >= level) {
          const t = (level - a[key]) / ((b[key] - a[key]) || 1);
          return { wr: a.wr + t * (b.wr - a.wr) };
        }
      }
      return { wr: null, above: true };
    };
    return {
      curve, delta, runs,
      perTrade: 100 / (1 + cfg.rr), // čistě matematická hranice jednoho obchodu
      evAll: cross('evAll', 0),
      evFirst: cross('evFirst', 0),
      pAny50: cross('pAny', 0.5),
      pAny90: cross('pAny', 0.9),
    };
  }

  function computeMoney(inp, pTotal) {
    const n = (k) => Number(inp[k] ?? DEFAULTS[k]);
    const attemptUsd = Math.min(n('accountPrice'), n('resetPrice'));
    const attemptCzk = attemptUsd * n('fxRate') * (1 + n('fxFee') / 100);
    const autoAttempts = attemptCzk > 0 ? Math.floor(n('budget') / attemptCzk) : 0;
    const manual = inp.maxAttempts !== '' && inp.maxAttempts != null && Number(inp.maxAttempts) > 0;
    const attempts = manual ? Math.floor(Number(inp.maxAttempts)) : autoAttempts;
    const payoutCzk = n('payoutSize') * (n('split') / 100) * (1 - n('taxReserve') / 100) * n('fxRate');
    const q = 1 - pTotal;
    const pAny = 1 - Math.pow(q, attempts);
    const expAttemptsInBudget = pTotal > 0 ? (1 - Math.pow(q, attempts)) / pTotal : attempts;
    const expCostInBudget = attemptCzk * expAttemptsInBudget;
    return {
      attemptUsd, attemptCzk, autoAttempts, attempts, manualAttempts: manual, payoutCzk,
      pAny,
      pLoseAll: Math.pow(q, attempts),
      expAttemptsToPayout: pTotal > 0 ? 1 / pTotal : Infinity,
      expCostToPayout: pTotal > 0 ? attemptCzk / pTotal : Infinity,
      expAttemptsInBudget, expCostInBudget,
      expNet: payoutCzk * pAny - expCostInBudget,
      evPerAttempt: pTotal * payoutCzk - attemptCzk,
    };
  }

  function histogram(days, maxBins) {
    if (!days.length) return { bins: [], width: 1, start: 0 };
    let min = Infinity, max = -Infinity;
    for (const d of days) { if (d < min) min = d; if (d > max) max = d; }
    const cap = percentile(Float64Array.from(days).sort(), 0.99); // ořízni dlouhý chvost
    const hi = Math.max(min, cap);
    const width = Math.max(1, Math.ceil((hi - min + 1) / maxBins));
    const count = Math.floor((hi - min) / width) + 1;
    const bins = new Array(count).fill(0);
    let overflow = 0;
    for (const d of days) {
      if (d > hi) { overflow++; continue; }
      bins[Math.floor((d - min) / width)]++;
    }
    return { bins, width, start: min, overflow, max };
  }

  function sampleTrajectories(cfg, count, seed) {
    const rng = mulberry32(seed ^ 0x9e3779b9);
    const out = [];
    for (let i = 0; i < count; i++) {
      const trace = [];
      const r = runEval(cfg, rng, trace);
      out.push({ passed: r.passed, days: r.days, points: trace });
    }
    return out;
  }

  // Kompletní výpočet pro UI
  function runAll(inp, seed) {
    const cfg = buildConfig(inp);
    const runs = Math.max(100, Math.min(1000000, Math.round(Number(inp.runs) || DEFAULTS.runs)));
    const main = simulate(cfg, runs, seed);
    const money = computeMoney(inp, main.pTotal);

    // Řádky = úspěšnost evaluace; funded se posouvá o stejný rozdíl jako v aktuálním nastavení.
    const rates = SENS_RATES.slice();
    const cur = Number(inp.winRate);
    const delta = cfg.pFunded * 100 - cur;
    if (!rates.includes(cur)) rates.push(cur);
    rates.sort((a, b) => a - b);
    const sensRuns = Math.max(2000, Math.round(runs / 2));
    const sensitivity = rates.map((wr, i) => {
      const wrF = Math.min(100, Math.max(0, wr + delta));
      const r = wr === cur ? main : simulate({ ...cfg, p: wr / 100, pFunded: wrF / 100 }, sensRuns, seed + 7919 * (i + 1), { keepDays: false });
      return {
        winRate: wr, winRateFunded: wrF, current: wr === cur,
        pEval: r.pEval, pFunded: r.pFunded, pTotal: r.pTotal,
        pAny: computeMoney(inp, r.pTotal).pAny,
      };
    });

    const breakeven = breakEven(cfg, inp, Math.max(1500, Math.round(runs / 25)), seed + 4243);
    const optimizer = optimizeRisk(cfg, Math.max(4000, Math.round(runs / 5)), seed + 99991);
    const life = {
      payoutsPerFunded: main.payoutsPerFunded,
      payoutsPerAttempt: main.payoutsPerAttempt,
      payoutDist: main.payoutDist,
      lifeDays: stats(main.lifeDays),
      evPerAttempt: main.payoutsPerAttempt * money.payoutCzk - money.attemptCzk,
      payoutsTotalCzk: main.payoutsPerFunded * money.payoutCzk,
    };
    // Dlouhodobý zisk za obchodní den při opakování pokusů (renewal-reward):
    // E[zisk na pokus] / E[dní na pokus], kde dny = evaluace (i neúspěšná) + celý život funded účtu.
    const lifeMean = stats(main.lifeDays).mean || 0;
    life.daysPerAttempt = main.meanEvalDaysAll + main.pEval * lifeMean;
    life.profitPerDay = life.daysPerAttempt > 0 ? life.evPerAttempt / life.daysPerAttempt : 0;

    return {
      runs, life, optimizer, breakeven,
      pEval: main.pEval, pFunded: main.pFunded, pTotal: main.pTotal, timeouts: main.timeouts,
      money,
      time: { eval: stats(main.evalDays), funded: stats(main.fundedDays), total: stats(main.totalDays) },
      histogram: histogram(main.totalDays, 40),
      sensitivity,
      trajectories: sampleTrajectories(cfg, 20, seed),
      cfg,
    };
  }

  function workerMain() {
    self.onmessage = (e) => {
      const { id, inputs, seed } = e.data;
      try {
        self.postMessage({ id, result: runAll(inputs, seed) });
      } catch (err) {
        self.postMessage({ id, error: String(err && err.message || err) });
      }
    };
  }

  return {
    DEFAULTS, SENS_RATES, MAX_DAYS,
    mulberry32, buildConfig, newAccount, endOfDay, simulateDay, runEval, runFunded, runFundedLife,
    simulateEvalOnly, simulateFundedOnly, optimizeRisk, breakEven,
    simulate, computeMoney, histogram, stats, sampleTrajectories, runAll, workerMain,
  };
});
