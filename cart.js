/**
 * js/cart.js
 * Motor determinístico de carrinho e cálculo de pedido.
 * Zero dependência de LLM: todos os preços, subtotais, taxa de entrega e total
 * são calculados exclusivamente por código JavaScript determinístico.
 */

import { DELIVERY_FEE } from './config.js';
import { MENU_ITEMS, getMenuDoDia } from './menu.js';

/**
 * Arredonda valores monetários para 2 casas decimais evitando imprecisão de ponto flutuante.
 * @param {number} valor
 * @returns {number}
 */
function roundCurrency(valor) {
  return Math.round((Number(valor) + Number.EPSILON) * 100) / 100;
}

/**
 * Normaliza texto para comparação insensível a maiúsculas/minúsculas, acentos e espaços extras.
 * @param {string} texto
 * @returns {string}
 */
function normalizarTexto(texto) {
  return String(texto || '')
    .trim()
    .toLowerCase();
}

/**
 * Remove acentos para comparação flexível de termos em linguagem natural.
 * @param {string} texto
 * @returns {string}
 */
function normalizarSemAcento(texto) {
  return normalizarTexto(texto)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Normaliza variações em linguagem natural de ponto da carne
 * (ex.: "bem passada" -> "bem passado", "mal passada" -> "mal passado", "no ponto" -> "ao ponto").
 * @param {string} pontoBruto
 * @returns {string}
 */
function normalizarPontoCarne(pontoBruto) {
  const limpo = normalizarSemAcento(pontoBruto)
    .replace(/^carne\s+/, '')
    .replace(/^ponto\s+/, '')
    .trim();

  if (
    limpo === 'mal passada' ||
    limpo === 'mal passado' ||
    limpo === 'malpassada' ||
    limpo === 'malpassado'
  ) {
    return 'mal passado';
  }
  if (limpo === 'ao ponto' || limpo === 'no ponto' || limpo === 'ponto normal') {
    return 'ao ponto';
  }
  if (
    limpo === 'bem passada' ||
    limpo === 'bem passado' ||
    limpo === 'bempassada' ||
    limpo === 'bempassado'
  ) {
    return 'bem passado';
  }
  return normalizarTexto(pontoBruto);
}

/**
 * Lista todos os itens (ingredientes + temperos) que podem ser removidos de um prato.
 * @param {object} menuItem
 * @returns {string[]}
 */
export function listarAlternativasRemoviveis(menuItem) {
  const ingRemoviveis = (menuItem.ingredientes || [])
    .filter((i) => i.removivel)
    .map((i) => i.nome);
  const tempRemoviveis = menuItem.temperos_removiveis || [];
  return [...ingRemoviveis, ...tempRemoviveis];
}

// Palavras funcionais que jamais devem fazer match parcial com nomes de ingredientes
const STOPWORDS_INGREDIENTES = new Set([
  'a',
  'o',
  'os',
  'as',
  'e',
  'de',
  'do',
  'da',
  'dos',
  'das',
  'no',
  'na',
  'em',
  'um',
  'uma',
  'por',
  'com',
  'sem',
  'pra',
  'pro',
  'para',
  'que',
  'ele',
  'ela',
  'isso',
  'tira',
  'tirar',
  'retira',
  'retirar',
  'remove',
  'remover',
  'marmita',
  'prato',
  'favor',
]);

/**
 * Verifica se um termo de busca casa com uma palavra inteira dentro do nome do ingrediente.
 * Evita que substrings curtas (como "a" ou "ar") casem acidentalmente com "arroz branco" ou "farofa".
 *
 * @param {string} nomeIngredienteNorm - Nome do ingrediente sem acento (ex.: "arroz branco")
 * @param {string} termoNorm - Termo buscado sem acento (ex.: "cebola" ou "arroz")
 * @returns {boolean}
 */
function casaPalavraDoIngrediente(nomeIngredienteNorm, termoNorm) {
  if (!termoNorm || termoNorm.length < 3) return false;
  if (nomeIngredienteNorm === termoNorm) return true;

  // Se o termo tem múltiplas palavras (ex.: "batata frita"), verifica inclusão exata
  if (termoNorm.includes(' ')) {
    return (
      nomeIngredienteNorm.includes(termoNorm) ||
      termoNorm.includes(nomeIngredienteNorm)
    );
  }

  // Compara palavra por palavra do nome do ingrediente
  const palavrasDoIngrediente = nomeIngredienteNorm.split(/[\s-]+/).filter(Boolean);
  return palavrasDoIngrediente.some(
    (palavra) =>
      palavra === termoNorm ||
      // Aceita plural/singular simples (ex.: "ovos" <-> "ovo", "batatas" <-> "batata")
      palavra.replace(/s$/, '') === termoNorm.replace(/s$/, '')
  );
}

/**
 * Localiza um ingrediente ou tempero no prato aceitando variações naturais
 * (ex.: "feijão" -> "feijão carioca", "couve" -> "couve refogada", "fritas" -> "batata frita"),
 * mas exigindo correspondência por palavra inteira para nunca remover componentes errados.
 *
 * @param {object} menuItem
 * @param {string} termoBruto
 * @returns {{ tipo: 'ingrediente' | 'tempero' | null, item: object | string | null }}
 */
function encontrarIngredienteOuTempero(menuItem, termoBruto) {
  let alvo = normalizarSemAcento(termoBruto)
    .replace(
      /^(?:sem|tirar|tira|retirar|retira|remover|remove|excluir)\s+/i,
      ''
    )
    .replace(/^(?:o|a|os|as|um|uma|de|do|da|dos|das)\s+/i, '')
    .trim();

  if (!alvo || alvo.length < 3 || STOPWORDS_INGREDIENTES.has(alvo)) {
    return { tipo: null, item: null };
  }

  // Sinônimos comuns em linguagem natural
  const mapaSinonimos = {
    fritas: 'batata frita',
    frita: 'batata frita',
    batatas: 'batata',
    pure: 'pure de batata',
    couve: 'couve refogada',
    feijao: 'feijao carioca',
    arroz: 'arroz',
    pimenta: 'pimenta',
    bife: 'bife bovino',
    carne: 'bife bovino',
    frango: 'file de frango',
    peixe: 'file de tilapia empanado',
    tilapia: 'file de tilapia empanado',
    ovo: 'ovos caipiras',
    ovos: 'ovos caipiras',
    salada: 'salada',
    queijo: 'queijo minas',
    legume: 'legumes no vapor',
    legumes: 'legumes no vapor',
    pirao: 'pirao de peixe',
  };

  const buscaExpandida = mapaSinonimos[alvo] || alvo;

  // 1. Busca exata em ingredientes
  const ingExato = menuItem.ingredientes.find(
    (ing) =>
      normalizarSemAcento(ing.nome) === alvo ||
      normalizarSemAcento(ing.nome) === buscaExpandida
  );
  if (ingExato) return { tipo: 'ingrediente', item: ingExato };

  // 2. Busca exata em temperos removíveis
  const tempExato = (menuItem.temperos_removiveis || []).find(
    (temp) =>
      normalizarSemAcento(temp) === alvo ||
      normalizarSemAcento(temp) === buscaExpandida
  );
  if (tempExato) return { tipo: 'tempero', item: tempExato };

  // 3. Busca por palavra inteira nos ingredientes do prato
  const ingPorPalavra = menuItem.ingredientes.find((ing) => {
    const nomeNorm = normalizarSemAcento(ing.nome);
    return (
      casaPalavraDoIngrediente(nomeNorm, alvo) ||
      casaPalavraDoIngrediente(nomeNorm, buscaExpandida)
    );
  });
  if (ingPorPalavra) return { tipo: 'ingrediente', item: ingPorPalavra };

  // 4. Busca por palavra inteira nos temperos removíveis do prato
  const tempPorPalavra = (menuItem.temperos_removiveis || []).find((temp) => {
    const tempNorm = normalizarSemAcento(temp);
    return (
      casaPalavraDoIngrediente(tempNorm, alvo) ||
      casaPalavraDoIngrediente(tempNorm, buscaExpandida)
    );
  });
  if (tempPorPalavra) return { tipo: 'tempero', item: tempPorPalavra };

  return { tipo: null, item: null };
}

/**
 * Gera uma chave canônica da customização para identificar se duas linhas possuem
 * exatamente a mesma personalização.
 * @param {{ remover: string[], ponto: string | null, observacao: string }} customizacao
 * @returns {string}
 */
function gerarChaveCustomizacao(customizacao) {
  const removidosOrdenados = [...(customizacao.remover || [])]
    .map(normalizarTexto)
    .filter(Boolean)
    .sort();
  const pontoNorm = customizacao.ponto ? normalizarTexto(customizacao.ponto) : '';
  const obsNorm = normalizarTexto(customizacao.observacao || '');
  return JSON.stringify({
    remover: removidosOrdenados,
    ponto: pontoNorm,
    observacao: obsNorm,
  });
}

/**
 * Formata as customizações em texto conciso para exibição no painel do pedido
 * (ex.: "sem cebola, ao ponto").
 * @param {{ remover: string[], ponto: string | null, observacao: string }} customizacao
 * @returns {string}
 */
export function formatarNotasCustomizacao(customizacao) {
  const partes = [];
  if (customizacao.remover && customizacao.remover.length > 0) {
    for (const itemRemovido of customizacao.remover) {
      partes.push(`sem ${itemRemovido}`);
    }
  }
  if (customizacao.ponto) {
    partes.push(customizacao.ponto);
  }
  if (customizacao.observacao) {
    partes.push(customizacao.observacao);
  }
  return partes.join(', ');
}

/**
 * Valida objeto de customização contra as regras do item no cardápio.
 * Quando uma personalização é impossível, retorna a explicação e as alternativas válidas.
 *
 * @param {object} menuItem
 * @param {{ remover?: string[], ponto?: string | null, observacao?: string }} customizacaoInput
 * @returns {{ ok: boolean, error: string | null, alternativas?: object, customizacaoValidada?: { remover: string[], ponto: string | null, observacao: string } }}
 */
function validarCustomizacaoParaItem(menuItem, customizacaoInput = {}) {
  if (customizacaoInput === null || typeof customizacaoInput !== 'object') {
    return {
      ok: false,
      error: 'Formato de customização inválido.',
    };
  }

  const opcoesRemoviveis = listarAlternativasRemoviveis(menuItem);
  const removerInput = Array.isArray(customizacaoInput.remover)
    ? customizacaoInput.remover
    : [];
  const removidosValidos = [];

  for (const nomeBruto of removerInput) {
    const textoLimpo = String(nomeBruto || '').trim();
    if (!textoLimpo) continue;

    const encontrado = encontrarIngredienteOuTempero(menuItem, textoLimpo);

    if (encontrado.tipo === 'ingrediente') {
      const ing = encontrado.item;
      if (!ing.removivel) {
        return {
          ok: false,
          error: `O ingrediente "${ing.nome}" é base do prato "${menuItem.nome}" e não pode ser removido. Alternativas que podem ser removidas neste prato: ${opcoesRemoviveis.join(', ')}.`,
          alternativas: {
            removiveis_permitidos: opcoesRemoviveis,
            pontos_permitidos: menuItem.pontos_permitidos,
          },
        };
      }
      if (!removidosValidos.includes(ing.nome)) {
        removidosValidos.push(ing.nome);
      }
      continue;
    }

    if (encontrado.tipo === 'tempero') {
      const tempero = encontrado.item;
      if (!removidosValidos.includes(tempero)) {
        removidosValidos.push(tempero);
      }
      continue;
    }

    return {
      ok: false,
      error: `O ingrediente ou tempero "${textoLimpo}" não faz parte ou não é removível em "${menuItem.nome}". Itens que você pode remover neste prato: ${opcoesRemoviveis.join(', ')}.`,
      alternativas: {
        removiveis_permitidos: opcoesRemoviveis,
        pontos_permitidos: menuItem.pontos_permitidos,
      },
    };
  }

  // Validação do ponto da carne
  let pontoValidado = null;
  if (
    customizacaoInput.ponto !== undefined &&
    customizacaoInput.ponto !== null &&
    String(customizacaoInput.ponto).trim() !== ''
  ) {
    if (!menuItem.permite_ponto) {
      return {
        ok: false,
        error: `O item "${menuItem.nome}" não permite escolha de ponto de cozimento. Pratos que permitem ponto hoje: Bife Acebolado e Frango Grelhado.`,
        alternativas: {
          permite_ponto: false,
          pontos_permitidos: [],
          removiveis_permitidos: opcoesRemoviveis,
        },
      };
    }

    const pontoAlvo = normalizarPontoCarne(customizacaoInput.ponto);
    const pontoPermitido = (menuItem.pontos_permitidos || []).find(
      (p) => normalizarTexto(p) === pontoAlvo
    );

    if (!pontoPermitido) {
      return {
        ok: false,
        error: `Ponto "${customizacaoInput.ponto}" inválido para "${menuItem.nome}". Pontos permitidos para este prato: ${menuItem.pontos_permitidos.join(', ')}.`,
        alternativas: {
          permite_ponto: true,
          pontos_permitidos: menuItem.pontos_permitidos,
          removiveis_permitidos: opcoesRemoviveis,
        },
      };
    }
    pontoValidado = pontoPermitido;
  }

  const observacaoValidada = customizacaoInput.observacao
    ? String(customizacaoInput.observacao).trim().slice(0, 200)
    : '';

  return {
    ok: true,
    error: null,
    customizacaoValidada: {
      remover: removidosValidos,
      ponto: pontoValidado,
      observacao: observacaoValidada,
    },
  };
}

// Estado interno do carrinho
let cartLines = [];
let nextLineCounter = 1;
let referenceDateProvider = () => new Date();

/**
 * Permite definir a data de referência (útil para testes determinísticos de dia da semana).
 * @param {Date | (() => Date)} dateOrFn
 */
export function setCartReferenceDate(dateOrFn) {
  if (typeof dateOrFn === 'function') {
    referenceDateProvider = dateOrFn;
  } else if (dateOrFn instanceof Date) {
    referenceDateProvider = () => dateOrFn;
  } else {
    referenceDateProvider = () => new Date();
  }
}

/**
 * Limpa todas as linhas do carrinho e reinicia o contador.
 * @returns {{ ok: boolean, error: null, state: object }}
 */
export function clearCart() {
  cartLines = [];
  nextLineCounter = 1;
  return {
    ok: true,
    error: null,
    state: getSummary(),
  };
}

/**
 * Retorna o resumo completo e determinístico do pedido atual.
 * @returns {{
 *   items: Array<object>,
 *   itens: Array<object>,
 *   subtotal: number,
 *   taxa_entrega: number,
 *   deliveryFee: number,
 *   total: number
 * }}
 */
export function getSummary() {
  const items = cartLines.map((line) => {
    const lineSubtotal = roundCurrency(line.preco_unitario * line.quantidade);
    const customizacaoCopia = {
      remover: [...line.customizacao.remover],
      ponto: line.customizacao.ponto,
      observacao: line.customizacao.observacao,
    };
    const notes = formatarNotasCustomizacao(customizacaoCopia);
    const displayLabel = notes ? `${line.nome} — ${notes}` : line.nome;

    return {
      lineId: line.lineId,
      itemId: line.itemId,
      nome: line.nome,
      name: line.nome,
      displayLabel,
      quantidade: line.quantidade,
      quantity: line.quantidade,
      preco_unitario: line.preco_unitario,
      unitPrice: line.preco_unitario,
      subtotal_item: lineSubtotal,
      lineSubtotal,
      customizacao: customizacaoCopia,
      notes,
    };
  });

  const subtotal = roundCurrency(
    items.reduce((acc, item) => acc + item.lineSubtotal, 0)
  );
  const taxaEntrega = roundCurrency(DELIVERY_FEE);
  const total = subtotal > 0 ? roundCurrency(subtotal + taxaEntrega) : 0;

  return {
    items,
    itens: items,
    subtotal,
    taxa_entrega: taxaEntrega,
    deliveryFee: taxaEntrega,
    total,
  };
}

/**
 * Adiciona um item do cardápio do dia ao carrinho, opcionalmente já com customizações.
 * Se já houver uma linha do mesmo item com exatamente a mesma customização,
 * soma a quantidade; caso contrário, cria uma linha separada.
 *
 * @param {string} itemId
 * @param {number} qtd
 * @param {{ remover?: string[], ponto?: string | null, observacao?: string }} [customizacaoOpcional]
 * @returns {{ ok: boolean, error: string | null, state: object, lineId?: string, alternativas?: object }}
 */
export function addItem(itemId, qtd, customizacaoOpcional = undefined) {
  if (!itemId || typeof itemId !== 'string') {
    return {
      ok: false,
      error: 'O identificador do item (itemId) é obrigatório.',
      state: getSummary(),
    };
  }

  if (!Number.isInteger(qtd) || qtd < 1 || qtd > 20) {
    return {
      ok: false,
      error: 'A quantidade deve ser um número inteiro entre 1 e 20.',
      state: getSummary(),
    };
  }

  const itemNoCatalogo = MENU_ITEMS.find((i) => i.id === itemId);
  if (!itemNoCatalogo) {
    return {
      ok: false,
      error: `O item "${itemId}" não existe no cardápio.`,
      state: getSummary(),
    };
  }

  const disponiveisHoje = getMenuDoDia(referenceDateProvider());
  const itemHoje = disponiveisHoje.find((i) => i.id === itemId);
  if (!itemHoje) {
    return {
      ok: false,
      error: `O item "${itemNoCatalogo.nome}" não está disponível no cardápio de hoje. Opções disponíveis hoje: ${disponiveisHoje.map((i) => i.nome).join(', ')}.`,
      state: getSummary(),
    };
  }

  let customizacaoInicial = {
    remover: [],
    ponto: null,
    observacao: '',
  };

  if (customizacaoOpcional !== undefined) {
    const validacao = validarCustomizacaoParaItem(itemHoje, customizacaoOpcional);
    if (!validacao.ok) {
      return {
        ok: false,
        error: validacao.error,
        alternativas: validacao.alternativas,
        state: getSummary(),
      };
    }
    customizacaoInicial = validacao.customizacaoValidada;
  }

  const chaveCustomizacao = gerarChaveCustomizacao(customizacaoInicial);

  const linhaExistente = cartLines.find(
    (line) =>
      line.itemId === itemHoje.id &&
      gerarChaveCustomizacao(line.customizacao) === chaveCustomizacao
  );

  if (linhaExistente) {
    const novaQtd = linhaExistente.quantidade + qtd;
    if (novaQtd > 20) {
      return {
        ok: false,
        error: `A quantidade total de "${itemHoje.nome}" na mesma linha não pode ultrapassar 20 unidades (atual: ${linhaExistente.quantidade}).`,
        state: getSummary(),
      };
    }
    linhaExistente.quantidade = novaQtd;
    return {
      ok: true,
      error: null,
      lineId: linhaExistente.lineId,
      state: getSummary(),
    };
  }

  const novaLinha = {
    lineId: `line-${nextLineCounter++}`,
    itemId: itemHoje.id,
    nome: itemHoje.nome,
    preco_unitario: itemHoje.preco_unitario,
    quantidade: qtd,
    customizacao: customizacaoInicial,
  };

  cartLines.push(novaLinha);

  return {
    ok: true,
    error: null,
    lineId: novaLinha.lineId,
    state: getSummary(),
  };
}

/**
 * Remove parcial ou totalmente a quantidade de uma linha do carrinho.
 * @param {string} lineId
 * @param {number} [qtd]
 * @returns {{ ok: boolean, error: string | null, state: object }}
 */
export function removeItem(lineId, qtd) {
  const idx = cartLines.findIndex((line) => line.lineId === lineId);
  if (idx === -1) {
    return {
      ok: false,
      error: `A linha do pedido "${lineId}" não foi encontrada no carrinho.`,
      state: getSummary(),
    };
  }

  const linha = cartLines[idx];
  const qtdParaRemover = qtd === undefined ? linha.quantidade : qtd;

  if (!Number.isInteger(qtdParaRemover) || qtdParaRemover < 1 || qtdParaRemover > 20) {
    return {
      ok: false,
      error: 'A quantidade a remover deve ser um número inteiro entre 1 e 20.',
      state: getSummary(),
    };
  }

  if (qtdParaRemover > linha.quantidade) {
    return {
      ok: false,
      error: `Não é possível remover ${qtdParaRemover} unidade(s) pois a linha possui apenas ${linha.quantidade}.`,
      state: getSummary(),
    };
  }

  if (qtdParaRemover === linha.quantidade) {
    cartLines.splice(idx, 1);
  } else {
    linha.quantidade -= qtdParaRemover;
  }

  return {
    ok: true,
    error: null,
    state: getSummary(),
  };
}

/**
 * Personaliza uma linha existente do pedido (totalmente ou dividindo parte da quantidade em nova linha).
 *
 * @param {string} lineId
 * @param {{ remover?: string[], ponto?: string | null, observacao?: string }} customizacao
 * @param {number} [qtdParcial]
 * @returns {{ ok: boolean, error: string | null, state: object, lineId?: string, alternativas?: object }}
 */
export function customizeItem(lineId, customizacao = {}, qtdParcial = undefined) {
  const idx = cartLines.findIndex((line) => line.lineId === lineId);
  if (idx === -1) {
    return {
      ok: false,
      error: `A linha do pedido "${lineId}" não foi encontrada no carrinho.`,
      state: getSummary(),
    };
  }

  const linha = cartLines[idx];
  const menuItem = MENU_ITEMS.find((i) => i.id === linha.itemId);

  if (qtdParcial !== undefined && qtdParcial !== null) {
    if (!Number.isInteger(qtdParcial) || qtdParcial < 1 || qtdParcial > linha.quantidade) {
      return {
        ok: false,
        error: `A quantidade a personalizar deve ser um inteiro entre 1 e ${linha.quantidade}.`,
        state: getSummary(),
      };
    }
  }

  const validacao = validarCustomizacaoParaItem(menuItem, customizacao);
  if (!validacao.ok) {
    return {
      ok: false,
      error: validacao.error,
      alternativas: validacao.alternativas,
      state: getSummary(),
    };
  }

  const novaCustomizacao = validacao.customizacaoValidada;
  const novaChave = gerarChaveCustomizacao(novaCustomizacao);
  const qtdAlvo = qtdParcial !== undefined && qtdParcial !== null ? qtdParcial : linha.quantidade;

  if (qtdAlvo < linha.quantidade) {
    linha.quantidade -= qtdAlvo;

    const outraLinhaIgual = cartLines.find(
      (other) =>
        other.itemId === linha.itemId &&
        gerarChaveCustomizacao(other.customizacao) === novaChave
    );

    if (outraLinhaIgual) {
      outraLinhaIgual.quantidade += qtdAlvo;
      return {
        ok: true,
        error: null,
        lineId: outraLinhaIgual.lineId,
        state: getSummary(),
      };
    }

    const novaLinha = {
      lineId: `line-${nextLineCounter++}`,
      itemId: linha.itemId,
      nome: linha.nome,
      preco_unitario: linha.preco_unitario,
      quantidade: qtdAlvo,
      customizacao: novaCustomizacao,
    };
    cartLines.push(novaLinha);

    return {
      ok: true,
      error: null,
      lineId: novaLinha.lineId,
      state: getSummary(),
    };
  }

  const outraLinhaIgual = cartLines.find(
    (other, otherIdx) =>
      otherIdx !== idx &&
      other.itemId === linha.itemId &&
      gerarChaveCustomizacao(other.customizacao) === novaChave
  );

  if (outraLinhaIgual) {
    if (outraLinhaIgual.quantidade + linha.quantidade > 20) {
      return {
        ok: false,
        error: 'A unificação de linhas com a mesma customização excederia o limite de 20 unidades.',
        state: getSummary(),
      };
    }
    outraLinhaIgual.quantidade += linha.quantidade;
    cartLines.splice(idx, 1);
    return {
      ok: true,
      error: null,
      lineId: outraLinhaIgual.lineId,
      state: getSummary(),
    };
  }

  linha.customizacao = novaCustomizacao;

  return {
    ok: true,
    error: null,
    lineId: linha.lineId,
    state: getSummary(),
  };
}
