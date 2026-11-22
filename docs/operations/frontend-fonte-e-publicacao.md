# Frontend: fonte principal e publicação da demo

Decidido em 2026-11-20 (revisão visual antes do lote pago). Nada foi publicado; nenhuma pasta foi excluída.

## Fonte principal

| O quê | Fonte principal (a partir de agora) | Entrada | Observação |
|---|---|---|---|
| Produto (frontend oficial) | `stylai-motor/apps/web/src` | `apps/web/index.html` | ligado à API e ao worker do monorepo |
| Demo / mock | `stylai-motor/apps/web/demo` | `apps/web/demo/index.html` | adaptador em memória sobre as **mesmas** telas de `src/` |
| Contrato REST | `stylai-motor/docs/API-CONTRACT.md` | | merge da versão do `frontend/` |

A pasta `Documents/stylai/frontend/` (repositório antigo, `main` `622264e` + alterações locais) fica **somente como referência histórica**. Ela não foi alterada nem excluída. Todo o conteúdo dela de 10/11 em diante foi incorporado ao `apps/web` por merge de 3 vias com base `10a8d24`. Mudanças novas devem ser feitas só no monorepo. Se alguém alterar o `frontend/` de novo, repita o merge a partir do último ponto incorporado (base `622264e` mais as alterações locais de 20/11), não copie a pasta por cima.

## Publicação da demo (Site)

O Site é o checkout `Documents/stylai/.site-publicacao` (`.openai/hosting.json`: `project_id appgprj_6aee285ad3e4819183ee78e93a6a847f`, hospedagem estática de `dist/`).

| | Antes | Agora (preparado, não executado) |
|---|---|---|
| Script | `frontend/scripts/sync-site-demo.mjs` (continua lá, intocado) | `stylai-motor/apps/web/scripts/sync-site-demo.mjs` |
| Fonte | `frontend/src`, `frontend/demo`, `frontend/dist-demo` | `apps/web/src`, `apps/web/demo`, `apps/web/dist-demo` |
| Comportamento padrão | copiava direto | **simulação**: só lista o que mudaria |
| Lockfile | copiava o `bun.lock` do `frontend` | não copia (o do monorepo cobre todos os workspaces). Depois de aplicar, rode `bun install` no Site |
| Exclusões | nunca removia | só com `--apply --prune` |
| Rastreabilidade | `app/source-hashes.json` | o mesmo arquivo, agora com `source: stylai-motor/apps/web@<commit>[+uncommitted]` |

Fluxo quando você autorizar:

```powershell
cd stylai-motor/apps/web
bun run build:demo
bun run sync:site:demo                    # simulação (o padrão)
node scripts/sync-site-demo.mjs --apply   # grava no Site, sem excluir nada
cd ../../../.site-publicacao; bun install; bun run typecheck; bun run test; bun run build
# revisar git diff no Site; publicar é um passo separado, feito por você
```

Simulação executada em 2026-11-20: +16 arquivos novos, ~29 alterados, 95 iguais e 28 que só existem no Site (assets antigos do build anterior; mantidos). O `package.json` do Site seria regenerado com as versões exatas do `apps/web`; o `tsconfig.demo.json` não muda. O `git status` do Site continuou limpo.

**Atenção:** o Site publicado hoje mostra o protótipo de 17/11 (Procurar/Vestir). Com a nova fonte, a demo publicada abriria por padrão o **contrato oficial** (provador de uma peça), e o protótipo ficaria em `?demo=full`. Decida qual dos dois deve ser a página principal antes de publicar.
