# Comece aqui — Leagle Job

Este pacote contém apenas o software e exemplos neutros. Não inclui o CV, contactos, histórico de candidaturas, relatórios ou credenciais da pessoa que o preparou.

## Instalação no Windows

1. Extrai o ZIP para uma pasta normal, por exemplo `Documentos\LeagleJob`.
2. Faz duplo clique em `setup.bat`.
3. Se o Node.js ainda não existir, aceita a instalação automática ou instala a versão LTS em <https://nodejs.org/>. Depois volta a executar `setup.bat`.
4. Aguarda pela mensagem `Leagle Job pronto a usar`.

Não é necessário executar como administrador. O instalador não pede palavras-passe, tokens ou chaves de API.

## Personalização mínima

Abre estes quatro ficheiros num editor de texto e substitui apenas os exemplos:

1. `cv.md` — o teu CV verdadeiro.
2. `config/profile.yml` — contactos, localização e cargos pretendidos.
3. `modes/_profile.md` — preferências, pontos fortes e limites.
4. `portals.yml` — palavras-chave e empresas a pesquisar.

Estes ficheiros são locais e estão ignorados pelo Git. Nunca publiques um ZIP feito diretamente da tua pasta de trabalho; usa sempre `criar-pacote.bat`.

## Primeiro teste

Faz duplo clique em `testar-sistema.bat`. Se preferires a linha de comandos:

```powershell
npm.cmd run doctor
npm.cmd run jobfinder:health
```

## Primeira utilização

Abre esta pasta num agente compatível, como Codex ou Claude Code, e escreve:

```text
Confirma se o meu perfil Leagle Job está bem configurado. Não envies candidaturas nem emails; prepara apenas rascunhos para eu rever.
```

Depois podes colar uma oferta e pedir:

```text
Avalia esta oferta com o Leagle Job: [URL ou descrição]
```

## Privacidade

- Não coloques chaves de API dentro de ficheiros YAML ou Markdown.
- Quando uma integração precisar de uma chave, usa uma variável de ambiente e segue a documentação dessa integração.
- Revê sempre CVs, mensagens e formulários antes de enviar.
- Para partilhar o software, executa `criar-pacote.bat`; o gerador recria dados vazios e faz uma auditoria automática ao ZIP.
