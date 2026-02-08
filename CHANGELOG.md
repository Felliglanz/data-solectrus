# Changelog

## 0.3.3 - 2026-02-08

### Added

- **NEW: State Machine Mode** - Rule-based state generation alongside Formula and Source modes:
  - Define rules with conditions and output values (string or boolean)
  - Rules evaluated top-to-bottom; first matching rule wins
  - Full formula support in rule conditions (use all inputs and state functions: s(), v(), jp())
  - Quick-insert examples: Battery Levels, Surplus Categories, Time of Day
  - Supports string outputs (e.g., "Battery-Empty", "Battery-Low", "Battery-Full")
  - Supports boolean outputs (true/false based on conditions)
  - Integration with existing input system (reuse inputs across rules)
  - Default/fallback rules (condition "true" or empty)
  - Comprehensive tooltips and inline help
  - Full German + English translations
  
  **Use Cases:**
  - Translate system status codes to human-readable messages
  - Create battery level indicators from SOC values
  - Generate time-of-day states from hour values
  - Convert external system states (e.g., "Fernabschaltung" → "System remote shutdown!")
  - Combine multiple conditions for complex state logic
  
### Technical

- New module `lib/stateMachine.js` for rule compilation and evaluation
- Extended `evaluator.js`, `itemManager.js`, `sourceDiscovery.js` for state-machine mode
- UI enhancements in `admin/custom/customComponents.js`
- Mode switcher now supports three modes: Formula, Source, State Machine
- Clamp/noNegative options hidden in State Machine mode (not applicable for string/boolean outputs)

## 0.3.2 - 2026-02-07

### Added

- **Enhanced Formula Builder** with comprehensive user assistance:
  - **Tooltips**: All operators (+, -, *, /, %, &&, ||, ==, etc.) and functions (IF, min, max, clamp) now have descriptive tooltips with examples
  - **Examples Section**: 6 ready-to-use formula patterns (PV sum, surplus, percentage calculation, positive-only values, conditional logic, clamp 0-1)
  - **Live Syntax Highlighting**: Color-coded formula editor
    - Variables (inputs) in green
    - Functions/keywords in blue
    - Numbers in orange
    - Strings in light green
    - Operators in cyan
  - **Smart Autocomplete**: Intelligent suggestions while typing
    - Shows available input variables
    - Shows available functions
    - Keyboard navigation (↑↓, Enter/Tab, Esc)
    - Mouse support
  - All features support both German and English translations

### Fixed

- Missing translation for Master/Detail editor hint text ("Configure values via the Master/Detail editor" now translates correctly)

### Changed

- Significantly improved README with better structure and installation instructions
- Installation via GitHub Custom URL now prominently featured as recommended method
- Formula Builder documentation added to README

## 0.3.1 - 2026-02-04

### Added

- **Folder grouping in master-detail editor**: Items are now automatically grouped by their `group` field in the master list (left panel)
  - Folders can be collapsed/expanded for better organization
  - Visual status indicators: Green badge shows active items count, gray badge shows inactive items count
  - Hover tooltips on badges display "X active item(s)" and "X inactive item(s)"
  - Items without a group are shown under "Ungrouped"
  - UI-only feature - no changes to object tree structure

### Changed

- Target ID placeholder simplified from `pv.pvGesamt` to `pvGesamt` (since group is defined separately)

## 0.3.0 - 2026-02-03

### BREAKING CHANGES

- **Diagnostics state reorganization**: States moved to hierarchical structure for better organization
  - `info.itemsConfigured` → `info.diagnostics.itemsTotal`
  - `info.itemsEnabled` → `info.itemsActive`
  - `info.evalTimeMs` → `info.lastRunMs`
  - `info.timeBudgetMs` → `info.diagnostics.evalBudgetMs`
  - `info.skippedItems` → `info.diagnostics.evalSkipped`
  - Old flat timing states → `info.diagnostics.timing.*`
- **Note**: Existing visualizations and scripts need to be updated to use new state paths

### Added

- New hierarchical state structure with `info.diagnostics.*` and `info.diagnostics.timing.*` channels
- Enhanced timing diagnostics:
  - Active vs sleeping source detection (30s threshold)
  - `info.diagnostics.timing.sourcesActive` and `sourcesSleeping`
  - Newest/oldest source tracking with IDs and age metrics
  - `info.diagnostics.timing.newestAgeMs`, `newestId`, `oldestAgeMs`, `oldestId`
  - Separate gap calculations for all sources vs active sources only
  - `info.diagnostics.timing.gapActiveMs` and `gapActiveOk`

### Changed

- Improved state organization: all timing-related states now grouped under `info.diagnostics.timing.*`
- Better state naming for clarity (e.g., `lastRunMs` instead of `evalTimeMs`)

## 0.2.9 - 2026-02-03

### Added

- Package metadata: repository, bugs, homepage URLs in package.json
- .npmignore file for cleaner npm packages
- News section in io-package.json for ioBroker Admin UI
- README link in io-package.json

## 0.2.8 - 2026-02-03

### Changed

- Repository renamed from `data-solectrus` to `ioBroker.data-solectrus` for ioBroker naming convention compliance.
- Updated all GitHub URLs in documentation and configuration files.

## 0.2.7 - 2026-01-30

### Added

