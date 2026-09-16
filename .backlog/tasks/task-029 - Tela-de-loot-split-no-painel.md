---
id: TASK-029
title: 'Tela de acerto do evento finalizado: dados, taxa e loot split'
status: To Do
assignee: []
created_date: '2026-09-15 03:24'
updated_date: '2026-09-16 19:29'
labels:
  - frontend
  - economy
milestone: m-5
dependencies:
  - TASK-028
  - TASK-023
priority: medium
ordinal: 29000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Interface do pós-evento no painel. Hoje o evento finalizado some de 'Meus eventos' em StaffEvents.tsx (o filtro exclui finished) e não existe formulário nenhum para editar dados nem taxa, embora a API já permita enquanto o status for finished. Esta task entrega o lugar onde o caller/dono fecha a conta: rever dados do evento, ajustar a taxa herdada do template, criar e editar o loot split e confirmar, com o arquivamento como último passo irreversível. Skills (doc-003): emil-design-eng, frontend-design, ask-sonner, security-review.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Evento finalizado aparece e é alcançável no painel de quem conduz (não some da lista como hoje)
- [ ] #2 Caller/dono edita dados do evento e a taxa enquanto o status é finished; archived deixa tudo somente leitura com a razão visível
- [ ] #3 Taxa editável em porcentagem ou valor fixo, mostrando na hora quanto é retido, quanto sobra pra dividir e pra quem vai o retido
- [ ] #4 Cria split informando o valor total e vê o rascunho com percentual e tempo de presença por participante
- [ ] #5 Soma dos percentuais sempre visível; confirmar desabilitado quando ≠ 100%, com o quanto falta ou sobra
- [ ] #6 Não inscrito que apareceu na call aparece na lista com 0% e rotulado como tal
- [ ] #7 Confirmação mostra o antes-e-depois (bruto, taxa, resíduo, líquido por pessoa) e avisa que vira lançamento imutável no ledger
- [ ] #8 Taxa fixa maior que o total é recusada na interface com mensagem clara, antes de chamar a API
- [ ] #9 Split confirmado fica somente leitura e mostra o caminho de correção por estorno
- [ ] #10 Arquivar exige confirmação explícita e é bloqueado enquanto houver rascunho de split pendente, explicando o motivo
- [ ] #11 Valores de prata formatados em PT-BR; nenhum valor passa por number no cálculo
- [ ] #12 Membro sem permissão não vê nem acessa a tela; ganhos de evento alheio não vazam
- [ ] #13 security-review executado sem achados críticos
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 pnpm quality sem falha bloqueante; resumo do gate colado nas notas
- [ ] #2 Cada AC verificado com evidência objetiva (teste, e2e, screenshot ou saída de comando), nunca só leitura de código
- [ ] #3 Skills aplicáveis do doc-003 invocadas e listadas nas notas
- [ ] #4 UI alterada: fluxo coberto por e2e e screenshots desktop 1280 e mobile 400 revisados pelo agent
- [ ] #5 Comportamento confere com decisões do doc-005 (Qs citadas) e nada fora do escopo da task
- [ ] #6 Toca auth, ledger, prata ou saque: security-review sem achado crítico
- [ ] #7 Notas e final summary com evidências; commits Conventional atômicos sem co-autor
- [ ] #8 PR merged na main com quality gate verde; branch e worktree removidos
<!-- DOD:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
Interface proposta (revisar antes de implementar):

1. ONDE VIVE. O acerto acontece dentro de StaffEvents, no painel de detalhe do evento, não numa tela solta. Motivo: quem acabou de finalizar já está ali, com a lista de inscritos na tela; mandar pra outra rota perde o contexto de quem esteve no evento. A rota /staff/splits continua existindo como fila ('o que ainda não fechei'), listando eventos finalizados com split pendente.

2. O EVENTO FINALIZADO PRECISA APARECER. Corrigir o filtro de 'Meus eventos' (hoje exclui finished). Proposta: seção 'A acertar' no topo da lista, separada dos eventos vivos, com contador. Evento finalizado sem split confirmado é pendência, não histórico — some da seção quando arquiva.

3. O PAINEL DE DETALHE GANHA ABAS quando o status é finished: 'Inscritos' (o que já existe) e 'Acerto' (novo). Abrir direto em Acerto quando o evento está finalizado sem split.

4. ABA ACERTO, de cima pra baixo, na ordem da decisão:
   a) Dados do evento em modo edição inline (nome, descrição), discreto — é correção, não criação.
   b) Bloco da taxa: toggle porcentagem | valor fixo, campo do valor, e embaixo a frase do resultado em tempo real ('De 10.000.000, retém 1.000.000 (10%) pra Thalya; sobram 9.000.000 pra dividir'). A frase é o feedback, não um preview separado.
   c) Bloco do split: campo do valor total arrecadado como CTA primário quando ainda não existe rascunho ('Calcular divisão'). Com rascunho, vira a tabela.
   d) Tabela do rascunho: participante, tempo na call, percentual editável, prata resultante. Não inscrito com 0% e rótulo 'apareceu sem inscrição'. Resíduo e taxa como linhas finais da mesma tabela, marcadas como destino do dono — o dinheiro tem que fechar visualmente de cima a baixo.
   e) Rodapé fixo da tabela com a soma dos percentuais como número-chave (dourado --brand): '100%' verde, ou '97% — faltam 3%'. Botão confirmar desabilitado fora de 100%.
   f) Confirmação em diálogo: bruto, taxa, resíduo, líquido por pessoa, e a frase de que vira lançamento imutável e correção só por estorno.
   g) Arquivar só depois, como ação destrutiva separada do fluxo, com confirmação.

5. DEPOIS DE CONFIRMADO. A aba vira somente leitura com os lançamentos gerados e uma linha explicando que correção é por estorno. Arquivado: mesma coisa, mais a nota de arquivamento.

6. PRINCÍPIOS. Nada de tela vazia: sem rascunho, o estado inicial já mostra os participantes e o tempo de cada um, porque esse dado existe desde o finish. Densidade e contraste (o usuário rejeitou a versão anterior do painel por ser 'clean igual um necrotério'). Dourado --brand só na soma dos percentuais e no CTA de confirmar. Tratar carregando, vazio (ninguém na call) e erro.
<!-- SECTION:PLAN:END -->
