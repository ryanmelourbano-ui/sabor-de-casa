/**
 * js/tools.js
 * Declaração das ferramentas (Function Declarations para a API do Gemini)
 * e dispatcher que executa cada tool de forma determinística usando menu.js e cart.js.
 * Aplica sanitização estrita de argumentos (Camada 3 de Guardrails) e implementa
 * o fluxo completo de fechamento (get_order_summary e confirm_order).
 */

import { DELIVERY_FEE } from './config.js';
import { MENU_ITEMS, getMenuDoDia, getNomeDiaSemana, formatarPreco } from './menu.js';
import {
  addItem,
  removeItem,
  customizeItem,
  getSummary,
  listarAlternativasRemoviveis,
} from './cart.js';
import { sanitizeToolArgs } from './guardrails.js';

// Último pedido confirmado na sessão (para exibição/cópia no painel)
let lastConfirmedOrder = null;

/**
 * Retorna o último pedido confirmado na sessão atual, se houver.
 * @returns {object | null}
 */
export function getLastConfirmedOrder() {
  return lastConfirmedOrder;
}

/**
 * Limpa o registro do último pedido confirmado (usado no botão "Novo pedido").
 */
export function clearLastConfirmedOrder() {
  lastConfirmedOrder = null;
}

/**
 * Gera um número de pedido aleatório local (ex.: #PED-482910).
 * @returns {string}
 */
function gerarNumeroPedidoLocal() {
  const codigo = Math.floor(100000 + Math.random() * 900000);
  return `#PED-${codigo}`;
}

/**
 * Declarações JSON Schema das tools para envio no campo tools[].functionDeclarations do Gemini.
 */
export const GEMINI_FUNCTION_DECLARATIONS = [
  {
    name: 'get_menu',
    description:
      'Consulta o cardápio disponível hoje na marmitaria, incluindo preços unitários, ingredientes base (não removíveis), ingredientes/temperos removíveis, pontos da carne permitidos e taxa de entrega.',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
  },
  {
    name: 'add_item',
    description:
      'Adiciona uma ou mais unidades de uma marmita do cardápio de hoje ao carrinho, podendo incluir personalizações (remoção de ingredientes/temperos, ponto da carne e observação).',
    parameters: {
      type: 'OBJECT',
      properties: {
        itemId: {
          type: 'STRING',
          description:
            'ID do item no cardápio (ex.: "bife-acebolado", "frango-grelhado", "strogonoff-carne", "feijoada-completa", "omelete-vegetariana", "peixe-frito").',
        },
        quantidade: {
          type: 'INTEGER',
          description: 'Quantidade inteira de marmitas a adicionar (entre 1 e 20).',
        },
        remover: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description:
            'Lista opcional de ingredientes ou temperos removíveis que o cliente deseja retirar (ex.: ["cebola", "alho", "pimenta-do-reino", "couve refogada"]).',
        },
        ponto: {
          type: 'STRING',
          description:
            'Ponto da carne opcional, somente se o item permitir ("mal passado", "ao ponto" ou "bem passado").',
        },
        observacao: {
          type: 'STRING',
          description: 'Observação curta adicional sobre o preparo do item.',
        },
      },
      required: ['itemId', 'quantidade'],
    },
  },
  {
    name: 'customize_item',
    description:
      'Personaliza uma linha de item já existente no carrinho (remover ingredientes/temperos permitidos, definir o ponto da carne ou observação). Se houver várias linhas do mesmo item no pedido, informe o lineId exato ou pergunte ao cliente qual marmita deseja personalizar.',
    parameters: {
      type: 'OBJECT',
      properties: {
        lineId: {
          type: 'STRING',
          description:
            'Identificador exato da linha no carrinho (ex.: "line-1"). Opcional se itemId for informado e houver apenas 1 linha daquele item.',
        },
        itemId: {
          type: 'STRING',
          description:
            'ID do item caso lineId não seja especificado. Se houver mais de uma linha desse item no carrinho, a tool informará a ambiguidade.',
        },
        quantidade: {
          type: 'INTEGER',
          description:
            'Quantidade de unidades daquela linha que devem receber esta personalização (útil quando o cliente tem 2 unidades na mesma linha e quer personalizar apenas 1).',
        },
        remover: {
          type: 'ARRAY',
          items: { type: 'STRING' },
          description: 'Lista completa de ingredientes/temperos a remover nesta linha.',
        },
        ponto: {
          type: 'STRING',
          description: 'Ponto da carne desejado ("mal passado", "ao ponto" ou "bem passado").',
        },
        observacao: {
          type: 'STRING',
          description: 'Observação adicional para esta linha do pedido.',
        },
      },
    },
  },
  {
    name: 'remove_item',
    description:
      'Remove total ou parcialmente a quantidade de uma linha do pedido no carrinho.',
    parameters: {
      type: 'OBJECT',
      properties: {
        lineId: {
          type: 'STRING',
          description: 'ID da linha no carrinho (ex.: "line-1").',
        },
        itemId: {
          type: 'STRING',
          description: 'ID do item caso lineId não seja informado.',
        },
        quantidade: {
          type: 'INTEGER',
          description:
            'Quantidade inteira a remover. Se omitida, remove a linha inteira.',
        },
      },
    },
  },
  {
    name: 'get_order_summary',
    description:
      'SEMPRE chame esta ferramenta quando o cliente perguntar o valor total, pedir a conta ou quiser fechar o pedido. Retorna os itens com customizações, subtotal, taxa de entrega e total calculados pelo código.',
    parameters: {
      type: 'OBJECT',
      properties: {},
    },
  },
  {
    name: 'confirm_order',
    description:
      'Finaliza e confirma o pedido APÓS coletar nome do cliente, endereço de entrega e forma de pagamento e receber a confirmação do cliente. Gera número do pedido aleatório local e tempo estimado de entrega.',
    parameters: {
      type: 'OBJECT',
      properties: {
        nome_cliente: {
          type: 'STRING',
          description: 'Nome do cliente que receberá o pedido.',
        },
        endereco_entrega: {
          type: 'STRING',
          description: 'Endereço completo informado pelo cliente para entrega.',
        },
        forma_pagamento: {
          type: 'STRING',
          description: 'Forma de pagamento escolhida pelo cliente (ex.: PIX, Cartão, Dinheiro).',
        },
      },
      required: ['nome_cliente', 'endereco_entrega', 'forma_pagamento'],
    },
  },
];

