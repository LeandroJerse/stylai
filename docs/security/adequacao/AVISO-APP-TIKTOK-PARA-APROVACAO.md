# Aviso de privacidade — aplicativo StylAI e integração TikTok Shop

**MINUTA 1.0 PARA APROVAÇÃO — 22/11/2026. Não publicada.**
Este texto descreve o piloto atual e identifica integrações futuras. A aprovação editorial não libera integrações nem substitui os testes e confirmações do anexo técnico.

## 1. Responsável e contato

A STYLAI INOVA SIMPLES(I.S.) é responsável pelo tratamento de dados descrito neste aviso. Para dúvidas ou solicitações de privacidade, escreva para **stylaioficial@gmail.com**. A empresa ainda não nomeou formalmente um encarregado de dados. O contato indicado atende questões operacionais de privacidade.

Este aviso trata do aplicativo e da preparação da integração TikTok Shop. O pré-cadastro do site possui aviso próprio em https://stylai.shop/privacidade.

## 2. Estado do serviço

O aplicativo está em desenvolvimento e piloto controlado. O ambiente verificado utiliza serviços locais e geração simulada. A existência de um adaptador de fornecedor no código não significa que suas fotos tenham sido enviadas a ele. A integração TikTok Shop ainda não está comprovada de ponta a ponta.

Antes de habilitar processamento externo de fotos ou novas categorias de dados, informaremos o fornecedor, a finalidade e as condições aplicáveis. Este aviso não autoriza indiscriminadamente fornecedores futuros.

## 3. Dados e finalidades

| Dados | Finalidade |
|---|---|
| Identificador da conta, e-mail, informações de autenticação e sessão | Criar e proteger o acesso ao aplicativo e associar seus dados à sua conta |
| Versão e registro de aceite do termo de uso de fotos | Registrar a escolha do usuário e impedir envio sem o aceite exigido |
| Fotos fornecidas, ângulo, enquadramento, pose e resultados de validação | Avaliar se a imagem pode ser usada no provador e preparar a funcionalidade solicitada |
| Consultas de busca, produtos escolhidos, imagens de peças, jobs e resultados | Buscar peças e apresentar as simulações solicitadas |
| Registros técnicos de falhas, execução e custos | Operar, diagnosticar falhas, proteger o serviço e controlar consumo |
| Solicitações de suporte e privacidade | Responder ao pedido e manter evidência mínima do atendimento |

A validação de pose não tem como finalidade identificar pessoas por reconhecimento facial. Isso não elimina o caráter pessoal das fotos nem dispensa avaliar eventual tratamento de dados sensíveis antes de novas funcionalidades.

A negativa ao uso de fotos impede as funções que dependem dessas imagens. Não equivale a consentimento para publicidade ou treinamento de modelos.

## 4. Fundamentos do tratamento

Para fotos no provador, a proposta é utilizar autorização específica, destacada e revogável, vinculada à finalidade informada. O aplicativo já exige registro de aceite de versão do termo; o conteúdo desse termo precisa corresponder a esta finalidade e aos destinatários efetivamente ativados.

Para criação de conta e execução de funções solicitadas, a proposta é tratar os dados necessários à prestação do serviço. Segurança, registros obrigatórios e defesa de direitos devem ter fundamento próprio documentado conforme o tratamento concreto, sem utilizar um consentimento genérico para todos os usos.

**Nota de revisão interna: validar o enquadramento de cada operação, inclusive dados sensíveis e transferências internacionais, antes da publicação. Esta nota e a redação propositiva devem ser resolvidas na versão final.**

## 5. Integração TikTok Shop

A finalidade prevista é consultar e apresentar produtos e links disponíveis ao criador autorizado no Brasil, conforme as permissões efetivamente concedidas pelo TikTok Shop.

O escopo técnico em preparação contempla identificadores de conexão/criador, permissões e validade da autorização, credenciais de acesso mantidas no servidor e dados de catálogo, como identificador do produto, título, categoria, imagem, preço e link quando disponíveis. Não se deve solicitar dados de compradores, pedidos ou mensagens para esse escopo sem nova necessidade demonstrada e revisão deste aviso.

A autorização pode ser recusada ou revogada. A conexão é opcional e sua revogação impede as funções dependentes dela. A implementação completa da revogação e limpeza ainda está em validação; não anunciamos essa integração como disponível neste piloto.

O acesso a imagens de produtos pela API não concede automaticamente permissão para enviá-las a modelos de IA. O uso de imagens TikTok no provador está bloqueado enquanto os direitos necessários não forem confirmados. Não enviaremos fotos pessoais ao TikTok apenas para consultar o catálogo.

