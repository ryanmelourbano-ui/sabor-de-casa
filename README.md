# 🍱 Sabor da Casa — Chatbot de Vendas para Marmitaria (Atendente Carlão)

Aplicação web 100% *client-side* em JavaScript puro (ES Modules), HTML5 e CSS3 para venda de marmitas via conversa em português do Brasil com o atendente virtual **Carlão**.

Funciona **inteiramente no navegador, sem LLM externo, sem necessidade de API Key e sem nenhuma requisição de rede (`fetch`)**, pronta para hospedagem estática no GitHub Pages.

---

## Estrutura de Pastas

```text
Carlao/
├── index.html               # Interface principal responsiva (Chat + Painel do Cliente)
├── README.md                # Documentação geral e limitações de guardrails
├── css/
│   └── style.css            # Design gastronômico moderno (Mobile-First)
├── docs/
│   └── test-scenarios.md    # 8 cenários de teste manuais documentados
├── js/
│   ├── main.js              # Inicialização da UI, chips rápidos e eventos
│   ├── config.js            # Constantes globais e taxa de entrega (R$ 6,00)
│   ├── menu.js              # Catálogo determinístico por dia da semana e formatarPreco()
│   ├── cart.js              # Motor determinístico de carrinho, validações e cálculo de totais
│   ├── tools.js             # Dispatcher de ferramentas (get_menu, add_item, customize_item, remove_item, get_order_summary, confirm_order)
│   ├── agent.js             # Motor conversacional PT-BR 100% local (sem LLM e sem rede)
│   ├── guardrails.js        # Defesa em 4 camadas (entrada, prompt/dados, tools e saída)
│   ├── prompts.js           # Referência de regras de atendimento do Carlão
│   └── ui.js                # Renderização segura do DOM (exclusivamente via textContent)
└── tests/
    ├── cart.test.html       # Runner de testes unitários do carrinho (14 casos)
    ├── cart.test.js
    ├── guardrails.test.html # Runner de testes de segurança/guardrails (40 casos)
    ├── guardrails.test.js
    ├── e2e-audit.html       # Runner de auditoria E2E completa (19 cenários)
    └── e2e-audit.js
```

---

## Principais Funcionalidades

1. **Atendimento 100% Local em Português do Brasil (Carlão):**
   * Compreende pedidos em texto livre, numerais por extenso (`"duas marmitas de bife e uma de frango"`), múltiplos pratos na mesma frase, botões `"+ Pedir 1"` no cardápio lateral e *chips* de sugestão rápida.
2. **Personalização Precisa por Palavra Inteira (`js/cart.js` e `js/agent.js`):**
   * Reconhece `"sem cebola"`, `"sem a cebola"`, `"retirar a cebola"`, `"tira o alho"`, `"frango sem pimenta"`, `"só o feijão sem couve"`, `"trocar batata frita por salada"` e escolha do ponto da carne (`"mal passado"`, `"ao ponto"`, `"bem passado"`).
   * Correspondência de ingredientes por palavra inteira (`casaPalavraDoIngrediente`), garantindo que artigos ou preposições nunca removam componentes errados da marmita.
   * Explicação clara com sugestão de alternativas válidas quando uma personalização não é permitida.
   * Resolução conversacional de ambiguidade quando existem múltiplas linhas do mesmo prato no carrinho.
3. **Cálculo Financeiro Determinístico e Fechamento (`js/cart.js` e `js/tools.js`):**
   * Preço unitário, subtotal por linha, subtotal geral, taxa de entrega fixa (`R$ 6,00`) e total final calculados exclusivamente via código.
   * Coleta de **Nome**, **Endereço de entrega** e **Forma de pagamento**, resumo final para confirmação (`"confirmar"`) e geração de número de pedido local (`#PED-xxxxxx`) com tempo estimado (`35 a 50 minutos`).
   * Botões **"📋 Copiar pedido"** e **"🔄 Novo pedido"** na interface.
4. **Defesa em 4 Camadas de Guardrails (`js/guardrails.js`):**
   * **Camada 1 (Entrada):** Limite de 500 caracteres, remoção de caracteres de controle/*zero-width*, normalização Unicode (`NFKC`), *rate limit* local (10 mensagens/minuto), bloqueio de *prompt injection*/*jailbreak* (PT/EN) e recusa de perguntas fora do escopo (clima, programação, política).
   * **Camada 2 (Isolamento):** Sanitização de delimitadores XML/HTML.
   * **Camada 3 (Ferramentas):** *Whitelist* estrita de argumentos (`sanitizeToolArgs`), impedindo qualquer injeção de preço, desconto ou taxa de entrega.
   * **Camada 4 (Saída e DOM):** Reconciliação de valores monetários em `R$`, bloqueio de scripts/URLs e renderização no DOM usando exclusivamente `textContent` e `document.createElement` (zero `innerHTML`).

---

## ⚠️ Limitações Conhecidas dos Guardrails

Mesmo operando 100% localmente sem LLM externo, nenhum sistema de guardrails é 100% infalível:
* O *rate limit* local e as validações no navegador ocorrem no cliente (*client-side*), pois a aplicação foi projetada para rodar sem backend no GitHub Pages.
* O motor de linguagem natural local é especializado no domínio de venda e personalização de marmitas do cardápio; frases fora dos padrões do domínio são redirecionadas para a apresentação do cardápio do dia.

---

## Como Executar e Testar

1. Acesse a aplicação pelo servidor HTTP local:
   * **Chatbot Principal:** `http://localhost:8888/index.html`
   * **Suíte de Auditoria E2E (19 cenários):** `http://localhost:8888/tests/e2e-audit.html`
   * **Testes de Guardrails (40 casos):** `http://localhost:8888/tests/guardrails.test.html`
   * **Testes do Carrinho (14 casos):** `http://localhost:8888/tests/cart.test.html`
