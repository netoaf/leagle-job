# Leagle Job — instalação rápida

## Windows (recomendado)

1. Extrai todo o ZIP.
2. Faz duplo clique em `setup.bat`.
3. Espera pela mensagem `Leagle Job pronto a usar`.
4. Segue [COMECE-AQUI.md](COMECE-AQUI.md).

O instalador verifica o Node.js, instala as dependências exatas do `package-lock.json`, instala o Chromium necessário ao Playwright, cria os ficheiros locais a partir de templates e executa o diagnóstico. Não requer modo de administrador e nunca substitui uma configuração pessoal existente.

## Instalação manual

```powershell
npm.cmd ci
npx.cmd playwright install chromium
Copy-Item config/profile.example.yml config/profile.yml
Copy-Item config/scoring.example.yml config/scoring.yml
Copy-Item config/jobfinder-rules.example.yml config/jobfinder-rules.yml
Copy-Item modes/_profile.template.md modes/_profile.md
Copy-Item templates/portals.example.yml portals.yml
Copy-Item templates/cv.example.md cv.md
node doctor.mjs
```

## Testar

Faz duplo clique em `testar-sistema.bat` ou executa:

```powershell
npm.cmd run jobfinder:health
```

## Partilhar sem dados pessoais

Faz duplo clique em `criar-pacote.bat`. O ZIP criado em `dist/` contém templates neutros e dados vazios. O processo termina com erro se encontrar no pacote um email, telefone, perfil LinkedIn/GitHub ou nome recolhido dos ficheiros privados locais.

Nunca comprimas diretamente a pasta onde utilizas o Leagle Job.
