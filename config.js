/**
 * js/config.js
 * Configurações globais da aplicação e gerenciamento seguro da API Key em sessionStorage.
 * Nenhuma chave de API deve ser hardcoded neste arquivo.
 */

export const DELIVERY_FEE = 6.00;

export const CONFIG = Object.freeze({
  RESTAURANT_NAME: 'Sabor da Casa',
  SESSION_STORAGE_KEY: 'marmitaria_llm_api_key',
  DELIVERY_FEE,
  DEFAULT_DELIVERY_FEE: DELIVERY_FEE,
  GEMINI_MODEL: 'gemini-2.5-flash',
  GEMINI_BASE_URL: 'https://generativelanguage.googleapis.com/v1beta/models',
  MAX_TOOL_ITERATIONS: 5,
  MAX_HISTORY_MESSAGES: 20,
  REQUEST_TIMEOUT_MS: 25000,
});

/**
 * Monta a URL do endpoint REST generateContent da API do Google Gemini.
 * @param {string} [model=CONFIG.GEMINI_MODEL]
 * @returns {string}
 */
export function getGeminiEndpoint(model = CONFIG.GEMINI_MODEL) {
  return `${CONFIG.GEMINI_BASE_URL}/${encodeURIComponent(model)}:generateContent`;
}

/**
 * Obtém a API Key armazenada apenas na sessão atual do navegador.
 * @returns {string | null}
 */
export function getApiKey() {
  return sessionStorage.getItem(CONFIG.SESSION_STORAGE_KEY);
}

/**
 * Salva a API Key no sessionStorage (apagada ao fechar a aba/navegador).
 * @param {string} apiKey
 */
export function setApiKey(apiKey) {
  const sanitized = String(apiKey || '').trim();
  if (!sanitized) {
    throw new Error('A chave da API não pode estar vazia.');
  }
  sessionStorage.setItem(CONFIG.SESSION_STORAGE_KEY, sanitized);
}

/**
 * Remove a API Key da sessão atual.
 */
export function clearApiKey() {
  sessionStorage.removeItem(CONFIG.SESSION_STORAGE_KEY);
}
