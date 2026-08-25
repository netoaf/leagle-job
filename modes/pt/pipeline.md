# Modo: pipeline -- Inbox de URLs (Second Brain)

> **CANONICAL-OPERATIONAL-CONTRACT:** `modes/_shared.md` governs every operational action, score, tracker change and safety boundary. Usar a pipeline local suportada; nunca editar o tracker diretamente, fazer upload, enviar ou submeter.

Processa URLs de vagas acumuladas em `data/pipeline.md`. O candidato adiciona URLs quando quiser e depois executa `/career-ops pipeline` para processar todas de uma vez.

## Workflow

1. Verificar uma URL confirmada com `npm run jobfinder:new:dry-run` ou
   `evaluate-url.mjs`.
2. A pipeline existente executa extracao, quality gate, deduplicacao, score
   canonico 0--100 e report.
3. Escrever no dashboard apenas depois de escolha humana explicita; nunca criar
   manualmente uma linha de tracker.
4. Executar `npm run verify` e mostrar apenas a proxima acao de revisao humana.
   Nao iniciar navegadores em paralelo.

A tabela resumo usa score e recomendacao canonicos:

```
| # | Empresa | Vaga | Score/100 | Recomendacao | Proxima acao |
```

## Formato de pipeline.md

```markdown
## Pendentes
- [ ] https://jobs.example.com/posting/123
- [ ] https://boards.greenhouse.io/company/jobs/456 | Company Inc | Senior PM
- [!] https://private.url/job — Erro: login necessario

## Processadas
- [x] #143 | https://jobs.example.com/posting/789 | Acme Corp | Junior Developer | 84/100 | PDF ✅
- [x] #144 | https://boards.greenhouse.io/xyz/jobs/012 | BigCo | Senior Architect | 42/100 | PDF ❌
```

> Nota: Os titulos das secoes podem estar em EN ("Pending"/"Processed"), ES ("Pendientes"/"Procesadas"), DE ("Offen"/"Verarbeitet") ou PT-BR ("Pendentes"/"Processadas"). Ao ler, ser flexivel; ao escrever, manter o estilo da arquivo existente.

## Deteccao inteligente de JD a partir da URL

1. **Playwright (preferido):** `browser_navigate` + `browser_snapshot`. Funciona com todas as SPAs.
2. **WebFetch (fallback):** Para paginas estaticas ou quando Playwright nao esta disponivel.
3. **WebSearch (ultimo recurso):** Buscar em portais secundarios que indexam o JD.

**Casos especiais:**
- **LinkedIn**: Pode exigir login → marcar com `[!]` e pedir ao candidato para colar o texto
- **PDF**: Se a URL aponta para um PDF, ler diretamente com o Read tool
- **`local:` prefix**: Ler arquivo local. Exemplo: `local:jds/linkedin-pm-ai.md` → ler `jds/linkedin-pm-ai.md`
- **Gupy / Greenhouse / Lever**: Plataformas comuns no Brasil. Playwright funciona bem com todas
- **Vagas.com.br / InfoJobs / Catho**: Portais brasileiros, geralmente acessiveis via WebFetch
- **LinkedIn BR**: Mesmas restricoes do LinkedIn global — pode exigir login

## Numeracao automatica

1. Listar todos os arquivos em `reports/`
2. Extrair o numero do prefixo (ex: `142-medispend...` → 142)
3. Novo numero = maximo encontrado + 1

## Sincronizacao de fontes

Antes de processar qualquer URL, verificar sincronizacao:

```bash
node cv-sync-check.mjs
```

Se houver dessincronizacao, avisar o candidato antes de continuar.
