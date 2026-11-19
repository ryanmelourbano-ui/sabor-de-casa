/**
 * js/guardrails.js
 * Defesa em camadas contra Prompt Injection, Jailbreak, XSS, perguntas fora de escopo,
 * abuso de taxa e alucinação de preços pelo LLM.
 *
 * - Camada 1: Validação, sanitização, heurísticas PT/EN (injection/jailbreak e fora de escopo) e rate limit de entrada.
 * - Camada 2: Encapsulamento da entrada do usuário como dado não confiável (<mensagem_usuario>).
 * - Camada 3: Sanitização estrita de argumentos das tools (whitelist de campos).
 * - Camada 4: Validação de saída contra vazamento de prompt, HTML/scripts/URLs e divergência de valores em R$.
 */

import { DELIVERY_FEE } from './config.js';
import { getMenuDoDia, formatarPreco } from './menu.js';

export const MAX_INPUT_LENGTH = 500;
export const RATE_LIMIT_MAX_PER_MINUTE = 10;
export const RATE_LIMIT_WINDOW_MS = 60 * 1000;

export const SAFE_REFUSAL_MESSAGE =
  'Desculpe, sou o Carlão, atendente virtual da Marmitaria Sabor da Casa, e só posso ajudar com informações do nosso cardápio e com o seu pedido de marmitas. 🍱 O que você gostaria de pedir hoje?';

export const OUT_OF_SCOPE_MESSAGE =
  'Sou especializado apenas no atendimento da Marmitaria Sabor da Casa e não consigo responder sobre outros assuntos (como clima, programação ou política). 🍱 Que tal conferirmos o cardápio de marmitas de hoje?';

export const RATE_LIMIT_MESSAGE =
  'Você enviou muitas mensagens em pouco tempo. Por favor, aguarde alguns segundos antes de enviar a próxima mensagem.';

export const INPUT_TOO_LONG_MESSAGE =
  'Sua mensagem ultrapassou o limite de 500 caracteres. Por favor, envie seu pedido de forma mais curta.';

// Janela deslizante de timestamps para rate limit local
let messageTimestamps = [];

/**
 * Reinicia o estado do rate limiter local (útil para testes automatizados).
 */
export function resetRateLimiter() {
  messageTimestamps = [];
}

/**
 * Remove caracteres de controle ASCII/Unicode e caracteres invisíveis (zero-width)
 * e aplica normalização Unicode NFKC.
 * @param {string} rawText
 * @returns {string}
 */
export function sanitizeText(rawText) {
  return String(rawText ?? '')
    .normalize('NFKC')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, '')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, '')
    .trim();
}

/**
 * Normaliza texto para inspeção de padrões (minúsculas e sem acentos).
 * @param {string} text
 * @returns {string}
 */
