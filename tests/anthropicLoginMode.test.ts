import { afterEach, describe, expect, spyOn, test } from 'bun:test';
import axios, { type AxiosRequestConfig } from 'axios';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import { createInstance } from 'i18next';
import {
  ANTHROPIC_LOGIN_MODE_STORAGE_KEY,
  loadAnthropicLoginMode,
  readAnthropicLoginMode,
  saveAnthropicLoginMode,
} from '../src/features/oauth/loginMode';
import { apiClient } from '../src/services/api/client';
import { buildOAuthStartParams, oauthApi } from '../src/services/api/oauth';
import { computeApiUrl } from '../src/utils/connection';
import { OAuthPage } from '../src/pages/OAuthPage';
import en from '../src/i18n/locales/en.json';
import zhCN from '../src/i18n/locales/zh-CN.json';
import zhTW from '../src/i18n/locales/zh-TW.json';
import ru from '../src/i18n/locales/ru.json';

const spies: Array<{ mockRestore(): void }> = [];
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

const restoreWindow = () => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
};

const installStorage = (storage: Partial<Storage>) => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage: storage },
  });
};

const memoryStorage = (initial: Record<string, string> = {}) => {
  const values = new Map(Object.entries(initial));
  return {
    values,
    storage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    } satisfies Partial<Storage>,
  };
};

afterEach(() => {
  spies.splice(0).forEach((spy) => spy.mockRestore());
  restoreWindow();
});

describe('Anthropic login mode', () => {
  test('keeps a persisted mode and falls back to the local callback otherwise', () => {
    expect(readAnthropicLoginMode('manual')).toBe('manual');
    expect(readAnthropicLoginMode('local')).toBe('local');
    expect(readAnthropicLoginMode(null)).toBe('local');
    expect(readAnthropicLoginMode(undefined)).toBe('local');
    expect(readAnthropicLoginMode('')).toBe('local');
    expect(readAnthropicLoginMode('bogus')).toBe('local');
  });

  test('round-trips the selection through localStorage under the original key', () => {
    const { values, storage } = memoryStorage();
    installStorage(storage);
    expect(loadAnthropicLoginMode()).toBe('local');
    saveAnthropicLoginMode('manual');
    expect(values.get(ANTHROPIC_LOGIN_MODE_STORAGE_KEY)).toBe('manual');
    expect(ANTHROPIC_LOGIN_MODE_STORAGE_KEY).toBe('cliproxy.anthropic-login-mode');
    expect(loadAnthropicLoginMode()).toBe('manual');
  });

  test('falls back to the local callback when storage is missing or blocked', () => {
    restoreWindow();
    expect(loadAnthropicLoginMode()).toBe('local');
    expect(() => saveAnthropicLoginMode('manual')).not.toThrow();
    installStorage({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    });
    expect(loadAnthropicLoginMode()).toBe('local');
    expect(() => saveAnthropicLoginMode('manual')).not.toThrow();
  });
});

describe('OAuth start parameters', () => {
  test('sends an explicit manual flag for Claude in both directions', () => {
    expect(buildOAuthStartParams('claude', { manual: true })).toEqual({
      provider: 'claude',
      is_webui: true,
      manual: true,
    });
    expect(buildOAuthStartParams('claude', { manual: false })).toEqual({
      provider: 'claude',
      is_webui: true,
      manual: false,
    });
  });

  test('omits the manual flag when unset so the server default applies', () => {
    expect(buildOAuthStartParams('claude')).toEqual({ provider: 'claude', is_webui: true });
    expect(buildOAuthStartParams('claude', {})).toEqual({ provider: 'claude', is_webui: true });
  });

  test('ignores the manual flag for providers that do not support it', () => {
    expect(buildOAuthStartParams('codex', { manual: true })).toEqual({
      provider: 'codex',
      is_webui: true,
    });
    expect(buildOAuthStartParams('kimi', { manual: true })).toEqual({ provider: 'kimi' });
  });
});

describe('Anthropic manual login wire contract', () => {
  const mock = (method: 'get' | 'post', value: unknown = {}) => {
    const spy = spyOn(apiClient, method).mockResolvedValue(value as never);
    spies.push(spy);
    return spy;
  };

  test('the auth-url request carries manual=true or manual=false next to the provider', async () => {
    const get = mock('get', { url: 'https://claude.com/cai/oauth/authorize', state: 's' });
    const signal = new AbortController().signal;
    for (const manual of [true, false]) {
      await oauthApi.startAuth('anthropic', signal, { manual });
      const [url, config] = get.mock.lastCall as [string, AxiosRequestConfig];
      expect(url).toBe('/oauth/auth-url');
      expect(config).toEqual({
        params: { provider: 'claude', is_webui: true, manual },
        signal,
      });
      expect(
        axios.getUri({ baseURL: computeApiUrl('http://example.test'), url, params: config.params })
      ).toBe(
        `http://example.test/v8/management/oauth/auth-url?provider=claude&is_webui=true&manual=${manual}`
      );
    }
  });

  test('the pasted <code>#<state> pair is submitted verbatim as redirect_url', async () => {
    const post = mock('post', { status: 'ok' });
    await oauthApi.submitCallback('anthropic', 'ac_01ABC#state-123');
    expect(post).toHaveBeenLastCalledWith(
      '/oauth/callback',
      { provider: 'claude', redirect_url: 'ac_01ABC#state-123' },
      undefined
    );
  });
});

const i18n = createInstance();
await i18n.init({ lng: 'en', resources: { en: { translation: en } } });

describe('Anthropic login mode selector', () => {
  const render = () =>
    renderToStaticMarkup(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(MemoryRouter, null, createElement(OAuthPage))
      )
    );

  test('defaults to the local callback and restores a saved manual choice', () => {
    restoreWindow();
    const localMarkup = render();
    expect(localMarkup).toContain('Login mode');
    expect(localMarkup).toContain(en.auth_login.anthropic_login_mode_local);
    expect(localMarkup).toContain('http://localhost:54545/callback');
    expect(localMarkup).not.toContain('hosted callback page');

    installStorage(memoryStorage({ [ANTHROPIC_LOGIN_MODE_STORAGE_KEY]: 'manual' }).storage);
    const manualMarkup = render();
    expect(manualMarkup).toContain(en.auth_login.anthropic_login_mode_manual);
    expect(manualMarkup).toContain('hosted callback page');
    expect(manualMarkup).not.toContain('http://localhost:54545/callback');
    expect(manualMarkup).not.toContain('auth_login.anthropic_');
  });

  test('supplies every login-mode string in all four languages', () => {
    const keys = Object.keys(en.auth_login).filter(
      (key) => key.startsWith('anthropic_login_mode_') || key.startsWith('anthropic_manual_code_')
    );
    expect(keys.length).toBe(10);
    for (const locale of [en, zhCN, zhTW, ru]) {
      for (const key of keys) {
        expect((locale.auth_login as Record<string, string>)[key]?.trim()).toBeTruthy();
      }
    }
  });
});
