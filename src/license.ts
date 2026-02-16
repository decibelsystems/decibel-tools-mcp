// ============================================================================
// License Validator — server-side pro tier enforcement
// ============================================================================
// Validates DCBL-XXXX-XXXX-XXXX license keys against Supabase.
// 24-hour in-memory cache with 72-hour offline grace period.
// ============================================================================

import { createHash } from 'crypto';
import { log } from './config.js';

// ============================================================================
// Constants
// ============================================================================

const KEY_PATTERN = /^DCBL-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const OFFLINE_GRACE_MS = 72 * 60 * 60 * 1000; // 72 hours

// Supabase project for license verification (same as extension)
const SUPABASE_URL = 'https://dfbwpgqvkijogxvxolqe.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRmYndwZ3F2a2lqb2d4dnhvbHFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzc1OTk2OTEsImV4cCI6MjA1MzE3NTY5MX0.AvAXbB6CswWCIKZ0zoVha9JEVFqZSMaV3VEhEEDVqxw';

// ============================================================================
// Types
// ============================================================================

export interface LicenseResult {
  valid: boolean;
  tier: 'core' | 'pro';
  expires_at?: string;
  cached?: boolean;
  offline_grace?: boolean;
}

interface CacheEntry {
  result: LicenseResult;
  checkedAt: number;
}

// ============================================================================
// License Validator
// ============================================================================

export class LicenseValidator {
  private cache = new Map<string, CacheEntry>();

  /**
   * Validate a license key. Returns tier info.
   * - Checks format first (fast reject)
   * - Uses 24h in-memory cache
   * - Falls back to Supabase REST API
   * - Offline grace: trusts cache for 72h if Supabase unreachable
   */
  async validate(key: string): Promise<LicenseResult> {
    const normalizedKey = key.toUpperCase().trim();

    // Format gate
    if (!KEY_PATTERN.test(normalizedKey)) {
      return { valid: false, tier: 'core' };
    }

    const cacheKey = this.hashKey(normalizedKey);
    const cached = this.cache.get(cacheKey);
    const now = Date.now();

    // Check fresh cache (within 24h)
    if (cached && now - cached.checkedAt < CACHE_TTL_MS) {
      return { ...cached.result, cached: true };
    }

    // Remote validation
    try {
      const result = await this.remoteValidate(normalizedKey);
      this.cache.set(cacheKey, { result, checkedAt: now });
      return result;
    } catch {
      // Offline: trust stale cache within 72h grace period
      if (cached && now - cached.checkedAt < OFFLINE_GRACE_MS) {
        log('License: Supabase unreachable, using cached result (offline grace)');
        return { ...cached.result, cached: true, offline_grace: true };
      }

      // No cache and offline: reject (server-side is stricter than extension)
      log('License: Supabase unreachable and no cached result — rejecting');
      return { valid: false, tier: 'core' };
    }
  }

  /**
   * Pre-validate a key on startup (fire and forget).
   */
  async prevalidate(key: string): Promise<void> {
    try {
      const result = await this.validate(key);
      if (result.valid) {
        log(`License: Pre-validated key (tier: ${result.tier})`);
      } else {
        log('License: Pre-validation failed — key is invalid or expired');
      }
    } catch (err) {
      log(`License: Pre-validation error: ${err}`);
    }
  }

  /**
   * Check if a key is currently valid (from cache only, no network).
   */
  getCachedResult(key: string): LicenseResult | null {
    const cacheKey = this.hashKey(key.toUpperCase().trim());
    const cached = this.cache.get(cacheKey);
    if (!cached) return null;
    return cached.result;
  }

  private hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex').substring(0, 16);
  }

  private async remoteValidate(key: string): Promise<LicenseResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    try {
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/licenses?key=eq.${encodeURIComponent(key)}&select=tier,active,expires_at`,
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
        throw new Error(`Supabase returned ${res.status}`);
      }

      const rows = await res.json() as Array<{ tier: string; active: boolean; expires_at: string | null }>;
      if (rows.length === 0) {
        return { valid: false, tier: 'core' };
      }

      const row = rows[0];
      const expired = row.expires_at && new Date(row.expires_at) < new Date();

      return {
        valid: row.active && !expired,
        tier: row.active && !expired ? 'pro' : 'core',
        expires_at: row.expires_at || undefined,
      };
    } catch (err) {
      clearTimeout(timeout);
      throw err; // Let caller handle offline case
    }
  }
}

// Singleton for the daemon process
let _instance: LicenseValidator | null = null;

export function getLicenseValidator(): LicenseValidator {
  if (!_instance) {
    _instance = new LicenseValidator();
  }
  return _instance;
}
