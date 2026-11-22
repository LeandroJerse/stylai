# Revisão visual antes do lote pago (2026-11-20)

Nada foi pago, publicado, commitado ou aplicado no Supabase hospedado. O provador usado é o **simulador local**.

## 1. Onde acessar

A pilha de revisão já estava rodando quando esta tarefa começou: foi iniciada por outra sessão via `stylai-motor/test-results/start-review.mjs`, às 18:25–18:26, depois da última edição de código. Os logs não contêm segredos. Ela foi verificada e usada, sem duplicar processos.

| Modo | URL | Como entrar |
|---|---|---|
| **Oficial** (API + worker + simulador + Supabase local) | **http://localhost:5193** (use `localhost`, não `127.0.0.1`: a API só aceita essa origem exata) | Conta local de revisão `revisao@example.com` / `Revisao2026`, que já tem v1 e v2. Ou crie uma conta em `#/criar-conta` e abra o link de confirmação no **Mailpit**: http://127.0.0.1:54324 |
| **Demo / mock** (sem serviços) | **http://127.0.0.1:5192** (Estúdio: `/#/estudio`) | Já entra logado. A barra "Testar cenários" tem: sem login, cota zero, falhar o próximo pedido, link de confirmação do cadastro e protótipo completo (`?demo=full`) |
| Front oficial sem API | http://127.0.0.1:5190 | Mostra "Servidor não conectado", como esperado. **Não use para a revisão** |

A conta de revisão tem 3 pedidos por dia: a gravação usou 2 e resta 1. Para mais provas hoje, crie outra conta (qualquer e-mail; ele cai no Mailpit). O catálogo do oficial tem 3 itens de **teste**: Blusa de teste A, Jaqueta de teste B e Blusa de teste que simula falha.

Processos (para encerrar quando quiser): Vite oficial `5193`, API `3000`, worker `3001`, simulador `54390`, demo `5192`, Vite sem API `5190`. Supabase local: `bun run supabase -- stop`.

## 2. A jornada (escolher peça, gerar, trocar, reabrir a v1)

Gravada nos dois modos com `bun run review:record` (`apps/web/scripts/review-journey.mjs`):

- Oficial: `apps/web/test-results/review/oficial/jornada.webm` e as capturas `0-confirme-email` … `7-v1-reaberta.png`.
- Demo: `apps/web/test-results/review/demo/jornada.webm` e as capturas `1-foto` … `7-v1-reaberta.png`.

Passos: termo e foto → escolher a peça → "Provar esta peça" → processamento → v1 → escolher outra peça → "Trocar a peça (nova versão)" → v2 → seletor v1/v2 → reabrir a v1 (mesma imagem e mesma peça).

**Para sua revisão (UX, não é erro):** ao reabrir a v1, o painel "2. A peça" continua mostrando a última peça escolhida (a Jaqueta B). Um novo "Trocar a peça" nesse momento criaria a v3 a partir da v1. Talvez seja melhor reabrir a versão com a peça dela já selecionada; aguardo sua decisão.

## 3. As melhorias do `frontend/` estão incorporadas?

Sim. A comparação foi feita assim:

1. **Base comum comprovada:** o `apps/web` do handoff é idêntico ao `frontend` em `10a8d24`.
2. **Merge de 3 vias:** os 21 arquivos alterados no `frontend` (dois commits de 17/11 e as alterações locais) entraram por merge, com 2 conflitos resolvidos em `Studio.tsx`; os 6 arquivos novos foram copiados.
3. **Regressão funcional:** o e2e do próprio `frontend` (ofertas por loja, tags de preço, catálogo da busca, limite de 6 peças, Vestir, Closet, Perfil, logout) passou com **59 checagens** no `apps/web`.
4. **Regressão visual:** a demo do `frontend/` (porta 5197) e a do `apps/web` (`?demo=full`) foram comparadas pixel a pixel, com a barra da demo oculta (`bun run compare:frontend`):

| Tela | Desktop 1280 | Mobile 390 |
|---|---|---|
| Explorar | 0,00 % | 0,04 % |
| Closet | 0,00 % | 0,20 % |
| Perfil | 0,00 % | 0,09 % |
| Estúdio (protótipo) | 0,00 % | 0,22 % |

No mobile, a diferença se concentra no cabeçalho de vidro (desfoque de fundo), que é ruído de renderização; a inspeção visual das capturas não mostrou diferença. Capturas em `apps/web/test-results/review/comparacao/`.

**Diferenças que permanecem (intencionais):**

