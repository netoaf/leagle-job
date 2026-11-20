import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const localizedOperationalModes = [
  'modes/de/README.md',
  'modes/de/_shared.md',
  'modes/de/angebot.md',
  'modes/de/pipeline.md',
  'modes/de/bewerben.md',
  'modes/fr/README.md',
  'modes/fr/_shared.md',
  'modes/fr/offre.md',
  'modes/fr/pipeline.md',
  'modes/fr/postuler.md',
  'modes/pt/README.md',
  'modes/pt/_shared.md',
  'modes/pt/oferta.md',
  'modes/pt/pipeline.md',
  'modes/pt/aplicar.md',
];

test('localized operational modes defer actions and safety to the canonical contract', () => {
  for (const file of localizedOperationalModes) {
    const content = readFileSync(join(projectRoot, file), 'utf8');
    assert.match(
      content,
      /CANONICAL-OPERATIONAL-CONTRACT:[\s\S]*modes\/_shared\.md/,
      `${file} must defer operational behavior to modes/_shared.md`,
    );
  }
});

test('localized modes do not preserve obsolete direct-tracker or legacy-score workflows', () => {
  const forbiddenInstructions = [
    ['modes/de/angebot.md', /### 2\. Im Tracker eintragen/],
    ['modes/fr/offre.md', /### 2\. Enregistrer dans le tracker/],
    ['modes/pt/oferta.md', /### 2\. Registrar no tracker/],
    ['modes/de/pipeline.md', /Score >= 3\.0/],
    ['modes/fr/pipeline.md', /score >= 3\.0/],
    ['modes/pt/pipeline.md', /score >= 60\/100/],
    ['modes/de/bewerben.md', /Status in `applications\.md`/],
    ['modes/fr/postuler.md', /statut dans `applications\.md`/],
    ['modes/pt/aplicar.md', /status em `applications\.md`/],
    ['modes/de/_shared.md', /Nach jeder Bewertung im Tracker eintragen/],
    ['modes/fr/_shared.md', /Enregistrer dans le tracker apres chaque evaluation/],
    ['modes/pt/_shared.md', /Registrar no tracker apos cada avaliacao/],
  ];

  for (const [file, pattern] of forbiddenInstructions) {
    const content = readFileSync(join(projectRoot, file), 'utf8');
    assert.doesNotMatch(content, pattern, `${file} retains an obsolete operational instruction`);
  }
});
