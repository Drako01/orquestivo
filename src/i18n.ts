const en = {
  title: 'CI/CD Workflow Studio',
  subtitle: 'Design the pipeline. Verify the outcome.',
  scan: 'Analyze workflows',
  empty: 'No scan yet. Open a trusted workspace to analyze GitHub Actions workflows.',
  noFiles: 'No GitHub Actions workflow files were found.',
  untrusted: 'Trust this workspace before analyzing repository files.',
  report: 'Static analysis only · No workflow was executed',
  clean: 'No findings in the supported static rules. Runtime correctness is not verified.',
  findings: 'Findings',
  files: 'Workflow files',
  errors: 'Errors',
  warnings: 'Warnings',
  info: 'Information',
  oversized: 'File exceeds the configured size limit; no analysis performed.',
  readError: 'Could not read the workflow file.',
  analyzeProgress: 'Analyzing GitHub Actions workflows…'
} as const;
const es: Record<keyof typeof en, string> = {
  title: 'Estudio de workflows CI/CD',
  subtitle: 'Diseñá el pipeline. Verificá el resultado.',
  scan: 'Analizar workflows',
  empty: 'Todavía no hay análisis. Abrí un espacio confiable para analizar workflows de GitHub Actions.',
  noFiles: 'No se encontraron workflows de GitHub Actions.',
  untrusted: 'Confiá en el espacio de trabajo antes de analizar archivos del repositorio.',
  report: 'Solo análisis estático · No se ejecutó ningún workflow',
  clean: 'Sin hallazgos en las reglas estáticas disponibles. No se verificó la ejecución real.',
  findings: 'Hallazgos',
  files: 'Archivos de workflows',
  errors: 'Errores',
  warnings: 'Advertencias',
  info: 'Información',
  oversized: 'El archivo supera el límite configurado; no fue analizado.',
  readError: 'No se pudo leer el archivo del workflow.',
  analyzeProgress: 'Analizando workflows de GitHub Actions…'
};
export type TextKey = keyof typeof en;
export function tr(key: TextKey, language: string): string {
  return language.toLowerCase().startsWith('es') ? es[key] : en[key];
}
