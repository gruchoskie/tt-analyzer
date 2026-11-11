/** Tradução dos erros de getUserMedia em mensagens claras para o usuário. */

export type CameraErrorKind =
  | 'insecure'
  | 'unsupported'
  | 'denied'
  | 'not-found'
  | 'busy'
  | 'overconstrained'
  | 'unknown';

export interface CameraErrorInfo {
  kind: CameraErrorKind;
  title: string;
  message: string;
  /** Faz sentido oferecer "Tentar de novo". */
  canRetry: boolean;
}

export function describeCameraError(err: unknown): CameraErrorInfo {
  const name = (err as { name?: string } | null)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return {
        kind: 'denied',
        title: 'Permissão de câmera negada',
        message:
          'O TT Analyzer precisa da câmera para gravar e analisar o jogo. Toque no cadeado ou no ícone de câmera ' +
          'na barra de endereço (ou em Ajustes do sistema > navegador > Câmera) e permita o acesso. Depois toque em "Tentar de novo".',
        canRetry: true,
      };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return {
        kind: 'not-found',
        title: 'Nenhuma câmera encontrada',
        message: 'Não encontramos uma câmera neste aparelho. Verifique se outra câmera está conectada ou use outro celular.',
        canRetry: true,
      };
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return {
        kind: 'busy',
        title: 'Câmera ocupada',
        message:
          'A câmera está sendo usada por outro app ou aba. Feche apps de câmera, chamadas de vídeo ou outras abas e tente de novo.',
        canRetry: true,
      };
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return {
        kind: 'overconstrained',
        title: 'Configuração de câmera não suportada',
        message: 'A câmera escolhida não aceita a configuração pedida. Tente outra câmera na lista.',
        canRetry: true,
      };
    case 'NotSupportedError':
      return {
        kind: 'unsupported',
        title: 'Câmera indisponível neste navegador',
        message:
          'O navegador não conseguiu pedir acesso à câmera. Abra o app no Chrome (Android) ou Safari (iPhone), fora de abas anônimas ou apps embutidos.',
        canRetry: true,
      };
    case 'SecurityError':
      return {
        kind: 'insecure',
        title: 'Conexão não segura',
        message: 'O navegador só libera a câmera em páginas HTTPS. Abra o app pelo endereço https://.',
        canRetry: false,
      };
    default:
      return {
        kind: 'unknown',
        title: 'Não foi possível abrir a câmera',
        message: `Ocorreu um erro inesperado${name ? ` (${name})` : ''}. Tente de novo ou reinicie o navegador.`,
        canRetry: true,
      };
  }
}

/** Verificações antes de chamar getUserMedia. Retorna null se estiver tudo certo. */
export function checkCameraSupport(env: {
  isSecureContext: boolean;
  hasGetUserMedia: boolean;
  hasMediaRecorder: boolean;
}): CameraErrorInfo | null {
  if (!env.isSecureContext) {
    return {
      kind: 'insecure',
      title: 'Conexão não segura',
      message: 'O navegador só libera a câmera em páginas HTTPS (ou localhost). Abra o app pelo endereço https://.',
      canRetry: false,
    };
  }
  if (!env.hasGetUserMedia) {
    return {
      kind: 'unsupported',
      title: 'Navegador sem acesso à câmera',
      message: 'Este navegador não oferece acesso à câmera. Use o Chrome (Android) ou o Safari (iPhone) atualizados.',
      canRetry: false,
    };
  }
  if (!env.hasMediaRecorder) {
    return {
      kind: 'unsupported',
      title: 'Navegador sem gravação de vídeo',
      message: 'Este navegador não consegue gravar vídeo (MediaRecorder). Use o Chrome (Android) ou o Safari 14.5+ (iPhone).',
      canRetry: false,
    };
  }
  return null;
}

/** Mensagem para quando a câmera abriu, mas o microfone foi negado. */
export const MIC_DENIED_NOTICE =
  'Microfone não liberado: vamos gravar só o vídeo. A detecção de quiques por áudio (Fase 4) ficará menos precisa.';
