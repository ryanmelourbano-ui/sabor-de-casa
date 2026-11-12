/**
 * js/agent.js
 * Orquestrador do agente de LLM via fetch direto para a API REST do Google Gemini.
 * - Envia a API Key no cabeçalho HTTP 'x-goog-api-key' (nunca exposta na URL).
 * - Integra as 4 camadas de Guardrails.
 * - Suporta também Modo Demonstração local determinístico com escopo por item.
 */

import { CONFIG, DELIVERY_FEE, getApiKey, getGeminiEndpoint } from './config.js';
import { formatarPreco } from './menu.js';
import { buildSystemPrompt } from './prompts.js';
import {
  GEMINI_FUNCTION_DECLARATIONS,
  executeToolCall,
  getLastConfirmedOrder,
} from './tools.js';
import { getSummary } from './cart.js';
import {
  validateUserInput,
  wrapUntrustedUserMessage,
  validateModelOutput,
} from './guardrails.js';

let conversationHistory = [];

let demoCheckoutDraft = {
  nome_cliente: '',
  endereco_entrega: '',
  forma_pagamento: '',
  aguardandoConfirmacao: false,
};

/**
 * Limpa o histórico de conversação em memória e rascunho de checkout.
 */
export function clearConversationHistory() {
  conversationHistory = [];
  demoCheckoutDraft = {
    nome_cliente: '',
    endereco_entrega: '',
    forma_pagamento: '',
    aguardandoConfirmacao: false,
  };
}

/**
 * Trunca o histórico mantendo no máximo as últimas MAX_HISTORY_MESSAGES mensagens,
 * garantindo que o primeiro elemento seja sempre um turno 'user' com texto.
 * @param {Array<object>} history
 * @returns {Array<object>}
 */
function trimHistory(history) {
  if (history.length <= CONFIG.MAX_HISTORY_MESSAGES) {
    return [...history];
  }

  let sliced = history.slice(-CONFIG.MAX_HISTORY_MESSAGES);

  while (
    sliced.length > 0 &&
    (sliced[0].role !== 'user' ||
      !sliced[0].parts?.some((part) => typeof part.text === 'string'))
  ) {
    sliced.shift();
  }

  return sliced;
}

/**
 * Traduz erros HTTP e de rede para mensagens amigáveis em português,
 * garantindo que nenhum dado sensível (como a API key) seja incluído na mensagem.
 * @param {number | null} status
 * @param {string} rawMessage
 * @returns {string}
 */
function formatFriendlyApiError(status, rawMessage = '') {
  if (status === 400 && rawMessage.toLowerCase().includes('api key')) {
    return 'Sua chave da API parece inválida. Clique em "🔑 Chave da API" no topo para verificar ou atualizar.';
  }
  if (status === 401 || status === 403) {
    return 'Acesso negado pela API do Gemini (chave inválida ou sem permissão). Verifique sua chave no botão "🔑 Chave da API".';
  }
  if (status === 429) {
    return 'Muitas solicitações em sequência (limite da API atingido - erro 429). Aguarde alguns segundos e tente novamente.';
  }
  if (status && status >= 500) {
    return 'O serviço de inteligência artificial está temporariamente instável. Tente novamente em instantes.';
  }
  return 'Não foi possível concluir a comunicação com o assistente no momento. Verifique sua chave de API ou conexão.';
}

/**
 * Realiza uma chamada HTTP POST para o endpoint generateContent do Gemini com timeout.
 * SEGURANÇA: A API Key é enviada via header 'x-goog-api-key' para evitar exposição em URLs/logs.
 *
 * @param {Array<object>} contents
 * @param {string} apiKey
 * @returns {Promise<object>}
 */
