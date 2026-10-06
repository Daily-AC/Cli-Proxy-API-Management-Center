import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  AxiosError,
  AxiosHeaders,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig,
} from 'axios';
import { apiClient } from '@/services/api/client';
import { friendPath, normalizeFriend, z10FriendsApi } from '@/services/api/z10Friends';
import type { ApiError } from '@/types';

type Handler = (config: InternalAxiosRequestConfig) => { status: number; data?: unknown };

const instance = (apiClient as unknown as { instance: AxiosInstance }).instance;
const originalAdapter = instance.defaults.adapter;
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
let requests: InternalAxiosRequestConfig[] = [];
let events: string[] = [];

/** Runs the real client interceptors against a fake server. */
const serve = (handler: Handler) => {
  instance.defaults.adapter = async (config) => {
    requests.push(config);
    const { status, data } = handler(config);
    const response: AxiosResponse = {
      data,
      status,
      statusText: String(status),
      headers: new AxiosHeaders(),
      config,
    };
    if (status >= 400) {
      throw new AxiosError(
        `Request failed with status code ${status}`,
        'ERR_BAD_REQUEST',
        config,
        undefined,
        response
      );
    }
    return response;
  };
};

const wireFriend = {
  name: 'alice',
  models: ['*'],
  channels: ['DeepSeek'],
  expires: '2026-12-31',
  enabled: true,
  active: true,
  inactive_reason: '',
  last_used: '2026-10-06T12:00:00Z',
  requests: 12,
  failed_requests: 1,
  total_tokens: 3456,
};

beforeEach(() => {
  requests = [];
  events = [];
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { dispatchEvent: (event: Event) => events.push(event.type) },
  });
  apiClient.setConfig({
    apiBase: 'https://proxy.invalid/gateway/v8/management',
    managementKey: 'fixture-only',
  });
});

afterEach(() => {
  instance.defaults.adapter = originalAdapter;
  apiClient.setConfig({ apiBase: '', managementKey: '' });
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

describe('z10 friend key transport', () => {
  test('calls /z10 at the server root with the management bearer key', async () => {
    serve(() => ({ status: 200, data: { friends: [wireFriend] } }));
    await z10FriendsApi.list();
    const [config] = requests;
    expect(config.baseURL).toBe('https://proxy.invalid/gateway');
    expect(config.url).toBe('/z10/friends');
    expect(config.method).toBe('get');
    expect(config.headers.Authorization).toBe('Bearer fixture-only');
  });

  test('ordinary management requests keep the v8 prefix', async () => {
    serve(() => ({ status: 200, data: {} }));
    await apiClient.get('/config');
    expect(requests[0].baseURL).toBe('https://proxy.invalid/gateway/v8/management');
  });

  test('channels are read from the root path and normalized', async () => {
    serve(() => ({
      status: 200,
      data: { channels: [{ name: 'DeepSeek', models: ['a', 'b', 7] }, { models: [] }, null] },
    }));
    expect(await z10FriendsApi.listChannels()).toEqual([{ name: 'DeepSeek', models: ['a', 'b'] }]);
    expect(requests[0].baseURL).toBe('https://proxy.invalid/gateway');
    expect(requests[0].url).toBe('/z10/channels');
  });

  test('create sends JSON without models or an empty expiry and returns the one-time key', async () => {
    serve(() => ({ status: 201, data: { friend: wireFriend, key: 'sk-z10-fixture' } }));
    const result = await z10FriendsApi.create({ name: 'alice', channels: ['DeepSeek'] });
    const [config] = requests;
    expect(config.method).toBe('post');
    expect(config.url).toBe('/z10/friends');
    expect(config.baseURL).toBe('https://proxy.invalid/gateway');
    expect(config.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(config.data as string)).toEqual({ name: 'alice', channels: ['DeepSeek'] });
    expect(result.key).toBe('sk-z10-fixture');
    expect(result.friend.name).toBe('alice');

    await z10FriendsApi.create({ name: 'bob', channels: ['Qwen'], expires: '2026-12-31' });
    expect(JSON.parse(requests[1].data as string)).toEqual({
      name: 'bob',
      channels: ['Qwen'],
      expires: '2026-12-31',
    });
  });

  test('create refuses a response without a key', async () => {
    serve(() => ({ status: 201, data: { friend: wireFriend } }));
    await expect(z10FriendsApi.create({ name: 'alice', channels: ['DeepSeek'] })).rejects.toThrow(
      'Malformed create response'
    );
  });

  test('update and delete address the friend by encoded name', async () => {
    expect(friendPath('a b/c')).toBe('/z10/friends/a%20b%2Fc');
    serve((config) =>
      config.method === 'delete' ? { status: 204 } : { status: 200, data: { friend: wireFriend } }
    );
    await z10FriendsApi.update('alice.dev', { enabled: false, expires: '' });
    await z10FriendsApi.remove('alice.dev');
    expect(requests.map((config) => [config.method, config.baseURL, config.url])).toEqual([
      ['patch', 'https://proxy.invalid/gateway', '/z10/friends/alice.dev'],
      ['delete', 'https://proxy.invalid/gateway', '/z10/friends/alice.dev'],
    ]);
    expect(requests[0].headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(requests[0].data as string)).toEqual({ enabled: false, expires: '' });
  });

  test('maps the {"error"} envelope to ApiError with status', async () => {
    serve(() => ({ status: 409, data: { error: 'friend already exists' } }));
    const error = await z10FriendsApi
      .create({ name: 'alice', channels: ['DeepSeek'] })
      .catch((err: ApiError) => err);
    expect(error).toMatchObject({
      name: 'ApiError',
      status: 409,
      message: 'friend already exists',
    });
    expect(events).toEqual([]);
  });

  test('401 triggers the same unauthorized event as every management call', async () => {
    serve(() => ({ status: 401, data: { error: 'invalid management key' } }));
    const error = await z10FriendsApi.list().catch((err: ApiError) => err);
    expect(error).toMatchObject({ status: 401, message: 'invalid management key' });
    expect(events).toEqual(['unauthorized']);
  });

  test('a malformed list response is an error, not an empty list', async () => {
    serve(() => ({ status: 200, data: { items: [] } }));
    await expect(z10FriendsApi.list()).rejects.toThrow('Malformed friends response');
  });
});

describe('friend normalization', () => {
  test('maps snake_case fields and defaults the optional ones', () => {
    expect(normalizeFriend(wireFriend)).toEqual({
      name: 'alice',
      models: ['*'],
      channels: ['DeepSeek'],
      expires: '2026-12-31',
      enabled: true,
      active: true,
      inactiveReason: '',
      lastUsed: '2026-10-06T12:00:00Z',
      requests: 12,
      failedRequests: 1,
      totalTokens: 3456,
    });
    expect(
      normalizeFriend({ name: 'bob', enabled: false, active: false, inactive_reason: 'disabled' })
    ).toMatchObject({
      expires: '',
      lastUsed: '',
      inactiveReason: 'disabled',
      requests: 0,
      totalTokens: 0,
    });
    expect(normalizeFriend({ name: 'x', inactive_reason: 'weird' })?.inactiveReason).toBe('');
    expect(normalizeFriend({ name: '' })).toBeNull();
    expect(normalizeFriend('alice')).toBeNull();
  });
});
