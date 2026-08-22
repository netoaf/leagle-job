# Mode : pipeline -- Inbox d'URLs (Second Brain)

> **CANONICAL-OPERATIONAL-CONTRACT:** `modes/_shared.md` governs every operational action, score, tracker change and safety boundary. Use the supported local pipeline; never edit the tracker directly, upload files, send or submit.

Traite les URLs d'offres accumulees dans `data/pipeline.md`. Le candidat ajoute des URLs quand il veut et lance ensuite `/career-ops pipeline` pour toutes les traiter d'un coup.

## Workflow

1. Verifier une URL confirmee avec `npm run jobfinder:new:dry-run` ou
   `evaluate-url.mjs`.
2. La pipeline existante effectue l'extraction, le quality gate, la deduplication,
   le score canonique 0--100 et le report.
3. N'ecrire dans le dashboard qu'apres un choix humain explicite; ne jamais
   creer manuellement une ligne de tracker.
4. Executer `npm run verify` et afficher uniquement la prochaine action de
   revue humaine. Ne pas lancer de navigateurs en parallele.

Le recapitulatif utilise le score et la recommandation canoniques :

```
| # | Entreprise | Role | Score/100 | Recommandation | Prochaine action |
```

## Format de pipeline.md

```markdown
## En attente
- [ ] https://jobs.example.com/posting/123
- [ ] https://boards.greenhouse.io/company/jobs/456 | Company SAS | Senior PM
- [!] https://private.url/job -- Erreur : login requis

## Traitees
- [x] #143 | https://jobs.example.com/posting/789 | Acme SAS | AI PM | 4.2/5 | PDF oui
- [x] #144 | https://boards.greenhouse.io/xyz/jobs/012 | BigCo | SA | 2.1/5 | PDF non
```

> Note : Les en-tetes de section peuvent etre en EN ("Pending"/"Processed"), ES ("Pendientes"/"Procesadas"), DE ("Offen"/"Verarbeitet") ou FR ("En attente"/"Traitees"). Etre flexible a la lecture, fidele au style existant a l'ecriture.

## Detection intelligente de l'offre depuis l'URL

1. **Playwright (prefere) :** `browser_navigate` + `browser_snapshot`. Fonctionne avec toutes les SPAs.
2. **WebFetch (fallback) :** Pour les pages statiques ou quand Playwright n'est pas disponible.
3. **WebSearch (dernier recours) :** Chercher sur des portails secondaires qui indexent l'offre.

**Cas particuliers :**
- **LinkedIn** : Peut necessiter un login -> marquer `[!]` et demander au candidat de coller le texte
- **PDF** : Si l'URL pointe vers un PDF, le lire directement avec le Read tool
- **Prefixe `local:`** : Lire le fichier local. Exemple : `local:jds/linkedin-pm-ai.md` -> lire `jds/linkedin-pm-ai.md`
- **Welcome to the Jungle / Indeed FR / APEC** : Portails francophones courants. Playwright gere bien les cookie banners
- **France Travail (ex-Pole emploi)** : Offres structurees, bien lisibles par machine. WebFetch suffit generalement

## Numerotation automatique

1. Lister tous les fichiers dans `reports/`
2. Extraire le numero du prefixe (ex : `142-medispend...` -> 142)
3. Nouveau numero = maximum trouve + 1

## Synchronisation des sources

Avant de traiter une URL, verifier la sync :

```bash
node cv-sync-check.mjs
```

En cas de desynchronisation, alerter le candidat avant de continuer.
