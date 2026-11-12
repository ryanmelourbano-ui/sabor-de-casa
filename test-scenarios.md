# Cenários de Teste Manuais — Personalização de Pedidos

Este documento descreve **8 cenários de teste manuais** para validar a compreensão de linguagem natural, regras de personalização, tratamento de restrições, resolução de ambiguidade e exibição no painel **"Seu pedido"**.

---

### Cenário 1: Adição com remoção de ingrediente e ponto da carne na mesma frase
* **Pré-condição:** Carrinho vazio.
* **Entrada do usuário:**
  > `"Quero 2 marmitas de bife acebolado sem cebola e carne bem passada"`
* **Comportamento esperado:**
  1. O agente aciona a tool `add_item` com `itemId: "bife-acebolado"`, `quantidade: 2`, `remover: ["cebola"]` e `ponto: "bem passado"`.
  2. O painel **"Seu pedido"** exibe:
     * `2x Bife Acebolado — sem cebola, bem passado` (`R$ 49,80`)
     * Subtotal: `R$ 49,80` | Taxa de entrega: `R$ 6,00` | Total: `R$ 55,80`
  3. O bot confirma os 2 itens personalizados e informa o valor total com entrega.

---

### Cenário 2: Variações naturais de temperos ("tira o alho", "frango sem pimenta")
* **Pré-condição:** Carrinho vazio.
* **Entrada do usuário:**
  > `"Me vê 1 frango grelhado, tira o alho e faz o frango sem pimenta"`
* **Comportamento esperado:**
  1. O sistema associa `"tira o alho"` ao tempero `"alho"` e `"sem pimenta"` ao tempero `"pimenta-do-reino"`.
  2. O painel **"Seu pedido"** exibe:
     * `1x Frango Grelhado — sem alho, sem pimenta-do-reino` (`R$ 21,90`)
     * Subtotal: `R$ 21,90` | Taxa de entrega: `R$ 6,00` | Total: `R$ 27,90`

---

### Cenário 3: Expressão coloquial de acompanhamento ("só o feijão sem couve" na Feijoada de sábado)
* **Pré-condição:** Testar em um sábado (ou com data de referência no sábado).
* **Entrada do usuário:**
  > `"Quero 1 feijoada, só o feijão sem couve e sem laranja"`
* **Comportamento esperado:**
  1. O sistema reconhece `"sem couve"` como remoção de `"couve refogada"` e `"sem laranja"` como remoção de `"laranja"`.
  2. O painel **"Seu pedido"** exibe:
     * `1x Feijoada — sem couve refogada, sem laranja` (`R$ 29,90`)
     * Total com entrega: `R$ 35,90`.
  *(Nota: se testado de domingo a sexta-feira, o bot informa que a Feijoada é exclusiva de sábado e oferece as opções disponíveis no dia).*

---

### Cenário 4: Tentativa de remover ingrediente base obrigatório (Personalização Impossível)
* **Pré-condição:** Carrinho vazio.
* **Entrada do usuário:**
  > `"Quero 1 bife acebolado, mas tira o bife bovino"`
* **Comportamento esperado:**
  1. A validação determinística de `cart.js` recusa a remoção (`ok: false`) porque `"bife bovino"` está marcado com `removivel: false`.
  2. O carrinho permanece inalterado.
  3. O bot explica educadamente que o bife bovino é a base do prato e **oferece alternativas válidas** (remover arroz branco, feijão carioca, cebola, farofa, batata frita ou temperos, ou ainda sugerir a Omelete Vegetariana caso o cliente não queira carne).

---

### Cenário 5: Ponto da carne inválido para o prato escolhido
* **Pré-condição:** Carrinho vazio.
* **Entrada do usuário:**
  > `"Quero 1 frango grelhado mal passado"`
* **Comportamento esperado:**
  1. `cart.js` bloqueia a adição (`ok: false`) pois `Frango Grelhado` só aceita `["ao ponto", "bem passado"]`.
  2. O bot explica que o frango grelhado não pode ser servido mal passado por segurança alimentar e pergunta se o cliente prefere **ao ponto** ou **bem passado**.

---

### Cenário 6: Escolha de ponto em prato que não permite ponto (`permite_ponto: false`)
* **Pré-condição:** Carrinho vazio.
* **Entrada do usuário:**
  > `"Me manda 1 strogonoff bem passado sem batata palha"`
* **Comportamento esperado:**
  1. `cart.js` informa que `Strogonoff` não permite escolha de ponto de cozimento, mas permite remover `"batata palha"`.
  2. O bot avisa que o strogonoff tem preparo único no molho (não possui ponto de carne) e pergunta se pode adicionar a marmita de Strogonoff apenas `sem batata palha` (ou se prefere o Bife Acebolado bem passado).

---

### Cenário 7: Ambiguidade ao personalizar quando há várias linhas do mesmo item
* **Pré-condição:** O cliente já pediu duas configurações diferentes de Bife Acebolado:
  * Passo 1: `"Quero 1 bife acebolado sem cebola ao ponto e 1 bife acebolado bem passado"` (gera 2 linhas separadas no painel: `line-1` e `line-2`).
* **Entrada do usuário (Passo 2):**
  > `"Tira a farofa do bife também"`
* **Comportamento esperado:**
  1. Como existem 2 linhas de `Bife Acebolado` no carrinho (`1x Bife Acebolado — sem cebola, ao ponto` e `1x Bife Acebolado — bem passado`), há ambiguidade.
  2. O bot **pergunta ao cliente qual das duas marmitas de bife** (ou se ambas) ele deseja deixar sem farofa antes de alterar.

---

### Cenário 8: Personalização parcial de uma linha com múltiplas unidades
* **Pré-condição:** O cliente adicionou 2 unidades iguais:
  * Passo 1: `"Quero 2 marmitas de frango grelhado"` (painel mostra `2x Frango Grelhado` — `R$ 43,80`).
* **Entrada do usuário (Passo 2):**
  > `"Dessas duas de frango, deixa apenas 1 sem purê de batata e bem passada"`
* **Comportamento esperado:**
  1. O agente chama `customize_item` com `quantidade: 1`, `remover: ["purê de batata"]`, `ponto: "bem passado"`.
  2. `cart.js` divide a linha automaticamente em duas linhas separadas no painel **"Seu pedido"**:
     * `1x Frango Grelhado` (`R$ 21,90`)
     * `1x Frango Grelhado — sem purê de batata, bem passado` (`R$ 21,90`)
     * Subtotal: `R$ 43,80` | Taxa de entrega: `R$ 6,00` | Total: `R$ 49,80`.

