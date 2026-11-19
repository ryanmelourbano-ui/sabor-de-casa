/**
 * js/agent.js
 * Agente conversacional 100% Client-Side (Zero LLM externo, Zero API Key, Zero requisições de rede).
 * Atendente: Carlão • Marmitaria Sabor da Casa.
 * Opera inteiramente no navegador com processamento determinístico de linguagem natural (PT-BR),
 * integrado às 4 camadas de Guardrails (js/guardrails.js) e às Tools determinísticas (js/tools.js e js/cart.js).
 */

import { DELIVERY_FEE } from './config.js';
import { MENU_ITEMS, getMenuDoDia, formatarPreco } from './menu.js';
import {
  executeToolCall,
  getLastConfirmedOrder,
  clearLastConfirmedOrder,
} from './tools.js';
import { getSummary, clearCart } from './cart.js';
import {
  validateUserInput,
  validateModelOutput,
} from './guardrails.js';

let checkoutState = {
  emFechamento: false,
  aguardandoConfirmacao: false,
  nome_cliente: '',
  endereco_entrega: '',
  forma_pagamento: '',
};

let pendingAmbiguity = null;
let lastReferencedLineId = null;

/**
 * Reinicia todo o estado conversacional do agente local.
 */
export function clearConversationHistory() {
  checkoutState = {
    emFechamento: false,
    aguardandoConfirmacao: false,
    nome_cliente: '',
    endereco_entrega: '',
    forma_pagamento: '',
  };
  pendingAmbiguity = null;
  lastReferencedLineId = null;
}

/**
 * Normaliza string para minúsculas sem acentos.
 * @param {string} str
 * @returns {string}
 */
