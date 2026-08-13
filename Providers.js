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
  ],
  chatgpt: [
    { label: 'GPT-5', description: 'OpenAI mặc định nhanh', value: 'gpt-5' },
    { label: 'GPT-5 Mini', description: 'Nhanh, rẻ hơn', value: 'gpt-5-mini' },
    { label: 'GPT-5.1', description: 'Cân bằng mới', value: 'gpt-5.1' },
    { label: 'o4-mini', description: 'Reasoning nhẹ', value: 'o4-mini' },
  ],
  claude: [
    { label: 'Claude Sonnet 5', description: 'Mặc định cân bằng', value: 'claude-sonnet-5-20250514' },
    { label: 'Claude Haiku 4.5', description: 'Nhanh, rẻ', value: 'claude-haiku-4-5' },
    { label: 'Claude Opus 5', description: 'Cao cấp suy luận', value: 'claude-opus-5' },
  ],
  grok: [
    { label: 'Grok 4.6', description: 'Flagship xAI', value: 'grok-4.6' },
    { label: 'Grok 4.5', description: 'Đa dụng, code', value: 'grok-4.5' },
    { label: 'Grok 4.3', description: 'Nhanh / tiết kiệm hơn', value: 'grok-4.3' },
  ],
  deepseek: [
    { label: 'DeepSeek Chat', description: 'Mặc định (V-series API)', value: 'deepseek-chat' },
    { label: 'DeepSeek Reasoner', description: 'Suy luận', value: 'deepseek-reasoner' },
  ],
};

function providerFromModel(modelId) {
  const m = String(modelId || '');
  if (m.startsWith('gemini')) return 'gemini';
  if (
    m.startsWith('gpt-') ||
    m.startsWith('o1') ||
    m.startsWith('o3') ||
    m.startsWith('o4') ||
    m.startsWith('chatgpt')
  )
    return 'chatgpt';
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
    '🔑 **Nhập API key:**\n' +
    '```\n' +
    'key gemini: AIza...\n' +
    'key chatgpt: sk-...\n' +
    'key claude: sk-ant-...\n' +
    'key grok: xai-...\n' +
    'key deepseek: sk-...\n' +
    '```\n' +
    '**Link lấy key:**\n' +
    '• Gemini: https://aistudio.google.com\n' +
    '• ChatGPT: https://platform.openai.com/api-keys\n' +
    '• Claude: https://console.anthropic.com/settings/keys\n' +
    '• Grok: https://console.x.ai\n' +
    '• DeepSeek: https://platform.deepseek.com/api_keys\n' +
    'Key chỉ lưu trong **ticket**. Model + key phải cùng nhà cung cấp.'
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
        model: model || 'claude-sonnet-5-20250514',
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

  // Chuẩn hóa model id
  if (provider === 'grok') {
    const legacy = {
      'grok-2-latest': 'grok-4.5',
      'grok-2': 'grok-4.5',
      'grok-2-mini': 'grok-4.5',
      'grok-3': 'grok-4.5',
      'grok-3-latest': 'grok-4.5',
    };
    if (!model) model = 'grok-4.5';
    else if (legacy[model]) model = legacy[model];
  }
  if (provider === 'chatgpt') {
    if (!model || String(model).startsWith('gemini')) model = 'gpt-5-mini';
    const legacyGpt = {
      'gpt-4.1-mini': 'gpt-5-mini',
      'gpt-4.1': 'gpt-5',
      'gpt-4o': 'gpt-5',
      'gpt-4o-mini': 'gpt-5-mini',
    };
    if (legacyGpt[model]) model = legacyGpt[model];
  }
  if (provider === 'claude') {
    const legacyClaude = {
      'claude-sonnet-4-20250514': 'claude-sonnet-5-20250514',
      'claude-3-5-haiku-latest': 'claude-haiku-4-5',
    };
    if (legacyClaude[model]) model = legacyClaude[model];
  }

  // OpenAI-compatible: ChatGPT, Grok, DeepSeek
  let base = 'https://api.openai.com/v1';
  let defaultModel = 'gpt-5-mini';
  if (provider === 'grok') {
    base = 'https://api.x.ai/v1';
    defaultModel = 'grok-4.6';
  } else if (provider === 'deepseek') {
    base = 'https://api.deepseek.com';
    defaultModel = 'deepseek-chat';
  } else if (provider === 'chatgpt') {
    base = 'https://api.openai.com/v1';
    defaultModel = 'gpt-5-mini';
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
    const msg =
      data?.error?.message ||
      data?.error?.code ||
      (typeof data?.error === 'string' ? data.error : null) ||
      data?.message ||
      JSON.stringify(data?.error || data || {}).slice(0, 300) ||
      res.statusText ||
      'API error';
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
