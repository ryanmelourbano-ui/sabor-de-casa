/**
 * js/ui.js
 * Manipulação segura da interface (DOM).
 * REGRA DE SEGURANÇA: Todas as mensagens e dados dinâmicos são inseridos
 * exclusivamente com textContent e document.createElement (NUNCA innerHTML)
 * para mitigar vulnerabilidades de XSS.
 */

import { formatarPreco } from './menu.js';

/**
 * Seletores centralizados da interface.
 */
export function getElements() {
  return {
    chatMessages: document.getElementById('chat-messages'),
    typingIndicator: document.getElementById('typing-indicator'),
    chatForm: document.getElementById('chat-form'),
    userInput: document.getElementById('user-input'),
    sendBtn: document.getElementById('send-btn'),
    orderSidebar: document.getElementById('order-sidebar'),
    toggleOrderBtn: document.getElementById('toggle-order-btn'),
    closeOrderBtn: document.getElementById('close-order-btn'),
    menuDayBadge: document.getElementById('menu-day-badge'),
    menuOfDayList: document.getElementById('menu-of-day-list'),
    orderStatusBadge: document.getElementById('order-status-badge'),
    confirmedOrderBanner: document.getElementById('confirmed-order-banner'),
    orderItemsList: document.getElementById('order-items-list'),
    orderSubtotal: document.getElementById('order-subtotal'),
    orderDelivery: document.getElementById('order-delivery'),
    orderTotal: document.getElementById('order-total'),
    copyOrderBtn: document.getElementById('copy-order-btn'),
    newOrderBtn: document.getElementById('new-order-btn'),
    orderActionFeedback: document.getElementById('order-action-feedback'),
  };
}

/**
 * Rola automaticamente a área de mensagens para o final.
 */
