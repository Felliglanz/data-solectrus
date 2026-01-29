# Data-SOLECTRUS Wiki

Willkommen im Wiki des ioBroker-Adapters **data-solectrus**.

Neu: Der [[Formula-Builder]] hilft dir beim Erstellen von Formeln direkt im Admin-UI.

Der Adapter ist ein „Daten-Preprozessor“: Er liest vorhandene ioBroker-States, **berechnet** daraus neue Werte (oder spiegelt Werte 1:1) und schreibt das Ergebnis als eigene States unter `data-solectrus.0.*`.

## Was kann der Adapter?

- Beliebige States **spiegeln** (Mode `source`)
- Werte per **Formel** berechnen (Mode `formula`)
- Formeln können mehrere Inputs kombinieren (Summe, Differenz, Mittelwert, Bedingungen, etc.)
- Negative Werte optional auf `0` klemmen und Ergebnisse per Min/Max begrenzen
- Optionaler „Snapshot“: alle Inputs eines Ticks einmal einlesen, dann mit konsistenten Werten rechnen

## Für wen ist das?

- Für Einsteiger: Wenn du Werte nur „zusammenrechnen“ willst, ohne Script-Programmierung.
- Für Fortgeschrittene: Wenn du eine zentrale, wartbare Stelle für Berechnungen möchtest.

## Einstieg

1. Admin öffnen → Adapter `data-solectrus` → Konfiguration.
2. Unter „Values“ neue Einträge anlegen.
3. Pro Eintrag definierst du einen **Output-State** (Target ID) und entweder:
   - `source`: welchen State du spiegeln willst, oder
   - `formula`: welche Inputs du nutzt und welche Formel gerechnet wird.

Weiter geht’s hier:

- [[Use-Cases]]

## Hinweis zu Formeln (ab v0.2.0)

In v0.2.0 wurde die Formel-Syntax bewusst etwas strenger gemacht:

- Potenzen bitte mit `pow(a, b)` (statt `a ** b`).
- Gleichheit nur noch strikt: `===` und `!==` (kein `==` / `!=`).

Tipp: Wenn du einen eigenen Anwendungsfall dokumentierst, hänge ihn in [[Use-Cases]] an – so bleibt das Wiki für Einsteiger schnell durchsuchbar.
