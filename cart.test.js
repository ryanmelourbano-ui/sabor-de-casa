/**
 * tests/cart.test.js
 * Suíte de testes unitários determinísticos para js/cart.js (14 casos de teste).
 * Pode ser executada diretamente no navegador via tests/cart.test.html ou via Node.js.
 */

import {
  addItem,
  removeItem,
  customizeItem,
  getSummary,
  clearCart,
  setCartReferenceDate,
} from '../js/cart.js';

// Quinta-feira (dia 4) e Sábado (dia 6) para testes determinísticos de disponibilidade
const QUINTA_FEIRA = new Date('2026-11-12T12:00:00-03:00');
const SABADO = new Date('2026-11-14T12:00:00-03:00');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

export const CART_TESTS = [
  {
    name: '1. Deve adicionar item disponível hoje e calcular subtotal, taxa de entrega (R$ 6,00) e total com entrega',
    fn: () => {
      setCartReferenceDate(QUINTA_FEIRA);
      clearCart();

      const res = addItem('bife-acebolado', 2);
      assert(res.ok === true, 'Esperava ok: true');
      assert(res.error === null, 'Não deveria retornar erro');
      assert(res.state.items.length === 1, 'Deveria ter 1 linha no carrinho');
      assert(res.state.subtotal === 49.80, `Subtotal esperado 49.80, obtido ${res.state.subtotal}`);
      assert(res.state.deliveryFee === 6.00, `Entrega esperada 6.00, obtida ${res.state.deliveryFee}`);
      assert(res.state.total === 55.80, `Total esperado 55.80, obtido ${res.state.total}`);
    },
  },
  {
    name: '2. Deve rejeitar quantidade negativa ou zero',
    fn: () => {
      setCartReferenceDate(QUINTA_FEIRA);
      clearCart();

      const resNeg = addItem('bife-acebolado', -2);
      assert(resNeg.ok === false, 'Quantidade negativa deve falhar');
      assert(Boolean(resNeg.error), 'Deve informar mensagem de erro clara');

      const resZero = addItem('bife-acebolado', 0);
      assert(resZero.ok === false, 'Quantidade zero deve falhar');
      assert(resZero.state.items.length === 0, 'Carrinho deve continuar vazio');
    },
  },
  {
    name: '3. Deve rejeitar quantidade decimal ou acima de 20 unidades',
    fn: () => {
      setCartReferenceDate(QUINTA_FEIRA);
      clearCart();

      const resDecimal = addItem('frango-grelhado', 1.5);
      assert(resDecimal.ok === false, 'Quantidade fracionada deve falhar');

      const resAcima = addItem('frango-grelhado', 21);
      assert(resAcima.ok === false, 'Quantidade > 20 deve falhar');
    },
  },
  {
    name: '4. Deve rejeitar item inexistente no cardápio',
    fn: () => {
      setCartReferenceDate(QUINTA_FEIRA);
      clearCart();

      const res = addItem('lasanha-bolonhesa-inexistente', 1);
      assert(res.ok === false, 'Item inexistente deve falhar');
      assert(res.error.includes('não existe'), `Mensagem inesperada: ${res.error}`);
    },
  },
  {
    name: '5. Deve rejeitar item que existe no catálogo mas não está disponível hoje (ex.: Feijoada na quinta-feira)',
    fn: () => {
      setCartReferenceDate(QUINTA_FEIRA);
      clearCart();

      const res = addItem('feijoada-completa', 1);
      assert(res.ok === false, 'Feijoada não deve estar disponível na quinta-feira');
      assert(res.error.includes('não está disponível'), `Mensagem inesperada: ${res.error}`);
    },
  },
  {
    name: '6. Deve permitir adicionar Feijoada quando o dia de referência é Sábado',
    fn: () => {
      setCartReferenceDate(SABADO);
      clearCart();

      const res = addItem('feijoada-completa', 1);
      assert(res.ok === true, 'Feijoada deve estar disponível no sábado');
      assert(res.state.subtotal === 29.90, `Subtotal esperado 29.90, obtido ${res.state.subtotal}`);
      assert(res.state.total === 35.90, `Total com entrega esperado 35.90, obtido ${res.state.total}`);
    },
  },
  {
    name: '7. Deve permitir remover ingredientes marcados como removíveis e temperos removíveis',
    fn: () => {
      setCartReferenceDate(QUINTA_FEIRA);
      clearCart();

      const addRes = addItem('bife-acebolado', 1);
      const custRes = customizeItem(addRes.lineId, {
        remover: ['cebola', 'batata frita', 'alho'],
        ponto: 'ao ponto',
        observacao: 'Caprichar no feijão',
      });

      assert(custRes.ok === true, `Deveria aceitar customização válida: ${custRes.error}`);
      const item = custRes.state.items[0];
      assert(item.customizacao.remover.includes('cebola'), 'Deveria remover cebola');
      assert(item.customizacao.remover.includes('alho'), 'Deveria remover tempero alho');
      assert(item.customizacao.ponto === 'ao ponto', 'Deveria definir ponto ao ponto');
    },
  },
  {
    name: '8. Deve rejeitar remoção de ingrediente NÃO removível (ex.: bife bovino no Bife Acebolado)',
    fn: () => {
      setCartReferenceDate(QUINTA_FEIRA);
      clearCart();

      const addRes = addItem('bife-acebolado', 1);
      const custRes = customizeItem(addRes.lineId, {
        remover: ['bife bovino'],
      });

      assert(custRes.ok === false, 'Não deve permitir remover ingrediente base não removível');
      assert(
        custRes.error.includes('não pode ser removido'),
        `Mensagem de erro inesperada: ${custRes.error}`
      );
    },
  },
  {
    name: '9. Deve rejeitar ingrediente inexistente na receita ao tentar remover',
    fn: () => {
      setCartReferenceDate(QUINTA_FEIRA);
      clearCart();

      const addRes = addItem('bife-acebolado', 1);
      const custRes = customizeItem(addRes.lineId, {
        remover: [' camarão '],
      });

      assert(custRes.ok === false, 'Não deve permitir remover ingrediente inexistente');
    },
  },
  {
    name: '10. Deve rejeitar escolha de ponto em item com permite_ponto = false (ex.: Omelete Vegetariana)',
    fn: () => {
      setCartReferenceDate(QUINTA_FEIRA);
      clearCart();

      const addRes = addItem('omelete-vegetariana', 1);
      const custRes = customizeItem(addRes.lineId, {
        ponto: 'bem passado',
      });

      assert(custRes.ok === false, 'Omelete não deve aceitar ponto da carne');
      assert(
        custRes.error.includes('não permite escolha de ponto'),
        `Mensagem inesperada: ${custRes.error}`
      );
    },
  },
  {
    name: '11. Deve rejeitar ponto fora de pontos_permitidos (ex.: Frango Grelhado mal passado)',
    fn: () => {
      setCartReferenceDate(QUINTA_FEIRA);
      clearCart();

      const addRes = addItem('frango-grelhado', 1);
      const custRes = customizeItem(addRes.lineId, {
        ponto: 'mal passado',
      });

      assert(custRes.ok === false, 'Frango grelhado não permite ponto mal passado');
      assert(
        custRes.error.includes('Pontos permitidos'),
        `Mensagem inesperada: ${custRes.error}`
      );
    },
  },
  {
    name: '12. Itens iguais com customizações diferentes devem ficar em linhas separadas',
    fn: () => {
      setCartReferenceDate(QUINTA_FEIRA);
      clearCart();

      // Adiciona 1 bife acebolado e personaliza sem cebola / bem passado
      const r1 = addItem('bife-acebolado', 1);
      customizeItem(r1.lineId, {
        remover: ['cebola'],
        ponto: 'bem passado',
      });

      // Adiciona outro bife acebolado padrão (sem customização)
      const r2 = addItem('bife-acebolado', 1);
      assert(r2.ok === true, 'Segunda adição deve ter sucesso');

      const summary = getSummary();
      assert(
        summary.items.length === 2,
        `Esperava 2 linhas separadas para customizações diferentes, obteve ${summary.items.length}`
      );
      assert(summary.subtotal === 49.80, `Subtotal esperado 49.80, obteve ${summary.subtotal}`);
      assert(summary.total === 55.80, `Total com entrega esperado 55.80, obteve ${summary.total}`);
    },
  },
  {
    name: '13. Deve remover quantidade parcial e total de uma linha e recalcular total',
    fn: () => {
      setCartReferenceDate(QUINTA_FEIRA);
      clearCart();

      const addRes = addItem('strogonoff-carne', 3); // 3 * 25.50 = 76.50
      assert(addRes.state.subtotal === 76.50, 'Subtotal inicial 76.50');

      // Remove 1 unidade -> restam 2 (51.00 + 6.00 = 57.00)
      const remParcial = removeItem(addRes.lineId, 1);
      assert(remParcial.ok === true, 'Remoção parcial deve funcionar');
      assert(remParcial.state.items[0].quantidade === 2, 'Quantidade restante deve ser 2');
      assert(remParcial.state.total === 57.00, `Total esperado 57.00, obtido ${remParcial.state.total}`);

      // Remove o restante da linha
      const remTotal = removeItem(addRes.lineId, 2);
      assert(remTotal.ok === true, 'Remoção total deve funcionar');
      assert(remTotal.state.items.length === 0, 'Carrinho deve ficar vazio');
      assert(remTotal.state.subtotal === 0, 'Subtotal deve ser 0');
      assert(remTotal.state.total === 0, 'Total de carrinho vazio deve ser 0');
    },
  },
  {
    name: '14. Deve rejeitar remoção de linha inexistente ou quantidade maior que a existente',
    fn: () => {
      setCartReferenceDate(QUINTA_FEIRA);
      clearCart();

      const addRes = addItem('peixe-frito', 1);
      const errExcesso = removeItem(addRes.lineId, 2);
      assert(errExcesso.ok === false, 'Não deve remover mais unidades do que existem na linha');

      const errInexistente = removeItem('line-999', 1);
      assert(errInexistente.ok === false, 'Não deve remover lineId inexistente');
    },
  },
];

/**
 * Executa todos os testes e retorna o relatório.
 */
export function runCartTests() {
  const results = [];
  let passedCount = 0;

  for (const testCase of CART_TESTS) {
    try {
      testCase.fn();
      results.push({ name: testCase.name, passed: true, error: null });
      passedCount++;
    } catch (err) {
      results.push({ name: testCase.name, passed: false, error: err.message });
    }
  }

  // Restaura data padrão ao final
  setCartReferenceDate(() => new Date());
  clearCart();

  return {
    total: CART_TESTS.length,
    passed: passedCount,
    failed: CART_TESTS.length - passedCount,
    results,
  };
}

