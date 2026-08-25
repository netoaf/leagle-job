# Leagle Job Operational Runbook

Este runbook e o guia pratico para usar o Leagle Job sem estragar dados,
duplicar vagas ou enviar candidaturas sem revisao.

## Regra Principal

O Leagle Job prepara e organiza. A decisao final e humana.

Nunca usar a ferramenta para:

- inventar experiencia, projetos, certificados, metricas, links ou clientes;
- enviar emails automaticamente;
- submeter formularios automaticamente;
- expor codigo privado, tokens, API keys ou links privados;
- apresentar o candidato como mid-level ou senior.

## Health Check

Antes de mexer no sistema ou depois de uma alteracao:

```powershell
npm.cmd run jobfinder:health
```

Este comando agrega:

- `doctor.mjs`
- validacao de config/scoring;
- testes dos exemplos de scoring;
- verificacao do pipeline/dashboard data;
- draft quality gate para packs de candidatura;
- safety check do browser agent;
- testes do dashboard Go quando o Go bundled esta presente.

Se este comando falhar, corrigir antes de procurar vagas novas.

## Saude, memoria de execucao e cobertura do mercado

Estes sao tres sinais diferentes:

- **Saude das fontes** indica se a URL/configuracao de uma fonte publica
  respondeu recentemente. Nao prova que existam vagas relevantes.
- **Memoria de execucao** indica o que aconteceu em scans reais comparaveis:
  falha da fonte, zero aquisicao, falha de captura, vagas sem fit ou resultado
  saudavel. Tres falhas seguidas geram alerta alto; tres aquisicoes vazias
  geram aviso medio, sem chamar a fonte de avariada.
- **Cobertura** indica quantas URLs qualificadas foram realmente capturadas
  nos ultimos sete dias para LinkedIn, Indeed, IEFP, ITJobs e Net-Empregos.
  Uma fonte saudavel nao aumenta esta contagem por si so.

Antes de tratar uma pesquisa como atual, ou antes de escrever vagas novas no
dashboard, atualizar e rever ambos os sinais:

```powershell
npm.cmd run portals:audit
npm.cmd run sources:status
npm.cmd run coverage:audit
```

Se a cobertura estiver `DEGRADED`, continua a ser seguro fazer uma pesquisa em
modo preview, mas nao afirmes que o mercado esta coberto. Para uma URL publica
que viste manualmente, usa o unico fluxo de captura/revisao existente:

```powershell
npm.cmd run evaluate-url:write -- --url "https://exemplo.pt/vaga"
```

Nao substituir este passo por login automatico, scraping autenticado ou uma
candidatura. A URL deve ser publica, recente e revista antes de qualquer acao.

## Analise de segredos

Antes de partilhar uma branch ou criar um pacote, executar:

```powershell
npm.cmd run security:scan
```

O comando analisa todo o historico Git, redige os valores encontrados e falha
se detetar um segredo. Nao le nem envia dados externos. O executavel local em
`tools/gitleaks/` nao entra no Git nem no pacote; em Windows pode ser criado
com o Go bundled:

```powershell
$env:GOBIN = "$PWD\tools\gitleaks"
.\tools\go\bin\go.exe install github.com/zricethezav/gitleaks/v8@v8.30.1
```

## Daily Workflow

1. Confirmar saude:

```powershell
npm.cmd run jobfinder:health
```

2. Atualizar saude das fontes e confirmar a cobertura, pelo menos uma vez por
   semana e sempre antes de uma escrita importante:

```powershell
npm.cmd run portals:audit
npm.cmd run sources:status
npm.cmd run coverage:audit
```

3. Procurar vagas novas Portugal-first sem escrever:

```powershell
npm.cmd run jobfinder:new:dry-run -- --limit 80
```

4. Se houver vagas boas e os sinais anteriores forem conhecidos, escrever
   poucas de cada vez:

```powershell
npm.cmd run jobfinder:new -- --limit 80 --write-limit 5
```

5. Validar dashboard:

```powershell
npm.cmd run verify
```

6. Abrir o dashboard:

```powershell
.\dashboard\career-dashboard-live.exe
```

## Remote/Global Workflow

Usar apenas depois de limpar Portugal-first:

```powershell
npm.cmd run jobfinder:remote:dry-run -- --limit 80
npm.cmd run jobfinder:global:dry-run -- --limit 80
```

Escrever no dashboard apenas se a oportunidade for realmente forte:

```powershell
npm.cmd run jobfinder:remote -- --limit 80 --write-limit 3
```

## Single URL Workflow

Para uma vaga especifica:

```powershell
npm.cmd run evaluate-url -- --url "https://example.com/job"
```

Guardar artefactos:

```powershell
npm.cmd run evaluate-url:write -- --url "https://example.com/job"
```

Promover para dashboard se passar qualidade/scoring:

```powershell
npm.cmd run evaluate-url:dashboard -- --url "https://example.com/job"
```

## Recovery Workflow

Usar apenas quando uma vaga foi falsamente rejeitada antes de um adapter ser
melhorado.

Exemplo:

```powershell
npm.cmd run jobfinder:remote -- --source Celonis --audit --limit 10 --write-limit 1 --write-guard-mode dashboard_only
```

Regras:

- usar fonte especifica;
- usar `write-limit` baixo;
- validar com `npm.cmd run verify`;
- nao usar como workflow normal.

