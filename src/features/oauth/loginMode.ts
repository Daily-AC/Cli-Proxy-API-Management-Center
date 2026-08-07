/**
 * Anthropic supports two authorization redirects. "local" sends the browser back to
 * the proxy host on its callback port; "manual" uses Anthropic's hosted callback,
 * which renders a "<code>#<state>" pair to paste back and therefore works when the
 * browser cannot reach the proxy host at all.
 */
export type AnthropicLoginMode = 'local' | 'manual';

/** localStorage key holding the last selected Anthropic login mode. */
export const ANTHROPIC_LOGIN_MODE_STORAGE_KEY = 'cliproxy.anthropic-login-mode';

const ANTHROPIC_LOGIN_MODES: readonly AnthropicLoginMode[] = ['local', 'manual'];

/**
 * Reads a persisted login mode, falling back to the local callback so an unknown or
 * missing value keeps the flow the server has always used.
 */
export function readAnthropicLoginMode(raw: string | null | undefined): AnthropicLoginMode {
  return ANTHROPIC_LOGIN_MODES.includes(raw as AnthropicLoginMode)
    ? (raw as AnthropicLoginMode)
    : 'local';
}

/**
 * Loads the persisted login mode. Storage that is missing (server-side render) or
 * blocked falls back to the local callback instead of breaking the page.
 */
export function loadAnthropicLoginMode(): AnthropicLoginMode {
  if (typeof window === 'undefined') return 'local';
  try {
    return readAnthropicLoginMode(window.localStorage.getItem(ANTHROPIC_LOGIN_MODE_STORAGE_KEY));
  } catch {
    return 'local';
  }
}

/** Persists the selected login mode; storage failures only lose the preference. */
export function saveAnthropicLoginMode(mode: AnthropicLoginMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(ANTHROPIC_LOGIN_MODE_STORAGE_KEY, mode);
  } catch {
    // ignore storage failures
  }
}