## 6. Prestadores e locais de tratamento

- **Piloto local:** processamento do aplicativo, banco e arquivos na estação de desenvolvimento no Brasil, com software Supabase local e validação local de pose.
- **Backup:** arquivos criptografados enviados ao Google Drive, em conta controlada pelo responsável e com acesso restrito. Não presumimos armazenamento exclusivamente no Brasil.
- **Site de pré-cadastro:** hospedagem Vercel e banco Supabase gerenciado, distintos do banco local do piloto. O projeto identificado para o pré-cadastro usa a região us-east-2, nos Estados Unidos. O tratamento da lista é detalhado no aviso do site.
- **TikTok Shop:** integração prevista, limitada às permissões autorizadas e condições aplicáveis. Destinatários e transferências precisam ser confirmados antes da ativação.
- **Geração externa e telemetria:** existem adaptadores Segmind/fal, relay Cloudflare e exportação opcional de telemetria. Sua ativação, destinatários, retenção e locais de tratamento devem ser verificados e informados antes do uso real. Não os apresentamos como destinatários atuais comprovados das fotos.

Dados podem ser tratados fora do Brasil quando um prestador efetivamente utilizado operar no exterior. As localidades e o mecanismo aplicável à transferência devem ser documentados antes de habilitar novos fluxos. A mera aceitação deste aviso não substitui essas garantias.

## 7. Retenção e exclusão

Fotos e resultados são mantidos enquanto necessários à função solicitada, considerando pedido de exclusão, encerramento da conta/finalidade e obrigações aplicáveis. Prazos específicos das categorias e sua execução automática serão informados na versão final antes da abertura do aplicativo a novos usuários.

A política interna prevê até 30 dias para logs operacionais sanitizados e backups. O fluxo de backup diário criptografado e retenção de 30 dias está configurado; sua execução depende da disponibilidade do ambiente. Isso não significa que todas as categorias do aplicativo já tenham expurgo automatizado.

Cópias de segurança não são utilizadas para atendimento normal do aplicativo. Ao restaurar, exclusões aplicáveis devem ser reaplicadas antes de disponibilizar dados. Esse procedimento ainda precisa de validação integral. Não prometemos remoção imediata de todas as cópias.

Dados TikTok devem respeitar os prazos e regras aplicáveis do fornecedor, inclusive na revogação. O cache técnico temporário não substitui a exclusão integral da conexão, credenciais e derivados.

## 8. Direitos e atendimento

Você pode solicitar confirmação do tratamento, acesso, correção, informações sobre compartilhamento, revogação de consentimento e, quando aplicável, anonimização, bloqueio, eliminação ou portabilidade. Também pode apresentar petição à ANPD.

Use **stylaioficial@gmail.com** e descreva o pedido. Poderemos verificar sua identidade de maneira proporcional para evitar entrega ou exclusão indevida de dados. Não envie senhas, códigos de autenticação ou chaves de recuperação. Informaremos o andamento e eventuais limitações justificadas, observados os prazos aplicáveis.

A exclusão completa de conta ainda não está disponibilizada de ponta a ponta no piloto. O canal de contato atende solicitações; recebimento não significa conclusão automática da exclusão.

## 9. Proteção e alterações

O ambiente verificado utiliza proteção antimalware, firewall, criptografia do disco, controles de sessão e acesso a imagens e backups criptografados. Essas medidas reduzem riscos, mas não são garantia de segurança absoluta nem certificação.

Mudanças relevantes de finalidade, dados ou destinatários serão informadas antes de novos tratamentos. Quando uma nova autorização for necessária, ela será solicitada separadamente.

---

## Fontes de revisão, fora do texto público

- Direitos dos titulares, ANPD: https://www.gov.br/anpd/pt-br/assuntos/titular-de-dados-1/direito-dos-titulares
- Transferências internacionais, ANPD: https://www.gov.br/anpd/pt-br/assuntos/assuntos-internacionais/transferencia-internacional-de-dados
- TikTok DSPR: https://partner.tiktokshop.com/docv2/page/data-security-and-privacy-review (consulta automatizada não retornou conteúdo integral; conferir no portal autenticado).
- Evidências internas: MATRIZ-TIKTOK.md, POLITICAS-PARA-APROVACAO.md, ROTINA-BACKUP-DIARIO.md, apps/api/src/modules/photos/routes.ts, apps/api/src/modules/integrations/tiktok/routes.ts, apps/worker/src/server.ts e landingpage/README.md.
