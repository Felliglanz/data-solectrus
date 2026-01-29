# ioBroker.Data-SOLECTRUS

![Version (Git Tag)](https://img.shields.io/github/v/tag/Felliglanz/data-solectrus?sort=semver)

<img src="admin/data-solectrus.png" alt="SOLECTRUS" width="120" />

ioBroker-Adapter, der eigene States unter `data-solectrus.0.*` anlegt und im festen Intervall (Standard: 5s, **wall-clock aligned**) mit berechneten Werten befüllt.

Ziel: Datenpunkte (z.B. PV/Verbrauch/Batterie) per **Formeln** aus beliebigen ioBroker-States zusammenstellen und als adapter-eigene States bereitstellen (z.B. für SOLECTRUS-Dashboards).

## Installation

Der Adapter kann lokal als `.tgz` gebaut und in ioBroker installiert werden (oder via GitHub-Release, falls vorhanden).

- Paket bauen: `npm pack`
- Installation in ioBroker: Admin → Adapter → „Benutzerdefiniert“ / URL/Datei → `iobroker.data-solectrus-<version>.tgz` (z.B. `iobroker.data-solectrus-0.2.1.tgz`)

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
- **JSONPath (optional)**:
	- Wenn der Source-State (oder ein Input) statt einer Zahl ein JSON als Text enthält, kann hier ein JSONPath angegeben werden, um daraus einen numerischen Wert zu extrahieren.
	- Beispiele: `$.apower`, `$.aenergy.by_minute[2]`
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

- Arithmetik: `+ - * / %`
- Vergleiche: `< <= > >= == != === !==`
- Logik: `&& || !`
- Ternary: `bedingung ? a : b`

Kompatibilität (optional):

- `AND`, `OR`, `NOT` werden (außerhalb von Strings) automatisch zu `&&`, `||`, `!` normalisiert.
- Ein einzelnes `=` wird (außerhalb von Strings) automatisch zu `==` normalisiert.

### Erlaubte Funktionen

- `min(a, b, ...)`
- `max(a, b, ...)`
- `pow(a, b)`
- `abs(x)`
- `round(x)`
- `floor(x)`
- `ceil(x)`
- `clamp(value, min, max)`
- `IF(condition, valueIfTrue, valueIfFalse)` (Alias: `if(...)`)

### Beispiel: IF/Strings (z.B. Wärmemenge)

Wenn du Bedingungen gegen **String-States** prüfen willst (z.B. Betriebsmodus), nutze `v("...")`.

Beispiel (IDs bitte an deine Umgebung anpassen):

- Output-Item: z.B. `waerme.erzeugt`
- Formel:

`IF(v("mqtt.0.hp.operationMode") == 'Heating' && v("mqtt.0.hp.freezeProtection") == 'OFF' && s("mqtt.0.hp.r2t") > s("mqtt.0.hp.r4t"), s("mqtt.0.hp.flow_l_min") * 60.0 * 1.163 * (s("mqtt.0.hp.r2t") - s("mqtt.0.hp.r4t")), 0)`

### State-Lesen per ID (optional)

Du kannst zusätzlich `s("voll.qualifizierter.state")` verwenden, um einen Wert direkt aus dem Cache zu lesen.

Wenn du den **rohen** Wert (z.B. Strings wie `"Heating"`/`"OFF"` oder Booleans) brauchst, verwende `v("voll.qualifizierter.state")`.

Beispiel:

- `s("modbus.0.inputRegisters.12345") * 1000`

Hinweis: Diese States werden nicht automatisch „entdeckt“; verwende dafür idealerweise Inputs oder achte darauf, dass der State existiert und der Adapter ihn lesen kann.

Update: `s("...")` und `v("...")` werden aus der Formel erkannt und als Quellen (Snapshot/Subscribes) berücksichtigt.

## Use-Cases / Beispiele

Die vollständigen, ausführlichen Use-Cases (mit Schritt-für-Schritt-Konfiguration und Formeln) sind ins Wiki ausgelagert, damit sie leichter erweitert werden können.

- Wiki: https://github.com/Felliglanz/data-solectrus/wiki

Typische Anwendungsfälle:

- PV-Leistung aus mehreren Quellen summieren (z.B. Enpal + Zendure + BKW)
- Verbraucher/Verbrauchergruppen zusammenfassen
- Hausverbrauch aus PV/Netz/Batterie herleiten
- Batterie-Leistung (Laden/Entladen) aus zwei Messwerten berechnen
- SoC aus mehreren Speichern (gewichtet nach Kapazität) zusammenführen
- Werte klemmen/begrenzen (negativ → 0, Min/Max)

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

