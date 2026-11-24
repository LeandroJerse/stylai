# Comparação de composição conjunta — Nano Banana Pro

Objetivo autorizado: corrigir qualidade reprovada no teste E05, conservando busca real, pessoa e roupas selecionadas. Plano de execução direta, TDD e revisão independente conforme Superpowers. Especificação e cronologia: docs/qa/diario-cronologico-stylai.md.

## Contrato

- Gemini nativo gemini-3-pro-image (confirmado por models.list); generateContent síncrono, 2K, 3:4, sem web search, uma saída.
- Uma única chamada recebe foto original e até três roupas, com papéis explícitos. Nenhuma entrada usa o render defeituoso.
- Worker preserva snapshot e direitos de todas as peças, gate do piloto e orçamento persistente. Nunca repetir POST incerto.
- Preço oficial consultado: imagem1K/2K1120tokens aUS$120/M =US$0,1344; inputUS$2/M e texto/thinkingUS$12/M. Fonte https://ai.google.dev/gemini-api/docs/pricing. ReservaUS$0,35, maxOutputTokens8192, entrada limitada14MB. Falha incerta mantém reserva.
- API/UI devem mostrar uma chamada conjunta, não multiplicar por peças. Mesmo modelo deve chegar à API e worker via launcher sem editar env.
- Restam três chamadas e US$1,609111. Fazer uma comparação e inspecionar antes de qualquer próxima.

## Etapas

1. RED/GREEN cliente HTTP, prompt de preservação de pessoa/peças e preço por imagem. Testes sem fotos reais.
2. RED/GREEN worker: duas peças em uma chamada; fotos originais, snapshots de todas, gate antes de despacho e reconciliação pelo modelo da chamada.
3. Launcher, API e UI informam modelo/custo/conjunto corretamente. Check completo e revisão.
4. Reiniciar local, habilitar modelo no mesmo piloto sem reset, gerar pela API usando composição real e foto existente. Avaliar defeitos, rosto, fidelidade das roupas e links; marcar resultado no ledger.

Review Focus: nenhuma chamada por peça no modo conjunto; nenhuma perda dos gates de imagem/direitos/piloto; custo por modelo e resolução; payload sem fotos ou chaves nos logs; orçamento não reiniciado; chamada anterior não reconciliada com preço novo.

Decisão atualizada por instrução do usuário: usar Gemini diretamente, sem intermediário. Pro escolhido por prioridade de qualidade/seguimento de instruções; comparação visual ainda necessária. Fallback fal e navegação P01 continuam tarefas separadas; não confundir qualidade de um teste com aplicação pronta.

## Resultado e decisão final (E07–E10)

- Gemini direto foi implementado, mas duas chamadas foram rejeitadas por quota Free Tier. Conta/projeto foram vinculados com autorização; pré-pagamento Google ainda pendente, sem nova recarga.
- Usuário decidiu usar Nano Banana Pro pelo Segmind. Integrado /v1/nano-banana-pro síncrono, 2K/3:4/IMAGE, sem web search, original por relay temporário autorizado e referências juntas. Reserva US$0,20, preço estimado US$0,152273.
- Geração real via aplicativo concluída: b2e2da48-b44b-48f7-9d1d-6de82f239036. PNG1792x2400. Resultado aprovado como prévia ilustrativa: identidade aparente preservada, camisa/calça naturais e sem defeitos graves do teste anterior. Fidelidade exata/tamanho não certificados.
- Limite do piloto atingido: 5 chamadas, US$0,543162 computados; nenhuma geração adicional neste piloto.
- Revisão independente encontrou perda de reconciliação de chamadas Segmind legadas após troca de modelo. Corrigido com reconciliador try-on-diffusion separado e cálculo por modelo da chamada; teste RED/GREEN cobre não precificar Nano Banana como GPU try-on.
- Diário cronológico guarda evidências, restrições e falhas. Fallback fal, navegação P01 e prontidão de produção continuam escopos separados.