/**
 * Resolve apelidos comuns de itemId caso o modelo envie nome parcial (ex.: "bife" -> "bife-acebolado").
 * @param {string} rawId
 * @returns {string}
 */
function resolverItemId(rawId) {
  const limpo = String(rawId || '')
    .trim()
    .toLowerCase();
  if (!limpo) return '';

  const exato = MENU_ITEMS.find((i) => i.id === limpo);
  if (exato) return exato.id;

  const porNome = MENU_ITEMS.find(
    (i) =>
      i.nome.toLowerCase() === limpo ||
      i.nome.toLowerCase().includes(limpo) ||
      i.id.includes(limpo)
  );
  return porNome ? porNome.id : limpo;
}

/**
 * Enriquecimento determinístico do state com strings já formatadas em BRL para o LLM.
 * @param {object} state
 * @returns {object}
 */
function enriquecerEstadoParaLLM(state) {
  return {
    ...state,
    subtotal_formatado: formatarPreco(state.subtotal),
    taxa_entrega_formatada: formatarPreco(state.taxa_entrega),
    total_formatado: formatarPreco(state.total),
  };
}

/**
 * Resolve o lineId alvo ou detecta ambiguidade quando há múltiplas linhas do mesmo item.
 * @param {string | undefined} lineId
 * @param {string | undefined} itemId
 * @returns {{ ok: boolean, lineId?: string, ambiguidade?: boolean, error?: string, opcoes?: Array<object> }}
 */
function resolverLinhaDoCarrinho(lineId, itemId) {
  const summary = getSummary();

  if (lineId) {
    const existe = summary.items.find((i) => i.lineId === lineId);
    if (existe) {
      return { ok: true, lineId: existe.lineId };
    }
  }

  if (itemId) {
    const idResolvido = resolverItemId(itemId);
    const linhasDoItem = summary.items.filter((i) => i.itemId === idResolvido);

    if (linhasDoItem.length === 0) {
      return {
        ok: false,
        error: `Não há nenhuma marmita "${idResolvido}" no carrinho no momento.`,
      };
    }

    if (linhasDoItem.length > 1) {
      return {
        ok: false,
        ambiguidade: true,
        error: `Existem ${linhasDoItem.length} linhas diferentes de "${linhasDoItem[0].nome}" no pedido. Pergunte ao cliente qual delas ele deseja alterar.`,
        opcoes: linhasDoItem.map((l) => ({
          lineId: l.lineId,
          quantidade: l.quantidade,
          descricao: l.displayLabel,
        })),
      };
    }

    return { ok: true, lineId: linhasDoItem[0].lineId };
  }

  if (summary.items.length === 1) {
    return { ok: true, lineId: summary.items[0].lineId };
  }

  return {
    ok: false,
    ambiguidade: summary.items.length > 1,
    error:
      summary.items.length > 1
        ? 'Há mais de uma marmita no pedido. Especifique o lineId ou pergunte ao cliente qual marmita ele deseja personalizar/remover.'
        : 'O carrinho está vazio.',
    opcoes: summary.items.map((l) => ({
      lineId: l.lineId,
      quantidade: l.quantidade,
      descricao: l.displayLabel,
    })),
  };
}

