# Cenários de Teste Manuais — Personalização e Fechamento (Atendente Carlão)

Este documento descreve **8 cenários de teste manuais** para validar a compreensão de linguagem natural (100% local, sem LLM e sem API Key), regras de personalização, tratamento de restrições, resolução de ambiguidade e exibição no painel **"🛒 Seu pedido"**.

---

### Cenário 1: Adição com remoção de ingrediente e ponto da carne na mesma frase
* **Pré-condição:** Carrinho vazio.
* **Entrada do usuário:**
  > `"Quero 2 marmitas de bife acebolado sem cebola e carne bem passada"`
  *(ou `"Pedi uma marmita de bife acebolada e retirar a cebola"`)*
* **Comportamento esperado:**
  1. O agente Carlão aciona a tool `add_item` com `itemId: "bife-acebolado"`, `quantidade: 2`, `remover: ["cebola"]` e `ponto: "bem passado"`.
  2. O painel **"🛒 Seu pedido"** exibe exclusivamente a remoção solicitada:
     * `2x Bife Acebolado — sem cebola, bem passado` (`R$ 49,80`)
     * Subtotal: `R$ 49,80` | Taxa de entrega: `R$ 6,00` | Total: `R$ 55,80`
  3. O Carlão confirma os itens personalizados e informa o valor total com entrega.

---

### Cenário 2: Variações naturais de temperos ("tira o alho", "frango sem pimenta")
* **Pré-condição:** Carrinho vazio.
* **Entrada do usuário:**
  > `"Me vê 1 frango grelhado, tira o alho e faz o frango sem pimenta"`
* **Comportamento esperado:**
  1. O sistema associa `"tira o alho"` ao tempero `"alho"` e `"sem pimenta"` ao tempero `"pimenta-do-reino"`.
  2. O painel **"🛒 Seu pedido"** exibe:
     * `1x Frango Grelhado — sem alho, sem pimenta-do-reino` (`R$ 21,90`)
     * Subtotal: `R$ 21,90` | Taxa de entrega: `R$ 6,00` | Total: `R$ 27,90`

---

### Cenário 3: Expressão coloquial de acompanhamento ("só o feijão sem couve" na Feijoada de sábado)
* **Pré-condição:** Testar em um sábado (ou com data de referência no sábado).
* **Entrada do usuário:**
  > `"Quero 1 feijoada, só o feijão sem couve e sem laranja"`
* **Comportamento esperado:**
  1. O sistema reconhece `"sem couve"` como remoção de `"couve refogada"` e `"sem laranja"` como remoção de `"laranja"`.
  2. O painel **"🛒 Seu pedido"** exibe:
     * `1x Feijoada — sem couve refogada, sem laranja` (`R$ 29,90`)
     * Total com entrega: `R$ 35,90`.
  *(Nota: se testado de domingo a sexta-feira, o Carlão informa que a Feijoada não está disponível hoje e lista as opções do dia).*

---

### Cenário 4: Tentativa de remover ingrediente base obrigatório (Personalização Impossível)
* **Pré-condição:** Carrinho vazio.
* **Entrada do usuário:**
  > `"Quero 1 bife acebolado, mas tira o bife bovino"`
* **Comportamento esperado:**
  1. A validação determinística de `cart.js` recusa a remoção (`ok: false`) porque `"bife bovino"` está marcado com `removivel: false`.
  2. O carrinho permanece inalterado.
  3. O Carlão explica que o bife bovino é a base do prato e **oferece alternativas válidas** que podem ser removidas (`arroz branco, feijão carioca, cebola, farofa, batata frita, alho, pimenta-do-reino, sal, cheiro-verde`).

---

### Cenário 5: Ponto da carne inválido para o prato escolhido
* **Pré-condição:** Carrinho vazio.
* **Entrada do usuário:**
  > `"Quero 1 frango grelhado mal passado"`
* **Comportamento esperado:**
  1. `cart.js` bloqueia a adição (`ok: false`) pois `Frango Grelhado` só aceita `["ao ponto", "bem passado"]`.
  2. O Carlão informa os pontos permitidos para o prato (`ao ponto` ou `bem passado`).

---

### Cenário 6: Escolha de ponto em prato que não permite ponto (`permite_ponto: false`)
* **Pré-condição:** Carrinho vazio.
* **Entrada do usuário:**
  > `"Me manda 1 strogonoff bem passado sem batata palha"`
* **Comportamento esperado:**
  1. `cart.js` informa que `Strogonoff` não permite escolha de ponto de cozimento e indica os pratos que permitem ponto (`Bife Acebolado` e `Frango Grelhado`).

---

### Cenário 7: Ambiguidade ao personalizar quando há várias linhas do mesmo item
* **Pré-condição:** O cliente já pediu duas configurações diferentes de Bife Acebolado:
  * Passo 1: `"Quero 1 bife acebolado sem cebola ao ponto e 1 bife acebolado bem passado"` (gera 2 linhas separadas no painel: `line-1` e `line-2`).
* **Entrada do usuário (Passo 2):**
  > `"Tira a farofa do bife"`
* **Comportamento esperado:**
  1. Como existem 2 linhas de `Bife Acebolado` no carrinho (`1x Bife Acebolado — sem cebola, ao ponto` e `1x Bife Acebolado — bem passado`), há ambiguidade.
  2. O Carlão **pergunta ao cliente qual das duas marmitas de bife** (`a 1ª ou a 2ª`) ele deseja alterar.
  3. Ao responder `"A segunda"`, apenas a 2ª linha passa a exibir `1x Bife Acebolado — sem farofa, bem passado`.

---

### Cenário 8: Personalização parcial de uma linha com múltiplas unidades
* **Pré-condição:** O cliente adicionou 2 unidades iguais:
  * Passo 1: `"Quero 2 marmitas de frango grelhado"` (painel mostra `2x Frango Grelhado` — `R$ 43,80`).
* **Entrada do usuário (Passo 2):**
  > `"Dessas duas de frango, deixa 1 sem purê de batata e bem passada"`
* **Comportamento esperado:**
  1. O agente chama `customize_item` com `quantidade: 1`, `remover: ["purê de batata"]`, `ponto: "bem passado"`.
  2. `cart.js` divide a linha automaticamente em duas linhas separadas no painel **"🛒 Seu pedido"**:
     * `1x Frango Grelhado` (`R$ 21,90`)
     * `1x Frango Grelhado — sem purê de batata, bem passado` (`R$ 21,90`)
     * Subtotal: `R$ 43,80` | Taxa de entrega: `R$ 6,00` | Total: `R$ 49,80`.
