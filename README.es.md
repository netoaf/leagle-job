# Leagle Job

Leagle Job es una herramienta local para descubrir, evaluar y organizar
oportunidades de empleo con revisión humana. Es una adaptación Portugal-first
de [Career-Ops](https://github.com/santifer/career-ops).

La referencia actual del producto está en el [README en inglés](README.md).
Esta página existe solo como orientación breve; los modos de idioma heredados no
son una segunda implementación del scoring ni del pipeline.

## Capacidades confirmadas

- Descubrimiento en fuentes y ATS compatibles.
- Normalización, deduplicación, filtro de calidad y score determinista de
  0--100.
- Informes, selección de CV, tracking y dashboard local en terminal.
- Preparación revisable de candidaturas, con límites estrictos de seguridad.

## Límites

- No envía emails, no presenta candidaturas y no sube CVs automáticamente.
- El borrador Gmail es opcional, está desactivado por defecto y solo puede crear
  un borrador no enviado después de todas las comprobaciones.
- No existe servicio alojado, base de datos, API pública ni automatización de
  candidaturas.

## Inicio rápido

```powershell
npm install
npx playwright install chromium
npm run doctor
npm run jobfinder:health
npm run leagle:new:dry-run -- --limit 80
```

Mantén CV, configuración, tracker, informes y resultados en la User Layer
local. Consulta [DATA_CONTRACT.md](DATA_CONTRACT.md),
[CURRENT-STATUS.md](docs/CURRENT-STATUS.md) y el
[runbook](docs/operational-runbook.md) antes de ejecutar un flujo con escritura.

## Licencia y atribución

Conserva la licencia MIT, la cita y la atribución del proyecto Career-Ops al
redistribuir o extender Leagle Job.