/**
 * Formata um recibo em texto puro para exibição e para o botão "Copiar pedido".
 * @param {object} summary
 * @param {object | null} confirmedInfo
 * @returns {string}
 */
export function buildOrderTextReceipt(summary, confirmedInfo = null) {
  const fonte = confirmedInfo || summary;
  if (!fonte || !Array.isArray(fonte.items) || fonte.items.length === 0) {
    return 'Pedido Sabor da Casa — Nenhum item no pedido.';
  }

  const linhasItens = fonte.items
    .map((item) => {
      const label = item.notes ? `${item.nome} — ${item.notes}` : item.nome;
      return `- ${item.quantidade}x ${label}: ${formatarPreco(item.lineSubtotal)}`;
    })
    .join('\n');

  const cabecalho = confirmedInfo
    ? `✅ PEDIDO CONFIRMADO ${confirmedInfo.numero_pedido}\n` +
      `Cliente: ${confirmedInfo.nome_cliente}\n` +
      `Endereço: ${confirmedInfo.endereco_entrega}\n` +
      `Pagamento: ${confirmedInfo.forma_pagamento}\n` +
      `Tempo estimado: ${confirmedInfo.tempo_estimado}\n`
    : `🍱 RESUMO DO PEDIDO — Sabor da Casa\n`;

  return (
    `${cabecalho}` +
    `----------------------------------------\n` +
    `Itens:\n${linhasItens}\n` +
    `----------------------------------------\n` +
    `Subtotal: ${formatarPreco(fonte.subtotal)}\n` +
    `Taxa de entrega: ${formatarPreco(fonte.taxa_entrega)}\n` +
    `Total: ${formatarPreco(fonte.total)}`
  );
}

/**
 * Executa uma chamada de ferramenta (functionCall) solicitada pelo LLM.
 * CAMADA 3: Todos os argumentos passam por sanitizeToolArgs() para descartar
 * qualquer tentativa de injetar preço, desconto ou taxa de entrega.
 *
 * @param {string} name - Nome da tool
 * @param {object} rawArgs - Argumentos brutos enviados pelo LLM
 * @returns {object} Resultado estruturado para envio em functionResponse
 */