- New sync diagnostics under `info.*`: input timestamp gap telemetry (`info.inputTsGapMs`, `info.inputTsGapOk`, `info.inputTsGapThresholdMs`, `info.inputTsSources`, `info.inputTsMissing`).
- New deterministic regression check script: `npm run check:simulate` (30s / 6 ticks) to validate PV + signed grid meter scenarios.

### Changed

- Admin UI: clearer wording + tooltip for “Ergebnis negativ → 0” (mode-aware hint: source vs formula).
- Docs: README + Wiki updated to clarify output clamp vs per-input clamp.

### Fixed

- Formula evaluation: item-level `noNegative` no longer clamps negative *inputs* (important for signed meters where export is negative). Only per-input `noNegative` clamps that input; item-level `noNegative` clamps the final result.
- Source mode: output datatype handling corrected (string/boolean/mixed items no longer force numeric parsing; primitives are mirrored correctly).
- Sync diagnostics robustness: initial reads now populate the timestamp cache so `info.inputTsGap*` works immediately after startup.

## 0.2.6 - 2026-01-29

### Added

- Admin UI: Formula Builder popup for building formulas with a palette (operators/functions/state pickers).
- Admin UI: Live input values inside the builder (polling while popup is open).
- Admin UI: Local in-browser formula preview pill (updates automatically while popup is open).

### Fixed

- Admin UI: Builder crash on open (runtime error in custom UI script).
- Admin UI: Formula Builder live values now respect JSONPath and input clamping (neg→0) in the preview.

## 0.2.5 - 2026-01-29

### Changed

- Internal refactor: extracted formula parsing/evaluation and JSONPath helpers into separate modules under `lib/` to keep `main.js` smaller and easier to maintain.
- No functional changes intended.

## 0.2.4 - 2026-01-29

### Added

- Subscription management hardening: subscriptions are now derived from enabled items and kept in sync (unsubscribe removed ids). A global cap prevents runaway subscription counts.
- Tick time budget to avoid long ticks piling up; new telemetry states: `info.timeBudgetMs` and `info.skippedItems`.

### Fixed

- Output type consistency: formula results are no longer forced numeric for `string`/`boolean`/`mixed` outputs.
- Fallback after repeated errors is now type-appropriate (e.g. `''` for string outputs instead of `'0'`).

## 0.2.3 - 2026-01-29

### Fixed

- Formula inputs with JSONPath can now yield strings/booleans (not only numbers). This enables conditions like `IF(opMode == 'Heating', ..., 0)` when `opMode` is an input extracted from a JSON payload.
	- Numeric-like strings (e.g. `"12.2"`) are still treated as numbers to keep strict comparisons (`===`) working as expected.

## 0.2.2 - 2026-01-29

### Added

- New formula helper `jp("state.id", "jsonPath")` to read primitive values (string/number/boolean) from JSON payload states via the built-in minimal JSONPath.
	- This enables conditions like `IF(jp("...", "$['Operation Mode']") == 'Heating', ..., 0)` without requiring separate input states.
- Per-item diagnostics states under `data-solectrus.0.items.<outputId>.*`:
	- `compiledOk`, `compileError`, `lastError`, `lastOkTs`, `lastEvalMs`, `consecutiveErrors`.

### Changed

- Robust tick behavior: formula/compile/snapshot failures no longer stop the adapter; errors are handled per item.
- Fallback behavior on errors: keep the last good value for a few retries, then set the output to `0` (config key `errorRetriesBeforeZero`, default: 3).
- Performance: formulas are compiled once per item (normalized expression + AST) and reused during ticks; snapshot/subscriptions use compiled source ids.
- Config change detection: when items change without restart, the adapter rebuilds compiled caches on the next tick.

## 0.2.1 - 2026-01-29

### Added

- Formula function `IF(condition, valueIfTrue, valueIfFalse)` (alias: `if(...)`).
- Helper `v("state.id")` to read raw foreign state values (string/boolean/number) from cache/snapshot.
- Compatibility normalization in formulas (outside strings): `AND`/`OR`/`NOT` and single `=`.

### Changed

- Expression engine: re-introduced `==` and `!=` for compatibility with existing formula styles (use `===`/`!==` when you want strict matching).
- `s("...")` / `v("...")` state ids are now discovered from formulas and included in snapshot/subscriptions.

## 0.2.0 - 2026-01-29

### Added

- Formula function `pow(a, b)` (use this instead of an exponent operator).
- One-time debug logs for blocked dangerous input keys and for skipped JSONPath when the source value is already numeric.

### Changed

- Security hardening: formula input variables use a null-prototype map and block dangerous keys (`__proto__`, `prototype`, `constructor`).
- Expression engine: removed support for `**` and for loose equality operators `==` / `!=` (use `===` / `!==`).
- Bounded internal "log once" caches to avoid unbounded growth.

## 0.1.22 - 2026-01-28

### Added

- Optional JSON extraction for `source` items and formula inputs via **JSONPath (optional)** (e.g. `$.apower`, `$.aenergy.by_minute[2]`).

### Changed

- Wiki/README updated: JSON payloads no longer require a separate alias/script when JSONPath is configured.
- When `Datatype` is set to `boolean` or `string`, the adapter now writes real booleans/strings to the output state (not 0/1).

### Notes

- JSONPath support is intentionally limited (dot access, bracket keys, array indexes). Unsupported expressions fall back to `0` and log a warning once.
