# Mensagem ao Segmind sobre as imagens geradas (NÃO enviada)

Preparada em 2026-11-24, a pedido de Leandro, que decide se e quando envia.

- **Para:** `contact@segmind.com`, o contato do aviso de privacidade do Segmind. O mesmo aviso publica também o contato do encarregado de dados (seção 14): https://www.segmind.com/privacy
- **De:** o e-mail da conta usada no StylAI, para que reconheçam a conta.
- Preencher os campos entre colchetes. Não enviar chave de API, fotos nem endereços das imagens.

## Texto para enviar (inglês)

> **Subject:** Deletion and retention of generated images containing personal data
>
> Hello Segmind team,
>
> We are building StylAI, a virtual try-on app in Brazil, currently in private testing. We call `flux-3-klein-image-edit` through the v1 API, sending a photo of the user and the garments inline as base64. The generated images show the user's face, so we treat them as personal data under Brazilian law (LGPD).
>
> Your documentation says output files have no expiry and are not deleted automatically. We also noticed that the result URLs on `images.segmind.com` open without authentication. Before inviting other users, we need to understand:
>
> 1. **Deleting outputs.** How can we delete a generated image and its URL? Is there an API endpoint, by request ID? If not, can you delete them on request, for specific requests and for the whole account, and how long does it take?
> 2. **Access.** Can outputs be private, with signed or expiring URLs, or not stored at all (for example, returned only in the response)?
> 3. **Inputs.** How long are images sent inline as base64 in a v1 request kept, including in request history, logs and backups? Does the 2-day default for uploaded inputs apply to them?
> 4. **Training.** Are inputs, prompts or outputs used to train or improve any model, by Segmind or by the model provider? If so, how do we opt out?
> 5. **Subprocessors and location.** Which providers process these images for this model, and in which countries?
> 6. **Agreement.** Do you offer a Data Processing Agreement? Please send us a copy.
>
> We have a small number of test images already generated. Please tell us how to have those deleted; we can send the request IDs.
>
> Thank you,
> [NAME]
> [COMPANY OR PROJECT]
> [ACCOUNT E-MAIL]

## Tradução para conferência

> **Assunto:** Exclusão e retenção de imagens geradas que contêm dados pessoais
>
> Olá, equipe Segmind,
>
> Estamos construindo o StylAI, um provador virtual no Brasil, hoje em teste fechado. Chamamos `flux-3-klein-image-edit` pela API v1, enviando a foto da pessoa e as peças dentro do pedido, em base64. As imagens geradas mostram o rosto da pessoa, então as tratamos como dado pessoal pela lei brasileira (LGPD).
>
> A documentação de vocês diz que as saídas não expiram e não são apagadas automaticamente. Também notamos que os endereços em `images.segmind.com` abrem sem autenticação. Antes de convidar outras pessoas, precisamos entender:
>
> 1. **Apagar as saídas.** Como apagamos uma imagem gerada e o endereço dela? Existe uma rota de API, por número de pedido? Se não, vocês apagam a pedido, por pedido e da conta inteira, e em quanto tempo?
> 2. **Acesso.** As saídas podem ser privadas, com endereço assinado ou que expira, ou nem ser guardadas (por exemplo, só devolvidas na resposta)?
> 3. **Entradas.** Por quanto tempo ficam guardadas as imagens enviadas em base64 num pedido v1, incluindo histórico, registros e cópias de segurança? O padrão de 2 dias dos arquivos enviados vale para elas?
> 4. **Treinamento.** Entradas, instruções ou saídas são usadas para treinar ou melhorar algum modelo, por vocês ou pelo dono do modelo? Se sim, como recusamos?
> 5. **Subcontratados e local.** Quais empresas processam essas imagens neste modelo, e em quais países?
> 6. **Contrato.** Vocês oferecem um acordo de tratamento de dados (DPA)? Por favor, enviem uma cópia.
>
> Já temos um pequeno número de imagens de teste. Digam como pedir a exclusão delas; podemos enviar os números dos pedidos.

## O que fazer com a resposta

- **Há rota de exclusão:** apagar no provedor quando a pessoa apagar o look ou a conta, e publicar o texto B do termo.
- **Só a pedido:** rotina manual com registro, e o prazo informado no termo.
- **Não apagam:** reavaliar o provedor antes de abrir para outras pessoas.
- **Guardar a resposta** em `docs/legal/`, sem dados pessoais.
