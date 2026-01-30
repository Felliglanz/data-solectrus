# Werte begrenzen / klemmen

In der Praxis liefern Sensoren gelegentlich Ausreißer:

- kurz negative Werte (z.B. -3 W)
- unrealistisch hohe Spitzen
- NaN/Null-Glitches in Übergängen

data-solectrus bietet zwei Ebenen, um das abzufangen:

1. **UI-Optionen pro Item** (Clamp negative to 0, Clamp result Min/Max)
2. **Formel-Funktionen** wie `max(...)`, `min(...)`, `clamp(value, min, max)`

## 1) Negative Werte auf 0

Wenn dein Ergebnis nie negativ sein darf (z.B. PV-Leistung, Verbraucherleistung):

- Aktiviere **Clamp negative to 0**

Hinweis: **Clamp negative to 0** wirkt auf das **Ergebnis** (Output) des Items.
Wenn du nur einzelne Quellen/Inputs bereinigen willst, nutze entweder die Option **Input negativ auf 0** direkt am jeweiligen Input oder `max(0, …)` in der Formel.

## 2) Ergebnis begrenzen (Min/Max)

Beispiele:

- PV-Leistung soll nie über 20000 W gehen → Clamp result: Max = `20000`
- SoC soll immer 0–100% bleiben → Clamp result: Min = `0`, Max = `100`

## 3) Begrenzen direkt in der Formel

Manchmal willst du bewusst nur in der Formel begrenzen, z.B. wenn du bestimmte Inputs begrenzt, andere aber nicht.

### Beispiel: SoC 0–100

```
clamp(soc, 0, 100)
```

### Beispiel: import/export trennen

```
import = max(0, grid)
export = max(0, -grid)
```

## Empfehlung

- Für einfache Fälle: UI-Clamps nutzen (schnell, transparent).
- Für Logik/Abzweigungen: `max/min/clamp` in der Formel nutzen.