async function callGeminiGenerateContent(contents, apiKey) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Você está sem conexão com a internet (offline). Verifique sua rede e tente novamente.');
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);

  const url = getGeminiEndpoint(CONFIG.GEMINI_MODEL);

  const payload = {
    systemInstruction: {
      parts: [{ text: buildSystemPrompt(new Date()) }],
    },
    contents,
    tools: [
      {
        functionDeclarations: GEMINI_FUNCTION_DECLARATIONS,
      },
    ],
    generationConfig: {
      temperature: 0.2,
    },
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      let apiErrorMsg = '';
      try {
        const errJson = await response.json();
        apiErrorMsg = errJson?.error?.message || '';
      } catch {
        // Ignora erro de parse no corpo de erro
      }
      throw new Error(formatFriendlyApiError(response.status, apiErrorMsg));
    }

    return await response.json();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('O tempo limite de resposta da IA foi excedido (timeout). Tente enviar novamente.');
    }
    if (error instanceof TypeError) {
      throw new Error('Falha de conexão com a API (rede offline ou inacessível). Verifique sua internet.');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Orquestrador determinístico local para o Modo Demonstração (quando nenhuma API Key foi informada).
 * Usa exatamente as mesmas tools (get_menu, add_item, get_order_summary, confirm_order) e guardrails.
 * @param {string} text
 * @param {(state: object) => void} [onCartUpdate]
 * @returns {{ reply: string, state: object, toolCallsExecuted: Array<object> }}
 */
function handleDemoModeTurn(text, onCartUpdate) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new Error('Você está sem conexão com a internet (offline). Verifique sua rede e tente novamente.');
  }

  const lower = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const toolCallsExecuted = [];

  function runTool(name, args) {
    const result = executeToolCall(name, args);
    toolCallsExecuted.push({ name, args, result });
    if (typeof onCartUpdate === 'function') {
      onCartUpdate(getSummary());
    }
    return result;
  }

  // 1. Confirmação final ("confirmar" / "confirmo")
  if (
    /\b(confirmar|confirmo|pode confirmar|confirmado)\b/.test(lower) &&
    demoCheckoutDraft.nome_cliente &&
    demoCheckoutDraft.endereco_entrega &&
    demoCheckoutDraft.forma_pagamento
  ) {
    const res = runTool('confirm_order', {
      nome_cliente: demoCheckoutDraft.nome_cliente,
      endereco_entrega: demoCheckoutDraft.endereco_entrega,
      forma_pagamento: demoCheckoutDraft.forma_pagamento,
    });

    if (res.ok) {
      demoCheckoutDraft.aguardandoConfirmacao = false;
      const rec = res.resumo_fechado;
      return {
        reply:
          `Pedido confirmado com sucesso! 🎉\n` +
          `Número do pedido: ${res.numero_pedido}\n` +
          `Cliente: ${rec.nome_cliente}\n` +
          `Endereço: ${rec.endereco_entrega}\n` +
          `Forma de pagamento: ${rec.forma_pagamento}\n` +
          `Tempo estimado de entrega: ${res.tempo_estimado}\n` +
          `Subtotal: ${rec.subtotal_formatado} | Taxa de entrega: ${rec.taxa_entrega_formatada} | Total: ${rec.total_formatado}`,
        state: getSummary(),
        toolCallsExecuted,
      };
    }
  }

  // 2. Coleta de dados de entrega e pagamento (nome, endereço, pagamento)
  const nomeMatch = text.match(/nome\s*(?:e|é|:)?\s*([A-Za-zÀ-ÿ\s]{2,40}?)(?:,|;|\.|endereco|endereço|rua|av|pagamento|pix|cartao|cartão|dinheiro|$)/i);
  if (nomeMatch) {
    demoCheckoutDraft.nome_cliente = nomeMatch[1].trim();
  }
  const endMatch = text.match(/(?:endereco|endereço|entregar na|moro na)?\s*((?:rua|av\.?|avenida|alameda|travessa|praca|praça)\s+[^,;]+(?:,\s*\d+[^,;]*)?(?:\s*-\s*[^,;.]+)?)/i);
  if (endMatch) {
    demoCheckoutDraft.endereco_entrega = endMatch[1].trim();
  }
  const pagMatch = text.match(/\b(pix|cart[aã]o(?:\s+de\s+(?:cr[eé]dito|d[eé]bito))?|dinheiro)\b/i);
  if (pagMatch) {
    demoCheckoutDraft.forma_pagamento = pagMatch[1].toUpperCase();
  }

  if (
    (nomeMatch || endMatch || pagMatch) &&
    getSummary().items.length > 0
  ) {
    const sumRes = runTool('get_order_summary', {});
    const st = sumRes.state;

    const faltando = [];
    if (!demoCheckoutDraft.nome_cliente) faltando.push('seu nome');
    if (!demoCheckoutDraft.endereco_entrega) faltando.push('o endereço de entrega');
    if (!demoCheckoutDraft.forma_pagamento) faltando.push('a forma de pagamento (PIX, Cartão ou Dinheiro)');

    if (faltando.length > 0) {
      return {
        reply: `Anotei os dados! Para concluir, informe também ${faltando.join(' e ')}. O total atual com entrega (${formatarPreco(DELIVERY_FEE)}) é ${formatarPreco(st.total)}.`,
        state: st,
        toolCallsExecuted,
      };
    }

    demoCheckoutDraft.aguardandoConfirmacao = true;
    const itensStr = st.items
      .map((i) => `• ${i.quantidade}x ${i.displayLabel}: ${formatarPreco(i.lineSubtotal)}`)
      .join('\n');

    return {
      reply:
        `Confira o resumo final do seu pedido antes de fechar:\n` +
        `${itensStr}\n` +
        `Subtotal: ${formatarPreco(st.subtotal)}\n` +
        `Taxa de entrega: ${formatarPreco(st.taxa_entrega)}\n` +
        `Total: ${formatarPreco(st.total)}\n` +
        `Cliente: ${demoCheckoutDraft.nome_cliente}\n` +
        `Endereço: ${demoCheckoutDraft.endereco_entrega}\n` +
        `Pagamento: ${demoCheckoutDraft.forma_pagamento}\n\n` +
        `Digite "confirmar" para finalizar seu pedido!`,
      state: st,
      toolCallsExecuted,
    };
  }

  // 3. Adição de itens ao carrinho segmentando por cláusula (ex.: "1 bife sem cebola, 1 frango e 1 strogonoff")
  const catalogKeywords = [
    { id: 'bife-acebolado', regex: /(\d+)?\s*(?:marmitas?\s+de\s+)?bifes?(?:\s+acebolados?)?/i },
    { id: 'frango-grelhado', regex: /(\d+)?\s*(?:marmitas?\s+de\s+)?frangos?(?:\s+grelhados?)?/i },
    { id: 'strogonoff-carne', regex: /(\d+)?\s*(?:marmitas?\s+de\s+)?strogonoff/i },
    { id: 'feijoada-completa', regex: /(\d+)?\s*(?:marmitas?\s+de\s+)?feijoada/i },
    { id: 'omelete-vegetariana', regex: /(\d+)?\s*(?:marmitas?\s+de\s+)?omeletes?(?:\s+vegetarianas?)?/i },
    { id: 'peixe-frito', regex: /(\d+)?\s*(?:marmitas?\s+de\s+)?peixes?(?:\s+fritos?)?/i },
  ];

  // Divide a frase em cláusulas quando múltiplos pratos são pedidos juntos
  const clauses = text.split(/,|\be\s+(?=\d+\s+|\bmarmita|\bbife|\bfrango|\bstrogonoff|\bfeijoada|\bomelete|\bpeixe)/i);

  const addedMessages = [];
  const errorMessages = [];

  for (const clause of clauses) {
    const removerList = [];
    const remMatches = clause.matchAll(/(?:sem|tira\s+o|tira\s+a|tirar\s+o|tirar\s+a)\s+([a-zA-ZÀ-ÿ-]+(?:\s+de\s+[a-zA-ZÀ-ÿ]+|\s+frita|\s+palha|\s+branco|\s+carioca|\s+refogada)?)/gi);
    for (const m of remMatches) {
      removerList.push(m[1].trim());
    }

    let ponto = undefined;
    if (/bem\s+passad[oa]/i.test(clause)) ponto = 'bem passado';
    else if (/mal\s+passad[oa]/i.test(clause)) ponto = 'mal passado';
    else if (/(?:ao|no)\s+ponto/i.test(clause)) ponto = 'ao ponto';

    for (const entry of catalogKeywords) {
      const match = clause.match(entry.regex);
      if (match) {
        const qtd = match[1] ? Number(match[1]) : 1;
        const res = runTool('add_item', {
          itemId: entry.id,
          quantidade: qtd,
          remover: removerList.length > 0 ? removerList : undefined,
          ponto,
        });
        if (res.ok) {
          const line =
            res.state.items.find((i) => i.lineId === res.lineId) ||
            res.state.items[res.state.items.length - 1];
          addedMessages.push(`${qtd}x ${line ? line.displayLabel : entry.id}`);
        } else if (res.error) {
          errorMessages.push(res.error);
        }
      }
    }
  }

  if (addedMessages.length > 0 || errorMessages.length > 0) {
    const sumRes = runTool('get_order_summary', {});
    const st = sumRes.state;
    const partes = [];
    if (addedMessages.length > 0) {
      partes.push(`Adicionei ao seu pedido: ${addedMessages.join(', ')}.`);
    }
    if (errorMessages.length > 0) {
      partes.push(errorMessages.join(' '));
    }
    if (st.items.length > 0) {
      partes.push(
        `Subtotal: ${formatarPreco(st.subtotal)} | Taxa de entrega: ${formatarPreco(st.taxa_entrega)} | Total: ${formatarPreco(st.total)}.\n` +
        `Deseja mais algum item ou quer informar seu nome, endereço e forma de pagamento para fechar o pedido?`
      );
    }
    return {
      reply: partes.join('\n'),
      state: st,
      toolCallsExecuted,
    };
  }

  // 4. Consulta de total / fechamento / resumo
  if (/\b(total|conta|fechar|resumo|quanto\s+fica|valor)\b/.test(lower)) {
    const sumRes = runTool('get_order_summary', {});
    const st = sumRes.state;
    if (st.items.length === 0) {
      return {
        reply: `Seu carrinho ainda está vazio! A taxa de entrega fixa é ${formatarPreco(DELIVERY_FEE)}. Qual marmita do cardápio de hoje você gostaria de pedir?`,
        state: st,
        toolCallsExecuted,
      };
    }
    const lista = st.items
      .map((i) => `• ${i.quantidade}x ${i.displayLabel}: ${formatarPreco(i.lineSubtotal)}`)
      .join('\n');
    return {
      reply:
        `Aqui está o resumo do seu pedido:\n${lista}\n` +
        `Subtotal: ${formatarPreco(st.subtotal)}\n` +
        `Taxa de entrega: ${formatarPreco(st.taxa_entrega)}\n` +
        `Total com entrega: ${formatarPreco(st.total)}\n\n` +
        `Para finalizar, informe seu nome, endereço completo e forma de pagamento (PIX, Cartão ou Dinheiro).`,
      state: st,
      toolCallsExecuted,
    };
  }

  // 5. Consulta de cardápio
  const menuRes = runTool('get_menu', {});
  const opcoes = menuRes.itens_disponiveis_hoje
    .map((i) => `• ${i.nome}: ${i.preco_formatado}`)
    .join('\n');
  return {
    reply:
      `Hoje (${menuRes.dia_semana}) temos as seguintes marmitas disponíveis:\n${opcoes}\n` +
      `Taxa de entrega fixa: ${menuRes.taxa_entrega_formatada}.\n` +
      `O que você gostaria de pedir?`,
    state: getSummary(),
    toolCallsExecuted,
  };
}