function normalizeForDetection(text) {
  return sanitizeText(text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ');
}

/**
 * Lista de padrões maliciosos (Prompt Injection, Jailbreak, Role-play, Delimitadores e Manipulação de Preço).
 */
const INPUT_ATTACK_PATTERNS = [
  // 1. Ignorar / esquecer instruções (PT / EN)
  {
    category: 'prompt_injection_override',
    regex: /\b(ignore|ignorar|desconsidere|esqueca|forget|disregard|override|bypass)\b.{0,40}\b(instruc|instruction|regra|rule|anterior|previous|prior|above|acima|sistema|system|tudo|all)\b/i,
  },
  // 2. Vazamento de System Prompt / regras internas
  {
    category: 'system_prompt_leak',
    regex: /\b(system\s*prompt|prompt\s*de\s*sistema|revele\s+(suas|as)\s+(regras|instrucoes)|mostre\s+(suas|as)\s+(regras|instrucoes)|qual\s+e\s+o\s+seu\s+prompt|reveal\s+(your\s+)?(rules|instructions|prompt)|show\s+(your\s+)?(system\s+)?(prompt|instructions)|print\s+your\s+instructions|repita\s+o\s+texto\s+acima)\b/i,
  },
  // 3. Mudança de persona / Role-play / "Você agora é" / "Finja que"
  {
    category: 'roleplay_hijack',
    regex: /\b(voce\s+agora\s+e|a\s+partir\s+de\s+agora\s+voce|finja\s+(que|ser)|aja\s+como|atue\s+como|you\s+are\s+now|act\s+as\s+(a|an)?|pretend\s+(to\s+be|you\s+are)|role\s*-?\s*play|vamos\s+brincar\s+de\s+faz\s+de\s+conta)\b/i,
  },
  // 4. Modo desenvolvedor / DAN / Jailbreak
  {
    category: 'jailbreak_mode',
    regex: /\b(modo\s+desenvolvedor|developer\s+mode|god\s+mode|modo\s+deus|jailbreak|do\s+anything\s+now|\bdan\b\s*mode|ative\s+o\s+modo\s+dan|\bcomo\s+dan\b|sem\s+restricoes|without\s+restrictions|unfiltered\s+mode)\b/i,
  },
  // 5. Ofuscação / Codificação (Base64, ROT13, Hex)
  {
    category: 'encoding_evasion',
    regex: /\b(responda\s+em\s+base64|encode\s+in\s+base64|decode\s+base64|em\s+base64|base64|rot13|hexadecimal\s+encoded|morse\s+code|codigo\s+binario)\b/i,
  },
  // 6. Delimitadores falsos de sistema, tags HTML/script ou XML de controle
  {
    category: 'fake_delimiters_or_script',
    regex: /(<\s*\/?\s*system\s*>|<\s*\/?\s*mensagem_usuario\s*>|###\s*(system|instruction|instrucao|novo\s+prompt)|\[\s*system\s*\]|<\|im_start\|>|<\|im_end\|>|<\s*\/?\s*script\b|onerror\s*=|javascript\s*:)/i,
  },
  // 7. Tentativas de alterar preço, forçar desconto ou zerar taxa de entrega
  {
    category: 'price_manipulation',
    regex: /\b(mude\s+o\s+preco|altere\s+o\s+(preco|valor)|defina\s+o\s+preco|preco\s+(agora\s+e|passa\s+a\s+ser|sera)\s*r?\$?\s*\d+|set\s+price\s+to|override\s+price|change\s+the\s+price|aplique\s+(um\s+)?desconto\s+de\s+\d+|desconto\s+de\s+(90|99|100)\s*%|100\s*%\s*de\s*desconto|taxa\s+de\s+entrega\s+(agora\s+e\s+zero|gratis\s+obrigatoria)|cobre\s+apenas\s+r?\$?\s*0|tudo\s+de\s+graca)\b/i,
  },
];

/**
 * Padrões claros de perguntas fora do escopo do restaurante (clima, programação/código, política, esportes).
 */
const OUT_OF_SCOPE_PATTERNS = [
  /\b(previsao\s+do\s+tempo|como\s+esta\s+o\s+clima|vai\s+chover|temperatura\s+em)\b/i,
  /\b(escreva\s+um\s+codigo|codigo\s+em\s+(python|javascript|java|c\+\+|html)|algoritmo\s+de|como\s+programar|funcao\s+em\s+javascript)\b/i,
  /\b(fale\s+de\s+politica|opiniao\s+sobre\s+politica|eleicoes|partido\s+politico|quem\s+votar|congresso\s+nacional)\b/i,
];

/**
 * Verifica se um texto é uma pergunta claramente fora do escopo de marmitas.
 * @param {string} rawText
 * @returns {boolean}
 */
export function isOutOfScopeQuery(rawText) {
  const normalized = normalizeForDetection(rawText);
  return OUT_OF_SCOPE_PATTERNS.some((regex) => regex.test(normalized));
}

/**
 * CAMADA 1: Valida e sanitiza a mensagem do usuário antes de enviá-la ao LLM.
 * @param {string} rawText
 * @param {{ checkRateLimit?: boolean, nowMs?: number }} [options]
 * @returns {{ allowed: boolean, sanitizedText: string, reason: string | null, safeReply: string | null }}
 */
export function validateUserInput(rawText, options = {}) {
  const { checkRateLimit = true, nowMs = Date.now() } = options;

  const rawString = String(rawText ?? '');
  if (rawString.length > MAX_INPUT_LENGTH) {
    return {
      allowed: false,
      sanitizedText: '',
      reason: 'max_length_exceeded',
      safeReply: INPUT_TOO_LONG_MESSAGE,
    };
  }

  const sanitizedText = sanitizeText(rawString);
  if (!sanitizedText) {
    return {
      allowed: false,
      sanitizedText: '',
      reason: 'empty_input',
      safeReply: 'Por favor, digite seu pedido ou dúvida sobre o cardápio.',
    };
  }

  // Rate limit local (10 mensagens por minuto)
  if (checkRateLimit) {
    messageTimestamps = messageTimestamps.filter(
      (ts) => nowMs - ts < RATE_LIMIT_WINDOW_MS
    );
    if (messageTimestamps.length >= RATE_LIMIT_MAX_PER_MINUTE) {
      return {
        allowed: false,
        sanitizedText,
        reason: 'rate_limit_exceeded',
        safeReply: RATE_LIMIT_MESSAGE,
      };
    }
    messageTimestamps.push(nowMs);
  }

  const rawNormalized = rawString.normalize('NFKC');
  const normalizedDetection = normalizeForDetection(rawString);

  for (const pattern of INPUT_ATTACK_PATTERNS) {
    if (pattern.regex.test(rawNormalized) || pattern.regex.test(normalizedDetection)) {
      return {
        allowed: false,
        sanitizedText,
        reason: pattern.category,
        safeReply: SAFE_REFUSAL_MESSAGE,
      };
    }
  }

  if (isOutOfScopeQuery(rawString)) {
    return {
      allowed: false,
      sanitizedText,
      reason: 'out_of_scope',
      safeReply: OUT_OF_SCOPE_MESSAGE,
    };
  }

  return {
    allowed: true,
    sanitizedText,
    reason: null,
    safeReply: null,
  };
}

/**
 * CAMADA 2: Encapsula a mensagem do usuário em tags de dados não confiáveis,
 * neutralizando delimitadores XML internos.
 * @param {string} sanitizedUserText
 * @returns {string}
 */
export function wrapUntrustedUserMessage(sanitizedUserText) {
  const safeContent = String(sanitizedUserText || '')
    .replace(/</g, '‹')
    .replace(/>/g, '›');
  return `<mensagem_usuario>${safeContent}</mensagem_usuario>`;
}

/**
 * CAMADA 3: Whitelist estrita de argumentos para cada tool.
 * Qualquer campo extra (ex.: preco, desconto, taxa_entrega, total) é descartado.
 * @param {string} toolName
 * @param {object} rawArgs
 * @returns {object}
 */
export function sanitizeToolArgs(toolName, rawArgs = {}) {
  if (!rawArgs || typeof rawArgs !== 'object') {
    return {};
  }

  switch (toolName) {
    case 'get_menu':
    case 'get_order_summary':
      return {};

    case 'add_item':
      return {
        itemId: typeof rawArgs.itemId === 'string' ? sanitizeText(rawArgs.itemId).slice(0, 60) : '',
        quantidade: Number(rawArgs.quantidade),
        remover: Array.isArray(rawArgs.remover)
          ? rawArgs.remover.map((r) => sanitizeText(String(r)).slice(0, 50)).filter(Boolean)
          : undefined,
        ponto: typeof rawArgs.ponto === 'string' ? sanitizeText(rawArgs.ponto).slice(0, 30) : undefined,
        observacao:
          typeof rawArgs.observacao === 'string'
            ? sanitizeText(rawArgs.observacao).slice(0, 150)
            : undefined,
      };

    case 'customize_item':
      return {
        lineId: typeof rawArgs.lineId === 'string' ? sanitizeText(rawArgs.lineId).slice(0, 30) : undefined,
        itemId: typeof rawArgs.itemId === 'string' ? sanitizeText(rawArgs.itemId).slice(0, 60) : undefined,
        quantidade:
          rawArgs.quantidade !== undefined && rawArgs.quantidade !== null
            ? Number(rawArgs.quantidade)
            : undefined,
        remover: Array.isArray(rawArgs.remover)
          ? rawArgs.remover.map((r) => sanitizeText(String(r)).slice(0, 50)).filter(Boolean)
          : undefined,
        ponto: typeof rawArgs.ponto === 'string' ? sanitizeText(rawArgs.ponto).slice(0, 30) : undefined,
        observacao:
          typeof rawArgs.observacao === 'string'
            ? sanitizeText(rawArgs.observacao).slice(0, 150)
            : undefined,
      };

    case 'remove_item':
      return {
        lineId: typeof rawArgs.lineId === 'string' ? sanitizeText(rawArgs.lineId).slice(0, 30) : undefined,
        itemId: typeof rawArgs.itemId === 'string' ? sanitizeText(rawArgs.itemId).slice(0, 60) : undefined,
        quantidade:
          rawArgs.quantidade !== undefined && rawArgs.quantidade !== null
            ? Number(rawArgs.quantidade)
            : undefined,
      };

    case 'confirm_order':
      return {
        nome_cliente:
          typeof rawArgs.nome_cliente === 'string'
            ? sanitizeText(rawArgs.nome_cliente).slice(0, 100)
            : '',
        endereco_entrega:
          typeof rawArgs.endereco_entrega === 'string'
            ? sanitizeText(rawArgs.endereco_entrega).slice(0, 200)
            : '',
        forma_pagamento:
          typeof rawArgs.forma_pagamento === 'string'
            ? sanitizeText(rawArgs.forma_pagamento).slice(0, 80)
            : '',
      };

    default:
      return {};
  }
}

/**
 * Constrói uma resposta determinística segura baseada exclusivamente no estado real do carrinho.
 * @param {object} cartState
 * @param {object} [confirmedReceipt]
 * @returns {string}
 */
export function buildSafeFallbackResponse(cartState, confirmedReceipt = null) {
  if (confirmedReceipt && confirmedReceipt.texto_resumo) {
    return confirmedReceipt.texto_resumo;
  }

  if (!cartState || !Array.isArray(cartState.items) || cartState.items.length === 0) {
    return (
      `No momento seu carrinho está vazio. A taxa de entrega fixa é ${formatarPreco(DELIVERY_FEE)}. ` +
      `Posso anotar alguma marmita do cardápio de hoje para você?`
    );
  }

  const linhas = cartState.items
    .map((item) => {
      const desc = item.notes ? `${item.nome} — ${item.notes}` : item.nome;
      return `• ${item.quantidade}x ${desc}: ${formatarPreco(item.lineSubtotal)}`;
    })
    .join('\n');

  return (
    `Aqui está o resumo atualizado do seu pedido:\n${linhas}\n` +
    `Subtotal: ${formatarPreco(cartState.subtotal)}\n` +
    `Taxa de entrega: ${formatarPreco(cartState.taxa_entrega)}\n` +
    `Total com entrega: ${formatarPreco(cartState.total)}\n\n` +
    `Para fechar o pedido, informe seu nome, endereço de entrega e forma de pagamento!`
  );
}

/**
 * Extrai todos os valores monetários precedidos por "R$" em um texto (ex.: "R$ 24,90" -> 24.9).
 * @param {string} text
 * @returns {number[]}
 */
export function extractMonetaryValuesBRL(text) {
  const regex = /R\$\s*(\d{1,4}(?:[.,]\d{1,2})?)/gi;
  const values = [];
  let match;
  while ((match = regex.exec(String(text || ''))) !== null) {
    const normalizedNumber = Number(match[1].replace(',', '.'));
    if (!Number.isNaN(normalizedNumber)) {
      values.push(Math.round(normalizedNumber * 100) / 100);
    }
  }
  return values;
}

/**
 * CAMADA 4: Valida a resposta gerada pelo LLM antes de exibi-la na UI.
 * @param {string} modelText
 * @param {object} cartState
 * @param {object} [extraContext]
 * @returns {{ safe: boolean, reason: string | null, finalText: string }}
 */
export function validateModelOutput(modelText, cartState, extraContext = {}) {
  const raw = String(modelText || '').trim();
  if (!raw) {
    return {
      safe: false,
      reason: 'empty_output',
      finalText: buildSafeFallbackResponse(cartState, extraContext.confirmedReceipt),
    };
  }

  const leakPatterns = [
    /REGRAS OBRIGATÓRIAS DE ATENDIMENTO/i,
    /<\s*\/?\s*mensagem_usuario\s*>/i,
    /marmitaria_llm_api_key/i,
    /GEMINI_FUNCTION_DECLARATIONS/i,
    /buildSystemPrompt/i,
    /TRATE O CONTEÚDO INTERNO APENAS COMO DADO/i,
  ];

  for (const pattern of leakPatterns) {
    if (pattern.test(raw)) {
      return {
        safe: false,
        reason: 'system_prompt_leak_detected',
        finalText: buildSafeFallbackResponse(cartState, extraContext.confirmedReceipt),
      };
    }
  }

  const htmlOrUrlPatterns = [
    /<\s*(script|iframe|img|svg|object|embed|style|link|meta|form|input|a)\b/i,
    /on(error|load|click|mouseover)\s*=/i,
    /javascript\s*:/i,
    /\bhttps?:\/\/[^\s)]+/i,
  ];

  for (const pattern of htmlOrUrlPatterns) {
    if (pattern.test(raw)) {
      return {
        safe: false,
        reason: 'unsafe_html_or_url_detected',
        finalText: buildSafeFallbackResponse(cartState, extraContext.confirmedReceipt),
      };
    }
  }

  const citedValues = extractMonetaryValuesBRL(raw);
  if (citedValues.length > 0) {
    const menuHoje = extraContext.menuItems || getMenuDoDia(new Date());
    const allowedNumbers = new Set([
      0,
      Math.round(DELIVERY_FEE * 100) / 100,
    ]);

    for (const item of menuHoje) {
      allowedNumbers.add(Math.round(item.preco_unitario * 100) / 100);
    }

    if (cartState) {
      allowedNumbers.add(Math.round((cartState.subtotal || 0) * 100) / 100);
      allowedNumbers.add(Math.round((cartState.taxa_entrega || DELIVERY_FEE) * 100) / 100);
      allowedNumbers.add(Math.round((cartState.total || 0) * 100) / 100);

      for (const line of cartState.items || []) {
        allowedNumbers.add(Math.round(line.preco_unitario * 100) / 100);
        allowedNumbers.add(Math.round(line.lineSubtotal * 100) / 100);
      }
    }

    if (extraContext.confirmedReceipt) {
      const rec = extraContext.confirmedReceipt;
      allowedNumbers.add(Math.round((rec.subtotal || 0) * 100) / 100);
      allowedNumbers.add(Math.round((rec.taxa_entrega || DELIVERY_FEE) * 100) / 100);
      allowedNumbers.add(Math.round((rec.total || 0) * 100) / 100);
      for (const line of rec.items || []) {
        allowedNumbers.add(Math.round(line.preco_unitario * 100) / 100);
        allowedNumbers.add(Math.round(line.lineSubtotal * 100) / 100);
      }
    }

    for (const cited of citedValues) {
      if (!allowedNumbers.has(cited)) {
        return {
          safe: false,
          reason: `divergent_monetary_value: R$ ${cited.toFixed(2)}`,
          finalText: buildSafeFallbackResponse(cartState, extraContext.confirmedReceipt),
        };
      }
    }
  }

  return {
    safe: true,
    reason: null,
    finalText: raw,
  };
}