1. **Estúdio padrão:**
   - quando o servidor anuncia `single_piece_try_on`, o Estúdio é o provador de uma peça;
   - o Estúdio Procurar/Vestir do `frontend` continua no código e aparece só sem `capabilities` (contrato histórico) ou em `?demo=full`.
2. **Cadastro:** não entra mais direto. Pede confirmação por e-mail, em ambos os modos; na demo, o link de confirmação vem pela barra.
3. **Saldo:** no modo oficial e na demo padrão aparece em "pedidos" por dia, sem planos. No protótipo continua em "tokens".
4. **Barra da demo:** texto novo ("Sua foto não sai do navegador.") e dois botões a mais.
5. **Publicação:** o script de publicação ainda não foi executado pela nova fonte (ver §4).

## 4. Fonte principal e publicação

Ver [operations/frontend-fonte-e-publicacao.md](../operations/frontend-fonte-e-publicacao.md).

- A fonte principal passa a ser `stylai-motor/apps/web`: `src/` é o produto, `demo/` é a demo.
- O `frontend/` fica como referência histórica, sem alteração e sem exclusão.
- O novo `sync-site-demo.mjs` foi executado **só em modo de simulação**; o Site continuou sem alterações.

## 5. O que foi testado e o que é simulado

### Testes executados (resultados reais)

| Teste | Resultado | Ambiente |
|---|---|---|
| Lint, typecheck, 94 testes unitários, build e smoke | verde | local |
| SQL (`test:db`), papéis restritos (`test:db:private`), `test:motor` | verde | PostgreSQL 17 descartável no Docker |
| Navegador, modo oficial (`test:e2e:official`) | 58/58 | Supabase local real (Auth, Storage, Postgres) + API + worker + simulador + **Langfuse Cloud real** (`integration-test`) |
| Navegador, modo demo (`e2e:demo`) e adaptador (`test:demo`) | 21 checagens; 15 testes | só o navegador |
| Navegador, contrato histórico (`e2e`) | 59 | backend falso de teste |
| Gravação da jornada nesta revisão | concluída nos dois modos | pilha de revisão rodando |
| Comparação visual com o `frontend/` | tabela do §3 | duas demos |
| Simulação da publicação | concluída, sem escrita | Site local |

### Simulado ou fictício (não comprova o comportamento real)

| Item | O que é simulado | O que falta para ser real |
|---|---|---|
| **Provador** | `scripts/segmind-simulator.ts` devolve um PNG sintético (silhueta com faixa colorida), custo 0. Ele só comprova o contrato HTTP, o fluxo de job e o download da foto pelo link do Storage | lote pago Segmind (aguarda autorização) |
| Qualidade e fidelidade da imagem | nenhuma avaliação; o aviso "Aparência no render não verificada" é exibido | lote pago e avaliação |
| **Catálogo** | 3 itens de teste (oficial) e o catálogo ilustrativo do protótipo (demo); preço, link e estoque **não verificados** | `curado.json` com peças reais e evidência de direito |
| Fotos | sintéticas (blocos de cor); na demo, fotografias preparadas que não correspondem à foto enviada | sua foto com consentimento |
| E-mail | Mailpit local (nada sai da máquina) | SMTP real no projeto hospedado |
| Demo inteira | adaptador em memória: nenhum dado sai do navegador; nada de IA, e-mail, compra ou pagamento | — |
| Ledger | chamadas registradas no ambiente `test`, custo calculado 0 | lote pago (custo pelo `inference_time` real) |

## 6. Segmind: base da restrição comercial

Fontes lidas em 2026-11-20. Os trechos estão copiados como aparecem nas páginas.

### 6.1 Termos do serviço (contrato entre StylAI e Segmind)

