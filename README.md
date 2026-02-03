# ioBroker.Data-SOLECTRUS

![Version](https://img.shields.io/github/package-json/v/Felliglanz/ioBroker.data-solectrus?label=version)
![NPM Version](https://img.shields.io/npm/v/iobroker.data-solectrus?label=npm)
![NPM Downloads](https://img.shields.io/npm/dt/iobroker.data-solectrus)

<img src="admin/data-solectrus.png" alt="SOLECTRUS" width="120" />

Ein kleiner ioBroker-Adapter, der eigene States unter `data-solectrus.0.*` anlegt und im festen Intervall (Standard: 5s, **wall-clock aligned**) mit berechneten oder gespiegelten Werten befüllt.

Kurz gesagt: 🧮 **Formeln** + 🔌 **beliebige ioBroker-States** → 📦 **saubere, adapter-eigene Ziel-States** (z.B. für SOLECTRUS-Dashboards).

## Highlights

- ✅ `source`-Items: 1:1 spiegeln (optional mit JSONPath)
- ✅ `formula`-Items: Werte aus vielen Quellen zusammenrechnen
- ✅ Optionale Snapshot-Reads pro Tick (reduziert Timing-Effekte)
- ✅ Clamps/Regeln am Ergebnis (z.B. Ergebnis negativ → 0, Min/Max)
- ✅ Diagnose-States für Laufzeit/Fehler/Sync

## Installation

Der Adapter kann lokal als `.tgz` gebaut und in ioBroker installiert werden (oder via GitHub-Release, falls vorhanden).

- Paket bauen: `npm pack`
- Installation in ioBroker: Admin → Adapter → „Benutzerdefiniert“ / URL/Datei → `iobroker.data-solectrus-<version>.tgz` (z.B. `iobroker.data-solectrus-0.2.7.tgz`)

Hinweis: Adaptername in ioBroker ist `data-solectrus` (Instanz: `data-solectrus.0`).

## Quickstart (Konfig)

Der Adapter ist absichtlich „leer“ – du legst nur die Items an, die du brauchst.

1) **Items anlegen** (Admin → Adapter → data-solectrus → Werte)
- `mode=source`: genau einen State spiegeln
- `mode=formula`: mehrere Inputs + eine Formel

2) Optional: **Snapshot aktivieren** (Global settings)
- Wenn deine Quellen zeitversetzt updaten und du „kurz unplausible“ Kombinationen siehst, aktiviere Snapshot.

## Wichtige Semantik (signed Meter / Clamps)

### Ergebnis negativ → 0

Die Option **„Ergebnis negativ → 0“** wirkt nur auf das **Ergebnis** des Items (Output).

- Wenn du nur einzelne Inputs bereinigen willst (z.B. PV darf nie negativ sein, aber Netzleistung ist signed), nutze dafür pro Input **„neg→0“** oder `max(0, …)` in der Formel.

### Beispiel: Hausverbrauch aus PV + signed Netzleistung

- `gridSigned`: Import positiv, Export negativ
- Hausverbrauch: `pvTotal + gridSigned`

Wenn PV=4639W und Export=-2514W, ergibt sich Hausverbrauch ≈ 2125W.

## Wiki / Use-Cases

Die ausführlichen Beispiele und Erklärungen sind im Wiki:

- https://github.com/Felliglanz/ioBroker.data-solectrus/wiki

Direktlinks (Auswahl):

- Hausverbrauch: https://github.com/Felliglanz/ioBroker.data-solectrus/wiki/Hausverbrauch
- Werte begrenzen: https://github.com/Felliglanz/ioBroker.data-solectrus/wiki/Werte-begrenzen
- Formel-Builder: https://github.com/Felliglanz/ioBroker.data-solectrus/wiki/Formel-Builder
- Use-Cases Übersicht: https://github.com/Felliglanz/ioBroker.data-solectrus/wiki/Use-Cases

## Diagnose-States

Unter `data-solectrus.0.info.*` werden Status/Diagnosewerte gepflegt:

- `info.status`: `starting`, `ok`, `no_items_enabled`
- `info.itemsConfigured`, `info.itemsEnabled`
- `info.lastError`
- `info.lastRun`, `info.evalTimeMs`
- `info.timeBudgetMs`, `info.skippedItems`

Timing/Sync-Diagnose (hilft bei kurzzeitig „unplausiblen“ Kombinationen, wenn Quellen zeitversetzt updaten):

- `info.inputTsGapMs`: Differenz zwischen ältestem und neuestem Input-Timestamp (ms) der im Tick genutzten Quellen
- `info.inputTsGapOk`: `true/false` basierend auf einem konservativen Threshold
- `info.inputTsGapThresholdMs`: verwendeter Threshold (ms)
- `info.inputTsSources`: Anzahl Inputs mit Timestamp
- `info.inputTsMissing`: Anzahl Inputs ohne Timestamp

Zusätzlich gibt es per Item Diagnose-States unter `data-solectrus.0.items.<outputId>.*`:

- `compiledOk`, `compileError`, `lastError`, `lastOkTs`, `lastEvalMs`, `consecutiveErrors`

## Development / Checks

Für schnelle Checks (z.B. nach Refactorings) gibt es einen Runtime-Smoke-Test, der **ohne** ioBroker-Controller läuft.
Er mockt die minimal benötigte Adapter-API und führt einmalig diese Phasen aus:

- `createInfoStates()`
- `prepareItems()` (inkl. Formel-Compile, Source-Discovery, Subscriptions)
- `runTick()` (ein Tick mit Snapshot + Berechnung + Output-States)

Ausführen:

- `npm run smoke`

## Konfiguration (Admin)

Die Konfiguration ist absichtlich **leer** – du fügst nur die Werte hinzu, die du brauchst.

### Globale Einstellungen

- **Poll interval (seconds)**: Intervall in Sekunden (min 1). Der Tick läuft synchron zur Uhr, d.h. bei 5s z.B. auf `...:00, ...:05, ...:10, ...`.

Optional (gegen Timing-/Cache-Effekte bei vielen Quellen):

- **Read inputs on tick (snapshot)**: Wenn aktiv, liest der Adapter zu jedem Tick alle benötigten Input-States einmal aktiv via ioBroker und rechnet dann mit diesem „Snapshot“. Das kann kleine Abweichungen reduzieren, wenn mehrere Quellen minimal versetzt updaten.
- **Snapshot delay (ms)**: Optionaler Delay vor dem Snapshot (z.B. 100–300ms), falls deine Sensoren typischerweise kurz nach dem Tick-Rand updaten.

Optional (Robustheit bei Fehlern):

- **errorRetriesBeforeZero** (noch nicht im Admin-UI): Wie viele fehlgeschlagene Berechnungen pro Item toleriert werden, bevor der Output auf `0` gesetzt wird. Standard: `3`.

### Werte (Items)

Jeder Eintrag erzeugt genau **einen Output-State**.

Felder:

- **Enabled**: aktiviert/deaktiviert.
- **Name**: Anzeigename (optional).
- **Folder/Group**: optionaler Ordner/Channel-Prefix.
	- Beispiel: `pv` + Target ID `leistung` → Output wird `data-solectrus.0.pv.leistung`.
- **Target ID**: Ziel-State innerhalb des Adapters (relativ). Beispiel: `leistung`, `pv.gesamt`.
	- Erlaubt sind nur Segmente mit `A-Z`, `a-z`, `0-9`, `_`, `-` und `.` (keine absoluten IDs, kein `..`).
- **Mode**:
	- `source`: 1:1 Spiegelung eines ioBroker-States (mit optionaler Nachbearbeitung).
	- `formula`: Berechnung aus mehreren Inputs.
- **ioBroker Source State**:
	- bei `mode=source`: der Quell-State (vollqualifiziert, z.B. `some.adapter.0.channel.state`).
	- bei `mode=formula`: pro Input ein Source-State.
- **JSONPath (optional)**:
	- Wenn der Source-State (oder ein Input) statt einer Zahl ein JSON als Text enthält, kann hier ein JSONPath angegeben werden, um daraus einen numerischen Wert zu extrahieren.
	- Beispiele: `$.apower`, `$.aenergy.by_minute[2]`
- **Inputs** (nur `mode=formula`): Liste aus (Key, Source State).
	- Optional pro Input: **Input negativ auf 0** (klemmt nur diesen Input vor der Rechnung).
	- Optional pro Input: **JSONPath**
		- Wenn JSONPath auf einen String/Boolean zeigt, wird dieser Wert als Variable bereitgestellt (z.B. für `IF(opMode == 'Heating', ...)`).
		- Wenn JSONPath auf eine Zahl zeigt (oder einen numerischen String wie `"12.2"`), wird der Wert als Zahl bereitgestellt.
	- **Wichtig zu Keys**: In Formeln sind `-` und Leerzeichen Operatoren/Trenner.
		- Verwende daher am besten nur `a-z`, `0-9`, `_` (z.B. `bkw_garage`, `enpal`, `zendure`).
		- Intern werden ungültige Zeichen im Key zu `_` umgewandelt.
- **Formula expression**: Formel-String.
- **Datatype**: optional (Standard: number).
- **Role**, **Unit**: optional (für Metadaten).

Nachbearbeitung:

- **Clamp negative to 0**: negative Werte werden auf `0` gesetzt.
	- wirkt auf das **Ergebnis** des Items (Output).
	- wenn du nur einzelne Quellen/Inputs „bereinigen“ willst (z.B. PV darf nie negativ sein, aber Netzleistung ist signed), nutze dafür **Input negativ auf 0** direkt am jeweiligen Input oder `max(0, …)` in der Formel.
- **Clamp result**: Ergebnis begrenzen (Min/Max). Leere Felder bedeuten „nicht begrenzen“.

## Formeln

### Variablen

Die Variablen kommen aus den **Inputs** (Key → Source State). In der Formel verwendest du dann den Key.

Beispiel:

- Inputs: `pv1`, `pv2`, `pv3`

Zusätzlich:

- `npm run lint` (Syntax-Check)
- `npm run check:simulate` (kurzer 30s/6-Ticks Regression-Check für PV+signed Meter)
- Formel: `pv1 + pv2 + pv3`
- `info.itemsEnabled`: Anzahl aktivierter Items

- `info.lastError`: letzter Fehlertext
