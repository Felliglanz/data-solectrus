# ioBroker.Data-Solectrus

<img src="admin/data-solectrus.png" alt="SOLECTRUS" width="120" />

ioBroker-Adapter, der eigene States unter `data-solectrus.0.*` anlegt und im festen Intervall (Standard: 5s, **wall-clock aligned**) mit berechneten Werten befüllt.

Ziel: Datenpunkte (z.B. PV/Verbrauch/Batterie) per **Formeln** aus beliebigen ioBroker-States zusammenstellen und als adapter-eigene States bereitstellen (z.B. für SOLECTRUS-Dashboards).

## Installation

Der Adapter kann lokal als `.tgz` gebaut und in ioBroker installiert werden (oder via GitHub-Release, falls vorhanden).

- Paket bauen: `npm pack`
- Installation in ioBroker: Admin → Adapter → „Benutzerdefiniert“ / URL/Datei → `iobroker.data-solectrus-<version>.tgz`

Hinweis: Adaptername in ioBroker ist `data-solectrus` (Instanz: `data-solectrus.0`).

## Konfiguration (Admin)

Die Konfiguration ist absichtlich **leer** – du fügst nur die Werte hinzu, die du brauchst.

### Globale Einstellungen

- **Poll interval (seconds)**: Intervall in Sekunden (min 1). Der Tick läuft synchron zur Uhr, d.h. bei 5s z.B. auf `...:00, ...:05, ...:10, ...`.

Optional (gegen Timing-/Cache-Effekte bei vielen Quellen):

- **Read inputs on tick (snapshot)**: Wenn aktiv, liest der Adapter zu jedem Tick alle benötigten Input-States einmal aktiv via ioBroker und rechnet dann mit diesem „Snapshot“. Das kann kleine Abweichungen reduzieren, wenn mehrere Quellen minimal versetzt updaten.
- **Snapshot delay (ms)**: Optionaler Delay vor dem Snapshot (z.B. 100–300ms), falls deine Sensoren typischerweise kurz nach dem Tick-Rand updaten.

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
- **Inputs** (nur `mode=formula`): Liste aus (Key, Source State).
	- Optional pro Input: **Input negativ auf 0** (klemmt nur diesen Input vor der Rechnung).
	- **Wichtig zu Keys**: In Formeln sind `-` und Leerzeichen Operatoren/Trenner.
		- Verwende daher am besten nur `a-z`, `0-9`, `_` (z.B. `bkw_garage`, `enpal`, `zendure`).
		- Intern werden ungültige Zeichen im Key zu `_` umgewandelt.
- **Formula expression**: Formel-String.
- **Datatype**: optional (Standard: number).
- **Role**, **Unit**: optional (für Metadaten).

Nachbearbeitung:

- **Clamp negative to 0**: negative Werte werden auf `0` gesetzt.
	- bei `mode=formula`: bereits auf **Inputs vor der Rechnung** (damit negative Messartefakte nicht in die Summe eingehen).
	- zusätzlich immer auf das **Ergebnis** (zur Sicherheit; ändert nichts, wenn Inputs schon bereinigt sind).
- **Clamp result**: Ergebnis begrenzen (Min/Max). Leere Felder bedeuten „nicht begrenzen“.

## Formeln

### Variablen

Die Variablen kommen aus den **Inputs** (Key → Source State). In der Formel verwendest du dann den Key.

Beispiel:

- Inputs: `pv1`, `pv2`, `pv3`
- Formel: `pv1 + pv2 + pv3`

### Erlaubte Operatoren

- Arithmetik: `+ - * / % **`
- Vergleiche: `< <= > >= == != === !==`
- Logik: `&& || !`
- Ternary: `bedingung ? a : b`

### Erlaubte Funktionen

- `min(a, b, ...)`
- `max(a, b, ...)`
- `abs(x)`
- `round(x)`
- `floor(x)`
- `ceil(x)`
- `clamp(value, min, max)`

### State-Lesen per ID (optional)

Du kannst zusätzlich `s("voll.qualifizierter.state")` verwenden, um einen Wert direkt aus dem Cache zu lesen.

Beispiel:

- `s("modbus.0.inputRegisters.12345") * 1000`

Hinweis: Diese States werden nicht automatisch „entdeckt“; verwende dafür idealerweise Inputs oder achte darauf, dass der State existiert und der Adapter ihn lesen kann.

## Beispiele

### PV-Leistung zusammenfassen

- Group: `pv`
- Target ID: `leistung`
- Mode: `formula`
- Inputs:
	- `enpal` → `<...>`
	- `zendure` → `<...>`
	- `bkw` → `<...>`
- Formel: `enpal + zendure + bkw`

### Batterie „Leistung“ aus zwei States

Wenn du `outputPackPower` und `packInputPower` hast:

- Inputs: `out`, `in`
- Formel (signiert): `out - in`

Oder getrennt:

- Entladen: `max(0, out - in)`
- Laden: `max(0, in - out)`

### Werte begrenzen

- Maximal 20000W: Clamp result aktivieren, **Max = 20000**, Min leer.
- Keine negativen Werte: Clamp negative to 0 aktivieren (oder Clamp result mit Min=0).

## Diagnose-States

Unter `data-solectrus.0.info.*` werden Status/Diagnosewerte gepflegt:

- `info.status`: `starting`, `ok`, `no_items_enabled`
- `info.itemsConfigured`: Anzahl konfigurierter Items
- `info.itemsEnabled`: Anzahl aktivierter Items
- `info.lastError`: letzter Fehlertext
- `info.lastRun`: ISO-Timestamp des letzten Ticks
- `info.evalTimeMs`: Laufzeit der Berechnung im letzten Tick

## Sicherheit / Expression Engine

Formeln werden über `jsep` geparst und in einem streng allowlist-basierten Evaluator ausgeführt.
Nicht erlaubt sind z.B. Member-Zugriffe (`a.b`), `new`, `this`, Funktionskonstruktion etc.

## Branding / Logo

Dieses Projekt verwendet das offizielle SOLECTRUS Logo mit Freigabe durch Georg Ledermann.

Hinweis: SOLECTRUS ist eine Marke der jeweiligen Inhaber.

## Maintainer / Contributing

Dieses Repository ist öffentlich, um die Weiterentwicklung gemeinsam mit einem Maintainer für dessen Adapter zu ermöglichen.
PRs/Issues sind willkommen.

