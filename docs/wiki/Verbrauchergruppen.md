# Verbrauchergruppen zusammenfassen ("Küche", "IT", "Wäsche" …)

Wenn du viele kleine Verbraucher misst (z.B. per Shelly, smarten Steckdosen oder Zwischenzählern), ist es oft unpraktisch, jedes Gerät einzeln in SOLECTRUS zu führen.

- Es wird schnell unübersichtlich.
- In SOLECTRUS stößt man außerdem je nach Feature/Version an ein Limit für „Custom Consumers“.

Die Idee (inspiriert von Georgs Ansatz aus der SOLECTRUS-Community) ist daher:

1. Du misst viele einzelne Verbraucher in ioBroker.
2. Du bildest in ioBroker thematische Gruppen (z.B. „Küche“, „IT“, „Heizen“).
3. Der Adapter **data-solectrus** rechnet pro Gruppe eine Summe.
4. Du leitest nur noch die Gruppen-Summen an SOLECTRUS weiter (z.B. via mqtt-collector).

## Voraussetzungen

- Jeder Verbraucher liefert eine **numerische** Leistung in Watt (W) als ioBroker-State.
  - Ideal sind States wie `...power` / `...apower` / `...activePower`.
  - Falls dein MQTT-Payload JSON ist (z.B. `{ "apower": 97.5 }`) und im ioBroker-State als Text landet, kannst du im Adapter pro Input ein **JSONPath (optional)** setzen, z.B. `$.apower`.

## Beispiel: Gruppen "Küche" und "IT"

### Ziel

- `data-solectrus.0.consumers.kueche_power`
- `data-solectrus.0.consumers.it_power`

### Item 1: Küche

- **Enabled**: an
- **Folder/Group**: `consumers`
- **Target ID**: `kueche_power`
- **Mode**: `formula`
- **Inputs** (Key → Source State):
  - `kuehlschrank` → (dein State, z.B. `shelly.0.kitchen.fridge.power`)
  - `spuelmaschine` → (z.B. `shelly.0.kitchen.dishwasher.power`)
  - `waschmaschine` → (z.B. `shelly.0.kitchen.washer.power`)
- **Formula expression**:

```
max(0, kuehlschrank) + max(0, spuelmaschine) + max(0, waschmaschine)
```

- Optional: **Clamp negative to 0** aktivieren
- **Unit**: `W`

### Item 2: IT

- **Folder/Group**: `consumers`
- **Target ID**: `it_power`
- **Mode**: `formula`
- **Inputs**:
  - `nas` → …
  - `router` → …
  - `workstation` → …
- **Formel**:

```
max(0, nas) + max(0, router) + max(0, workstation)
```

## Praktische Tipps

- Keys in den Inputs am besten nur `a-z`, `0-9`, `_` verwenden (z.B. `kuehlschrank`, `it_router`).
- Wenn ein Gerät gelegentlich kurz negative Werte liefert (Messartefakt), ist `max(0, …)` bzw. „Clamp negative to 0“ Gold wert.
- Lege lieber **wenige, aussagekräftige Gruppen** an (z.B. 5–8), statt 30 Einzelgeräte.

## Weiterleitung zu SOLECTRUS (Beispiel-Idee)

Der Adapter schreibt die Summen nach `data-solectrus.0.*`. Diese States kannst du z.B. per MQTT in Richtung SOLECTRUS weiterreichen (je nach Setup). Ein häufiges Muster ist:

- ioBroker MQTT Adapter stellt `data-solectrus.0.consumers.*` als Topics bereit
- mqtt-collector mapped Topics → Measurements/Fields in InfluxDB

Wichtig: Topic-Namen, Measurement/Field und Datentyp müssen zu deinem Collector-Setup passen.