export function scrollToBottom() {
  const { chatMessages } = getElements();
  if (!chatMessages) return;
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

/**
 * Limpa todas as bolhas de mensagem do chat sem usar innerHTML.
 */
export function clearChatMessages() {
  const { chatMessages } = getElements();
  if (!chatMessages) return;
  while (chatMessages.firstChild) {
    chatMessages.removeChild(chatMessages.firstChild);
  }
}

/**
 * Renderiza uma nova bolha de mensagem (usuário ou bot) usando apenas textContent.
 * @param {'user' | 'bot'} role
 * @param {string} text
 */
export function appendMessage(role, text) {
  const { chatMessages } = getElements();
  if (!chatMessages) return;

  const row = document.createElement('div');
  row.className = `message-row ${role === 'user' ? 'user' : 'bot'}`;

  const sender = document.createElement('span');
  sender.className = 'message-sender';
  sender.textContent = role === 'user' ? 'Você' : 'Carlão • Sabor da Casa';

  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  bubble.textContent = String(text);

  const time = document.createElement('span');
  time.className = 'message-time';
  const now = new Date();
  time.textContent = now.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  row.appendChild(sender);
  row.appendChild(bubble);
  row.appendChild(time);

  chatMessages.appendChild(row);
  scrollToBottom();
}

/**
 * Exibe ou oculta o indicador "digitando..." e controla o bloqueio do input.
 * @param {boolean} isTyping
 */
export function setTypingState(isTyping) {
  const { typingIndicator, sendBtn, userInput } = getElements();
  if (!typingIndicator || !sendBtn || !userInput) return;

  if (isTyping) {
    typingIndicator.classList.remove('hidden');
    sendBtn.disabled = true;
    userInput.disabled = true;
  } else {
    typingIndicator.classList.add('hidden');
    sendBtn.disabled = false;
    userInput.disabled = false;
    userInput.focus();
  }
  scrollToBottom();
}

/**
 * Renderiza o bloco "Cardápio do dia" usando apenas createElement e textContent.
 * Inclui botão "+ Pedir" em cada card para envio rápido no chat.
 *
 * @param {Array<object>} menuItems
 * @param {string} nomeDiaSemana
 * @param {(promptText: string) => void} [onQuickOrder]
 */
export function renderMenuOfDay(menuItems, nomeDiaSemana, onQuickOrder) {
  const { menuOfDayList, menuDayBadge } = getElements();
  if (!menuOfDayList) return;

  if (menuDayBadge && nomeDiaSemana) {
    menuDayBadge.textContent = nomeDiaSemana;
  }

  while (menuOfDayList.firstChild) {
    menuOfDayList.removeChild(menuOfDayList.firstChild);
  }

  if (!menuItems || menuItems.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'empty-cart-msg';
    emptyMsg.textContent = 'Nenhum item disponível hoje.';
    menuOfDayList.appendChild(emptyMsg);
    return;
  }

  for (const item of menuItems) {
    const card = document.createElement('article');
    card.className = 'menu-item-card';

    const header = document.createElement('div');
    header.className = 'menu-item-header';

    const title = document.createElement('span');
    title.className = 'menu-item-title';
    title.textContent = item.nome;

    const price = document.createElement('span');
    price.className = 'menu-item-price';
    price.textContent = formatarPreco(item.preco_unitario);

    header.appendChild(title);
    header.appendChild(price);

    const desc = document.createElement('p');
    desc.className = 'menu-item-desc';
    desc.textContent = item.descricao;

    card.appendChild(header);
    card.appendChild(desc);

    const footer = document.createElement('div');
    footer.className = 'menu-item-footer';

    const meta = document.createElement('span');
    meta.className = 'menu-item-meta';
    meta.textContent =
      item.permite_ponto && item.pontos_permitidos.length > 0
        ? `Pontos: ${item.pontos_permitidos.join(', ')}`
        : 'Personalizável no chat';
    footer.appendChild(meta);

    if (typeof onQuickOrder === 'function') {
      const addBtn = document.createElement('button');
      addBtn.type = 'button';
      addBtn.className = 'menu-quick-add-btn';
      addBtn.textContent = '+ Pedir 1';
      addBtn.addEventListener('click', () => {
        onQuickOrder(`Quero 1 marmita de ${item.nome}`);
      });
      footer.appendChild(addBtn);
    }

    card.appendChild(footer);
    menuOfDayList.appendChild(card);
  }
}

/**
 * Atualiza o painel lateral "Seu pedido" usando apenas createElement e textContent.
 * Exibe a personalização diretamente no formato: "2x Bife Acebolado — sem cebola, ao ponto"
 * e mostra os detalhes de confirmação quando o pedido é fechado.
 *
 * @param {{ items: Array<{name: string, quantity: number, lineSubtotal: number, notes?: string}>, subtotal: number, deliveryFee: number, total: number }} orderSummary
 * @param {object | null} [confirmedOrder]
 */
export function renderOrderPanel(orderSummary, confirmedOrder = null) {
  const {
    orderStatusBadge,
    confirmedOrderBanner,
    orderItemsList,
    orderSubtotal,
    orderDelivery,
    orderTotal,
    toggleOrderBtn,
  } = getElements();

  if (confirmedOrder && confirmedOrder.pedido_confirmado) {
    orderStatusBadge.textContent = `Confirmado (${confirmedOrder.numero_pedido})`;
    orderStatusBadge.classList.remove('hidden');

    confirmedOrderBanner.textContent =
      `✅ Pedido ${confirmedOrder.numero_pedido}\n` +
      `Cliente: ${confirmedOrder.nome_cliente}\n` +
      `Endereço: ${confirmedOrder.endereco_entrega}\n` +
      `Pagamento: ${confirmedOrder.forma_pagamento}\n` +
      `Entrega estimada: ${confirmedOrder.tempo_estimado}`;
    confirmedOrderBanner.classList.remove('hidden');
  } else {
    orderStatusBadge.classList.add('hidden');
    confirmedOrderBanner.classList.add('hidden');
    confirmedOrderBanner.textContent = '';
  }

  while (orderItemsList.firstChild) {
    orderItemsList.removeChild(orderItemsList.firstChild);
  }

  if (!orderSummary.items || orderSummary.items.length === 0) {
    const emptyMsg = document.createElement('p');
    emptyMsg.className = 'empty-cart-msg';
    emptyMsg.textContent = 'Seu pedido ainda está vazio. Escolha uma marmita ao lado ou digite no chat!';
    orderItemsList.appendChild(emptyMsg);
  } else {
    for (const item of orderSummary.items) {
      const card = document.createElement('div');
      card.className = 'order-item-card';

      const header = document.createElement('div');
      header.className = 'order-item-header';

      const labelComPersonalizacao = item.notes
        ? `${item.name} — ${item.notes}`
        : item.name;

      const title = document.createElement('span');
      title.textContent = `${item.quantity}x ${labelComPersonalizacao}`;

      const price = document.createElement('span');
      price.className = 'order-item-price';
      price.textContent = formatarPreco(item.lineSubtotal);

      header.appendChild(title);
      header.appendChild(price);
      card.appendChild(header);

      orderItemsList.appendChild(card);
    }
  }

  orderSubtotal.textContent = formatarPreco(orderSummary.subtotal);
  orderDelivery.textContent = formatarPreco(orderSummary.deliveryFee);
  orderTotal.textContent = formatarPreco(orderSummary.total);
  toggleOrderBtn.textContent = `Cardápio & Pedido (${formatarPreco(orderSummary.total)})`;
}

/**
 * Exibe feedback temporário abaixo dos botões "Copiar pedido" e "Novo pedido".
 * @param {string} message
 */
export function showOrderActionFeedback(message) {
  const { orderActionFeedback } = getElements();
  if (!orderActionFeedback) return;

  orderActionFeedback.textContent = message;
  orderActionFeedback.classList.remove('hidden');

  window.setTimeout(() => {
    orderActionFeedback.classList.add('hidden');
  }, 3000);
}

/**
 * Abre ou fecha o drawer lateral em telas mobile.
 * @param {boolean} open
 */
export function toggleMobileOrderSidebar(open) {
  const { orderSidebar, toggleOrderBtn } = getElements();
  if (!orderSidebar || !toggleOrderBtn) return;

  if (open) {
    orderSidebar.classList.add('open');
    toggleOrderBtn.setAttribute('aria-expanded', 'true');
  } else {
    orderSidebar.classList.remove('open');
    toggleOrderBtn.setAttribute('aria-expanded', 'false');
  }
}