Fonte: [Segmind Main Cloud Services Agreement](https://www.segmind.com/terms), "Last updated 4 August 2026".

| Cláusula | Trecho |
|---|---|
| §2.1.1 Use Authorization | "Customer and its Authorized Users may, subject to this Agreement, access and use the Segmind Platform Services" … "solely for Customer's internal business purposes." |
| §2.3 (abertura) | "You will not (and will not permit your Authorized Users to):" |
| §2.3, item 3 | "sell, resell, license, sublicense, distribute, rent, lease, or otherwise provide access to the Platform Services" … "to any third party except to the extent explicitly authorized in writing by Segmind;" |
| §2.3, item 4 | "use the Platform Services to develop or offer a service made available to any third party" … "that could reasonably be seen to serve as a substitute for such third party's possible purchase" |
| §1, definição | "Customer Results" means any output Customer or its Authorized Users generate from their use of the Platform Services. |
| §2.4.1 | "As between you and Segmind, you retain all ownership or license rights in Customer Content" |
| §1.4.1 | "Small amounts of Customer Data may be stored within the Segmind Control Plane, including Customer Results" |
| §9.2 | "Customer Content contained within a Customer Workspace is permanently deleted within thirty (30) days" … "following cancellation of the Workspace." |

O que **não** foi encontrado nos termos:

- nenhuma cláusula que autorize oferecer a usuários finais aplicações construídas sobre a Segmind;
- nenhuma menção a "Third-Party Models", licenças de modelos ou open source.

**Leitura:** o resultado é nosso (§2.4.1), mas o uso autorizado é "internal business purposes" (§2.1.1). Expor a geração a clientes do app depende de autorização por escrito (§2.3, item 3). Isso é uma interpretação dos termos, **não um parecer jurídico**.

### 6.2 Licença do modelo (separada dos termos do serviço)

Fontes: [modelo](https://www.segmind.com/models/try-on-diffusion) e [API](https://www.segmind.com/models/try-on-diffusion/api).

- **O que as páginas dizem:**
  - título: "Try-On Diffusion";
  - subtítulo: "Outfitting Fusion based Latent Diffusion for Controllable Virtual Try-on";
  - nenhuma licença, nenhum modelo base, nenhum link para paper ou repositório.
- **Indício, não confirmado:**
  - o subtítulo é, palavra por palavra, o título do paper do OOTDiffusion: "OOTDiffusion: Outfitting Fusion based Latent Diffusion for Controllable Virtual Try-on" ([GitHub](https://github.com/levihsu/OOTDiffusion), [arXiv 2403.01779](https://arxiv.org/abs/2403.01779));
  - o OOTDiffusion é licenciado como "Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International" ([LICENSE](https://raw.githubusercontent.com/levihsu/OOTDiffusion/main/LICENSE); [Hugging Face](https://huggingface.co/levihsu/OOTDiffusion): "License: cc-by-nc-sa-4.0");
  - cláusula da licença: "reproduce and Share the Licensed Material, in whole or in part, for NonCommercial purposes only".
- **Contraponto:** a descrição da página da Segmind fala em "TryOnDiffusion" com "Parallel-UNet", termos que não aparecem no OOTDiffusion. **Não está confirmado qual modelo a Segmind executa.** É preciso perguntar à Segmind por escrito.

**Conclusão:** a pendência O01 continua aberta, por dois motivos independentes:

- os termos do serviço restringem o uso a fins internos;
- a licença do modelo não está declarada, e o indício aponta para uma licença não comercial.

O lote pago de 2 chamadas é um teste interno, coberto pelo §2.1.1.

### 6.3 Alternativas: o que foi verificado e o que falta

| Provedor | O que as fontes dizem | O que falta verificar |
|---|---|---|
| **FASHN API** ([termos](https://fashn.ai/legal/terms-of-service), [preços](https://fashn.ai/pricing), [retenção](https://docs.fashn.ai/api-overview/data-retention-privacy)) | Permite uso comercial: "You may use our API to incorporate the Services into applications and services that you make available to your own users or customers". Saídas: "you own the outputs generated for you". Proíbe "Resell or sublicense standalone access to the FASHN API". Não treina com o conteúdo do cliente sem opt-in. Preço: "$0.075 /credit"; Try-On Max `balanced` 1k = 2 créditos (≈ US$ 0,15 por imagem, cálculo meu). O Try-On Max está em "Preview" | API para empresas ("offered to businesses and developers"). Não há endpoint de exclusão ("There is currently no deletion endpoint"). Saídas em CDN são apagadas em 3 dias. Falta avaliar qualidade, latência e o contrato de dados pessoais |
| **Vertex AI Virtual Try-On** ([modelo](https://docs.cloud.google.com/vertex-ai/generative-ai/docs/models/imagen/virtual-try-on-preview-08-04), [Service Terms §5](https://cloud.google.com/terms/service-terms)) | ID `virtual-try-on-001`. A página não mostra estágio, preço nem regra de uso comercial. Se for Pre-GA: "Customer should not use Pre-GA Offerings to process personal data", sem SLA nem indenização | **Não verificado:** estágio de lançamento real, preço por imagem e se há exigência de allowlist. Se estiver em Pre-GA, ele **não serve** para fotos de pessoas (dado pessoal) |

Nenhuma alternativa foi integrada ou testada; só os termos públicos foram lidos.
