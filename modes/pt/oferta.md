# Modo: oferta -- Avaliacao Completa A-F

> **CANONICAL-OPERATIONAL-CONTRACT:** `modes/_shared.md` governs every operational action, score, tracker change and safety boundary. Este ficheiro acrescenta contexto de análise em português; nunca editar o tracker diretamente, fazer upload, enviar ou submeter.

Quando o candidato cola uma vaga (texto ou URL), entregar SEMPRE os 6 blocos:

Antes de classificar a vaga, ler `modes/_profile.md`. Se o perfil definir
arquetipos, senioridade, scoring ou regras proprias, essas regras sobrepoem os
exemplos genericos deste ficheiro.

## Passo 0 -- Deteccao de Arquetipo

Classificar a vaga em um dos 6 arquetipos (ver `_shared.md`). Se for hibrido, indicar os 2 mais proximos. Isso determina:
- Quais proof points priorizar no bloco B
- Como reescrever o summary no bloco E
- Quais historias STAR preparar no bloco F

## Bloco A -- Resumo da Vaga

Tabela com:
- Arquetipo detectado
- Domain (platform/agentic/LLMOps/ML/enterprise)
- Funcao (build/consult/manage/deploy)
- Senioridade
- Remoto (full/hibrido/presencial)
- Tamanho do time (se mencionado)
- TL;DR em 1 frase

## Bloco B -- Match com o Curriculo

Ler `cv.md`. Criar tabela com cada requisito do JD mapeado para linhas exatas do curriculo.

**Adaptado ao arquetipo:**
- Se FDE → priorizar proof points de entrega rapida e proximidade com cliente
- Se SA → priorizar design de sistemas e integracoes
- Se PM → priorizar product discovery e metricas
- Se LLMOps → priorizar evals, observability, pipelines
- Se Agentic → priorizar multi-agent, HITL, orquestracao
- Se Transformation → priorizar gestao de mudanca, adocao, escalabilidade

Secao de **gaps** com estrategia de mitigacao para cada um. Para cada gap:
1. E um hard blocker ou um nice-to-have?
2. O candidato consegue demonstrar experiencia adjacente?
3. Existe um projeto do portfolio que cubra esse gap?
4. Plano de mitigacao concreto (frase para carta de apresentacao, projeto rapido, etc.)

## Bloco C -- Nivel e Estrategia

1. **Nivel detectado** no JD vs **nivel natural do candidato para esse arquetipo**
2. **Plano de posicionamento junior/estagio honesto**: frases especificas adaptadas ao arquetipo, projetos concretos a destacar e como mostrar iniciativa sem exagerar experiencia
3. **Plano se a vaga pedir mais senioridade**: identificar hard blockers, propor candidatura apenas se aceitarem junior/estagio e listar o que deve ser confirmado antes de aplicar

## Bloco D -- Remuneracao e Demanda

Usar WebSearch para:
- Salarios atuais da vaga (Glassdoor, Levels.fyi, Blind, Glassdoor BR)
- Reputacao de remuneracao da empresa
- Tendencia de demanda da vaga

Tabela com dados e fontes citadas. Se nao houver dados, dizer isso em vez de inventar.

**Mercado Brasileiro -- Checks obrigatorios:**
- CLT ou PJ? Se CLT: considerar 13o, ferias, FGTS, plano de saude, VR/VA na comparacao.
- Se PJ: qual o valor mensal? Calcular equivalente CLT.
- PLR mencionado? Quantos salarios extras?
- Stock options / VSOP? Avaliar vesting, cliff e liquidez.
- Vale-refeicao / vale-alimentacao? Valor mensal?
- Plano de saude? Coparticipacao ou integral?

## Bloco E -- Plano de Personalizacao

| # | Secao | Estado atual | Mudanca proposta | Por que |
|---|-------|-------------|------------------|---------|
| 1 | Summary | ... | ... | ... |
| ... | ... | ... | ... | ... |

Top 5 mudancas no curriculo + Top 5 mudancas no LinkedIn para maximizar o match.

## Bloco F -- Plano de Entrevistas

6-10 historias STAR+R mapeadas para requisitos do JD (STAR + **Reflection**):

| # | Requisito do JD | Historia STAR+R | S | T | A | R | Reflection |
|---|----------------|-----------------|---|---|---|---|------------|

A coluna **Reflection** captura o que foi aprendido ou o que seria feito diferente. Isso sinaliza senioridade — candidatos juniores descrevem o que aconteceu, candidatos seniores extraem licoes.

**Story Bank:** Se `interview-prep/story-bank.md` existir, verificar se alguma dessas historias ja esta la. Se nao, adicionar as novas. Com o tempo, isso constroi um banco reutilizavel de 5-10 historias-mestre que podem ser adaptadas para qualquer pergunta de entrevista.

**Selecionadas e enquadradas conforme o arquetipo:**
- FDE → enfatizar velocidade de entrega e proximidade com cliente
- SA → enfatizar decisoes de arquitetura
- PM → enfatizar discovery e trade-offs
- LLMOps → enfatizar metricas, evals, production hardening
- Agentic → enfatizar orquestracao, tratamento de erros, HITL
- Transformation → enfatizar adocao e mudanca organizacional

Incluir tambem:
- 1 case study recomendado (qual projeto apresentar e como)
- Perguntas red-flag e como responde-las (ex: "Ainda nao tens experiencia profissional?", "Como compensas gaps da stack?", "Que partes do projeto sao privadas?")

---

## Pos-avaliacao

**SEMPRE** apos gerar os blocos A-F:

### 1. Salvar report .md

Salvar avaliacao completa em `reports/{###}-{company-slug}-{YYYY-MM-DD}.md`.

- `{###}` = proximo numero sequencial (3 digitos, zero-padded)
- `{company-slug}` = nome da empresa em lowercase, sem espacos (usar hifens)
- `{YYYY-MM-DD}` = data atual

**Formato do report:**

```markdown
# Avaliacao: {Empresa} -- {Vaga}

**Data:** {YYYY-MM-DD}
**Arquetipo:** {detectado}
**Score:** {N/100}
**URL:** {URL da vaga}
**PDF:** {caminho ou pendente}

---

## A) Resumo da Vaga
(conteudo completo do bloco A)

## B) Match com o Curriculo
(conteudo completo do bloco B)

## C) Nivel e Estrategia
(conteudo completo do bloco C)

## D) Remuneracao e Demanda
(conteudo completo do bloco D)

## E) Plano de Personalizacao
(conteudo completo do bloco E)

## F) Plano de Entrevistas
(conteudo completo do bloco F)

## G) Rascunhos de Respostas para Candidatura
(apenas quando a recomendacao canonica for `apply` -- rascunhos para campos do
formulario que param antes de upload ou submissao final)

---

## Keywords extraidas
(lista de 15-20 keywords do JD para otimizacao ATS)
```

### 2. Registar pela pipeline suportada

Nunca editar diretamente uma linha do tracker. Se a vaga tiver de entrar no
sistema, processar a URL confirmada por `evaluate-url.mjs` ou
`scan-and-rank.mjs`; essa pipeline atribui o score canonico 0--100, o estado e
o link do report. Executar depois `npm run verify`. Caso contrario, esta
avaliacao fica apenas como material de revisao.
