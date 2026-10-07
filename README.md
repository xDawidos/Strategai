# Frontline Sectors

Przeglądarkowa gra RTS 2D (widok z góry, pixel art) dla jednego gracza przeciwko AI.
Niebiescy (Ty) kontra Czerwoni (AI) walczą o strefy na jednej, ręcznie przygotowanej mapie 2400 × 1600.
Zbudowana w **TypeScript + Vite + Phaser 3**, bez backendu, wszystkie zasoby lokalne
(grafiki jednostek i terenu są generowane w kodzie – nie ma żadnych plików obrazów ani dźwięków).

## Uruchomienie

```bash
npm install
npm run dev        # serwer deweloperski (Vite), domyślnie http://localhost:5173
npm run build      # kontrola typów (tsc) + build produkcyjny do dist/
npm run preview    # podgląd zbudowanej wersji
npm test           # testy logiki gry (Vitest, bez przeglądarki)
npm run typecheck  # tylko kontrola typów
```

Wymagany Node.js 18+ (testowano na Node 22).

## Zasady

- **PZ (punkty zwycięstwa)** – służą tylko do wygrania. Zdobywasz je za kontrolę stref (1 PZ/s za każdą niesporną strefę) i za niszczenie jednostek wroga. Nie można ich wydawać. Zwycięstwo po **1000 PZ**; po 15 minutach wygrywa wyższy wynik, równy wynik = remis.
- **PD (punkty dowodzenia)** – służą tylko do zamawiania posiłków. Start 300 PD, +3 PD/s, +1 PD/s za każdą kontrolowaną niesporną strefę. Zabijanie wrogów nie daje PD.
- Brak surowców, robotników, budowania bazy i drzewka technologii. Brak jednostek na mapie nie oznacza porażki – zawsze można kupić posiłki.
- Limit **40 jednostek** na stronę; jednostki w kolejce posiłków i pasażerowie transporterów też zajmują miejsce w limicie.
- Posiłki pojawiają się po **5 s** w strefie przyjazdu przy krawędzi mapy (lewa – Niebiescy, prawa – Czerwoni). PD są pobierane raz, przy zamówieniu. Punkt zbiórki (przycisk lub `R`) kieruje nowe jednostki w wybrane miejsce.
- Jednostki w **własnej strefie przyjazdu są bezpieczne**: nie otrzymują obrażeń, ale też nie strzelają (moja interpretacja „bezpiecznej strefy”).

### Przejmowanie stref

- Strefy zaczynają jako neutralne. Przejmuje je wyłącznie **piechota** (medycy i pojazdy nie). Bojowe (uzbrojone) jednostki wroga wstrzymują przejmowanie – strefa jest wtedy **sporna** (postęp, PD i PZ z tej strefy stoją). Medyk nie jest jednostką bojową i nie blokuje.
- Neutralna strefa: 12 s dla jednej piechoty; kolejne jednostki przyspieszają (×1,5 przy dwóch, maks. ×2). Wroga strefa: dwa etapy po 12 s (neutralizacja, potem przejęcie).
- Pusta zdobyta strefa pozostaje własnością strony. Po opuszczeniu strefy niedokończony postęp powoli (25% prędkości) cofa się do początku etapu.
- Własność stref i wynik są publiczne (widoczne mimo mgły). Posiadanie strefy nie daje widoczności.
- Jednostki w transporterze nie przejmują i nie blokują stref.

### Jednostki

| Jednostka | Koszt | HP | Pancerz | Rola |
|---|---|---|---|---|
| Piechota | 50 PD | 60 | 1 | Przejmuje strefy; karabin + wolny (12 s) granatnik przeciwpancerny |
| Medyk | 60 PD | 50 | 0 | Leczy 8 HP/s pobliską piechotę i medyków (nie pojazdy, nie wskrzesza), nieuzbrojony |
| BWP | 150 PD | 260 | 6 | Działko 30 mm (piechota i lekkie pojazdy), przewozi 2 osoby |
| Transporter | 100 PD | 240 | 5 | Przewozi 4 osoby, słaby karabin maszynowy |
| Czołg | 240 PD | 420 | 12 | Armata (silna przeciw pojazdom) + km współosiowy |
| Artyleria | 200 PD | 120 | 2 | Zasięg 850, minimalny 260, wolny pocisk, obrażenia obszarowe, ogień ponad budynkami |

Obrażenia końcowe = `max(1, obrażenia × mnożnik(klasa celu: piechota/lekki/ciężki) − pancerz celu)`. Pancerz to stała redukcja, nie osobny pasek zdrowia. Wszystkie wartości są w `src/config/units.ts` i `src/config/rules.ts`.

## Sterowanie

| Akcja | Sterowanie |
|---|---|
| Zaznaczenie | LPM (klik), przeciągnięcie LPM (ramka), `Shift`+LPM dodaje/usuwa, dwuklik = wszystkie takie same na ekranie |
| Ruch | PPM na ziemi (grupa dostaje rozproszone punkty docelowe) |
| Atak | PPM na widocznym wrogu |
| Wsiadanie | PPM na własnym transporterze/BWP przy zaznaczonej piechocie lub medykach |
| Atak w ruchu | `A`, potem LPM w miejscu docelowym |
| Stop / anuluj rozkaz | `S` |
| Utrzymanie pozycji | `H` (nie goni celów, strzela w zasięgu) |
| Załaduj / wyładuj | `L` / `U` lub przyciski (zaznacz transporter/BWP; ładuje piechotę i medyków w promieniu ok. 140) |
| Punkt zbiórki | `R` lub przycisk w panelu posiłków, potem LPM |
| Kamera | `W`/`A`/`S`/`D` lub strzałki; kółko myszy = zoom do kursora; LPM/przeciąganie na minimapie |
| Rozkaz z minimapy | PPM na minimapie = ruch zaznaczonych jednostek |
| Grupy | `Ctrl`+`1..9` zapisuje, `1..9` przywołuje (część przeglądarek rezerwuje Ctrl+cyfra) |
| Pauza | `Spacja` |
| Anuluj tryb rozkazu / zamknij menu | `Esc` |

