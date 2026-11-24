/**
 * Photo term shown in Perfil. Describes today's technical behaviour; retention is not a final rule.
 * The version must match PHOTO_POLICY_VERSION (packages/contracts): a new text is a new version, accepted again by everyone.
 */
export const CONSENT_VERSION = "2026-11-24-inline"
export const CONSENT_TEXT =
  "Autorizo o StylAI a guardar minha foto de forma privada e a enviar essa imagem ao provedor de geração (hoje, o modelo FLUX pela Segmind) somente para gerar as prévias que eu pedir. No FLUX o arquivo da foto vai dentro do próprio pedido, sem link; outros modelos podem recebê-la por um link temporário. Nesta fase de testes a foto expira em até 7 dias (regra provisória) e pode ser apagada por mim a qualquer momento."
