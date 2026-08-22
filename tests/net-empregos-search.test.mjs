import assert from 'node:assert/strict';
import test from 'node:test';

import { extractOfferDescription } from '../net-empregos-search.mjs';

test('isolates the actual Net-Empregos offer from navigation and similar jobs', () => {
  const html = `
    <nav>Pesquisar Ofertas API Java React</nav>
    <main>
      <h2>Detalhe da Oferta:</h2>
      <p>Desenvolver uma aplicacao em Node.js com acompanhamento.</p>
      <div>Partilhar Guardar Oferta</div>
      <section>Ofertas de Emprego Semelhantes: Senior Java Developer</section>
    </main>
  `;

  const description = extractOfferDescription(html);
  assert.match(description, /Node\.js/);
  assert.doesNotMatch(description, /Pesquisar Ofertas/);
  assert.doesNotMatch(description, /Senior Java Developer/);
});
