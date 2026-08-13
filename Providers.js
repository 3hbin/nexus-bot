// Providers.js — gọi ChatGPT / Claude / Grok / DeepSeek / Gemini bằng API key user
const fetch =
  typeof globalThis.fetch === 'function'
    ? globalThis.fetch
    : (() => {
        try {
          return require('node-fetch');
        } catch {
          return null;
        }
      })();

/** @typedef {'gemini'|'chatgpt'|'claude'|'grok'|'deepseek'} ProviderId */

const PROVIDER_META = {
  gemini: {
    id: 'gemini',
    label: 'Gemini',
    keyHint: 'AIza...',
    envFallback: 'GEMINI_API_KEY',
  },
  chatgpt: {
    id: 'chatgpt',
    label: 'ChatGPT (OpenAI)',
    keyHint: 'sk-...',
    envFallback: 'OPENAI_API_KEY',
  },
  claude: {
    id: 'claude',
    label: 'Claude (Anthropic)',
    keyHint: 'sk-ant-...',
    envFallback: 'ANTHROPIC_API_KEY',
  },
  grok: {
    id: 'grok',
    label: 'Grok (xAI)',
    keyHint: 'xai-...',
    envFallback: 'XAI_API_KEY',
  },
  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    keyHint: 'sk-...',
    envFallback: 'DEEPSEEK_API_KEY',
  },
};

/** persona id → provider mặc định */
const PERSONA_PROVIDER = {
  default: 'gemini',
  gemini: 'gemini',
  chatgpt: 'chatgpt',
  claude: 'claude',
  grok: 'grok',
  deepseek: 'deepseek',
  dola: 'gemini',
  copilot: 'chatgpt',
  custom: 'gemini',
};


/** Model list cho menu ticket (value = model id API) */
const PROVIDER_MODELS = {
  gemini: [
    { label: 'Gemini 3.6 Flash', description: 'Mặc định, nhanh', value: 'gemini-3.6-flash' },
    { label: 'Gemini 3.5 Flash', description: 'Cân bằng', value: 'gemini-3.5-flash' },
    { label: 'Gemini 3.5 Flash-Lite', description: 'Rẻ, nhanh', value: 'gemini-3.5-flash-lite' },
    { label: 'Gemini 3.1 Pro', description: 'Sâu (cần billing)', value: 'gemini-3.1-pro' },
    { label: 'Gemini 3.1 Flash-Lite', description: 'Siêu nhẹ', value: 'gemini-3.1-flash-lite' },
  ],
  chatgpt: [
    { label: 'GPT-4.1 Mini', description: 'OpenAI mặc định', value: 'gpt-4.1-mini' },
    { label: 'GPT-4.1', description: 'Mạnh hơn', value: 'gpt-4.1' },
    { label: 'GPT-4o', description: 'Multimodal', value: 'gpt-4o' },
    { label: 'GPT-4o Mini', description: 'Rẻ, nhanh', value: 'gpt-4o-mini' },
  ],
  claude: [
    { label: 'Claude Sonnet 4', description: 'Cân bằng', value: 'claude-sonnet-4-20250514' },
    { label: 'Claude 3.5 Haiku', description: 'Nhanh, rẻ', value: 'claude-3-5-haiku-latest' },
  ],
  grok: [
    { label: 'Grok 2', description: 'xAI', value: 'grok-2-latest' },
    { label: 'Grok 3', description: 'Mới hơn (nếu key hỗ trợ)', value: 'grok-3' },
  ],
  deepseek: [
    { label: 'DeepSeek Chat', description: 'Mặc định', value: 'deepseek-chat' },
    { label: 'DeepSeek Reasoner', description: 'Suy luận', value: 'deepseek-reasoner' },
  ],
};

function providerFromModel(modelId) {
  const m = String(modelId || '');
  if (m.startsWith('gemini')) return 'gemini';
  if (m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('chatgpt')) return 'chatgpt';
  if (m.startsWith('claude')) return 'claude';
  if (m.startsWith('grok')) return 'grok';
  if (m.startsWith('deepseek')) return 'deepseek';
  return 'gemini';
}

function allModelSelectOptions() {
  const opts = [];
  for (const [prov, list] of Object.entries(PROVIDER_MODELS)) {
    for (const item of list) {
      opts.push({
        label: item.label.slice(0, 100),
        description: `${PROVIDER_META[prov]?.label || prov}: ${item.description}`.slice(0, 100),
        value: item.value.slice(0, 100),
      });
    }
  }
  return opts.slice(0, 25); // Discord limit
}

function providerForPersona(personaId) {
  return PERSONA_PROVIDER[personaId] || 'gemini';
}

/**
 * Parse tin nhắn nhập key.
 * Hỗ trợ:
 *   key: AIza...
 *   key gemini: ...
 *   key chatgpt: sk-...
 *   chatgpt: sk-...
 *   claude: sk-ant-...
 */
