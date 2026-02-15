import * as vscode from 'vscode';

const PRO_CONTEXT_KEY = 'decibel.isPro';
const CACHE_KEY = 'decibel.licenseCache';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// License key format: DCBL-XXXX-XXXX-XXXX (alphanumeric segments)
const KEY_PATTERN = /^DCBL-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;

// Supabase project for license verification
const SUPABASE_URL = 'https://dfbwpgqvkijogxvxolqe.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRmYndwZ3F2a2lqb2d4dnhvbHFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc1OTk2OTEsImV4cCI6MjA1MzE3NTY5MX0.AvAXbB6CswWCIKZ0zoVha9JEVFqZSMaV3VEhEEDVqxw';

interface LicenseCache {
  key: string;
  tier: string;
  valid: boolean;
  checkedAt: number;
}

export class ProGate {
  private _isPro = false;
  private globalState: vscode.Memento | null = null;

  get isPro(): boolean {
    return this._isPro;
  }

  async initialize(context: vscode.ExtensionContext): Promise<void> {
    this.globalState = context.globalState;
    this._isPro = await this.evaluate();
    await vscode.commands.executeCommand('setContext', PRO_CONTEXT_KEY, this._isPro);
  }

  async activate(key: string): Promise<boolean> {
    const result = await this.validateKey(key);
    if (result.valid) {
      await vscode.workspace.getConfiguration('decibel').update(
        'licenseKey', key, vscode.ConfigurationTarget.Global,
      );
      // Cache the successful validation
      await this.cacheResult({ key, tier: result.tier, valid: true, checkedAt: Date.now() });
      this._isPro = true;
      await vscode.commands.executeCommand('setContext', PRO_CONTEXT_KEY, true);
    }
    return result.valid;
  }

  async deactivate(): Promise<void> {
    await vscode.workspace.getConfiguration('decibel').update(
      'licenseKey', '', vscode.ConfigurationTarget.Global,
    );
    await this.cacheResult(undefined);
    this._isPro = this.isDevMode();
    await vscode.commands.executeCommand('setContext', PRO_CONTEXT_KEY, this._isPro);
  }

  async onConfigChange(): Promise<void> {
    const wasPro = this._isPro;
    this._isPro = await this.evaluate();
    if (wasPro !== this._isPro) {
      vscode.commands.executeCommand('setContext', PRO_CONTEXT_KEY, this._isPro);
    }
  }

  private async evaluate(): Promise<boolean> {
    // Dev override: env var or setting
    if (this.isDevMode()) return true;

    // License key
    const key = vscode.workspace.getConfiguration('decibel').get<string>('licenseKey', '');
    if (!KEY_PATTERN.test(key.toUpperCase())) return false;

    // Check cached result first
    const cached = this.getCachedResult();
    if (cached && cached.key === key.toUpperCase() && cached.valid) {
      const age = Date.now() - cached.checkedAt;
      if (age < CACHE_TTL_MS) return true;
    }

    // Remote validation (non-blocking — fall back to format check if offline)
    try {
      const result = await this.validateKey(key.toUpperCase());
      await this.cacheResult({ key: key.toUpperCase(), tier: result.tier, valid: result.valid, checkedAt: Date.now() });
      return result.valid;
    } catch {
      // Network failure — trust cache if it exists, otherwise accept format match
      if (cached && cached.key === key.toUpperCase()) return cached.valid;
      return true; // graceful degradation: format-valid key accepted offline
    }
  }

  private isDevMode(): boolean {
    if (process.env.DECIBEL_PRO === '1') return true;
    return vscode.workspace.getConfiguration('decibel').get<boolean>('devMode', false);
  }

  /**
   * Validate a license key against Supabase.
   */
  private async validateKey(key: string): Promise<{ valid: boolean; tier: string }> {
    // Format gate
    if (!KEY_PATTERN.test(key.toUpperCase())) {
      return { valid: false, tier: '' };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/licenses?key=eq.${encodeURIComponent(key.toUpperCase())}&select=tier,active,expires_at`,
        {
          headers: {
            'apikey': SUPABASE_ANON_KEY,
            'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
          },
          signal: controller.signal,
        },
      );

      clearTimeout(timeout);

      if (!res.ok) {
        return { valid: false, tier: '' };
      }

      const rows = await res.json() as Array<{ tier: string; active: boolean; expires_at: string | null }>;
      if (rows.length === 0) {
        return { valid: false, tier: '' };
      }

      const row = rows[0];
      const expired = row.expires_at && new Date(row.expires_at) < new Date();
      return {
        valid: row.active && !expired,
        tier: row.tier,
      };
    } catch {
      // Network error — re-throw so evaluate() can handle graceful degradation
      throw new Error('License verification unavailable');
    }
  }

  private getCachedResult(): LicenseCache | undefined {
    return this.globalState?.get<LicenseCache>(CACHE_KEY);
  }

  private async cacheResult(result: LicenseCache | undefined): Promise<void> {
    await this.globalState?.update(CACHE_KEY, result);
  }
}
