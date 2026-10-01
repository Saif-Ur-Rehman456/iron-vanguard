/**
 * Settings persistence.
 * Storage belongs to the app; `@iron/sim` only defines the shape and migration
 * rules, which keeps the simulation free of browser APIs (ADR-0002).
 */
import { DEFAULT_SETTINGS, loadSettings, type StoredSettings } from '@iron/sim';

const STORAGE_KEY = 'iron-vanguard/settings/v1';

export function readSettings(): StoredSettings {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return loadSettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function writeSettings(settings: StoredSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing / storage disabled: settings simply do not persist.
  }
}
