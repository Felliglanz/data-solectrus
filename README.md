# ioBroker.Data-SOLECTRUS

![Version](https://img.shields.io/github/package-json/v/Felliglanz/ioBroker.data-solectrus?label=version)
![NPM Version](https://img.shields.io/npm/v/iobroker.data-solectrus?label=npm)
![NPM Downloads](https://img.shields.io/npm/dt/iobroker.data-solectrus)

<img src="admin/data-solectrus.png" alt="SOLECTRUS" width="120" />

Ein flexibler ioBroker-Adapter, der eigene States unter `data-solectrus.0.*` anlegt und im festen Intervall (Standard: 5s, **wall-clock aligned**) mit berechneten oder gespiegelten Werten befüllt.

**Kurz gesagt:** 🧮 **Formeln** + 🔌 **beliebige ioBroker-States** → 📦 **saubere, adapter-eigene Ziel-States** (z.B. für SOLECTRUS-Dashboards).

## 🚀 Installation

### ⭐ Empfohlene Methode: GitHub Custom URL

Der einfachste Weg, den Adapter zu installieren:

1. Öffne **ioBroker Admin** → **Adapter**
2. Klicke auf das **GitHub-Symbol** (Octocat) oben rechts → **Custom**
3. Füge die URL ein:
   ```
   https://github.com/Felliglanz/ioBroker.data-solectrus
   ```
4. Klicke auf **Install**

Der Adapter wird direkt vom GitHub-Repository installiert und kann später über die gleiche Methode aktualisiert werden.

### Alternative: NPM

Falls der Adapter im ioBroker-Repository verfügbar ist:
```bash
cd /opt/iobroker
npm install iobroker.data-solectrus
```

### Alternative: Manuell via .tgz

Falls du lokal entwickelst:
```bash
npm pack
```
Dann in ioBroker Admin: **Adapter** → **Custom** → Datei hochladen (`iobroker.data-solectrus-<version>.tgz`)

**Hinweis:** Adaptername in ioBroker ist `data-solectrus` (Instanz: `data-solectrus.0`)

## ✨ Highlights

- ✅ **Source Items**: 1:1 spiegeln (optional mit JSONPath)
- ✅ **Formula Items**: Werte aus vielen Quellen zusammenrechnen
- ✅ **State Machine Items** 🆕: Regelbasierte Zustandserzeugung
  - String/Boolean Outputs basierend auf Bedingungen
  - Perfekt für Status-Übersetzungen und komplexe Logik
- ✅ **Komfortabler Formula Builder** 🆕 
  - Tooltips bei allen Operatoren und Funktionen
  - 6 Beispiel-Snippets zum direkten Einfügen
  - Live Syntax Highlighting mit Farbcodierung
  - Smart Autocomplete für Variablen und Funktionen
- ✅ **Ordner-Gruppierung** im Editor für bessere Übersicht
- ✅ **Snapshot-Reads** pro Tick (reduziert Timing-Effekte)
- ✅ **Clamps/Regeln** am Ergebnis (z.B. Ergebnis negativ → 0, Min/Max)
- ✅ **Diagnose-States** für Laufzeit/Fehler/Sync

## 🎯 Quickstart

Der Adapter ist absichtlich „leer" – du legst nur die Items an, die du brauchst.

### 1. Items anlegen

Gehe zu **Admin** → **Adapter** → **data-solectrus** → **Werte**

**Modi:**
- `mode=source`: Spiegelt genau einen ioBroker-State
- `mode=formula`: Berechnet Werte aus mehreren Inputs
- `mode=state-machine` 🆕: Regelbasierte String/Boolean-Ausgabe

**Features:**
- Items werden automatisch nach **Ordner/Gruppe** gruppiert
- Grüne/graue Badges zeigen aktive/inaktive Items
- Ordner können auf-/zugeklappt werden

### 2. State Machine für Status-Logik 🆕

Für **regelbasierte Zustände** (z.B. Status-Übersetzungen):

1. Wähle `mode=state-machine`
2. Definiere Inputs (z.B. `soc` für Batterie-SOC oder `status` für System-Status)
3. Füge Regeln hinzu (von oben nach unten geprüft, erste passende Regel gewinnt):

**Beispiel: Batterie-Status**
```
Regel 1: soc < 10   → "Akku-Leer"
Regel 2: soc < 30   → "Akku-Niedrig"
Regel 3: soc >= 80  → "Akku-Voll"
Regel 4: true       → "Akku-Normal" (Fallback)
```

**Beispiel: Externe System-States übersetzen**
```
Input: status → other.system.0.statusCode
Regel 1: status == "Fernabschaltung" → "System remote shutdown!"
Regel 2: status == "Wartung"         → "Maintenance mode"
Regel 3: status == "Normal"          → "All systems operational"
```

**Quick-Insert Beispiele** verfügbar für:
- 🔋 Battery Levels
- ⚡ Surplus Categories
- 🕐 Time of Day

### 3. Formula Builder nutzen

Beim Anlegen eines Formula-Items klicke auf **Builder…**:

- **Tooltips**: Hover über Operatoren (+, -, *, etc.) und Funktionen (min, max, IF) für Erklärungen mit Beispielen
- **Beispiele**: 6 vorgefertigte Snippets (PV-Summe, Überschuss, Prozentsatz, etc.) zum direkten Einfügen
- **Syntax Highlighting**: Variablen grün, Funktionen blau, Zahlen orange
- **Autocomplete**: Tippe los und erhalte Vorschläge für deine Variablen und Funktionen
  - Navigation: ↑↓ durch Vorschläge, Enter/Tab zum Übernehmen, Esc zum Schließen

### 4. Optional: Snapshot aktivieren

Unter **Global settings**:
- Wenn deine Quellen zeitversetzt updaten, aktiviere **Snapshot**
- Der Adapter liest dann alle Inputs einmalig pro Tick für konsistente Werte

## 📚 Wichtige Semantik

### Ergebnis negativ → 0

Die Option **„Ergebnis negativ → 0"** wirkt nur auf das **Ergebnis** des Items (Output).

- Wenn du nur einzelne Inputs bereinigen willst (z.B. PV darf nie negativ sein, aber Netzleistung ist signed), nutze dafür:
  - **"Input negativ auf 0"** direkt am Input, oder
  - `max(0, ...)` in der Formel

### Beispiel: Hausverbrauch aus PV + signed Netzleistung

```javascript
// Inputs:
// - pvTotal: 4639 W
// - gridSigned: -2514 W (negativ = Export)

// Formel:
pvTotal + gridSigned

// Ergebnis: 2125 W (Hausverbrauch)
```

## 📖 Wiki & Dokumentation

Ausführliche Beispiele und Erklärungen im Wiki:

**🔗 [GitHub Wiki](https://github.com/Felliglanz/ioBroker.data-solectrus/wiki)**

Direktlinks (Auswahl):
- [Hausverbrauch berechnen](https://github.com/Felliglanz/ioBroker.data-solectrus/wiki/Hausverbrauch)
- [Werte begrenzen](https://github.com/Felliglanz/ioBroker.data-solectrus/wiki/Werte-begrenzen)
- [Formel-Builder Guide](https://github.com/Felliglanz/ioBroker.data-solectrus/wiki/Formel-Builder)
- [Use-Cases Übersicht](https://github.com/Felliglanz/ioBroker.data-solectrus/wiki/Use-Cases)

## 📊 Diagnose-States

Unter `data-solectrus.0.info.*`:

**Allgemein:**
- `info.status`: `starting`, `ok`, `no_items_enabled`
- `info.itemsActive`: Anzahl aktiver Items
- `info.lastError`: Letzter Fehler
- `info.lastRun`: Zeitstempel (ISO)
- `info.lastRunMs`: Dauer des letzten Ticks (ms)

**Erweiterte Diagnose** unter `info.diagnostics.*`:
- `itemsTotal`: Gesamtzahl Items
- `evalBudgetMs`: Zeitbudget pro Tick
- `evalSkipped`: Übersprungene Items (bei Budget-Überschreitung)

**Timing-Analysen** unter `info.diagnostics.timing.*`:
- `gapMs`: Zeitdifferenz zwischen ältestem/neuestem Source
- `gapOk`: true/false basierend auf Threshold
- `sourcesActive`, `sourcesSleeping`: Anzahl aktiver/inaktiver Quellen (< 30s / ≥ 30s)
- `newestAgeMs`, `newestId`, `oldestAgeMs`, `oldestId`: Details zu Quellen

**Pro Item** unter `data-solectrus.0.items.<outputId>.*`:
- `compiledOk`, `compileError`, `lastError`, `lastOkTs`, `lastEvalMs`, `consecutiveErrors`

## ⚙️ Konfiguration (Admin)

### Globale Einstellungen

- **Poll interval (seconds)**: Intervall in Sekunden (min 1). Läuft synchron zur Uhr (z.B. bei 5s: `...:00, ...:05, ...:10`)

**Optional (gegen Timing-Effekte):**
- **Read inputs on tick (snapshot)**: Liest alle Input-States einmalig pro Tick für konsistente Werte
- **Snapshot delay (ms)**: Optionaler Delay vor dem Snapshot (z.B. 100-300ms)

### Werte (Items)

Jeder Eintrag erzeugt genau **einen Output-State**.

**Felder:**
- **Enabled**: aktiviert/deaktiviert
- **Name**: Anzeigename (optional)
- **Folder/Group**: optionaler Ordner/Channel-Prefix (z.B. `pv`)
- **Target ID**: Ziel-State relativ zum Adapter (z.B. `leistung`, `gesamt`)
  - → Output wird `data-solectrus.0.<group>.<targetId>`
  - Erlaubt: `A-Z`, `a-z`, `0-9`, `_`, `-`, `.`
- **Mode**:
  - `source`: 1:1 Spiegelung
  - `formula`: Berechnung aus mehreren Inputs
- **ioBroker Source State**: Quell-State vollqualifiziert (z.B. `some.adapter.0.channel.state`)
- **JSONPath (optional)**: Extrahiert Werte aus JSON-Strings (z.B. `$.apower`, `$.aenergy.by_minute[2]`)
- **Inputs** (nur bei `formula`): Liste aus (Key, Source State)
  - Optional pro Input: **Input negativ auf 0**, **JSONPath**
  - **Wichtig bei Keys**: Verwende nur `a-z`, `0-9`, `_` (z.B. `pv1`, `battery_power`)
- **Formula expression**: Formel-String (z.B. `pv1 + pv2 + pv3`)
- **Datatype**, **Role**, **Unit**: optional für Metadaten

**Nachbearbeitung:**
- **Clamp negative to 0**: Negative Ergebnisse → 0
- **Clamp result**: Min/Max Begrenzung

## 📝 Formeln

### Variablen

Die Variablen kommen aus den **Inputs** (Key → Source State).

**Beispiel:**
```javascript
// Inputs:
// - pv1: some.adapter.0.pv1
// - pv2: some.adapter.0.pv2
// - pv3: some.adapter.0.pv3

// Formel:
pv1 + pv2 + pv3
```

### Operatoren & Funktionen

- **Arithmetisch**: `+`, `-`, `*`, `/`, `%`
- **Vergleich**: `==`, `!=`, `>`, `<`, `>=`, `<=`
- **Logisch**: `&&`, `||`, `!`
- **Ternär**: `bedingung ? wertWennWahr : wertWennFalsch`
- **Funktionen**: `min(a, b)`, `max(a, b)`, `clamp(wert, min, max)`, `IF(bedingung, wennWahr, wennFalsch)`

**State-Funktionen** (für Zugriff auf andere ioBroker-States):
- `s("id")`: Liest `.val` eines States (Zahl)
- `v("id")`: Liest `.val` eines States (beliebiger Typ)
- `jp("id", "$.path")`: JSONPath auf `.val` eines States

### JSONPath Support

Wenn ein Source-State JSON als Text enthält:

```javascript
// State enthält: {"apower": 1234, "status": "ok"}
// JSONPath: $.apower
// → Ergebnis: 1234

// State enthält: {"values": [10, 20, 30]}
// JSONPath: $.values[1]
// → Ergebnis: 20
```

**Bei Strings/Booleans:**
```javascript
// Input mit JSONPath → String/Boolean wird als Variable bereitgestellt
// Nutzbar in Formeln: IF(status == "ok", 100, 0)
```

## 🛠️ Development

### Checks

- `npm run lint`: Syntax-Check
- `npm run smoke`: Runtime-Smoke-Test (läuft ohne ioBroker-Controller)
- `npm run check:simulate`: 30s/6-Ticks Regression-Check

### Smoke-Test

Führt einmalig aus:
- `createInfoStates()`
- `prepareItems()` (Formel-Compile, Source-Discovery, Subscriptions)
- `runTick()` (ein Tick mit Snapshot + Berechnung + Output-States)

## 📄 License

MIT © Sven

## 🙏 Credits

- Formel-Parser: [jsep](https://github.com/EricSmekens/jsep)
- JSONPath: Eigene Implementierung
