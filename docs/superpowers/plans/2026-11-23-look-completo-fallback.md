# Busca progressiva e completude

Autorização: Leandro pediu procurar sempre o conjunto e, na ausência, peças semelhantes coerentes com o estilo; autorizou implementação direta pelo Codex e geração supervisionada. Limites anteriores de 5 imagens/US$2 permanecem.

Decisão: manter SDK Anthropic/Zod e algoritmo determinístico de recuperação; não gastar uma nova chamada LLM por consulta vazia. Até três consultas por slot, exata primeiro, duas alternativas, sem repetir após indisponibilidade/rate limit. Seleção mantém intenção original, orçamento e peças travadas; nunca escolhe item apenas para preencher.

1. Contrato `buildSlotQueries`: lista deduplicada e limitada; preservar categoria, público e cor no fallback. Testar queries pequenas e estilo formal.
2. Recuperação: parar ao encontrar candidatas da categoria; registrar cada tentativa e motivo; não fazer fallback em falha técnica. Testar vazio, filtro, sucesso e indisponibilidade.
3. Completude: distinguir snapshot parcial de look completo; bloquear geração se faltar slot obrigatório, tanto na apresentação quanto no endpoint. Corrigir mensagens da UI.
4. Testes/typecheck e reteste real italiano via API. Não gerar se faltar peça ou se a imagem de entrada não for utilizável. Registrar qualidade, custo e bloqueios.

Geração comercial e avaliação privada devem manter proveniência explícita; não inventar disponibilidade, variantes ou licença de fornecedor. A autorização do usuário para testar não é declaração de licença concedida pelo vendedor.
