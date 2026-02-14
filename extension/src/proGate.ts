import * as vscode from 'vscode';

const PRO_CONTEXT_KEY = 'decibel.isPro';

// License key format: DCBL-XXXX-XXXX-XXXX (alphanumeric segments)
const KEY_PATTERN = /^DCBL-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

export class ProGate {
  private _isPro = false;

  get isPro(): boolean {
    return this._isPro;
  }

  async initialize(): Promise<void> {
    this._isPro = this.evaluate();
    await vscode.commands.executeCommand('setContext', PRO_CONTEXT_KEY, this._isPro);
  }

  async activate(key: string): Promise<boolean> {
    const valid = await this.validateKey(key);
    if (valid) {
      await vscode.workspace.getConfiguration('decibel').update(
        'licenseKey', key, vscode.ConfigurationTarget.Global,
      );
      this._isPro = true;
      await vscode.commands.executeCommand('setContext', PRO_CONTEXT_KEY, true);
    }
    return valid;
  }

  async deactivate(): Promise<void> {
    await vscode.workspace.getConfiguration('decibel').update(
      'licenseKey', '', vscode.ConfigurationTarget.Global,
    );
    this._isPro = this.isDevMode();
    await vscode.commands.executeCommand('setContext', PRO_CONTEXT_KEY, this._isPro);
  }

  onConfigChange(): void {
    const wasPro = this._isPro;
    this._isPro = this.evaluate();
    if (wasPro !== this._isPro) {
      vscode.commands.executeCommand('setContext', PRO_CONTEXT_KEY, this._isPro);
    }
  }

  private evaluate(): boolean {
    // Dev override: env var or setting
    if (this.isDevMode()) return true;

    // License key
    const key = vscode.workspace.getConfiguration('decibel').get<string>('licenseKey', '');
    return KEY_PATTERN.test(key.toUpperCase());
  }

  private isDevMode(): boolean {
    if (process.env.DECIBEL_PRO === '1') return true;
    return vscode.workspace.getConfiguration('decibel').get<boolean>('devMode', false);
  }

  /**
   * Validate a license key.
   * Currently: format check only.
   * Future: call subscription API to verify.
   */
  private async validateKey(key: string): Promise<boolean> {
    // Format gate
    if (!KEY_PATTERN.test(key.toUpperCase())) return false;

    // TODO: remote validation
    // const res = await fetch('https://api.decibel.systems/v1/license/verify', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify({ key }),
    // });
    // return res.ok;

    return true;
  }
}
