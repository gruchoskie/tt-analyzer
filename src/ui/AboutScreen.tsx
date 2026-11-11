import { navigate } from './route';

export function AboutScreen() {
  return (
    <div className="page prose">
      <header className="page-header">
        <button className="btn" onClick={() => navigate({ name: 'camera' })}>
          ← Câmera
        </button>
        <h1>Sobre o TT Analyzer</h1>
      </header>
      <p>
        Tudo roda no seu celular: os vídeos e as métricas ficam salvos só neste aparelho (no navegador). Nada é enviado para
        servidores.
      </p>
      <h2>Como posicionar</h2>
      <ul>
        <li>Celular na horizontal, em tripé, atrás de uma das extremidades da mesa.</li>
        <li>A mesa inteira precisa aparecer na imagem, com boa iluminação.</li>
        <li>Use o modo debug (em Ajustes) para conferir se a câmera entrega perto de 60 fps.</li>
      </ul>
      <h2>Limitações honestas</h2>
      <ul>
        <li>Com uma câmera, a análise é feita no plano da mesa (2D): altura da bola e efeito não são medidos.</li>
        <li>Velocidades serão sempre estimativas, com margem de erro indicada.</li>
        <li>Efeito (spin) só poderá ser estimado com 2 ou mais celulares, e ainda assim como estimativa.</li>
        <li>Entre celulares, a sincronia de tempo tem erro de alguns milissegundos.</li>
        <li>O fps real depende do aparelho e da luz: em ambientes escuros muitas câmeras caem para 30 fps.</li>
      </ul>
      <p className="muted small">Versão {__APP_VERSION__} · Fase 1 (gravação e sessões)</p>
    </div>
  );
}