/**
 * Envia a mensagem do usuário ao agente passando pelas 4 camadas de guardrails.
 *
 * @param {string} userText
 * @param {(state: object) => void} [onCartUpdate]
 * @returns {Promise<{ reply: string, state: object, toolCallsExecuted: Array<object>, confirmedOrder?: object | null, blockedByGuardrail?: boolean }>}
 */
export async function sendMessageToAgent(userText, onCartUpdate) {
  // CAMADA 1: Guardrail de Entrada (antes do LLM — não consome chamada de API se bloqueado)
  const inputValidation = validateUserInput(userText);
  if (!inputValidation.allowed) {
    return {
      reply: inputValidation.safeReply,
      state: getSummary(),
      toolCallsExecuted: [],
      confirmedOrder: getLastConfirmedOrder(),
      blockedByGuardrail: true,
      guardrailReason: inputValidation.reason,
    };
  }

  const apiKey = getApiKey();

  if (!apiKey) {
    const demoResult = handleDemoModeTurn(inputValidation.sanitizedText, onCartUpdate);
    const confirmedReceipt = getLastConfirmedOrder();
    const outputCheck = validateModelOutput(demoResult.reply, demoResult.state, {
      confirmedReceipt,
    });
    return {
      reply: outputCheck.finalText,
      state: demoResult.state,
      toolCallsExecuted: demoResult.toolCallsExecuted,
      confirmedOrder: confirmedReceipt,
      blockedByGuardrail: !outputCheck.safe,
    };
  }

  // CAMADA 2: Encapsulamento da mensagem como dado não confiável (<mensagem_usuario>...</mensagem_usuario>)
  const encapsulatedMessage = wrapUntrustedUserMessage(inputValidation.sanitizedText);

  const workingHistory = trimHistory([
    ...conversationHistory,
    {
      role: 'user',
      parts: [{ text: encapsulatedMessage }],
    },
  ]);

  const toolCallsExecuted = [];
  let confirmedReceiptInTurn = null;
  let iterations = 0;

  while (iterations < CONFIG.MAX_TOOL_ITERATIONS) {
    iterations += 1;

    const data = await callGeminiGenerateContent(workingHistory, apiKey);
    const candidate = data?.candidates?.[0];
    const modelParts = candidate?.content?.parts || [];

    if (modelParts.length === 0) {
      throw new Error('O modelo não retornou conteúdo para esta mensagem. Tente reformular seu pedido.');
    }

    workingHistory.push({
      role: 'model',
      parts: modelParts,
    });

    const functionCallParts = modelParts.filter((part) => Boolean(part.functionCall));

    if (functionCallParts.length === 0) {
      const rawReplyText = modelParts
        .filter((part) => typeof part.text === 'string')
        .map((part) => part.text)
        .join('\n')
        .trim();

      const currentState = getSummary();

      // CAMADA 4: Guardrail de Saída
      const outputCheck = validateModelOutput(rawReplyText, currentState, {
        confirmedReceipt: confirmedReceiptInTurn || getLastConfirmedOrder(),
      });

      conversationHistory = trimHistory(workingHistory);

      return {
        reply: outputCheck.finalText,
        state: currentState,
        toolCallsExecuted,
        confirmedOrder: confirmedReceiptInTurn || getLastConfirmedOrder(),
        blockedByGuardrail: !outputCheck.safe,
        guardrailReason: outputCheck.reason,
      };
    }

    // CAMADA 3: Execução determinística das tools com sanitização estrita de argumentos
    const responseParts = [];

    for (const part of functionCallParts) {
      const { name, args } = part.functionCall;
      const toolResult = executeToolCall(name, args || {});

      if (name === 'confirm_order' && toolResult.ok && toolResult.resumo_fechado) {
        confirmedReceiptInTurn = toolResult.resumo_fechado;
      }

      toolCallsExecuted.push({
        name,
        args,
        result: toolResult,
      });

      if (typeof onCartUpdate === 'function') {
        onCartUpdate(getSummary());
      }

      responseParts.push({
        functionResponse: {
          name,
          response: toolResult,
        },
      });
    }

    workingHistory.push({
      role: 'user',
      parts: responseParts,
    });
  }

  conversationHistory = trimHistory(workingHistory);
  const finalState = getSummary();
  const fallback = validateModelOutput('', finalState, {
    confirmedReceipt: confirmedReceiptInTurn || getLastConfirmedOrder(),
  });

  return {
    reply: fallback.finalText,
    state: finalState,
    toolCallsExecuted,
    confirmedOrder: confirmedReceiptInTurn || getLastConfirmedOrder(),
  };
}