Uwaga: `A` i `S` są jednocześnie klawiszami rozkazów i kamery. Gdy masz zaznaczone własne jednostki, `A`/`S` wydają rozkazy (kamera: strzałki albo `Shift`+`A`/`S`); bez zaznaczenia działają jako kamera. Menu kontekstowe przeglądarki jest wyłączone tylko nad obszarem gry i minimapą.

## Mgła wojny

Trzy stany pól: nieodkryte (czarne), odkryte ale niewidoczne (przyciemnione), widoczne. Widoczność wynika z pozycji własnych jednostek (kołem o promieniu wzroku; pasażerowie jej nie zapewniają). Wrogowie poza widocznością nie są rysowane, nie można ich zaznaczyć ani zaatakować i nie pojawiają się na minimapie. AI ma własną mgłę i nie czyta ukrytych pozycji gracza (dostaje tylko listę aktualnie widocznych wrogów i pamięta, gdzie ich widziało).
Linia strzału jest osobną kontrolą: broń bezpośrednia nie strzela przez budynki (drzewa nie blokują), artyleria strzela ponad nimi.

## Struktura projektu

```
src/
  config/   rules.ts (zasady meczu), units.ts (parametry jednostek), map.ts (definicja mapy)
  core/     logika bez Phasera: game.ts (symulacja), grid.ts (A*, linia strzału), map.ts (budowa mapy),
            zones.ts (przejmowanie), fog.ts (mgła), combat.ts (obrażenia), ai.ts (przeciwnik)
  render/   BattleScene.ts (Phaser: kamera, wejście, rysowanie), terrain.ts, sprites.ts
  ui/       hud.ts + styles.css (HTML/CSS: pasek, panele, minimapa, ekrany)
tests/      testy Vitest logiki (mapa, strefy, ekonomia, walka, transport, AI, uczciwość)
```

Logika (`src/core`) nie importuje Phasera ani DOM – symulacja działa ze stałym krokiem 1/30 s i jest testowana bez przeglądarki.

## AI

Podejmuje decyzje co 1,5 s, korzysta z tych samych kosztów, dochodów, limitów i parametrów walki (zakupy przez to samo `Game.buy`). Kupuje piechotę, medyków, BWP, czołgi i artylerię (bez transporterów). Zbiera piechotę w punkcie zbiórki i wysyła ją falami do neutralnych i wrogich stref (atak w ruchu), zostawia obrońców w zdobytych strefach (więcej, gdy w pobliżu widziano wroga), pojazdy dołączają do ataku, medycy podążają za piechotą (leczą automatycznie), artyleria zajmuje pozycję za frontem. Nie używa transportu.

## Co przetestowano

- `npm test`: **46 testów** logiki (mapa i dojazd obu stron do każdej z 3–6 stref, A*, formuła obrażeń, ekonomia i limity, posiłki i punkt zbiórki, przejmowanie stref wraz ze stanem spornym, walka i linia strzału, artyleria, medyk, transport, PZ za pasażerów dokładnie raz, mgła i uczciwość AI, symetria walki, pełny mecz AI vs AI bez NaN-ów i bez jednostek w przeszkodach).
- `npm run build` przechodzi (kontrola typów + build produkcyjny).
- Ręczny test dymny w headless Chromium (Playwright, nie jest częścią repozytorium): ekran startowy, start meczu, zakup, zaznaczanie ramką, rozkazy ruchu i ataku w ruchu, walka, przejmowanie strefy, minimapa, brak błędów w konsoli.

## Czego nie zaimplementowano / ograniczenia

- Brak dźwięku i muzyki. Brak zapisu gry, wielu map, trybu wieloosobowego, obsługi dotyku i urządzeń mobilnych.
- Mecz zaczyna się bez jednostek – trzeba od razu zamówić posiłki (zgodnie z opisem: 300 PD, brak darmowych jednostek).
- Grafika to prosty pixel art generowany w kodzie, z widokiem z góry, w stylu dołączonych przykładów (paleta, beret/kamizelka, karabin); Niebiescy mają niebieską wersję kolorystyczną, Czerwoni czerwono‑pomarańczową. Brak animacji chodu, obrót sprite'a jest całościowy (wieża nie obraca się osobno).
- Mgła: kołowy zasięg widzenia bez cieni za przeszkodami. Wrogie jednostki w polu widzenia sojuszników są widoczne wszystkim (wspólna widoczność drużyny).
- Pathfinding korzysta z jednej siatki 32 px dla wszystkich pojazdów (wąskie przejścia mają szerokość 1 pola); jednostki unikają nakładania się prostą separacją, więc w tłoku mogą się lekko blokować. Zablokowane jednostki po kilku sekundach kończą rozkaz.
- AI jest prosta: nie używa transportu, nie wycofuje rannych, nie flankuje. Balans (koszty, siła AI) sprawdzono jedynie symulacjami AI vs AI (wyniki wyrównane); nie był testowany z żywym graczem.
- Mapa jest lustrzana względem osi pionowej, więc obie strony mają ten sam teren; motywy stref (wieś/skraj lasu) są ustawione symetrycznie.
- Wydajność sprawdzono tylko w headless Chromium z programowym renderowaniem; paczka JS ma ok. 1,5 MB (Phaser).
