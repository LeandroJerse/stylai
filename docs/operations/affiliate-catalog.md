# Catálogo afiliado do StylAI

O worker de catálogo consulta o AliExpress e atualiza as coleções no Postgres.
A home e o detalhe consultam só o catálogo publicado. O Estúdio também pode
consultar o AliExpress quando a pessoa pede outra peça e faltam ofertas
compatíveis. O worker de IA usa um processo e um papel de banco próprios.

## Configuração

1. Confirme no portal da conta as operações de afiliados liberadas, as cotas,
   os domínios autorizados e a janela de retenção de dados e links. Use o
   tracking ID do StylAI e confirme que o segredo ativo foi provisionado pelo
   responsável pela integração. [Termos do programa afiliado](https://terms.alicdn.com/legal-agreement/terms/suit_bu1_aliexpress/suit_bu1_aliexpress202003132026_84536.html)
2. Aplique as migrações de catálogo e opções do Estúdio ao banco de destino.
   A migração cria o papel `stylai_catalog_worker` sem login. Em desenvolvimento,
   defina `STYLAI_DEV_DB_PASSWORD` em uma sessão local e execute
   `bun run db:dev -- --catalog-worker` para provisionar só esse papel.
   Em staging e produção, use o cofre do host e habilite o login do papel
   seguindo o runbook da fronteira privada.
3. Configure `STYLAI_CATALOG_MODE=aliexpress_affiliate` e as variáveis
   `ALIEXPRESS_*` no servidor da API. Use os mesmos limites globais
   `ALIEXPRESS_CALLS_PER_MINUTE` e `ALIEXPRESS_CALLS_PER_DAY` nos dois processos.
   Configure limites menores `STYLAI_CATALOG_CALLS_PER_MINUTE` e
   `STYLAI_CATALOG_CALLS_PER_DAY` no worker. Os limites precisam cobrir
   uma atualização completa e deixar pelo menos duas chamadas para
   a busca e a geração de links no app.
4. No worker, configure `STYLAI_CATALOG_WORKER_DATABASE_URL`, as credenciais
   e o tracking ID, as coleções e as janelas de atualização e expiração.
   O arquivo `apps/worker/.env.catalog.example` mostra os campos e exemplos
   de coleções. Use um intervalo de atualização menor que a validade
   da oferta, dentro da janela permitida para a conta.

Comandos do processo de catálogo:

```sh
bun run dev:catalog
bun run build
bun run start:catalog
```

`STYLAI_CATALOG_COLLECTIONS` é um array JSON. Cada coleção tem um
`slug` estável, um `label` e uma lista de `searches` com `keywords`.
Pode definir categorias normalizadas e preços em centavos por coleção.
O worker intercala as buscas configuradas e usa páginas e lotes com
tamanho limitado. Para trocar uma coleção, mantenha o slug e altere seus
termos. Ofertas dos termos anteriores somem conforme vencem.

## Atualização e indisponibilidade

O worker usa as consultas oficiais de produtos e gera os links em lote.
Nas consultas seguintes, atualiza as ofertas que o AliExpress devolver de
novo. A ausência em uma página não prova que o produto saiu da loja.
Ofertas antigas ficam disponíveis apenas até seu prazo. A leitura esconde
ofertas expiradas mesmo quando o worker está fora do ar. O worker remove
o conteúdo vencido do catálogo quando volta a operar.

Falhas temporárias geram tentativas com intervalo progressivo. Os logs
mostram a coleção, o resultado do processamento e a quantidade publicada,
sem dados de credenciais. A publicação mantém as verificações de direitos
para o provador separadas.

## Homologação

- Rode `bun run check`, `bun run test:db`, `bun run test:db:private`
  e `bun run test:e2e:catalog`. Os testes da feature usam dados locais e
  respostas simuladas do AliExpress.
- Em staging, comece com uma coleção e verifique a busca inicial, o
  detalhe, os relacionados, a expiração e o botão “Buscar outra”. Compare
  um preço observado com a página da loja, confira o link e acompanhe a
  atribuição permitida pelo programa no portal de afiliados.
- `productdetail.get` ainda precisa ter acesso e resposta conferidos na
  conta. A configuração atual revalida via novas buscas e usa a expiração
  para ofertas ausentes. Uma consulta bem-sucedida e um link gerado são
  verificações distintas do registro de atribuição de comissão.
