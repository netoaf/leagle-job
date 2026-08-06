# Leagle Job Data Contracts

Este documento descreve os ficheiros que funcionam como fonte de verdade no
Leagle Job. Complementa `DATA_CONTRACT.md`, que separa camada de utilizador e
camada de sistema.

## Fontes De Verdade

| Area | Fonte de verdade | Observacoes |
|------|------------------|-------------|
| Perfil | `config/profile.yml` | Identidade, skills, linguas e preferencias confirmadas. |
| Contexto estruturado | `config/candidate-context.yml` | Evidencias, posicionamento, mensagens seguras e estrategia de pesquisa. |
| Banco de evidencias | `data/candidate-evidence.md` | Versao humana/revisavel do que pode ou nao ser afirmado. |
| CV textual | `cv.md` | Contexto textual usado por avaliacao, drafts e ajustes de CV. |
| CV PDF atual | caminho definido em `config/profile.yml` | PDF base escolhido localmente para candidaturas manuais. |
| Regras | `config/jobfinder-rules.yml` | Privacidade, no-invention e aprovacao humana. |
| Email drafts | `config/email.yml` | Politica local para drafts, sem auto-send nem upload automatico. |
| Scoring | `config/scoring.yml` | Pesos, thresholds, blockers e penalizacoes. |
| Quality gate | `config/quality-gate.yml` | Bloqueios antes do scoring. |
| Fontes | `portals.yml` | Empresas, job boards, adapters e notas. |
| Scan profiles | `config/scan-profiles.yml` | Quotas e prioridades por perfil. |
| Dashboard | `data/applications.md` | Tracker principal lido pelo dashboard. |
| Application actions | `data/application-actions.tsv` | Canal, blocker e proxima acao antes de candidatura manual. |
| Historico | `data/scan-history.tsv` | URLs vistas e estado do scan. |
| Dedupe tecnico | `data/job-index.jsonl` | Identidade tecnica das vagas. |
| Pipeline humana | `data/pipeline.md` | Fila/processamento legivel por humanos. |
| Reports | `reports/*.md` | Avaliacoes e drafts por vaga. |
| Application packs | `output/application-packs/*.md` | Pacotes revistos por humano antes de candidaturas. |
| Email drafts locais | `data/email-drafts.tsv`, `output/email-drafts-local/*.md` | Preparacao local para Gmail; nao envia nem cria drafts reais. |
| Draft quality gate | `draft-quality-gate.mjs` | Valida drafts contra regras de idioma, claims, links e confirmacoes. |
| Artefactos | `output/` | PDFs, extracoes e outputs temporarios. |

## Contrato De Uma Vaga Normalizada

Uma vaga deve tentar conter:

```json
{
  "title": "",
  "company": "",
  "location": "",
  "work_mode": "",
  "link": "",
  "description": "",
  "source": "",
  "compensation": "",
  "date_posted": "",
  "valid_through": "",
  "employment_type": "",
  "seniority": "",
  "stack_required": [],
  "external_id": "",
  "canonical_url": ""
}
```

Campos desconhecidos devem ficar como `a confirmar` ou vazios, conforme o
contexto. Nunca inventar.

## Contrato De Avaliacao

`job-scoring-service.mjs` deve devolver:

```json
{
  "score": 0,
  "recommendation": "apply | maybe | discard",
  "score_breakdown": {},
  "strengths": [],
  "red_flags": [],
  "hard_blockers_triggered": [],
  "reasoning": "",
  "next_action": ""
}
```

## Contrato Do Dashboard

`data/applications.md` usa tabela Markdown com:

```text
| # | Date | Company | Role | Score | Status | PDF | Report | Notes |
```

Regras:

- `#` e unico.
- `Report` deve apontar para ficheiro existente em `reports/`.
- `Score` deve ser parseavel como numero.
- `Status` deve ser canonico ou normalizavel.
- `Notes` deve ser curta e acionavel.

## Contrato Do Job Index

`data/job-index.jsonl` usa uma linha JSON por vaga. Deve preservar:

