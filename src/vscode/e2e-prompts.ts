import * as vscode from 'vscode';

// Test-only prompt bridge. VS Code supplies a distinct API facade per extension;
// patching vscode.window in the test extension does not intercept Orquestivo's dialogs.
// This code registers NO commands or hooks in a regular installed extension.
type ApiMethod = (...args: unknown[]) => unknown;
interface Messages { info: string[]; warning: string[]; error: string[] }
interface Settings { inputs?: string[] }

export function registerIntegrationPrompts(context: vscode.ExtensionContext): void {
  if (process.env.ORQUESTIVO_E2E_MODE !== '1') return;

  const api = vscode.window as unknown as Record<string, ApiMethod>;
  const original = new Map<string, ApiMethod>();
  let messages: Messages = { info: [], warning: [], error: [] };
  let inputs: string[] = [];

  function restore(): void {
    for (const [name, method] of original) api[name] = method;
    original.clear();
    inputs = [];
  }
  function patch(name: string, method: ApiMethod): void {
    const methodBeforePatch = api[name];
    if (typeof methodBeforePatch !== 'function') throw new Error('VS Code window API unavailable: ' + name);
    if (!original.has(name)) original.set(name, methodBeforePatch);
    api[name] = method;
  }
  function message(kind: keyof Messages): ApiMethod {
    return async (value: unknown, ...args: unknown[]) => {
      messages[kind].push(String(value));
      return args.find((item) => typeof item === 'string');
    };
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('orquestivo.__e2e.prompts.begin', (settings?: Settings) => {
      restore();
      messages = { info: [], warning: [], error: [] };
      const suppliedInputs = settings?.inputs;
      inputs = Array.isArray(suppliedInputs)
        ? suppliedInputs.filter((v): v is string => typeof v === 'string') : [];
      patch('showInformationMessage', message('info'));
      patch('showWarningMessage', message('warning'));
      patch('showErrorMessage', message('error'));
      patch('showQuickPick', async (value: unknown, options?: unknown) => {
        const items = await Promise.resolve(value);
        const list = Array.isArray(items) ? items : [];
        const many = typeof options === 'object' && options !== null &&
          'canPickMany' in options && options.canPickMany === true;
        return many ? list.filter((item) => item?.picked === true) : list[0];
      });
      patch('showInputBox', async (options?: unknown) => {
        const fallback = typeof options === 'object' && options !== null && 'value' in options &&
          typeof options.value === 'string' ? options.value : '';
        return inputs.length ? inputs.shift() : fallback;
      });
      console.log('[Orquestivo E2E] Installed deterministic prompts in the extension API');
      return true;
    }),
    vscode.commands.registerCommand('orquestivo.__e2e.prompts.snapshot', () => ({
      info: [...messages.info], warning: [...messages.warning], error: [...messages.error],
    })),
    vscode.commands.registerCommand('orquestivo.__e2e.prompts.end', () => {
      const snapshot = { info: [...messages.info], warning: [...messages.warning], error: [...messages.error] };
      restore();
      return snapshot;
    }),
    { dispose: restore },
  );
}
