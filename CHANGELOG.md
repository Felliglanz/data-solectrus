# Changelog

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
