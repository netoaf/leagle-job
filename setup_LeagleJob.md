# Configurar o Leagle Job

O guia principal para novos utilizadores é [COMECE-AQUI.md](COMECE-AQUI.md). No Windows, basta extrair o ZIP e fazer duplo clique em `setup.bat`.

## O que o instalador faz

- verifica Node.js 18 ou superior;
- pode instalar automaticamente o Node.js LTS com `winget` quando não existe;
- instala as versões exatas das dependências registadas no `package-lock.json`;
- instala o Chromium utilizado pelo Playwright;
- cria configurações locais a partir de exemplos neutros;
- preserva todos os ficheiros pessoais que já existam;
- executa `doctor.mjs` no fim.

Não é necessário modo de administrador e o instalador não pede credenciais.

## Configuração pessoal

Depois da instalação, edita:

- `cv.md` — CV real em Markdown;
- `config/profile.yml` — identidade, contactos e objetivos;
- `modes/_profile.md` — preferências e posicionamento;
- `portals.yml` — cargos, palavras-chave e empresas.

Nunca inventes experiência, resultados ou qualificações. Mantém `auto_submit: false` e revê qualquer mensagem ou candidatura antes de enviar.

## Verificação

Faz duplo clique em `testar-sistema.bat` ou executa:

```powershell
npm.cmd run doctor
npm.cmd run jobfinder:health
```

## Distribuição segura

Executa `criar-pacote.bat`. O gerador:

1. exclui CVs, perfis, contexto do candidato, histórico, relatórios, outputs e credenciais;
2. recria dados vazios e configurações neutras;
3. procura no pacote valores privados recolhidos dos ficheiros locais;
4. só cria `dist/LeagleJob-v<versão>.zip` se a auditoria passar.

Nunca distribuas um ZIP criado manualmente a partir da pasta de trabalho.