export function executeToolCall(name, rawArgs = {}) {
  const args = sanitizeToolArgs(name, rawArgs);

  switch (name) {
    case 'get_menu': {
      const hoje = new Date();
      const itens = getMenuDoDia(hoje).map((item) => ({
        id: item.id,
        nome: item.nome,
        descricao: item.descricao,
        preco_unitario: item.preco_unitario,
        preco_formatado: formatarPreco(item.preco_unitario),
        ingredientes_base_nao_removiveis: item.ingredientes
          .filter((ing) => !ing.removivel)
          .map((ing) => ing.nome),
        ingredientes_removiveis: item.ingredientes
          .filter((ing) => ing.removivel)
          .map((ing) => ing.nome),
        temperos_removiveis: item.temperos_removiveis,
        todos_removiveis: listarAlternativasRemoviveis(item),
        permite_ponto: item.permite_ponto,
        pontos_permitidos: item.pontos_permitidos,
      }));

      return {
        ok: true,
        dia_semana: getNomeDiaSemana(hoje),
        taxa_entrega: DELIVERY_FEE,
        taxa_entrega_formatada: formatarPreco(DELIVERY_FEE),
        itens_disponiveis_hoje: itens,
        state: enriquecerEstadoParaLLM(getSummary()),
      };
    }

    case 'add_item': {
      const itemIdResolvido = resolverItemId(args.itemId);
      const qtd = Number(args.quantidade);
      const temCustomizacao =
        (Array.isArray(args.remover) && args.remover.length > 0) ||
        Boolean(args.ponto) ||
        Boolean(args.observacao);

      const customizacao = temCustomizacao
        ? {
            remover: Array.isArray(args.remover) ? args.remover : [],
            ponto: args.ponto || null,
            observacao: args.observacao || '',
          }
        : undefined;

      const resultado = addItem(itemIdResolvido, qtd, customizacao);
      return {
        ok: resultado.ok,
        error: resultado.error,
        alternativas: resultado.alternativas || null,
        lineId: resultado.lineId || null,
        state: enriquecerEstadoParaLLM(resultado.state),
      };
    }

    case 'customize_item': {
      const resolucao = resolverLinhaDoCarrinho(args.lineId, args.itemId);
      if (!resolucao.ok) {
        return {
          ok: false,
          ambiguidade: Boolean(resolucao.ambiguidade),
          error: resolucao.error,
          opcoes_no_carrinho: resolucao.opcoes || [],
          state: enriquecerEstadoParaLLM(getSummary()),
        };
      }

      const qtdParcial =
        args.quantidade !== undefined && args.quantidade !== null
          ? Number(args.quantidade)
          : undefined;

      const resultado = customizeItem(
        resolucao.lineId,
        {
          remover: Array.isArray(args.remover) ? args.remover : [],
          ponto: args.ponto || null,
          observacao: args.observacao || '',
        },
        qtdParcial
      );
      return {
        ok: resultado.ok,
        error: resultado.error,
        alternativas: resultado.alternativas || null,
        lineId: resultado.lineId || resolucao.lineId,
        state: enriquecerEstadoParaLLM(resultado.state),
      };
    }

    case 'remove_item': {
      const resolucao = resolverLinhaDoCarrinho(args.lineId, args.itemId);
      if (!resolucao.ok) {
        return {
          ok: false,
          ambiguidade: Boolean(resolucao.ambiguidade),
          error: resolucao.error,
          opcoes_no_carrinho: resolucao.opcoes || [],
          state: enriquecerEstadoParaLLM(getSummary()),
        };
      }

      const qtd =
        args.quantidade !== undefined && args.quantidade !== null
          ? Number(args.quantidade)
          : undefined;
      const resultado = removeItem(resolucao.lineId, qtd);
      return {
        ok: resultado.ok,
        error: resultado.error,
        state: enriquecerEstadoParaLLM(resultado.state),
      };
    }

    case 'get_order_summary': {
      const state = getSummary();
      const enriched = enriquecerEstadoParaLLM(state);
      return {
        ok: true,
        error: null,
        resumo_texto: buildOrderTextReceipt(state),
        state: enriched,
      };
    }

    case 'confirm_order': {
      const state = getSummary();
      if (state.items.length === 0) {
        return {
          ok: false,
          error: 'O carrinho está vazio. Adicione pelo menos uma marmita antes de confirmar.',
          state: enriquecerEstadoParaLLM(state),
        };
      }

      const nomeCliente = String(args.nome_cliente || '').trim();
      if (nomeCliente.length < 2) {
        return {
          ok: false,
          error: 'Por favor, informe o nome do cliente (mínimo 2 caracteres) para confirmar o pedido.',
          state: enriquecerEstadoParaLLM(state),
        };
      }

      const endereco = String(args.endereco_entrega || '').trim();
      if (endereco.length < 5) {
        return {
          ok: false,
          error: 'Por favor, informe o endereço completo de entrega (mínimo 5 caracteres).',
          state: enriquecerEstadoParaLLM(state),
        };
      }

      const formaPagamento = String(args.forma_pagamento || '').trim();
      if (formaPagamento.length < 2) {
        return {
          ok: false,
          error: 'Por favor, informe a forma de pagamento (ex.: PIX, Cartão ou Dinheiro).',
          state: enriquecerEstadoParaLLM(state),
        };
      }

      const numeroPedido = gerarNumeroPedidoLocal();
      const tempoEstimado = '35 a 50 minutos';
      const estadoEnriquecido = enriquecerEstadoParaLLM(state);

      const reciboConfirmado = {
        ...estadoEnriquecido,
        pedido_confirmado: true,
        numero_pedido: numeroPedido,
        tempo_estimado: tempoEstimado,
        nome_cliente: nomeCliente,
        endereco_entrega: endereco,
        forma_pagamento: formaPagamento,
      };
      reciboConfirmado.texto_resumo = buildOrderTextReceipt(state, reciboConfirmado);

      lastConfirmedOrder = reciboConfirmado;

      return {
        ok: true,
        error: null,
        pedido_confirmado: true,
        numero_pedido: numeroPedido,
        tempo_estimado: tempoEstimado,
        nome_cliente: nomeCliente,
        endereco_entrega: endereco,
        forma_pagamento: formaPagamento,
        resumo_fechado: reciboConfirmado,
        state: estadoEnriquecido,
      };
    }

    default:
      return {
        ok: false,
        error: `Ferramenta desconhecida: "${name}".`,
        state: enriquecerEstadoParaLLM(getSummary()),
      };
  }
}
