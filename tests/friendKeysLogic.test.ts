import { describe, expect, mock, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import i18n from '../src/i18n/index';
import en from '../src/i18n/locales/en.json';
import ru from '../src/i18n/locales/ru.json';
import zhCN from '../src/i18n/locales/zh-CN.json';
import zhTW from '../src/i18n/locales/zh-TW.json';
import type { FriendKey } from '@/services/api/z10Friends';
import { FriendKeyResultContent } from '@/features/friendKeys/components/FriendKeyResultModal';
import {
  CLOSED_DIALOG,
  FRIEND_STATUS_META,
  buildChannelOptions,
  buildCreateInput,
  buildUpdateInput,
  friendDialogReducer,
  friendErrorMessage,
  friendToFormValues,
  getFriendStatus,
  requestFriendDelete,
  validateFriendForm,
  type FriendFormContext,
} from '@/features/friendKeys/logic';

const friend = (overrides: Partial<FriendKey> = {}): FriendKey => ({
  name: 'alice',
  models: ['*'],
  channels: ['DeepSeek'],
  expires: '',
  enabled: true,
  active: true,
  inactiveReason: '',
  lastUsed: '',
  requests: 0,
  failedRequests: 0,
  totalTokens: 0,
  ...overrides,
});

const t = (key: string, options?: Record<string, unknown>) =>
  options ? `${key}:${JSON.stringify(options)}` : key;

describe('friend status badge', () => {
  test('maps active, disabled and expired to badge labels and tones', () => {
    expect(getFriendStatus(friend())).toBe('active');
    expect(
      getFriendStatus(friend({ enabled: false, active: false, inactiveReason: 'disabled' }))
    ).toBe('disabled');
    expect(getFriendStatus(friend({ active: false, inactiveReason: 'expired' }))).toBe('expired');
    // Disabled and past expiry: the server's reason decides what is shown.
    expect(
      getFriendStatus(friend({ enabled: false, active: false, inactiveReason: 'disabled' }))
    ).toBe('disabled');
    // Older responses without a reason fall back to the flags.
    expect(getFriendStatus(friend({ enabled: false, active: false }))).toBe('disabled');
    expect(getFriendStatus(friend({ active: false }))).toBe('expired');

    expect(FRIEND_STATUS_META.active).toEqual({
      labelKey: 'friend_keys.status_active',
      tone: 'success',
    });
    expect(FRIEND_STATUS_META.disabled.tone).toBe('muted');
    expect(FRIEND_STATUS_META.expired.tone).toBe('warning');
    expect(i18n.getFixedT('zh-CN')(FRIEND_STATUS_META.active.labelKey)).toBe('启用');
    expect(i18n.getFixedT('zh-CN')(FRIEND_STATUS_META.disabled.labelKey)).toBe('已停用');
    expect(i18n.getFixedT('zh-CN')(FRIEND_STATUS_META.expired.labelKey)).toBe('已过期');
  });
});

describe('friend form', () => {
  const create: FriendFormContext = { mode: 'create', existingNames: ['bob'], today: '2026-10-07' };

  test('validates name, channels and expiry inline', () => {
    expect(validateFriendForm({ name: '', channels: [], expires: '' }, create)).toEqual({
      name: 'friend_keys.error_name_required',
      channels: 'friend_keys.error_channels_required',
    });
    expect(
      validateFriendForm({ name: 'bad name', channels: ['DeepSeek'], expires: '' }, create).name
    ).toBe('friend_keys.error_name_invalid');
    expect(
      validateFriendForm({ name: 'x'.repeat(65), channels: ['DeepSeek'], expires: '' }, create).name
    ).toBe('friend_keys.error_name_invalid');
    expect(
      validateFriendForm({ name: '..', channels: ['DeepSeek'], expires: '' }, create).name
    ).toBe('friend_keys.error_name_invalid');
    expect(
      validateFriendForm({ name: '小明', channels: ['DeepSeek'], expires: '' }, create).name
    ).toBeUndefined();
    expect(
      validateFriendForm({ name: 'bob', channels: ['DeepSeek'], expires: '' }, create).name
    ).toBe('friend_keys.error_name_taken');
    expect(
      validateFriendForm({ name: 'a.b_c-1', channels: ['DeepSeek'], expires: '2026-10-07' }, create)
    ).toEqual({});
    expect(
      validateFriendForm({ name: 'carol', channels: ['DeepSeek'], expires: '2026-10-06' }, create)
        .expires
    ).toBe('friend_keys.error_expires_past');
    expect(
      validateFriendForm({ name: 'carol', channels: ['DeepSeek'], expires: '2026-02-30' }, create)
        .expires
    ).toBe('friend_keys.error_expires_invalid');
  });

  test('edit mode ignores the fixed name and an unchanged past expiry', () => {
    const edit: FriendFormContext = {
      mode: 'edit',
      existingNames: ['alice'],
      today: '2026-10-07',
      initialExpires: '2026-09-30',
    };
    expect(
      validateFriendForm({ name: 'alice', channels: ['Qwen'], expires: '2026-09-30' }, edit)
    ).toEqual({});
    expect(
      validateFriendForm({ name: 'alice', channels: ['Qwen'], expires: '2026-09-29' }, edit).expires
    ).toBe('friend_keys.error_expires_past');
  });

  test('create never sends models and omits an empty expiry', () => {
    expect(buildCreateInput({ name: ' alice ', channels: ['DeepSeek'], expires: '' })).toEqual({
      name: 'alice',
      channels: ['DeepSeek'],
    });
    expect(
      buildCreateInput({ name: 'alice', channels: ['DeepSeek', 'Qwen'], expires: '2026-12-31' })
    ).toEqual({ name: 'alice', channels: ['DeepSeek', 'Qwen'], expires: '2026-12-31' });
  });

  test('edit sends only changed fields and clears the expiry with an empty string', () => {
    const initial = friendToFormValues(
      friend({ channels: ['deepseek', 'Qwen'], expires: '2026-12-31' }),
      [
        { name: 'DeepSeek', models: ['a'] },
        { name: 'Qwen', models: ['b'] },
      ]
    );
    expect(initial).toEqual({
      name: 'alice',
      channels: ['DeepSeek', 'Qwen'],
      expires: '2026-12-31',
    });
    expect(buildUpdateInput(initial, { ...initial, channels: ['Qwen', 'DeepSeek'] })).toEqual({});
    expect(buildUpdateInput(initial, { ...initial, expires: '' })).toEqual({ expires: '' });
    expect(buildUpdateInput(initial, { ...initial, channels: ['Qwen'] })).toEqual({
      channels: ['Qwen'],
    });
  });

  test('keeps saved channels the server no longer offers visible', () => {
    expect(
      buildChannelOptions([{ name: 'DeepSeek', models: ['a'] }], ['deepseek', 'Gone'])
    ).toEqual([
      { name: 'DeepSeek', models: ['a'], missing: false },
      { name: 'Gone', models: [], missing: true },
    ]);
  });

  test('maps conflicts and missing friends to fixed wording, other errors to the server text', () => {
    expect(friendErrorMessage({ status: 409, message: 'exists' }, t, 'fallback')).toBe(
      'friend_keys.error_name_taken'
    );
    expect(friendErrorMessage({ status: 404, message: 'gone' }, t, 'fallback')).toBe(
      'friend_keys.error_not_found'
    );
    expect(friendErrorMessage({ status: 400, message: 'unknown channel' }, t, 'fallback')).toBe(
      'unknown channel'
    );
    expect(friendErrorMessage({}, t, 'fallback')).toBe('fallback');
  });
});

describe('one-time key dialog', () => {
  test('the key exists only in the created state and is dropped on close', () => {
    const created = friendDialogReducer(
      friendDialogReducer(CLOSED_DIALOG, { type: 'open_create' }),
      { type: 'created', friend: friend(), key: 'sk-z10-fixture-key' }
    );
    expect(created).toEqual({ kind: 'created', friend: friend(), key: 'sk-z10-fixture-key' });
    const closed = friendDialogReducer(created, { type: 'close' });
    expect(closed).toEqual({ kind: 'closed' });
    expect(JSON.stringify(closed)).not.toContain('sk-z10');
    // Reopening the form does not resurrect it either.
    expect(JSON.stringify(friendDialogReducer(closed, { type: 'open_create' }))).not.toContain(
      'sk-z10'
    );
  });

  test('shows the key once with a copy button and a cannot-be-shown-again warning', () => {
    const html = renderToStaticMarkup(
      createElement(FriendKeyResultContent, {
        name: 'alice',
        secret: 'sk-z10-fixture-key',
        copied: false,
        copyFailed: false,
        onCopy: () => {},
      })
    );
    expect(html).toContain('sk-z10-fixture-key');
    expect(html).toContain(i18n.t('friend_keys.key_warning'));
    expect(html).toContain(i18n.t('common.copy'));
    expect(html).toContain('role="alert"');
  });

  test('the page mounts the key dialog only for the created state and closes it via the reducer', () => {
    const page = readFileSync('src/features/friendKeys/FriendKeysPage.tsx', 'utf8');
    const block = page.slice(page.indexOf("dialog.kind === 'created' ? ("));
    expect(block).toContain('<FriendKeyResultModal');
    expect(block).toContain("onClose={() => dispatchDialog({ type: 'close' })}");
  });
});

describe('delete', () => {
  test('asks through the themed confirmation and only deletes after confirming', async () => {
    let confirmOptions: { variant?: string; onConfirm: () => void | Promise<void> } | undefined;
    const remove = mock(async () => {});
    const notify = mock(() => {});
    const reload = mock(async () => {});
    requestFriendDelete(friend({ name: 'bob' }), {
      t,
      showConfirmation: (options) => {
        confirmOptions = options;
      },
      remove,
      notify,
      reload,
    });
    expect(confirmOptions?.variant).toBe('danger');
    expect(remove).not.toHaveBeenCalled();

    await confirmOptions?.onConfirm();
    expect(remove).toHaveBeenCalledWith('bob');
    expect(notify).toHaveBeenCalledWith('friend_keys.delete_success:{"name":"bob"}', 'success');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  test('reports a failed delete and still refreshes the list', async () => {
    let onConfirm: (() => void | Promise<void>) | undefined;
    const notify = mock(() => {});
    const reload = mock(async () => {});
    requestFriendDelete(friend(), {
      t,
      showConfirmation: (options) => {
        onConfirm = options.onConfirm;
      },
      remove: async () => {
        throw Object.assign(new Error('gone'), { status: 404 });
      },
      notify,
      reload,
    });
    await onConfirm?.();
    expect(notify).toHaveBeenCalledWith(
      'friend_keys.delete_failed: friend_keys.error_not_found',
      'error'
    );
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('friend keys source contracts', () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      return statSync(path).isDirectory() ? files(path) : [path];
    });
  const sources = [...files('src/features/friendKeys'), 'src/services/api/z10Friends.ts'].filter(
    (path) => /\.tsx?$/.test(path)
  );

  test('uses no native dialogs and persists nothing in browser storage', () => {
    expect(sources.length).toBeGreaterThan(3);
    for (const path of sources) {
      const source = readFileSync(path, 'utf8');
      expect(source).not.toMatch(/\b(window\.)?(confirm|alert|prompt)\(/);
      expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB/);
    }
  });

  test('every friend_keys string exists in all four locales', () => {
    const keys = (value: unknown, prefix = ''): string[] =>
      value && typeof value === 'object'
        ? Object.entries(value).flatMap(([key, child]) => keys(child, `${prefix}${key}.`))
        : [prefix.slice(0, -1)];
    const base = (key: string) => key.replace(/_(one|few|many|other)$/, '');
    const sets = [zhCN, zhTW, en, ru].map((locale) => new Set(keys(locale.friend_keys).map(base)));
    for (const set of sets) expect([...set].sort()).toEqual([...sets[0]].sort());
    for (const locale of [zhCN, zhTW, en, ru]) {
      expect(locale.nav.friend_keys).toBeTruthy();
      expect(locale.nav_meta.friend_keys).toBeTruthy();
    }

    const used = new Set<string>();
    for (const path of sources) {
      for (const match of readFileSync(path, 'utf8').matchAll(/'friend_keys\.([a-z_]+)'/g)) {
        used.add(match[1]);
      }
    }
    expect(used.size).toBeGreaterThan(20);
    for (const key of used) expect(sets[0].has(key)).toBe(true);
  });
});
