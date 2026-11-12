/**
 * js/menu.js
 * Catálogo determinístico de marmitas por dia da semana e utilitários de formatação.
 * Os preços são sempre números em BRL e nunca devem ser inventados pelo LLM.
 */

export const DIAS_SEMANA = Object.freeze([
  'Domingo',
  'Segunda-feira',
  'Terça-feira',
  'Quarta-feira',
  'Quinta-feira',
  'Sexta-feira',
  'Sábado',
]);

export const PONTOS_PADRAO = Object.freeze([
  'mal passado',
  'ao ponto',
  'bem passado',
]);

/**
 * Cardápio base da marmitaria.
 * dias_disponiveis: 0 = Domingo, 1 = Segunda, ..., 6 = Sábado.
 */
export const MENU_ITEMS = Object.freeze([
  {
    id: 'bife-acebolado',
    nome: 'Bife Acebolado',
    descricao: 'Marmita com bife bovino acebolado, arroz branco, feijão carioca, farofa crocante e batata frita.',
    preco_unitario: 24.90,
    ingredientes: [
      { nome: 'bife bovino', removivel: false },
      { nome: 'arroz branco', removivel: true },
      { nome: 'feijão carioca', removivel: true },
      { nome: 'cebola', removivel: true },
      { nome: 'farofa', removivel: true },
      { nome: 'batata frita', removivel: true },
    ],
    temperos_removiveis: ['alho', 'pimenta-do-reino', 'sal', 'cheiro-verde'],
    permite_ponto: true,
    pontos_permitidos: [...PONTOS_PADRAO],
    dias_disponiveis: [0, 1, 2, 3, 4, 5, 6],
  },
  {
    id: 'frango-grelhado',
    nome: 'Frango Grelhado',
    descricao: 'Filé de peito de frango grelhado na chapa, arroz branco, feijão carioca, purê de batata e salada de alface com tomate.',
    preco_unitario: 21.90,
    ingredientes: [
      { nome: 'filé de frango', removivel: false },
      { nome: 'arroz branco', removivel: true },
      { nome: 'feijão carioca', removivel: true },
      { nome: 'purê de batata', removivel: true },
      { nome: 'alface', removivel: true },
      { nome: 'tomate', removivel: true },
    ],
    temperos_removiveis: ['alho', 'orégano', 'pimenta-do-reino', 'sal', 'ervas finas'],
    permite_ponto: true,
    pontos_permitidos: ['ao ponto', 'bem passado'],
    dias_disponiveis: [0, 1, 2, 3, 4, 5, 6],
  },
  {
    id: 'strogonoff-carne',
    nome: 'Strogonoff',
    descricao: 'Strogonoff cremoso de tirinhas bovinas com champignon, arroz branco e batata palha crocante.',
    preco_unitario: 25.50,
    ingredientes: [
      { nome: 'tirinhas bovinas ao molho cremoso', removivel: false },
      { nome: 'arroz branco', removivel: true },
      { nome: 'champignon', removivel: true },
      { nome: 'batata palha', removivel: true },
      { nome: 'cebola', removivel: true },
    ],
    temperos_removiveis: ['alho', 'pimenta-do-reino', 'sal', 'salsinha', 'mostarda'],
    permite_ponto: false,
    pontos_permitidos: [],
    dias_disponiveis: [0, 1, 2, 3, 4, 5, 6],
  },
  {
    id: 'feijoada-completa',
    nome: 'Feijoada',
    descricao: 'Feijoada tradicional completa com carnes nobres, arroz branco, couve refogada, farofa de bacon e laranja.',
    preco_unitario: 29.90,
    ingredientes: [
      { nome: 'feijoada com carnes', removivel: false },
      { nome: 'arroz branco', removivel: true },
      { nome: 'couve refogada', removivel: true },
      { nome: 'farofa de bacon', removivel: true },
      { nome: 'laranja', removivel: true },
    ],
    temperos_removiveis: ['alho', 'pimenta', 'cheiro-verde', 'louro'],
    permite_ponto: false,
    pontos_permitidos: [],
    dias_disponiveis: [6], // Exclusiva de sábado
  },
  {
    id: 'omelete-vegetariana',
    nome: 'Omelete Vegetariana',
    descricao: 'Omelete de 3 ovos caipiras com queijo minas, tomate, espinafre, arroz integral, feijão carioca e legumes no vapor.',
    preco_unitario: 20.50,
    ingredientes: [
      { nome: 'ovos caipiras', removivel: false },
      { nome: 'queijo minas', removivel: true },
      { nome: 'tomate', removivel: true },
      { nome: 'espinafre', removivel: true },
      { nome: 'arroz integral', removivel: true },
      { nome: 'feijão carioca', removivel: true },
      { nome: 'legumes no vapor', removivel: true },
    ],
    temperos_removiveis: ['orégano', 'cebolinha', 'sal', 'pimenta-do-reino'],
    permite_ponto: false,
    pontos_permitidos: [],
    dias_disponiveis: [0, 1, 2, 3, 4, 5, 6],
  },
  {
    id: 'peixe-frito',
    nome: 'Peixe Frito',
    descricao: 'Filé de tilápia empanado crocante, arroz branco, pirão de peixe, salada tropical e rodela de limão.',
    preco_unitario: 26.90,
    ingredientes: [
      { nome: 'filé de tilápia empanado', removivel: false },
      { nome: 'arroz branco', removivel: true },
      { nome: 'pirão de peixe', removivel: true },
      { nome: 'salada tropical', removivel: true },
      { nome: 'limão', removivel: true },
    ],
    temperos_removiveis: ['alho', 'coentro', 'pimenta-do-reino', 'sal'],
    permite_ponto: false,
    pontos_permitidos: [],
    dias_disponiveis: [0, 2, 4, 5, 6], // Domingo, Terça, Quinta, Sexta e Sábado
  },
]);

const brlFormatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

/**
 * Formata um número para moeda brasileira (ex.: R$ 24,90).
 * @param {number} valor
 * @returns {string}
 */
export function formatarPreco(valor) {
  const numero = Number(valor);
  if (Number.isNaN(numero)) {
    return brlFormatter.format(0);
  }
  return brlFormatter.format(numero);
}

/**
 * Retorna o nome do dia da semana correspondente à data.
 * @param {Date} [date=new Date()]
 * @returns {string}
 */
export function getNomeDiaSemana(date = new Date()) {
  const dia = date instanceof Date ? date.getDay() : new Date(date).getDay();
  return DIAS_SEMANA[dia] || '';
}

/**
 * Retorna apenas os itens do cardápio disponíveis na data informada.
 * @param {Date} [date=new Date()]
 * @returns {Array<object>}
 */
export function getMenuDoDia(date = new Date()) {
  const dataValida = date instanceof Date ? date : new Date(date);
  const diaSemana = dataValida.getDay();

  return MENU_ITEMS.filter((item) => item.dias_disponiveis.includes(diaSemana));
}

