/**
 * js/main.js
 * Ponto de entrada da aplicação 100% Client-Side (Sem LLM externo e Sem API Key).
 * Conecta o chat, os chips de sugestão rápida e os botões "+ Pedir 1" do cardápio
 * ao motor conversacional determinístico local.
 */

import { CONFIG } from './config.js';
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
      `Olá! Eu sou o Carlão, da Marmitaria Sabor da Casa! 🍱 Nosso cardápio de hoje (${nomeDia}) já está disponível ao lado.\n\n` +
        `Você pode escrever seu pedido livremente ou usar os botões rápidos abaixo (ex.: "Quero 2 marmitas de bife acebolado sem cebola ao ponto"). O que vamos pedir hoje?`
    );
  }

  /**
   * Processa o envio de uma mensagem do usuário (digitada ou clicada em chip/cardápio).
   * @param {string} rawText
   */
  function handleUserMessage(rawText) {
    const clean = String(rawText || '').trim();
    if (!clean) return;

    appendMessage('user', clean);
    elements.userInput.value = '';
    setTypingState(true);

    window.setTimeout(async () => {
      try {
        const { reply, state, confirmedOrder } = await sendMessageToAgent(
          clean,
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
    }, CONFIG.MOCK_TYPING_DELAY_MS || 280);
  }

  // Renderiza o Cardápio do dia com botão "+ Pedir 1" conectado ao chat
  renderMenuOfDay(menuHoje, nomeDia, (quickOrderText) => {
    handleUserMessage(quickOrderText);
  });

  renderOrderPanel(getSummary(), getLastConfirmedOrder());
  postWelcomeMessage();

  // Envio pelo formulário de texto
  elements.chatForm.addEventListener('submit', (event) => {
    event.preventDefault();
    handleUserMessage(elements.userInput.value);
  });

  // Chips de sugestão rápida acima da barra de texto
  const chipButtons = document.querySelectorAll('.chip-btn[data-prompt]');
  for (const btn of chipButtons) {
    btn.addEventListener('click', () => {
      const promptText = btn.getAttribute('data-prompt');
      if (promptText) {
        handleUserMessage(promptText);
      }
    });
  }

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
