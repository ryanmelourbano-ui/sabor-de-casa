# 🍱 Sabor da Casa — Chatbot de Vendas para Marmitaria

Aplicação web 100% *client-side* em JavaScript puro (ES Modules), HTML5 e CSS3 para venda de marmitas via conversa em português do Brasil, integrada diretamente à API do Google Gemini com *Function Calling* e motor determinístico de cálculo de preços.

http://localhost:8888/index.html

---

## Arquitetura de Segurança e Guardrails (Defesa em 4 Camadas)

O sistema adota uma estratégia de defesa em profundidade (*Defense in Depth*) implementada em `js/guardrails.js`, `js/prompts.js`, `js/tools.js` e `js/cart.js`:

1. **Camada 1 — Guardrail de Entrada (Antes do LLM):**
   * Limite estrito de **500 caracteres** por mensagem.
   * Remoção de caracteres de controle e invisíveis (*zero-width*) e normalização Unicode (`NFKC`).
   * Detecção heurística bilingue (PT/EN) de *Prompt Injection*, *Jailbreak* (`DAN`, modo desenvolvedor), tentativa de vazamento do *System Prompt*, *role-play*, codificações evasivas (`Base64`, `ROT13`), delimitadores falsos (`</system>`, `### system`, `</mensagem_usuario>`) e comandos para alterar preços/descontos.
   * Mensagens bloqueadas **não são enviadas ao LLM**, economizando cota e respondendo com uma mensagem segura que redireciona ao cardápio.
   * **Rate limit local:** máximo de 10 mensagens por minuto por sessão.

2. **Camada 2 — Isolamento no Prompt:**
   * A entrada do usuário é neutralizada e encapsulada dentro de tags `<mensagem_usuario>...</mensagem_usuario>`.
   * O *System Prompt* instrui explicitamente o modelo a tratar o conteúdo dentro dessa tag apenas como dado não confiável de pedido e proíbe revelar instruções internas, chaves ou configurações.

3. **Camada 3 — Blindagem das Ferramentas (Tools & Carrinho Determinístico):**
   * `sanitizeToolArgs()` aplica uma *whitelist* estrita nos parâmetros de cada tool: qualquer tentativa do modelo de enviar campos extras como `preco`, `desconto`, `taxa_entrega` ou `total` é descartada silenciosamente.
   * Todos os preços unitários, subtotais, taxa de entrega (`R$ 6,00`) e total são calculados exclusivamente pelo código determinístico em `js/cart.js` e `js/menu.js`.

4. **Camada 4 — Guardrail de Saída (Antes da UI):**
   * Inspeciona a resposta textual do LLM procurando vazamento de trechos do *System Prompt*, tags HTML/scripts/URLs externas ou valores monetários (`R$`) divergentes dos valores reais calculados pelo carrinho.
   * Caso detecte qualquer anomalia, descarta a resposta do modelo e exibe um resumo seguro gerado deterministicamente pelo código.
   * A renderização no DOM (`js/ui.js`) utiliza exclusivamente `textContent` e `document.createElement` (nunca `innerHTML`), eliminando vetores de XSS.

---

## ⚠️ Limitações Conhecidas dos Guardrails

**Nenhum guardrail para LLMs é 100% eficaz.** As seguintes limitações arquiteturais devem ser consideradas:

1. **Ataques Semânticos Inéditos:** Filtros baseados em expressões regulares e heurísticas (Camada 1) bloqueiam padrões conhecidos em português e inglês, mas formulações criativas, metáforas complexas ou outros idiomas ainda podem alcançar o modelo. Por isso, a segurança financeira do sistema **não depende do LLM**, mas sim do isolamento determinístico da Camada 3 (`cart.js`).
2. **Execução 100% Client-Side:** Como o aplicativo roda inteiramente no navegador (requisito para hospedagem estática no GitHub Pages sem backend), o rate limit local e as validações em JavaScript podem ser contornados por um usuário técnico que inspecione o DevTools ou faça chamadas diretas com sua própria chave de API.
3. **Falsos Positivos / Falsos Negativos na Reconciliação Monetária:** A Camada 4 exige que qualquer valor precedido por `R$` citado pelo bot coincida com os preços do cardápio do dia ou com os subtotais/totais do carrinho atual. Se o usuário perguntar quanto custariam 7 marmitas antes de adicioná-las ao carrinho e o bot escrever o valor em `R$` sem chamar `add_item` primeiro, a Camada 4 substituirá a resposta pelo resumo seguro do carrinho atual por precaução.

---

## Como Executar e Testar

1. Sirva a pasta raiz com um servidor HTTP estático:
   ```bash
   npx --yes serve .
   ```
2. **Aplicação principal:** `http://localhost:3000/index.html`
3. **Testes do Carrinho (14 casos):** `http://localhost:3000/tests/cart.test.html`
4. **Testes de Guardrails (40 casos):** `http://localhost:3000/tests/guardrails.test.html`

