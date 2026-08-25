# Modus: pipeline — URL-Inbox (Second Brain)

> **CANONICAL-OPERATIONAL-CONTRACT:** `modes/_shared.md` governs every operational action, score, tracker change and safety boundary. Use the supported local pipeline; never edit the tracker directly, upload files, send or submit.

Verarbeitet URLs von Stellenanzeigen, die in `data/pipeline.md` gesammelt wurden. Der Kandidat wirft URLs ins Inbox, wann immer er eine entdeckt, und führt später `/career-ops pipeline` aus, um sie alle in einem Rutsch zu verarbeiten.

## Workflow

1. Mit `npm run jobfinder:new:dry-run` oder `evaluate-url.mjs` eine bestätigte URL prüfen.
2. Die vorhandene Pipeline führt Extraktion, Qualitätsschranke, Deduplizierung,
   kanonisches 0--100 Scoring und Report-Erstellung aus.
3. Ein Schreiben in das Dashboard nur nach ausdrücklicher menschlicher Wahl
   ausführen; keine Datei oder Tracker-Zeile manuell erzeugen.
4. Mit `npm run verify` prüfen und nur die nächste menschliche Review-Aktion
   anzeigen. Keine parallelen Browser-Agenten starten.

Die Ergebnisübersicht verwendet den kanonischen Score und die Empfehlung:

```
| # | Firma | Rolle | Score/100 | Empfehlung | Nächste Aktion |
```

## Format von pipeline.md

```markdown
## Offen
- [ ] https://jobs.example.com/posting/123
- [ ] https://boards.greenhouse.io/company/jobs/456 | Company GmbH | Senior PM
- [!] https://private.url/job — Fehler: Login erforderlich

## Verarbeitet
- [x] #143 | https://jobs.example.com/posting/789 | Acme GmbH | AI PM | 4.2/5 | PDF ✅
- [x] #144 | https://boards.greenhouse.io/xyz/jobs/012 | BigCo | SA | 2.1/5 | PDF ❌
```

> Hinweis: Die Sektion-Überschriften können auf EN ("Pending"/"Processed"), ES ("Pendientes"/"Procesadas") oder DE ("Offen"/"Verarbeitet") sein. Beim Lesen flexibel sein, beim Schreiben dem Stil der bestehenden Datei treu bleiben.

## Intelligente Erkennung der Stellenanzeige aus der URL

1. **Playwright (bevorzugt):** `browser_navigate` + `browser_snapshot`. Funktioniert mit allen SPAs.
2. **WebFetch (Fallback):** Für statische Seiten oder wenn Playwright nicht verfügbar ist.
3. **WebSearch (letzter Ausweg):** In sekundären Portalen suchen, die die Stellenanzeige indexieren.

**Sonderfälle:**
- **LinkedIn**: Kann Login erfordern → mit `[!]` markieren und den Kandidaten bitten, den Text einzufügen
- **PDF**: Wenn die URL auf ein PDF zeigt, direkt mit dem Read-Tool lesen
- **`local:`-Präfix**: Lokale Datei lesen. Beispiel: `local:jds/linkedin-pm-ai.md` → `jds/linkedin-pm-ai.md` lesen
- **StepStone / XING / kununu**: Häufig deutscher Markt, oft Cookie-Banner. Playwright kann in Snapshot scrollen, um den Anzeigentext zu erfassen
- **Bundesagentur für Arbeit (arbeitsagentur.de)**: Strukturierte Stellenanzeigen, gut maschinenlesbar. WebFetch reicht meist

## Automatische Nummerierung

1. Alle Dateien in `reports/` listen
2. Aus dem Präfix die Nummer extrahieren (z. B. `142-medispend...` → 142)
3. Neue Nummer = höchste gefundene + 1

## Synchronisierung der Quellen

Vor dem Verarbeiten irgendeiner URL die Sync prüfen:

```bash
node cv-sync-check.mjs
```

Bei Abweichungen den Kandidaten warnen, bevor weitergearbeitet wird.