## Source Health Workflow

Auditar fontes:

```powershell
npm.cmd run portals:audit
```

Depois rever:

```text
data/source-health.tsv
docs/source-health.md
```

Rever a memoria persistente dos scans canonicos:

```powershell
npm.cmd run sources:status
```

O ficheiro local e `data/source-runs.tsv`. `jobfinder:*:dry-run`, re-ranking de
snapshots e avaliacao de candidatos fornecidos nao o alteram. Um alerta `HIGH`
significa tres falhas comparaveis; um `MEDIUM` de aquisicao vazia pode apenas
significar que nao existem vagas atuais para os filtros usados. Confirmar com
`portals:audit` e com a pagina oficial antes de alterar ou desativar uma fonte.

Prioridade de correcao:

1. fontes high-value com URL morto;
2. fontes high-value bloqueadas mas recuperaveis com adapter;
3. fontes low-value com ruido alto;
4. fontes globais com baixo fit recorrente.

## Dashboard Workflow

Atalhos principais:

- setas: navegar;
- `Enter`: abrir report;
- `D`: executar o preflight Gmail da vaga selecionada; só pode criar um
  rascunho Gmail não enviado quando a integração estiver explicitamente
  configurada e todos os gates passarem;
- `O`: abrir a vaga;
- `C`: mudar estado;
- setas esquerda/direita: mudar separador;
- `Esc`: voltar/sair.

O dashboard mostra apenas estas teclas de uso diario. Acoes de manutencao e
diagnostico continuam disponiveis pelos comandos documentados, sem poluir a
interface principal.

Acoes disponiveis no dashboard:

- health check;
- pesquisa Portugal preview;
- pesquisa Portugal com escrita limitada;
- deep search preview;
- remote/EU preview;
- source audit preview;
- source cleanup plan;
- Top 10 action mode;
- CV diff top 10;
- draft quality gate;
- follow-ups.

Estados recomendados:

- `Evaluated`: analisada, ainda nao enviada.
- `Skip`: nao aplicar.
- `Applied`: candidatura enviada manualmente.
- `Interview`: entrevista marcada.
- `Rejected`: rejeitada.

Quando mudares uma vaga para `Applied`, o dashboard atualiza
`data/application-followups.tsv` com data de candidatura e follow-up sugerido.

## Top 10 Workflow

Objetivo operacional: transformar as melhores 10 vagas em candidaturas fortes.

Gerar plano de execucao + packs:

```powershell
npm.cmd run top10-action
```

Gerar fila de canais/proximas acoes:

```powershell
npm.cmd run application-actions -- --top 10
```

Gerar packs:

```powershell
npm.cmd run application-pack -- --top 10
```

Validar drafts:

```powershell
npm.cmd run draft-quality
```

Se a gate falhar, corrigir o report/pack antes de usar qualquer email.

Preparar drafts locais para revisao, sem tocar no Gmail:

```powershell
npm.cmd run email-drafts:dry-run -- --top 3
npm.cmd run email-drafts -- --top 3
```

Estes comandos escrevem apenas em `data/email-drafts.tsv` e
`output/email-drafts-local/`. Não criam drafts reais no Gmail, não enviam email
e não anexam/uploadam CV.

O passo opcional `npm run gmail-draft-live -- --id <id>` só é válido quando o
Gmail foi configurado explicitamente. Requer destinatário, CV selecionado,
verificação Playwright fresca e review Codex; pode criar um rascunho **não
enviado** e nunca envia a mensagem. Ver [gmail-adapter.md](gmail-adapter.md).

Checklist por vaga:

- score e recommendation revistos;
- report lido;
- canal oficial de candidatura confirmado;
- draft quality gate sem erros;
- red flags confirmadas;
- requisitos de lingua confirmados;
- elegibilidade confirmada;
- CV adaptado apenas com dados reais;
- email draft revisto;
- draft local criado e destinatario confirmado, se for usar email;
- candidatura aprovada manualmente;
- follow-up registado.

Gerar diffs seguros de CV para as melhores vagas:

```powershell
npm.cmd run cv-tailor-diff -- --top 10
```

Estes diffs nao editam `cv.md` e nao geram PDF. Servem para revisao antes de
criar um CV adaptado.

## Follow-Up Workflow

Listar follow-ups:

```powershell
npm.cmd run followups
```

Inicializar linhas em falta para candidaturas ativas:

```powershell
npm.cmd run followups:init
```

O ficheiro de follow-up fica em:

```text
data/application-followups.tsv
```

## Validacoes Antes De Alterar Codigo

```powershell
npm.cmd run jobfinder:health
```

## Validacoes Depois De Alterar Codigo

```powershell
npm.cmd run jobfinder:health
```

Se alterar dashboard:

```powershell
cd dashboard
$env:GOCACHE = Join-Path (Get-Location) '.gocache'
..\tools\go\bin\go.exe test ./...
..\tools\go\bin\go.exe build -buildvcs=false -o career-dashboard-live.exe .
..\tools\go\bin\go.exe build -buildvcs=false -o career-dashboard.exe .
```

## O Que Fazer Se Algo Falhar

1. Nao correr comandos de escrita.
2. Ler a mensagem de erro.
3. Corrigir a causa mais pequena possivel.
4. Repetir `npm.cmd run jobfinder:health`.
5. So voltar ao scan real depois de estar verde.