function norm(str) {
  return String(str || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

/**
 * Converte numerais por extenso em português para dígitos apenas quando
 * antecedem palavras de quantidade/marmita/pratos.
 * @param {string} text
 * @returns {string}
 */
function replacePortugueseNumberWords(text) {
  const map = {
    uma: '1',
    um: '1',
    duas: '2',
    dois: '2',
    tres: '3',
    três: '3',
    quatro: '4',
    cinco: '5',
    seis: '6',
    sete: '7',
    oito: '8',
    nove: '9',
    dez: '10',
  };

  return text.replace(
    /\b(uma|um|duas|dois|tres|três|quatro|cinco|seis|sete|oito|nove|dez)\b(?=\s+(?:marmitas?|bifes?|frangos?|strogonoff|estrogonofe|feijoadas?|omeletes?|peixes?|tilapias?|unidades?|delas?|deles?))/gi,
    (match) => map[norm(match)] || match
  );
}

const CATALOG_PATTERNS = [
  {
    id: 'bife-acebolado',
    keywords: /\b(bifes?(?:\s+acebolad[oa]s?)?)\b/i,
    qtyRegex: /(?:(\d+)\s*(?:marmitas?\s+(?:de\s+)?)?)?\b(?:bifes?(?:\s+acebolad[oa]s?)?)\b/i,
  },
  {
    id: 'frango-grelhado',
    keywords: /\b(frangos?(?:\s+grelhad[oa]s?)?)\b/i,
    qtyRegex: /(?:(\d+)\s*(?:marmitas?\s+(?:de\s+)?)?)?\b(?:frangos?(?:\s+grelhad[oa]s?)?)\b/i,
  },
  {
    id: 'strogonoff-carne',
    keywords: /\b(strogonoff|estrogonofe)\b/i,
    qtyRegex: /(?:(\d+)\s*(?:marmitas?\s+(?:de\s+)?)?)?\b(?:strogonoff|estrogonofe)\b/i,
  },
  {
    id: 'feijoada-completa',
    keywords: /\b(feijoadas?)\b/i,
    qtyRegex: /(?:(\d+)\s*(?:marmitas?\s+(?:de\s+)?)?)?\b(?:feijoadas?)\b/i,
  },
  {
    id: 'omelete-vegetariana',
    keywords: /\b(omeletes?(?:\s+vegetarian[oa]s?)?)\b/i,
    qtyRegex: /(?:(\d+)\s*(?:marmitas?\s+(?:de\s+)?)?)?\b(?:omeletes?(?:\s+vegetarian[oa]s?)?)\b/i,
  },
  {
    id: 'peixe-frito',
    keywords: /\b(peixes?(?:\s+frit[oa]s?)?|tilapias?)\b/i,
    qtyRegex: /(?:(\d+)\s*(?:marmitas?\s+(?:de\s+)?)?)?\b(?:peixes?(?:\s+frit[oa]s?)?|tilapias?)\b/i,
  },
];

// Conjunto de termos conhecidos de ingredientes e temperos para listas coordenadas ("sem cebola, alho e farofa")
const KNOWN_INGREDIENT_TOKENS = new Set([
  'cebola',
  'alho',
  'farofa',
  'farofa de bacon',
  'batata',
  'batata frita',
  'batata palha',
  'fritas',
  'frita',
  'feijao',
  'feijao carioca',
  'arroz',
  'arroz branco',
  'arroz integral',
  'pure',
  'pure de batata',
  'alface',
  'tomate',
  'pimenta',
  'pimenta-do-reino',
  'sal',
  'cheiro-verde',
  'oregano',
  'ervas',
  'ervas finas',
  'champignon',
  'salsinha',
  'mostarda',
  'couve',
  'couve refogada',
  'laranja',
  'louro',
  'queijo',
  'queijo minas',
  'espinafre',
  'legumes',
  'legumes no vapor',
  'cebolinha',
  'pirao',
  'pirao de peixe',
  'salada',
  'salada tropical',
  'limao',
  'coentro',
  'bife',
  'bife bovino',
  'file de frango',
  'ovos',
  'ovos caipiras',
  'file de tilapia',
]);

// Palavras que NÃO são ingredientes e devem ser ignoradas ao extrair remoções
const NON_INGREDIENT_WORDS = new Set([
  'a',
  'o',
  'os',
  'as',
  'um',
  'uma',
  'de',
  'do',
  'da',
  'dos',
  'das',
  'no',
  'na',
  'em',
  'por',
  'favor',
  'pra',
  'para',
  'ele',
  'ela',
  'isso',
  'marmita',
  'marmitas',
  'pedido',
  'prato',
  'tambem',
  'também',
  'carne',
  'bem',
  'mal',
  'ao',
  'ponto',
  'passado',
  'passada',
  'quero',
  'pedi',
  'pedir',
  'coloca',
  'colocar',
  'deixa',
  'deixar',
  'manda',
  'mandar',
]);

/**
 * Limpa artigos e conectivos iniciais/finais de um termo candidato a ingrediente removido.
 * @param {string} rawCandidate
 * @returns {string}
 */
function cleanIngredientCandidate(rawCandidate) {
  let cleaned = String(rawCandidate || '')
    .trim()
    .replace(/^(?:sem|retirar|retira|tirar|tira|remover|remove|excluir)\s+/i, '')
    .replace(/^(?:o|a|os|as|um|uma|de|do|da|dos|das)\s+/i, '')
    .replace(
      /\s+\b(?:por\s+favor|pfv|obrigad[oa]|tamb[eé]m|(?:e\s+)?(?:carne\s+)?(?:ao\s+ponto|no\s+ponto|bem\s+passad[oa]|mal\s+passad[oa])).*$/i,
      ''
    )
    .replace(
      /\s+\b(?:do|da|no|na)\s+(?:meu\s+|minha\s+|essa\s+|esse\s+)?(?:bife|frango|strogonoff|feijoada|omelete|peixe|marmita|pedido).*$/i,
      ''
    )
    .trim();

  if (!cleaned || cleaned.length < 3 || NON_INGREDIENT_WORDS.has(norm(cleaned))) {
    return '';
  }
  return cleaned;
}

/**
 * Extrai lista de ingredientes/temperos para remover, ponto da carne e observações de um trecho de texto.
 *
 * @param {string} clause
 * @returns {{ remover: string[], ponto: string | undefined, observacao: string | undefined }}
 */
function extractCustomizationsFromClause(clause) {
  const remover = [];

  function addCandidate(raw) {
    const item = cleanIngredientCandidate(raw);
    if (item && !remover.some((r) => norm(r) === norm(item))) {
      remover.push(item);
    }
  }

  // 1. Captura cada ocorrência direta de verbo/preposição de remoção:
  //    Ex.: "sem cebola", "sem a cebola", "retirar a cebola", "tira o alho", "remover a batata frita"
  const directRemovalRegex =
    /\b(?:sem|retirar|retira|tirar|tira|remover|remove|excluir)\s+(?:o\s+|a\s+|os\s+|as\s+|um\s+|uma\s+|de\s+|do\s+|da\s+)*([a-zA-ZÀ-ÿ-]+(?:\s+(?:de\s+[a-zA-ZÀ-ÿ]+|frita|palha|branco|integral|carioca|refogada|bovino|minas|caipiras|tropical|no\s+vapor|finas))?)(.*?)(?=\b(?:sem|retirar|retira|tirar|tira|remover|remove|excluir)\b|$)/gi;

  let match;
  while ((match = directRemovalRegex.exec(clause)) !== null) {
    const firstTarget = match[1];
    const trailingText = match[2] || '';
    addCandidate(firstTarget);

    // 2. Se logo após o primeiro item houver uma lista coordenada (", alho e batata frita" ou "e o alho"),
    //    adiciona apenas os itens seguintes que forem ingredientes/temperos conhecidos do cardápio
    const coordinatedParts = trailingText.split(/,|\s+e\s+/i);
    for (const part of coordinatedParts) {
      const candidate = cleanIngredientCandidate(part);
      if (candidate && KNOWN_INGREDIENT_TOKENS.has(norm(candidate))) {
        addCandidate(candidate);
      }
    }
  }

  let ponto = undefined;
  if (/\bbem\s+passad[oa]\b/i.test(clause)) {
    ponto = 'bem passado';
  } else if (/\bmal\s+passad[oa]\b/i.test(clause)) {
    ponto = 'mal passado';
  } else if (/\b(?:ao|no)\s+ponto\b/i.test(clause)) {
    ponto = 'ao ponto';
  }

  let observacao = undefined;
  const swapMatch = clause.match(/\b(troca(?:r)?\s+[^,.]+?\s+por\s+[^,.]+)/i);
  if (swapMatch) {
    observacao = swapMatch[1].trim();
    const fromIng = swapMatch[1].match(/troca(?:r)?\s+(?:o\s+|a\s+)?([^,.]+?)\s+por\s+/i);
    if (fromIng && fromIng[1]) {
      addCandidate(fromIng[1]);
    }
  }

  return { remover, ponto, observacao };
}

/**
 * Extrai nome, endereço e forma de pagamento de uma mensagem do usuário.
 * @param {string} text
 */
function extractCheckoutFields(text) {
  const nText = norm(text);

  const pagMatch = text.match(
    /\b(pix|cart[aã]o(?:\s+de\s+(?:cr[eé]dito|d[eé]bito))?|cr[eé]dito|d[eé]bito|dinheiro|vale(?:\s*-?\s*refei[cç][aã]o)?)\b/i
  );
  if (pagMatch) {
    const rawPag = norm(pagMatch[1]);
    if (rawPag === 'pix') checkoutState.forma_pagamento = 'PIX';
    else if (rawPag.includes('credito')) checkoutState.forma_pagamento = 'Cartão de Crédito';
    else if (rawPag.includes('debito')) checkoutState.forma_pagamento = 'Cartão de Débito';
    else if (rawPag.includes('cartao')) checkoutState.forma_pagamento = 'Cartão';
    else if (rawPag.includes('dinheiro')) checkoutState.forma_pagamento = 'Dinheiro';
    else checkoutState.forma_pagamento = pagMatch[1].trim();
  }

  const endExplicit = text.match(
    /(?:endere[cç]o(?:\s+de\s+entrega)?(?:\s*[eé:]\s*|\s+)|entregar\s+(?:na|no|em)\s+|moro\s+(?:na|no|em)\s+)([^;|]+?)(?:,\s*(?:pagamento|forma\s+de\s+pagamento|pagar|vou\s+pagar)\b|;\s*|$)/i
  );
  const endStreet = text.match(
    /\b((?:rua|av\.?|avenida|alameda|travessa|pra[cç]a|estrada|rodovia)\s+[A-Za-zÀ-ÿ0-9\s.,-]+?\d+[A-Za-zÀ-ÿ0-9\s.,-]*?)(?:,\s*(?:pagamento|forma\s+de\s+pagamento|pagar|vou\s+pagar|no\s+pix|em\s+dinheiro|no\s+cart[aã]o)\b|;\s*|$)/i
  );

  if (endStreet) {
    checkoutState.endereco_entrega = endStreet[1].trim().replace(/[,.]+$/, '');
  } else if (endExplicit) {
    checkoutState.endereco_entrega = endExplicit[1].trim().replace(/[,.]+$/, '');
  }

  const nomeMatch = text.match(
    /(?:meu\s+nome\s+[eé]|nome\s*[:=]|sou\s+o|sou\s+a|cliente\s*[:=])\s*([A-Za-zÀ-ÿ]+(?:\s+[A-Za-zÀ-ÿ]+){0,4}?)(?:,|;|\.|endere[cç]o|rua|av|avenida|pagamento|pix|cart[aã]o|dinheiro|$)/i
  );
  if (nomeMatch) {
    checkoutState.nome_cliente = nomeMatch[1].trim();
  } else if (
    checkoutState.emFechamento &&
    !checkoutState.nome_cliente &&
    !endStreet &&
    !pagMatch &&
    /^[A-Za-zÀ-ÿ]{2,}(?:\s+[A-Za-zÀ-ÿ]{2,}){0,3}$/.test(text.trim()) &&
    !/^(confirmar|confirmo|sim|nao|não|oi|ola|olá|total|resumo|cardapio|cardápio)$/i.test(nText)
  ) {
    checkoutState.nome_cliente = text.trim();
  } else if (
    checkoutState.emFechamento &&
    checkoutState.nome_cliente &&
    !checkoutState.endereco_entrega &&
    !pagMatch &&
    text.trim().length >= 6 &&
    !/^(confirmar|confirmo|sim|nao|não)$/i.test(nText)
  ) {
    checkoutState.endereco_entrega = text.trim();
  }
}

/**
 * Monta a mensagem pedindo os dados faltantes ou o resumo final para confirmação.
 * @param {object} summaryState
 * @returns {string}
 */
function buildCheckoutPromptOrFinalSummary(summaryState) {
  const faltando = [];
  if (!checkoutState.nome_cliente) faltando.push('seu nome');
  if (!checkoutState.endereco_entrega) faltando.push('o endereço de entrega (com rua e número)');
  if (!checkoutState.forma_pagamento) faltando.push('a forma de pagamento (PIX, Cartão ou Dinheiro)');

  const linhasItens = summaryState.items
    .map((i) => `• ${i.quantidade}x ${i.displayLabel}: ${formatarPreco(i.lineSubtotal)}`)
    .join('\n');

  if (faltando.length > 0) {
    checkoutState.emFechamento = true;
    checkoutState.aguardandoConfirmacao = false;
    return (
      `Resumo parcial do seu pedido:\n${linhasItens}\n` +
      `Subtotal: ${formatarPreco(summaryState.subtotal)} | Taxa de entrega: ${formatarPreco(summaryState.taxa_entrega)} | Total: ${formatarPreco(summaryState.total)}\n\n` +
      `Para finalizar, por favor informe ${faltando.join(', ')}.`
    );
  }

  checkoutState.emFechamento = true;
  checkoutState.aguardandoConfirmacao = true;

  return (
    `Perfeito! Confira o resumo final do seu pedido:\n` +
    `${linhasItens}\n` +
    `Subtotal: ${formatarPreco(summaryState.subtotal)}\n` +
    `Taxa de entrega: ${formatarPreco(summaryState.taxa_entrega)}\n` +
    `Total com entrega: ${formatarPreco(summaryState.total)}\n\n` +
    `👤 Cliente: ${checkoutState.nome_cliente}\n` +
    `📍 Endereço: ${checkoutState.endereco_entrega}\n` +
    `💳 Pagamento: ${checkoutState.forma_pagamento}\n\n` +
    `Digite "confirmar" para concluir o pedido!`
  );
}

/**
 * Processa um turno de conversa 100% no navegador (sem LLM e sem rede).
 * @param {string} rawText
 * @param {(state: object) => void} [onCartUpdate]
 * @returns {{ reply: string, state: object, toolCallsExecuted: Array<object> }}
 */
function processLocalConversationTurn(rawText, onCartUpdate) {
  const textWithDigits = replacePortugueseNumberWords(rawText);
  const nText = norm(textWithDigits);
  const toolCallsExecuted = [];

  function runTool(name, args = {}) {
    const result = executeToolCall(name, args);
    toolCallsExecuted.push({ name, args, result });
    if (result.lineId) {
      lastReferencedLineId = result.lineId;
    }
    if (typeof onCartUpdate === 'function') {
      onCartUpdate(getSummary());
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // 0. Resolução de ambiguidade pendente ("a primeira", "a segunda", "line-1")
  // -------------------------------------------------------------------------
  if (pendingAmbiguity) {
    const currentItems = getSummary().items;
    const candidatos = currentItems.filter((i) => i.itemId === pendingAmbiguity.itemId);
    let chosenLine = null;

    if (/\b(primeir[oa]|1|line-1)\b/.test(nText) && candidatos[0]) {
      chosenLine = candidatos[0];
    } else if (/\b(segund[oa]|2|line-2)\b/.test(nText) && candidatos[1]) {
      chosenLine = candidatos[1];
    } else {
      const explicitLine = textWithDigits.match(/\b(line-\d+)\b/i);
      if (explicitLine) {
        chosenLine = currentItems.find((i) => i.lineId === explicitLine[1].toLowerCase());
      }
    }

    if (chosenLine) {
      const amb = pendingAmbiguity;
      pendingAmbiguity = null;

      if (amb.action === 'remove') {
        const res = runTool('remove_item', {
          lineId: chosenLine.lineId,
          quantidade: amb.quantidade,
        });
        const st = res.state;
        return {
          reply: res.ok
            ? `Pronto! Removi a marmita selecionada (${chosenLine.displayLabel}). Total atual com entrega: ${formatarPreco(st.total)}.`
            : res.error,
          state: st,
          toolCallsExecuted,
        };
      }

      if (amb.action === 'customize') {
        const mergedRemover = Array.from(
          new Set([...(chosenLine.customizacao.remover || []), ...(amb.customizacao.remover || [])])
        );
        const res = runTool('customize_item', {
          lineId: chosenLine.lineId,
          remover: mergedRemover,
          ponto: amb.customizacao.ponto || chosenLine.customizacao.ponto || undefined,
          observacao: amb.customizacao.observacao || chosenLine.customizacao.observacao || undefined,
        });
        const st = res.state;
        return {
          reply: res.ok
            ? `Personalização aplicada na marmita escolhida! Confira no painel ao lado. Total com entrega: ${formatarPreco(st.total)}.`
            : res.error,
          state: st,
          toolCallsExecuted,
        };
      }
    }
  }

  // -------------------------------------------------------------------------
  // 1. Confirmação final do pedido ("confirmar", "confirmo", "pode confirmar")
  // -------------------------------------------------------------------------
  if (/\b(confirmar|confirmo|pode\s+confirmar|confirmado|fechar\s+agora)\b/.test(nText)) {
    extractCheckoutFields(rawText);
    const currentSummary = getSummary();

    if (currentSummary.items.length === 0) {
      return {
        reply: 'Seu carrinho ainda está vazio! Escolha suas marmitas do cardápio do dia antes de confirmar.',
        state: currentSummary,
        toolCallsExecuted,
      };
    }

    if (
      !checkoutState.nome_cliente ||
      !checkoutState.endereco_entrega ||
      !checkoutState.forma_pagamento
    ) {
      const sumRes = runTool('get_order_summary');
      return {
        reply: buildCheckoutPromptOrFinalSummary(sumRes.state),
        state: sumRes.state,
        toolCallsExecuted,
      };
    }

    const res = runTool('confirm_order', {
      nome_cliente: checkoutState.nome_cliente,
      endereco_entrega: checkoutState.endereco_entrega,
      forma_pagamento: checkoutState.forma_pagamento,
    });

    if (res.ok) {
      checkoutState.emFechamento = false;
      checkoutState.aguardandoConfirmacao = false;
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

  // -------------------------------------------------------------------------
  // 2. Limpar todo o pedido / Cancelar tudo
  // -------------------------------------------------------------------------
  if (/\b(limpar\s+(o\s+)?(carrinho|pedido)|cancelar\s+(todo\s+o\s+|o\s+)?pedido|esvaziar\s+carrinho)\b/.test(nText)) {
    clearCart();
    clearLastConfirmedOrder();
    clearConversationHistory();
    if (typeof onCartUpdate === 'function') {
      onCartUpdate(getSummary());
    }
    return {
      reply: 'Pronto, esvaziei o seu carrinho! O que você gostaria de pedir agora?',
      state: getSummary(),
      toolCallsExecuted,
    };
  }

  // -------------------------------------------------------------------------
  // 3. Remoção de MARMITA inteira do carrinho
  //    Ex.: "remover 1 marmita de strogonoff do pedido", "cancela o frango"
  // -------------------------------------------------------------------------
  const mentionsIngredientRemoval =
    /\b(?:sem|retirar|retira|tirar|tira|remover|remove)\s+(?:o\s+|a\s+|os\s+|as\s+)?(?:cebola|alho|farofa|batata|fritas|feijao|arroz|pure|alface|tomate|pimenta|sal|cheiro-verde|oregano|ervas|champignon|salsinha|mostarda|couve|laranja|louro|queijo|espinafre|legumes|cebolinha|pirao|salada|limao|coentro)\b/i.test(
      nText
    );

  if (
    !mentionsIngredientRemoval &&
    /\b(remover\s+(?:\d+\s+)?(?:marmita|bife|frango|strogonoff|feijoada|omelete|peixe)|cancela(?:r)?\s+(?:o\s+|a\s+|\d+\s+)?(?:marmita|bife|frango|strogonoff|feijoada|omelete|peixe)|tirar\s+do\s+pedido|retirar\s+do\s+pedido)\b/.test(
      nText
    )
  ) {
    const matchedCatalog = CATALOG_PATTERNS.find((c) => c.keywords.test(textWithDigits));
    const qtyMatch = textWithDigits.match(/\b(\d+)\b/);
    const qtd = qtyMatch ? Number(qtyMatch[1]) : undefined;

    if (matchedCatalog) {
      const res = runTool('remove_item', {
        itemId: matchedCatalog.id,
        quantidade: qtd,
      });

      if (!res.ok && res.ambiguidade) {
        pendingAmbiguity = {
          action: 'remove',
          itemId: matchedCatalog.id,
          quantidade: qtd,
        };
        const opcoesTexto = (res.opcoes_no_carrinho || [])
          .map((o, idx) => `${idx + 1}ª (${o.lineId}): ${o.quantidade}x ${o.descricao}`)
          .join('\n');
        return {
          reply: `Você tem mais de uma marmita desse tipo no pedido:\n${opcoesTexto}\n\nQual delas você deseja remover (a 1ª ou a 2ª)?`,
          state: res.state,
          toolCallsExecuted,
        };
      }

      if (res.ok) {
        const st = res.state;
        return {
          reply:
            st.items.length > 0
              ? `Item removido do pedido! O novo subtotal é ${formatarPreco(st.subtotal)} e o total com entrega (${formatarPreco(st.taxa_entrega)}) fica ${formatarPreco(st.total)}.`
              : 'Item removido! Seu carrinho agora está vazio.',
          state: st,
          toolCallsExecuted,
        };
      }

      return {
        reply: res.error || 'Não encontrei esse item no seu carrinho para remover.',
        state: res.state,
        toolCallsExecuted,
      };
    }
  }

  // -------------------------------------------------------------------------
  // 4. Coleta de dados de entrega/pagamento quando já há itens no carrinho
  // -------------------------------------------------------------------------
  const hadCheckoutFieldsBefore =
    `${checkoutState.nome_cliente}|${checkoutState.endereco_entrega}|${checkoutState.forma_pagamento}`;
  extractCheckoutFields(rawText);
  const hasCheckoutFieldsNow =
    `${checkoutState.nome_cliente}|${checkoutState.endereco_entrega}|${checkoutState.forma_pagamento}`;

  if (
    hasCheckoutFieldsNow !== hadCheckoutFieldsBefore &&
    getSummary().items.length > 0
  ) {
    const sumRes = runTool('get_order_summary');
    return {
      reply: buildCheckoutPromptOrFinalSummary(sumRes.state),
      state: sumRes.state,
      toolCallsExecuted,
    };
  }

  // -------------------------------------------------------------------------
  // 5. Personalização de item JÁ EXISTENTE no carrinho
  //    Ex.: "Dessas duas de frango, deixa 1 sem purê", "Tira a farofa do bife",
  //         "quero retirar a cebola", "sem cebola, por favor"
  // -------------------------------------------------------------------------
  const matchedCatalogInTurn = CATALOG_PATTERNS.find((c) => c.keywords.test(textWithDigits));
  const refersToExistingDishInCart =
    /\b(dessa|dessas|daquela|daquelas|do\s+bife|da\s+marmita|do\s+frango|do\s+strogonoff|da\s+feijoada|da\s+omelete|do\s+peixe|no\s+bife|no\s+frango|na\s+marmita)\b/.test(
      nText
    );
  const isAddingIntent =
    /\b(quero|pedi|gostaria|me\s+ve|me\s+vê|me\s+manda|me\s+da|me\s+dá|adiciona|adicionar|vou\s+querer|manda\s+\d+|quero\s+pedir)\b/.test(
      nText
    );

  const isCustomizingExistingIntent =
    getSummary().items.length > 0 &&
    (!matchedCatalogInTurn || !isAddingIntent || refersToExistingDishInCart) &&
    (/\b(dessa|dessas|daquela|daquelas|deixa|deixar|tira|tirar|retira|retirar|remove|remover|sem\s+[a-zA-ZÀ-ÿ]+|bem\s+passad[oa]|mal\s+passad[oa]|ao\s+ponto|no\s+ponto|troca|trocar)\b/.test(
      nText
    ));

  if (isCustomizingExistingIntent) {
    const cust = extractCustomizationsFromClause(textWithDigits);

    if (cust.remover.length > 0 || cust.ponto || cust.observacao) {
      const partialQtyMatch = textWithDigits.match(/\b(?:deixa|deixar|apenas|so|só)\s+(\d+)\b/i);
      const qtdParcial = partialQtyMatch ? Number(partialQtyMatch[1]) : undefined;

      const summary = getSummary();
      let targetItemId = matchedCatalogInTurn ? matchedCatalogInTurn.id : undefined;
      let targetLineId = undefined;

      if (!targetItemId) {
        if (summary.items.length === 1) {
          targetLineId = summary.items[0].lineId;
        } else if (lastReferencedLineId) {
          targetLineId = lastReferencedLineId;
        }
      }

      const existingLines = targetLineId
        ? summary.items.filter((i) => i.lineId === targetLineId)
        : targetItemId
          ? summary.items.filter((i) => i.itemId === targetItemId)
          : [];

      const baseLine = existingLines.length === 1 && !qtdParcial ? existingLines[0] : null;
      const mergedRemover = baseLine
        ? Array.from(new Set([...(baseLine.customizacao.remover || []), ...cust.remover]))
        : cust.remover;
      const mergedPonto = cust.ponto || (baseLine ? baseLine.customizacao.ponto : undefined);
      const mergedObs = cust.observacao || (baseLine ? baseLine.customizacao.observacao : undefined);

      const res = runTool('customize_item', {
        lineId: targetLineId,
        itemId: targetItemId,
        quantidade: qtdParcial,
        remover: mergedRemover,
        ponto: mergedPonto || undefined,
        observacao: mergedObs || undefined,
      });

      if (!res.ok && res.ambiguidade) {
        pendingAmbiguity = {
          action: 'customize',
          itemId: targetItemId,
          customizacao: cust,
        };
        const opcoesTexto = (res.opcoes_no_carrinho || [])
          .map((o, idx) => `${idx + 1}ª (${o.lineId}): ${o.quantidade}x ${o.descricao}`)
          .join('\n');
        return {
          reply: `Você tem mais de uma marmita desse tipo no pedido:\n${opcoesTexto}\n\nQual delas você quer personalizar (a 1ª ou a 2ª)?`,
          state: res.state,
          toolCallsExecuted,
        };
      }

      if (res.ok) {
        const st = res.state;
        const updatedLine = st.items.find((i) => i.lineId === res.lineId) || st.items[0];
        return {
          reply: `Pronto! Atualizei sua marmita para: ${updatedLine ? updatedLine.displayLabel : 'personalizada'}. O total com entrega é ${formatarPreco(st.total)}.`,
          state: st,
          toolCallsExecuted,
        };
      }

      return {
        reply: res.error,
        state: res.state,
        toolCallsExecuted,
      };
    }
  }

  // -------------------------------------------------------------------------
  // 6. Pergunta específica sobre ingredientes/preço de um prato ("o que vem no bife?", "tem feijoada hoje?")
  // -------------------------------------------------------------------------
  const isQuestionAboutDish =
    /\b(o\s+que\s+vem|quais\s+(?:os\s+)?ingredientes|qual\s+o\s+preco|quanto\s+custa|tem\s+[a-zA-ZÀ-ÿ]+\s+hoje)\b/.test(
      nText
    ) && !isAddingIntent;

  if (isQuestionAboutDish && matchedCatalogInTurn) {
    const itemCatalog = MENU_ITEMS.find((i) => i.id === matchedCatalogInTurn.id);
    const disponiveisHoje = getMenuDoDia(new Date());
    const disponivel = disponiveisHoje.some((i) => i.id === itemCatalog.id);
    const removiveis = [
      ...itemCatalog.ingredientes.filter((i) => i.removivel).map((i) => i.nome),
      ...(itemCatalog.temperos_removiveis || []),
    ].join(', ');

    return {
      reply:
        `${itemCatalog.nome} (${formatarPreco(itemCatalog.preco_unitario)}): ${itemCatalog.descricao}\n` +
        `• Disponível hoje: ${disponivel ? 'Sim!' : 'Não (apenas aos sábados para Feijoada ou dias específicos).'}\n` +
        `• Ingredientes/temperos que você pode retirar: ${removiveis}.\n` +
        (itemCatalog.permite_ponto
          ? `• Pontos da carne aceitos: ${itemCatalog.pontos_permitidos.join(', ')}.`
          : '• Este prato não possui escolha de ponto de carne.'),
      state: getSummary(),
      toolCallsExecuted,
    };
  }

  // -------------------------------------------------------------------------
  // 7. Adição de itens ao carrinho
  // -------------------------------------------------------------------------
  const clauses = textWithDigits.split(
    /(?:,|;|\be\s+)(?=(?:quero\s+|mais\s+)?(?:\d+\s+)?(?:marmitas?\s+(?:de\s+)?)?(?:bifes?|frangos?|strogonoff|estrogonofe|feijoadas?|omeletes?|peixes?|tilapias?|outr[oa]\b))/i
  );

  const addedDescriptions = [];
  const errorDescriptions = [];
  let lastMatchedItemIdInSentence = null;

  for (const clause of clauses) {
    const cust = extractCustomizationsFromClause(clause);
    let matchedInClause = false;

    for (const entry of CATALOG_PATTERNS) {
      const m = clause.match(entry.qtyRegex);
      if (m) {
        matchedInClause = true;
        lastMatchedItemIdInSentence = entry.id;
        const qtd = m[1] ? Number(m[1]) : 1;

        const res = runTool('add_item', {
          itemId: entry.id,
          quantidade: qtd,
          remover: cust.remover.length > 0 ? cust.remover : undefined,
          ponto: cust.ponto,
          observacao: cust.observacao,
        });

        if (res.ok) {
          const line =
            res.state.items.find((i) => i.lineId === res.lineId) ||
            res.state.items[res.state.items.length - 1];
          addedDescriptions.push(`${qtd}x ${line ? line.displayLabel : entry.id}`);
        } else if (res.error) {
          errorDescriptions.push(res.error);
        }
      }
    }

    if (
      !matchedInClause &&
      lastMatchedItemIdInSentence &&
      (cust.remover.length > 0 || cust.ponto) &&
      /\b(outr[oa]|mais\s+\d+|\bsendo\s+1)\b/i.test(clause)
    ) {
      const res = runTool('add_item', {
        itemId: lastMatchedItemIdInSentence,
        quantidade: 1,
        remover: cust.remover.length > 0 ? cust.remover : undefined,
        ponto: cust.ponto,
        observacao: cust.observacao,
      });
      if (res.ok) {
        const line =
          res.state.items.find((i) => i.lineId === res.lineId) ||
          res.state.items[res.state.items.length - 1];
        addedDescriptions.push(`1x ${line ? line.displayLabel : lastMatchedItemIdInSentence}`);
      } else if (res.error) {
        errorDescriptions.push(res.error);
      }
    }
  }

  if (
    addedDescriptions.length === 0 &&
    errorDescriptions.length === 0 &&
    isAddingIntent
  ) {
    const menuRes = runTool('get_menu');
    const disponiveisNomes = menuRes.itens_disponiveis_hoje
      .map((i) => `${i.nome} (${i.preco_formatado})`)
      .join(', ');
    return {
      reply:
        `Esse item não faz parte do nosso cardápio de hoje. 😊\n` +
        `Hoje temos disponíveis: ${disponiveisNomes}.\n` +
        `Qual dessas marmitas você gostaria de pedir?`,
      state: getSummary(),
      toolCallsExecuted,
    };
  }

  if (addedDescriptions.length > 0 || errorDescriptions.length > 0) {
    const sumRes = runTool('get_order_summary');
    const st = sumRes.state;
    const msgParts = [];

    if (addedDescriptions.length > 0) {
      msgParts.push(`Anotei no seu pedido: ${addedDescriptions.join('; ')}.`);
    }
    if (errorDescriptions.length > 0) {
      msgParts.push(errorDescriptions.join('\n'));
    }
    if (st.items.length > 0) {
      msgParts.push(
        `Subtotal: ${formatarPreco(st.subtotal)} | Taxa de entrega: ${formatarPreco(st.taxa_entrega)} | Total com entrega: ${formatarPreco(st.total)}.\n` +
          `Deseja adicionar ou personalizar mais alguma marmita, ou quer informar seu nome, endereço e forma de pagamento para fechar o pedido?`
      );
    }

    return {
      reply: msgParts.join('\n\n'),
      state: st,
      toolCallsExecuted,
    };
  }

  // -------------------------------------------------------------------------
  // 8. Consulta de Total / Resumo / Fechar Pedido
  // -------------------------------------------------------------------------
  if (/\b(total|conta|fechar|finalizar|resumo|quanto\s+fica|quanto\s+deu|valor\s+do\s+pedido|concluir)\b/.test(nText)) {
    const sumRes = runTool('get_order_summary');
    const st = sumRes.state;

    if (st.items.length === 0) {
      return {
        reply: `Seu carrinho ainda está vazio! A taxa de entrega fixa é ${formatarPreco(DELIVERY_FEE)}. Qual marmita do cardápio de hoje você gostaria de pedir?`,
        state: st,
        toolCallsExecuted,
      };
    }

    return {
      reply: buildCheckoutPromptOrFinalSummary(st),
      state: st,
      toolCallsExecuted,
    };
  }

  // -------------------------------------------------------------------------
  // 9. Saudação / Cardápio do Dia (padrão)
  // -------------------------------------------------------------------------
  const menuRes = runTool('get_menu');
  const opcoes = menuRes.itens_disponiveis_hoje
    .map((i) => {
      const pontos = i.permite_ponto ? ` [Pontos: ${i.pontos_permitidos.join(', ')}]` : '';
      return `• ${i.nome}: ${i.preco_formatado} — ${i.descricao}${pontos}`;
    })
    .join('\n');

  return {
    reply:
      `Olá! Aqui é o Carlão! Confira as marmitas disponíveis hoje (${menuRes.dia_semana}):\n` +
      `${opcoes}\n\n` +
      `Taxa de entrega fixa: ${menuRes.taxa_entrega_formatada}.\n` +
      `Você pode pedir em texto livre e personalizar (ex.: "Quero 2 marmitas de bife acebolado sem cebola ao ponto"). O que vamos pedir hoje?`,
    state: getSummary(),
    toolCallsExecuted,
  };
}

/**
 * Envia a mensagem do usuário ao agente local passando pelas 4 camadas de guardrails.
 * Zero dependência de LLM, zero API Key e zero requisições de rede.
 *
 * @param {string} userText
 * @param {(state: object) => void} [onCartUpdate]
 * @returns {Promise<{ reply: string, state: object, toolCallsExecuted: Array<object>, confirmedOrder?: object | null, blockedByGuardrail?: boolean }>}
 */
export async function sendMessageToAgent(userText, onCartUpdate) {
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

  const localResult = processLocalConversationTurn(
    inputValidation.sanitizedText,
    onCartUpdate
  );
  const confirmedReceipt = getLastConfirmedOrder();

  const outputCheck = validateModelOutput(localResult.reply, localResult.state, {
    confirmedReceipt,
  });

  return {
    reply: outputCheck.finalText,
    state: localResult.state,
    toolCallsExecuted: localResult.toolCallsExecuted,
    confirmedOrder: confirmedReceipt,
    blockedByGuardrail: !outputCheck.safe,
    guardrailReason: outputCheck.reason,
  };
}
