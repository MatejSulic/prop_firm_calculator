# Prop kalkulačka

Lokální webová kalkulačka pro plánování prop trading účtů: Monte Carlo simulace pravděpodobnosti projití evaluace, výplat z funded účtu a finančního výsledku v rámci rozpočtu. Není to trade journal.

## Jak to stáhnout a spustit (krok za krokem)

Nic se neinstaluje. Potřebuješ jen webový prohlížeč (Chrome, Firefox, Edge, Safari…).

### Možnost A: stažení jako ZIP (nejjednodušší)

1. Otevři stránku projektu: https://github.com/MatejSulic/prop_firm_calculator
2. Klikni na zelené tlačítko **`<> Code`** (vpravo nahoře nad seznamem souborů).
3. V menu, které se otevře, klikni úplně dole na **Download ZIP**.
4. Počkej, až se stáhne soubor `prop_firm_calculator-main.zip` (najdeš ho ve složce **Stažené soubory / Downloads**).
5. Soubor rozbal:
   - **Windows:** klikni na ZIP pravým tlačítkem → **Extrahovat vše…** → **Extrahovat**.
   - **macOS:** dvakrát klikni na ZIP, rozbalí se sám.
   - **Linux:** klikni pravým tlačítkem → **Rozbalit sem** (nebo v terminálu `unzip prop_firm_calculator-main.zip`).
6. Otevři rozbalenou složku `prop_firm_calculator-main`.
7. **Dvakrát klikni na soubor `index.html`.** Otevře se v prohlížeči a kalkulačka hned počítá.

Hotovo. Příště stačí znovu dvakrát kliknout na `index.html`.

> Pozor: soubory `index.html` a `sim.js` musí zůstat **ve stejné složce**. Nepřesouvej jen `index.html` jinam, jinak se nic nespočítá.
>
> Když se `index.html` otevře v jiném programu než v prohlížeči (třeba v textovém editoru), klikni na něj pravým tlačítkem → **Otevřít v aplikaci / Otevřít pomocí** → vyber prohlížeč.

### Možnost B: přes git (pokud git znáš)

```
git clone https://github.com/MatejSulic/prop_firm_calculator.git
cd prop_firm_calculator
```

Pak otevři `index.html` v prohlížeči:

- **Windows:** `start index.html`
- **macOS:** `open index.html`
- **Linux:** `xdg-open index.html`

Aktualizace na novou verzi: ve složce spusť `git pull` a obnov stránku v prohlížeči (F5).

### Jak to používat

- Vlevo jsou vstupy (účet, obchodování, peníze). Přepiš libovolné číslo a výsledky vpravo se samy přepočítají (za necelou sekundu).
- Nastavení se ukládá v prohlížeči, takže po zavření a znovuotevření tam zůstane.
- Tlačítko **Obnovit výchozí hodnoty** vrátí všechno na začátek.
- Úplně dole je **Optimální riziko a čas**: posuň slider na počet dní, do kdy chceš výplatu, a klikni na **Nastavit** u doporučení.

## Testy (jen pro vývojáře, běžně nepotřebuješ)

Potřebuješ [Node.js](https://nodejs.org) verze 18 nebo novější. Ve složce projektu spusť:

```
node --test
```

Výpočet běží ve Web Workeru. Při otevření přes `file://` se automaticky spustí přes Blob URL.

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
