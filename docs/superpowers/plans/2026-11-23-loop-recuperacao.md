# Recuperação relevante — plano de implementação

> **For agentic workers:** Use superpowers:executing-plans para implementar neste checkout, tarefa a tarefa. O diário solicitado pelo usuário é o ledger durável; não removê-lo ao terminar.

**Goal:** Evitar perder material na ampliação de busca e comprovar o efeito na API real antes de geração.

**Architecture:** Manter funções determinísticas de consultas no contrato, execução de catálogo na API e seleção final pelo Haiku. Preservar no máximo três tentativas por slot, sem LLM adicional por consulta e sem dados comerciais inventados.

**Tech Stack:** TypeScript, Bun, Zod, SDK Anthropic, Fastify, API AliExpress.

**Spec:** [Diário e critérios de conclusão](../../qa/diario-cronologico-stylai.md), [plano anterior](2026-11-23-look-completo-fallback.md).

## Global Constraints

- Continuar execução direta autorizada; branch existente `feat/motor-first-slice`, alterações locais preservadas. Não mover trabalho em andamento para outro checkout.
- Cinco chamadas de imagem/US$2 no piloto; nenhuma imagem enquanto seleção estiver incompleta/incoerente.
- Sem edição de arquivos de ambiente, exposição de credenciais, push ou deploy.
- Loop de engenharia não é loop de chamadas pagas: cada reteste exige hipótese e evidência nova.

## Review Focus

- Material não pode desaparecer antes de uma alternativa que ainda o preserve.
- Cor e público explícitos devem permanecer nas alternativas.
- Material de outra peça não pode contaminar a consulta atual.
- Falha técnica do catálogo não deve disparar ampliação.
- Candidatas existentes não provam conjunto completo nem autorização de geração.

## Task 1: Preservar material na consulta alternativa

**Files:** `packages/contracts/src/composition.ts`, `packages/contracts/tests/composition.test.ts`.

**Interfaces:** `buildSlotQueries(intent: CompositionIntent, slot: SlotId): string[]`, mesma assinatura e teto de três consultas.

- [ ] RED: plano upper query `camisa social alfaiataria linho` deve produzir `[camisa social alfaiataria linho, camisa linho, camisa]`; público/cor e material de lower não vazam entre slots.
- [ ] Executar `bun --conditions=development test packages/contracts/tests/composition.test.ts`, observar falha de valor da consulta.
- [ ] GREEN: extrair material conhecido da consulta sanitizada do próprio slot; alternativa intermediária usa material quando presente, senão preserva comportamento formal existente.
- [ ] Executar teste focado e `bun run check`; zero falhas.
- [ ] Registrar diff e resultado no diário; checkpoint local após revisão do pacote.

## Task 2: Validar na fronteira real

**Files:** harness local `test-results/pilot-2026-11-23/italian-flow.mjs`; evidência nova, sem sobrescrever relatórios antigos.

**Interfaces:** POST `/v1/studio/compositions` e resposta `complete`, `stages`, `slots[].retrieval.attempts`, `generation`, `agentCost`.

- [ ] Reiniciar somente launcher verificado deste piloto para carregar alterações.
- [ ] Rodar pedido italiano natural uma vez com limite de chamadas Haiku conhecido; não resetar cotas.
- [ ] Inspecionar consultas, peças escolhidas, abstenções e custo; não confiar em resumo de checks do harness.
- [ ] Registrar diagnóstico seguinte; geração somente após completar critérios do diário.

## Execução e decisões

Ruling: manter execução direta já autorizada e ledger em `docs/qa/diario-cronologico-stylai.md`, em vez de pedir nova escolha de método ou criar histórico descartável — preserva continuidade e pedido explícito; risco: revisão final deve distinguir alterações anteriores desta rodada.

Pre-flight: Task2 consome `buildSlotQueries` indiretamente pela API; precisa reinício, pois API não usa watch. Sem mudança de contrato externo ou migration nesta tarefa.
