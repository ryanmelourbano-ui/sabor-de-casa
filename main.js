/**
 * js/main.js
 * Ponto de entrada da aplicação.
 * Conecta o chat ao agente com Guardrails, renderiza o fechamento do pedido,
 * gerencia os botões "Copiar pedido" e "Novo pedido" e limpa o campo de senha
 * do DOM imediatamente após salvar a API Key em sessionStorage.
 */

import { getApiKey, setApiKey, clearApiKey } from './config.js';
import { getMenuDoDia, getNomeDiaSemana } from './menu.js';
import { getSummary, clearCart } from './cart.js';
import {
  buildOrderTextReceipt,
  getLastConfirmedOrder,
  clearLastConfirmedOrder,
} from './tools.js';
import { sendMessageToAgent, clearConversationHistory } from './agent.js';
import {
  getElements,
  appendMessage,
  clearChatMessages,
  setTypingState,
  renderMenuOfDay,
  renderOrderPanel,
  showOrderActionFeedback,
  toggleApiKeyModal,
  showApiKeyFeedback,
  toggleMobileOrderSidebar,
} from './ui.js';

/**
 * Inicializa os eventos e o estado inicial da interface.
 */
function initApp() {
  const elements = getElements();
  const hoje = new Date();
  const menuHoje = getMenuDoDia(hoje);
  const nomeDia = getNomeDiaSemana(hoje);

  function postWelcomeMessage() {
    appendMessage(
      'bot',
      `Olá! Eu sou a Bia, da Marmitaria Sabor da Casa! 🍱 Nosso cardápio de hoje (${nomeDia}) já está disponível ao lado. O que você gostaria de pedir?`
    );
  }

  renderMenuOfDay(menuHoje, nomeDia);
  renderOrderPanel(getSummary(), getLastConfirmedOrder());
  postWelcomeMessage();

  const existingKey = getApiKey();
  if (existingKey) {
    toggleApiKeyModal(false);
  } else {
    toggleApiKeyModal(true);
  }

  elements.chatForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const rawText = elements.userInput.value.trim();
    if (!rawText) return;

    appendMessage('user', rawText);
    elements.userInput.value = '';

    setTypingState(true);
    try {
      const { reply, state, confirmedOrder } = await sendMessageToAgent(
        rawText,
        (partialState) => {
          renderOrderPanel(partialState, getLastConfirmedOrder());
        }
      );
      renderOrderPanel(state, confirmedOrder);
      appendMessage('bot', reply);
    } catch (error) {
      appendMessage('bot', `⚠️ ${error.message}`);
    } finally {
      setTypingState(false);
    }
  });

  // Botão "Copiar pedido"
  elements.copyOrderBtn.addEventListener('click', async () => {
    const confirmed = getLastConfirmedOrder();
    const summary = getSummary();
    const receiptText = buildOrderTextReceipt(summary, confirmed);

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(receiptText);
      }
      showOrderActionFeedback('✔ Resumo do pedido copiado!');
    } catch {
      showOrderActionFeedback('✔ Resumo gerado no painel!');
    }
  });

  // Botão "Novo pedido"
  elements.newOrderBtn.addEventListener('click', () => {
    clearCart();
    clearLastConfirmedOrder();
    clearConversationHistory();
    clearChatMessages();
    renderOrderPanel(getSummary(), null);
    postWelcomeMessage();
    showOrderActionFeedback('🔄 Novo pedido iniciado!');
    elements.userInput.focus();
  });

  // Abrir modal de API Key pelo cabeçalho (não repopula a chave bruta no DOM)
  elements.openApiModalBtn.addEventListener('click', () => {
    elements.apiKeyInput.value = '';
    elements.apiKeyInput.placeholder = getApiKey()
      ? 'Chave ativa na sessão (cole outra para substituir)...'
      : 'Cole sua API key aqui...';
    toggleApiKeyModal(true);
  });

  // Salvar API Key em sessionStorage e limpar imediatamente o value do input no DOM
  elements.apiKeyForm.addEventListener('submit', (event) => {
    event.preventDefault();
    try {
      setApiKey(elements.apiKeyInput.value);
      elements.apiKeyInput.value = '';
      toggleApiKeyModal(false);
      elements.userInput.focus();
    } catch (error) {
      showApiKeyFeedback(error.message);
    }
  });

  // Limpar API Key do sessionStorage e reiniciar histórico da sessão
  elements.clearKeyBtn.addEventListener('click', () => {
    clearApiKey();
    clearConversationHistory();
    elements.apiKeyInput.value = '';
    elements.apiKeyInput.placeholder = 'Cole sua API key aqui...';
    showApiKeyFeedback('Chave removida da sessão com sucesso.');
  });

  // Fechar modal (Modo Demonstração)
  elements.skipModalBtn.addEventListener('click', () => {
    elements.apiKeyInput.value = '';
    toggleApiKeyModal(false);
    elements.userInput.focus();
  });

  // Controle do painel lateral no mobile
  elements.toggleOrderBtn.addEventListener('click', () => {
    const isOpen = elements.orderSidebar.classList.contains('open');
    toggleMobileOrderSidebar(!isOpen);
  });

  elements.closeOrderBtn.addEventListener('click', () => {
    toggleMobileOrderSidebar(false);
  });
}

document.addEventListener('DOMContentLoaded', initApp);
