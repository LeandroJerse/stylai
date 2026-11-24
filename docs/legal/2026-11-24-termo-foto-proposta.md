# Termo de uso da foto: proposta (NÃO publicada)

Preparado em 2026-11-24, a pedido de Leandro. O termo em vigor continua sendo `2026-11-24-inline`. Este texto descreve o que o sistema faz hoje; não é parecer jurídico e precisa de revisão antes de abrir para outras pessoas.

## Por que mudar

O termo atual fala da foto enviada. Não diz que a imagem gerada, com o rosto da pessoa, fica também no provedor.

| Fato | Como sabemos |
| --- | --- |
| A imagem gerada fica em `images.segmind.com` e abre sem login para quem tem o endereço | Conferido em 2026-11-24: 4 de 4 imagens abriram sem chave |
| Não há prazo para apagar a imagem gerada | Documentação do Segmind (Logging; Async inference, "Result expiry") |
| O provedor guarda as instruções e a configuração do pedido | Documentação do Segmind (Logging). O registro do pedido fica 7 dias no histórico |
| Arquivos enviados ficam 2 dias por padrão | Documentação, para arquivos "uploaded". **Não confirmado** para a foto que vai dentro do pedido (FLUX) |
| Se a foto ou a imagem são usadas para treinar modelos | **Não confirmado.** Não achamos a resposta nos termos |
| Apagar foto, look ou conta no StylAI não apaga a cópia do provedor | Nosso código não tem essa chamada; não achamos uma rota de exclusão na documentação |
| No StylAI, a foto dura até 7 dias; a imagem gerada, 7 dias, ou enquanto estiver no Closet | Regra do banco (`assets_check3`) e migração `20261124210000` |

## Texto A: descreve a situação de hoje

Versão sugerida: `2026-11-25-saidas`

> **Uso da minha foto**
>
> Tenho 18 anos ou mais e a foto é minha.
>
> Autorizo o StylAI a guardar minha foto de forma privada e a enviá-la ao provedor de geração (hoje, o modelo FLUX, pela Segmind, empresa dos Estados Unidos) somente para gerar as prévias que eu pedir. No FLUX, a foto vai dentro do próprio pedido, sem link; outros modelos podem recebê-la por um link temporário.
>
> **No StylAI:** a foto expira em até 7 dias nesta fase de testes. A imagem gerada fica 7 dias, ou enquanto eu a mantiver no Closet. Posso apagar minha foto e meus looks guardados quando quiser.
>
> **No provedor:** a Segmind também guarda uma cópia da imagem gerada, com o meu rosto, em um endereço da internet que abre sem senha para quem tiver esse endereço. Segundo a Segmind, essa cópia não tem prazo para ser apagada. Ela também guarda as instruções do pedido. Ainda não confirmamos por quanto tempo guarda a foto enviada, nem se usa essas imagens para outros fins.
>
> **Importante:** apagar minha foto, meus looks ou minha conta no StylAI ainda não apaga a cópia que está na Segmind.
>
> A imagem é uma simulação: caimento, cor e tecido reais podem ser diferentes.

## Texto B: só se a Segmind confirmar a exclusão e ela funcionar

Troca os parágrafos "No provedor" e "Importante". Os campos entre colchetes dependem da resposta.

> **No provedor:** a Segmind guarda uma cópia da imagem gerada por [PRAZO CONFIRMADO]. Quando eu apagar o look ou a conta no StylAI, pediremos também a exclusão dessa cópia, que leva até [PRAZO CONFIRMADO]. [RESPOSTA SOBRE A FOTO ENVIADA E SOBRE TREINAMENTO.]

## Recomendação

1. Enviar a mensagem ao Segmind antes (`2026-11-24-segmind-mensagem-suporte.md`).
2. Enquanto não houver resposta, usar o texto A e não abrir para outras pessoas.
3. Pedir revisão jurídica: transferência para fora do Brasil, imagem de pessoa e direito de exclusão (LGPD).

## O que acontece ao publicar

- Muda o texto e a versão em `apps/web/src/lib/consent.ts` e `PHOTO_POLICY_VERSION` em `packages/contracts/src/photo-validation.ts`. As duas precisam ser iguais (há teste).
- **Todas as contas aceitam de novo.** Até aceitar, ninguém gera imagem.
- Os E2E passam a usar a versão nova. O aceite antigo continua registrado com a data dele.

## Fontes

- https://docs.segmind.com/docs/serverless-api/logging
- https://docs.segmind.com/docs/serverless-api/async-inference
- https://www.segmind.com/privacy
- https://www.segmind.com/terms
