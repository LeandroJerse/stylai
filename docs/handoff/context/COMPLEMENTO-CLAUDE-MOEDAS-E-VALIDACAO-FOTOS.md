# Complemento ao trabalho em andamento — moedas e validação de fotos

Este documento complementa o prompt que você já está executando. Incorpore os requisitos ao trabalho em andamento, sem reiniciar a implementação, desfazer trabalho compatível ou recriar funcionalidades prontas. Estas instruções substituem os trechos conflitantes do prompt anterior.

## 1. Correções do front e moedas

- Plano gratuito: **30 moedas**.
- Plano pago: **120 moedas**.
- Use a unidade “moedas” consistentemente.
- Remova a substituição indevida por “12 pedidos”.
- Corrija saldo, plano, mensagens, Perfil, Estúdio e demais telas afetadas, no front oficial e na demo.
- No oficial, o backend deve ser a fonte de verdade do saldo. Não basta mudar o texto.
- Preserve a periodicidade e as regras de concessão já documentadas. Se não estiverem definidas, sinalize; não invente renovação diária/mensal.
- Não redefina automaticamente saldos existentes ao carregar a página nem a cada login.
- Preserve o Estúdio original Procurar/Vestir e os fluxos existentes.

## 2. Três fotos no Perfil

Permita cadastrar, substituir e excluir individualmente:

- Frente: aproximadamente 0°.
- Três quartos: aproximadamente 45°.
- Perfil: aproximadamente 90°.

Remova “Não usada nesta fase” e qualquer bloqueio que impeça cadastrar lateral/perfil.
As fotos devem persistir após recarregar a página.
Não preencha o perfil com fotos fictícias de pessoas.

Permitir três fotos não significa exigir as três para toda geração: valide as fotos exigidas pelo fluxo/provedor existente. Não use silenciosamente a foto de uma posição em outra.

## 3. Validador de fotos com baixo custo

Implemente validação de:

- Arquivo válido, formato, tamanho e resolução.
- Presença de uma pessoa e identificação de múltiplas pessoas.
- Corpo inteiro ou enquadramento suficientemente amplo.
- Compatibilidade aproximada com a posição solicitada no quadro.
- Qualidade mínima para uso no provador.

Priorize um modelo local de detecção de pose, como MediaPipe Pose Landmarker, combinado com regras geométricas e de qualidade. Isso ainda é aprendizado de máquina, mas dispensa cobrança de API por análise.

Referência oficial: https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker?tab=Web

Não assuma que apenas detectar landmarks resolve tudo:

- Configure/teste a detecção de múltiplas pessoas.
- Use confiança e visibilidade dos pontos, sem tratar pontos inferidos fora do enquadramento como corpo visível.
- Classificação frontal/45°/perfil deve usar faixas e tolerâncias calibradas.
- Considere imagens espelhadas e rotação EXIF.
- Não use somente a direção do rosto para determinar a posição do corpo.
- Não prometa verificar identidade, autenticidade da foto ou que as três imagens são da mesma pessoa.

Defina e documente o que significa “grande parte do corpo”. Uma selfie de rosto/ombros não deve ser aprovada para prova corporal. Uma foto adequada para peça superior pode ser insuficiente para calça ou look completo; se necessário, registre capacidades de enquadramento por foto.

## 4. Resultados e experiência

Cada foto deve apresentar estado próprio:

- Analisando.
- Aprovada.
- Precisa de ajuste.
- Não foi possível validar.

Mostre orientações específicas:

- “Afaste a câmera para incluir as pernas.”
- “Use uma foto com apenas uma pessoa.”
- “Gire um pouco o corpo para a posição indicada.”
- “Não conseguimos confirmar a posição; tente outra foto.”

Não rejeite automaticamente toda imagem de baixa confiança como inválida.
Falha ao carregar o modelo é erro técnico, não prova de foto inadequada.
Não substitua uma foto válida existente até a nova passar pelo fluxo de validação.

## 5. Fallback pago somente se necessário

Primeiro avalie o validador local com imagens autorizadas e representativas. Se ele não for suficiente, proponha um modelo de visão econômico como fallback para casos inconclusivos.

Antes de escolher:

- Verifique preços atuais, qualidade e tratamento de imagens.
- Informe custo estimado por validação.
- Limite tentativas e orçamento.
- Reaproveite resultados para a mesma imagem e versão do validador.
- Não repita chamadas a cada renderização ou abertura de tela.
- Não registre fotos ou URLs privadas no Langfuse.

Não execute testes pagos sem informar quantidade/custo e obter autorização.

## 6. Backend e testes

A pré-validação no navegador serve para feedback rápido, mas não deve ser a única garantia para liberar uma geração paga.
O backend deve verificar propriedade, consentimento e status de validação associado à versão exata da foto, sem confiar em um booleano enviado pelo cliente.
Explique como será feita a validação confiável no servidor com o menor custo.

Teste casos reais, além de mocks:

- Foto sem pessoa.
- Selfie fechada.
- Corpo inteiro frontal.
- Três quartos.
- Perfil.
- Duas pessoas.
- Corpo cortado.
- Imagem espelhada.
- Imagem escura/desfocada.
- Falha do validador.
- Substituição e exclusão de foto.
- Persistência após recarregar.

Não considere testes com respostas simuladas suficientes para comprovar a precisão do detector.
Reporte limitações e exemplos de falsos positivos/negativos encontrados.

Implemente sobre o código mais recente, reaproveitando o que já existe. Entregue os links locais do oficial e da demo, com roteiro de teste e separação clara entre recursos reais, simulados e pendentes.