- `fingerprint`
- `canonical_url`
- `external_key`
- `similar_key`
- `company_role_key`
- `description_hash`
- `company`
- `title`
- `location`
- `source`
- `status`
- `first_seen`
- `last_seen`

Este ficheiro serve dedupe tecnico. Nao deve ser editado manualmente excepto
em recuperacoes controladas.

## Contrato De Reports

Um report deve conter pelo menos:

- URL;
- company;
- role;
- score;
- recommendation;
- source;
- remote/location;
- compensation;
- quality gate;
- score breakdown;
- data quality;
- strengths;
- red flags;
- CV adjustments;
- draft ou indicacao clara para nao preparar draft;
- reasoning;
- next action.

## Contrato De Application Packs

Um application pack deve conter:

- detalhes da vaga no tracker;
- caminho do CV PDF atual;
- caminho do report fonte;
- checklist do que confirmar antes de enviar;
- ajustes de CV;
- rascunho de email;
- perguntas para recrutador;
- red flags;
- hard blockers;
- checklist de privacidade;
- plano de follow-up.

Application packs nunca significam que uma candidatura foi enviada. Sao
artefactos de preparacao e revisao humana.

Antes de usar um draft, `npm.cmd run draft-quality` deve passar sem erros.

## Contrato De Email Drafts Locais

`data/email-drafts.tsv` usa:

```text
id application_id report_number company role status provider to subject body_file planned_attachment gmail_draft_id created_at updated_at review_required quality_gate_status notes
```

Regras:

- `status` deve deixar claro se falta destinatario, report ou revisao.
- `gmail_draft_id` fica vazio ate existir adaptador Gmail real.
- `planned_attachment` e apenas planeado; nao significa upload de CV.
- `review_required` deve ser `yes`.
- Um draft local nunca significa candidatura enviada.

## Contrato De Application Actions

`data/application-actions.tsv` usa:

```text
id application_id report_number company role channel apply_url recipient status blocker next_action created_at updated_at notes
```

Regras:

- `status` deve distinguir `ready_manual_review`, `needs_channel`,
  `needs_recipient` e `blocked_missing_report`.
- `apply_url` deve vir do report ou ficar como `a confirmar`.
- `recipient` fica `a confirmar` ate existir contacto confirmado.
- Uma action row nunca significa candidatura enviada.
- A submissao continua manual e depende de pack, draft quality e aprovacao.

## Contrato Do Draft Quality Gate

`draft-quality-gate.mjs` deve:

- ler application packs em `output/application-packs/`;
- extrair a seccao `Email Draft`;
- bloquear claims proibidas ou nao confirmadas;
- bloquear senioridade exagerada;
- bloquear links/contactos nao confirmados;
- bloquear idioma errado quando o contexto e claro;
- bloquear drafts que nao pedem confirmacao quando existem campos incertos;
- devolver exit code `1` quando existirem erros;
- devolver exit code `0` quando so existirem avisos ou nenhum problema.

## Regras De Escrita

Scripts que escrevem no dashboard devem:

1. normalizar vaga;
2. enriquecer identidade;
3. passar quality gate;
4. correr scoring;
5. verificar duplicados;
6. escrever report;
7. adicionar row em `data/applications.md`;
8. atualizar `data/pipeline.md`;
9. atualizar `data/scan-history.tsv`;
10. atualizar `data/job-index.jsonl`;
11. correr `npm.cmd run verify`.

## Regras De Recuperacao

Usar `--write-guard-mode dashboard_only` apenas quando:

- uma vaga foi falso negativo;
- o adapter melhorou;
- a vaga nao existe no dashboard/report;
- a fonte esta limitada por `--source`;
- `--write-limit` e baixo.

## Dados Que Nunca Devem Ir Para O Repo

- API keys;
- tokens;
- cookies;
- passwords;
- documentos oficiais;
- morada completa;
- NIF;
- cartao de cidadao;
- codigo privado;
- links privados;
- informacao familiar/financeira pessoal.
