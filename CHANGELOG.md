# Changelog

## 0.1.22 - 2026-01-28

### Added

- Optional JSON extraction for `source` items and formula inputs via **JSONPath (optional)** (e.g. `$.apower`, `$.aenergy.by_minute[2]`).

### Changed

- Wiki/README updated: JSON payloads no longer require a separate alias/script when JSONPath is configured.

### Notes

- JSONPath support is intentionally limited (dot access, bracket keys, array indexes). Unsupported expressions fall back to `0` and log a warning once.
