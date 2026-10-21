# Prop kalkulačka

Lokální webová kalkulačka pro plánování prop trading účtů: Monte Carlo simulace pravděpodobnosti projití evaluace, výplat z funded účtu a finančního výsledku v rámci rozpočtu. Není to trade journal.

## Spuštění

Otevři `index.html` v prohlížeči (dvojklik). `sim.js` musí ležet ve stejné složce. Bez buildu a bez závislostí.

Výpočet běží ve Web Workeru; při otevření přes `file://` se automaticky spustí přes Blob URL.

## Testy

```
node --test
```

## Co umí

- EOD trailing drawdown se zamčením, daily loss limit, consistency pravidlo
- Evaluace a funded fáze s vlastní úspěšností a rizikem (před / po zamčení drawdownu)
- Více výplat z funded účtu (limit výplat, min. dní mezi výplatami, horizont)
- Peníze v Kč: cena pokusu, výplata po splitu a daních, očekávaný zisk
- Čas: medián a 80. percentil dní, histogram, ukázkové trajektorie
- Citlivost na úspěšnost a hranice úspěšnosti (od kdy se to vyplatí)
- Optimalizátor rizika: heatmapa riziko evaluace × funded, slider cílového času
- Vstupy se ukládají do localStorage, světlý i tmavý režim, funguje na mobilu

Model předpokládá nezávislé obchody a konstantní úspěšnost, nezahrnuje skluz, poplatky ani psychologii. Není to finanční poradenství.