function parseKeyMessage(content) {
  const raw = String(content || '').trim();
  let m = raw.match(/^key\s*:\s*(.+)$/i);
  if (m) {
    return { provider: 'gemini', apiKey: m[1].trim() };
  }
  m = raw.match(/^key\s+(gemini|chatgpt|openai|claude|anthropic|grok|xai|deepseek)\s*:\s*(.+)$/i);
  if (m) {
    return { provider: normalizeProviderId(m[1]), apiKey: m[2].trim() };
  }
  m = raw.match(/^(gemini|chatgpt|openai|claude|anthropic|grok|xai|deepseek)\s*:\s*(.+)$/i);
  if (m) {
    return { provider: normalizeProviderId(m[1]), apiKey: m[2].trim() };
  }
  return null;
}

function normalizeProviderId(s) {
  const x = String(s || '').toLowerCase();
  if (x === 'openai') return 'chatgpt';
  if (x === 'anthropic') return 'claude';
  if (x === 'xai') return 'grok';
  if (PROVIDER_META[x]) return x;
  return 'gemini';
}

function helpKeyText() {
  return (
    '🔑 **Nhập API key theo nhà cung cấp:**\n' +
    '```\n' +
    'key gemini: AIza...\n' +
    'key chatgpt: sk-...\n' +
    'key claude: sk-ant-...\n' +
    'key grok: xai-...\n' +
    'key deepseek: sk-...\n' +
    '```\n' +
    '• `key: AIza...` = Gemini (mặc định)\n' +
    '• Chọn **persona** ChatGPT/Claude/Grok/DeepSeek → bot dùng key tương ứng nếu đã nhập\n' +
    '• Key chỉ lưu trong **ticket** (không gửi đi đâu khác)'
  );
}

/**
 * Gọi chat non-Gemini (OpenAI-compatible hoặc Anthropic).
 * @returns {Promise<string>}
 */
async function chatExternal({
  provider,
  apiKey,
  systemInstruction,
  userMessage,
  history = [],
  model,
}) {
  if (!fetch) throw new Error('fetch không khả dụng');
  const key = String(apiKey || '').trim();
  if (!key) throw new Error('Thiếu API key');

  const sys = String(systemInstruction || '').slice(0, 12000);
  const user = String(userMessage || '').slice(0, 20000);

  if (provider === 'claude') {
    const messages = [];
    for (const h of history || []) {
      const role = h.role === 'model' || h.role === 'assistant' ? 'assistant' : 'user';
      const text =
        typeof h.content === 'string'
          ? h.content
          : Array.isArray(h.parts)
            ? h.parts.map((p) => p.text || '').join('')
            : '';
      if (text) messages.push({ role, content: text.slice(0, 8000) });
    }
    messages.push({ role: 'user', content: user });
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-sonnet-4-20250514',
        max_tokens: 4096,
        system: sys || undefined,
        messages: messages.slice(-20),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data?.error?.message || data?.message || res.statusText || 'Claude API error';
      const err = new Error(msg);
      err.status = res.status;
      throw err;
    }
    const parts = data?.content || [];
    return parts
      .map((p) => (p.type === 'text' ? p.text : ''))
      .join('')
      .trim();
  }

  // OpenAI-compatible: ChatGPT, Grok, DeepSeek
  let base = 'https://api.openai.com/v1';
  let defaultModel = 'gpt-4.1-mini';
  if (provider === 'grok') {
    base = 'https://api.x.ai/v1';
    defaultModel = 'grok-2-latest';
  } else if (provider === 'deepseek') {
    base = 'https://api.deepseek.com';
    defaultModel = 'deepseek-chat';
  } else if (provider === 'chatgpt') {
    base = 'https://api.openai.com/v1';
    defaultModel = 'gpt-4.1-mini';
  }

  const messages = [];
  if (sys) messages.push({ role: 'system', content: sys });
  for (const h of history || []) {
    const role = h.role === 'model' || h.role === 'assistant' ? 'assistant' : 'user';
    const text =
      typeof h.content === 'string'
        ? h.content
        : Array.isArray(h.parts)
          ? h.parts.map((p) => p.text || '').join('')
          : typeof h.text === 'string'
            ? h.text
            : '';
    if (text) messages.push({ role, content: text.slice(0, 8000) });
  }
  messages.push({ role: 'user', content: user });

  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model: model || defaultModel,
      messages: messages.slice(-24),
      max_tokens: 4096,
      temperature: 0.7,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || res.statusText || 'API error';
    const err = new Error(msg);
    err.status = res.status;
    throw err;
  }
  return (data?.choices?.[0]?.message?.content || '').trim();
}

module.exports = {
  PROVIDER_META,
  PROVIDER_MODELS,
  PERSONA_PROVIDER,
  providerForPersona,
  providerFromModel,
  allModelSelectOptions,
  parseKeyMessage,
  helpKeyText,
  chatExternal,
  normalizeProviderId,
};
