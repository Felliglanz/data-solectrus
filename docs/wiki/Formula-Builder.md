# Formula Builder

Der **Formula Builder** ist ein komfortabler Editor im Admin-UI des Adapters **data-solectrus**, mit dem du Formeln schneller und fehlerärmer zusammenbauen kannst.

Er ist besonders hilfreich, wenn du viele Inputs hast (z. B. mehrere PV-Quellen) oder häufig Operatoren/Funktionen nutzt.

---

## Öffnen

1. Öffne die Adapter-Instanz im ioBroker Admin.
2. Wechsle zum Bereich **Items**.
3. Wähle ein Item im Modus **Formula**.
4. Klicke bei **Formula expression** auf **Builder…**.

Es öffnet sich ein Popup (links Palette, rechts Editor).

---

## Variablen / Inputs (links)

Unter **Variables (Inputs)** siehst du alle aktuell konfigurierten Inputs als Variablen (Keys). Mit einem Klick auf eine Variable wird der Variablenname in die Formel eingefügt.

### Live-Werte

Im Builder werden die aktuellen Werte der Input-States als **Live values** angezeigt.

- Die Live-Werte werden automatisch aktualisiert (Polling), solange das Popup offen ist.
- Mit **Refresh** kannst du die Werte auch manuell neu laden.

Hinweis: Die Live-Werte beziehen sich auf die im Item konfigurierten Inputs.

---

## Operatoren & Funktionen (links)

Der Builder bietet Buttons für typische Bausteine:

- **Operators**: `+ - * / % ( ) && || ! == != >= <= > < ? :`
- **Functions**: `min(a,b)`, `max(a,b)`, `clamp(value,min,max)`, `IF(condition, valueIfTrue, valueIfFalse)`

Mit einem Klick wird der Text in den Editor eingefügt (teilweise mit sinnvoller Cursor/Markierung).

---

## State Functions (links)

Du kannst State-IDs direkt über den ioBroker State-Picker auswählen und einfügen:

- `s("state.id")`
- `v("state.id")`
- `jp("state.id", "$.value")`

Diese Funktionen werden beim normalen Adapter-Lauf ausgewertet.

---

## Editor & Ergebnis-Vorschau (rechts)

Rechts ist der **Formula expression** Editor.

Oben rechts wird ein **Result** als Pill angezeigt.

- Die Vorschau wird **lokal im Browser** berechnet (schnell, ohne Adapter-Message).
- Sie verwendet die **aktuellen Live-Werte** der Inputs.
- Sie wird automatisch aktualisiert, solange das Popup offen ist.
- Mit **Refresh** kannst du die Vorschau zusätzlich manuell neu berechnen.

### Einschränkungen der Vorschau

Die lokale Vorschau unterstützt **keine** State-Funktionen (`s()`, `v()`, `jp()`), weil diese serverseitig/adapterseitig auf States zugreifen.

Wenn deine Formel solche Funktionen enthält, zeigt die Vorschau entsprechend eine Fehlermeldung.

---

## Änderungen übernehmen

- **Apply**: übernimmt den Inhalt des Editors in das Item.
- **Cancel** / **Close**: schließt das Popup ohne zu speichern.

Wichtig: Der Builder arbeitet im Popup zunächst mit „Draft“-Werten. Erst mit **Apply** wird die Item-Formel gespeichert.

---

## Troubleshooting

### Ich sehe alte UI / Änderungen kommen nicht an

Der Builder ist Teil der `customComponents.js`, die im Browser gecacht werden kann.

- Browser hart neu laden (Cache leeren) oder Admin-UI neu öffnen.

### Result zeigt `n/a` oder `NaN`

- Prüfe, ob die Inputs wirklich Werte liefern (links bei Live values).
- Prüfe, ob deine Variablen-Keys gültige Namen sind (z. B. keine Sonderzeichen; diese werden für die Vorschau normalisiert).

