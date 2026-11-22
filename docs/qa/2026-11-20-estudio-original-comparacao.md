# Estúdio original × versão anterior: comparação e restauração (2026-11-20)

Base: `PROMPT-CLAUDE-RESTAURAR-ESTUDIO-E-FOTOS-PERFIL.md`. O Estúdio original (Procurar/Vestir, do `frontend/` de 17/11) volta a ser a experiência principal. A prova de uma peça passa a ficar **dentro** dele e usa o backend já construído (jobs, auth, armazenamento, ledger, versões, telemetria). As fotos do corpo ficam **só no Perfil**.

## O que estava errado na versão anterior

| Problema | Efeito |
|---|---|
| `StudioTryOn.tsx` **substituía** o Estúdio quando o servidor anunciava `single_piece_try_on` | o produto foi trocado pela limitação temporária; o original só aparecia em `?demo=full` |
| Termo e foto cadastrados **dentro do Estúdio** | cadastro paralelo ao do Perfil |
| Escolha da peça por uma lista simples do catálogo | ignorava a ordem do produto: **pedido → busca → seleção → geração** |
| "Pedidos por dia", sem planos; retenção de 7 dias no texto | regras de teste apresentadas como definitivas |
| Perfil: "Aprovadas na análise" | sugeria análise por IA; só havia checagem técnica |
| Demo: o upload devolvia uma foto fixa | a pessoa não via a própria foto |

## Como ficou, item a item

| Parte do Estúdio original | Backend hoje | Como ficou |
|---|---|---|
| Alternância **Procurar / Vestir**, compositor, resumo, painel de job, palco, deck, histórico | — | **restaurados como estavam** (mesmos componentes e estilos). A tela substituta foi removida |
| **Procurar**: pedido + preferências | busca **no catálogo curado** (`POST /v1/studio/searches`), interpretação por **regras** (categoria, cor, "até R$ N"), **sem chamada de IA** | o botão vira "Buscar peças". O resultado aparece no painel original **"Catálogo da busca"**, como "Peças encontradas", com o motivo quando uma peça não pode ser provada. Texto explícito: "não é uma busca ao vivo nas lojas" |
| Preferências salvas | não existem na API | aviso: "ainda não disponíveis; escreva o orçamento no pedido" |
| **Seleção** de peças (até 6 no original) | o provador veste **1** peça | mesmo painel e mesma lista. A limitação aparece na seleção ("uma peça por vez; o look completo ainda não está disponível"). Uma nova escolha **substitui** a anterior. Escolha de tamanho quando há mais de uma variante |
| **Vestir** (geração) | `POST /studio/generations` com chave de idempotência | "Vestir 1 peça" no painel ou "Vestir a peça" no compositor Vestir. **Bloqueado** sem foto válida e termo vigente, com o botão **"Adicionar foto no Perfil"** |
| Fotos do celular (referências), ajuste por texto | não existem | blocos no lugar, marcados "ainda não disponível" |
| **Fotos do corpo** | termo versionado + foto de frente; exclusão (`DELETE /me/body-photos/front`) | **só no Perfil**: termo, envio (orientação aplicada e metadados removidos no navegador; o servidor remove de novo), troca e exclusão. Lateral e perfil: "não usada nesta fase" (o modelo usa só a frente). "Prontas para uso: verificação técnica de formato, tamanho e resolução, não é análise por IA" |
| Resultado e versões | linhagem v1→v2 | seletor original de versões, alimentado pela linhagem do servidor. Novo bloco **"Peça desta versão (vN)"** separado da **"Próxima troca"**, com o botão "Trocar para esta peça (nova versão)" |
| Simulação | `render_mode=simulated` | selo no palco: "Simulação · vN" e "Resultado simulado: não foi gerado pelo provedor real". Nenhum "gerado por IA" em resultado simulado ou foto preparada |
| Editar imagem, Match, Guardar no Closet, Acervo | não existem | os botões continuam no lugar e, ao tocar, dizem que ainda não estão disponíveis. O Acervo só aparece depois de uma busca com candidatos de geração, como no original |
| Custo e saldo | limite técnico de pedidos por dia | "Restam N pedidos hoje (**limite provisório da fase de testes**)". O detalhe diz que planos, preços e unidade de cobrança ainda não foram definidos |

## Oficial × demo

As mesmas telas. A demo padrão anuncia as **mesmas capacidades** do servidor e responde "ainda não implementado" nos mesmos pontos (Closet, preferências, Match, planos, edição, referências). Ela busca no catálogo da demo pelas mesmas regras. A foto escolhida aparece a partir do **próprio arquivo** (`blob:`) e nunca sai do navegador. A exclusão bloqueia a geração. Os resultados são fotografias preparadas, com o selo de simulação. `?demo=full` mantém o protótipo completo (busca e Match simulados).
