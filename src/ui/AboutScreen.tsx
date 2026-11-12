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
        <li>Celular na horizontal, em tripé, vendo a mesa inteira: atrás de uma extremidade, na diagonal ou de lado. "Perto" é a cabeceira mais próxima da câmera.</li>
        <li>A mesa inteira precisa aparecer na imagem, com boa iluminação.</li>
        <li>Use o modo debug (em Ajustes) para conferir se a câmera entrega perto de 60 fps.</li>
        <li>
          Toque em <strong>Mesa</strong> e marque os 4 cantos. Se mover o tripé, calibre de novo.
        </li>
      </ul>
      <h2>Limitações honestas</h2>
      <ul>
        <li>Com uma câmera, a análise é feita no plano da mesa (2D): altura da bola e efeito não são medidos.</li>
        <li>
          Para o rastreio ficar preso só na bola do jogo: calibre a mesa (o app passa a saber o tamanho da bola em cada
          ponto da imagem e onde o jogo acontece) e toque em <strong>Bola</strong> para escolher a bola. Sem isso, roupas
          brancas e reflexos podem gerar falsos positivos. A taxa de detecção aparece no selo "Bola".
        </li>
        <li>
          <strong>Ginásio com várias mesas, mesa cinza ou chão da mesma cor</strong>: o app não adivinha qual é a sua mesa. Em
          Mesa, toque em <strong>Tocar na mesa</strong> e toque no meio do tampo; confira os 4 pontos com a lupa. Reflexo forte da
          luz no tampo atrapalha: mudar um pouco o ângulo do celular (de preferência atrás da mesa, mais alto) ajuda.
        </li>
        <li>
          <strong>Para não travar</strong>: durante a gravação a pose fica pausada (dá para analisar os golpes depois, na
          reprodução). Se a tela começar a travar, o app pausa a pose e analisa menos quadros sozinho.
        </li>
        <li>A calibração mede bem o que está sobre a mesa (quiques). A bola no ar aparece projetada no plano da mesa.</li>
        <li>
          <strong>Quiques</strong>: detectados pela quebra brusca da bola na imagem (descia e passa a subir) sobre o tampo. A
          posição tem erro típico de 3 a 8 cm (mais em 30 fps). Com som, o "toc" a até 60 ms confirma o quique; o som
          sozinho não localiza nada. Raquetadas e quiques podem se confundir quando a bola é rebatida bem em cima da mesa.
        </li>
        <li>
          <strong>Direção</strong> (cruzada, paralela, meio): pela posição lateral de onde a bola veio e de onde quicou, em
          terços da largura da mesa. É uma classificação simples, sem medir a altura nem o efeito.
        </li>
        <li>
          <strong>Velocidade</strong>: sempre uma estimativa, com margem (±). Com 1 câmera, a altura da bola no ar sai de uma câmera
          aproximada (tirada dos cantos da mesa) e de uma parábola entre a batida e o quique. É a média da jogada; a de saída da
          raquete é um pouco maior, porque o ar freia a bola. Em 30 fps a margem é maior.
        </li>
        <li>
          <strong>Pose e golpes</strong> (opcional, MediaPipe): velocidade do pulso e do braço são estimativas relativas ao quadril
          (a profundidade é chutada a partir de uma imagem). Forehand/backhand pelo lado do corpo em que o pulso está no pico do
          golpe; o saque vem da bola. O <strong>índice de potência</strong> (0–100) mistura a velocidade da bola e a do pulso para
          comparar golpes: não é força. Na 1ª vez baixa ~15 MB; em celulares fracos a pose roda com poucos quadros.
        </li>
        <li>
          <strong>Rallies e placar</strong>: o rally termina quando a bola some por ~2,5 s. O placar é estimado (quem deixou a bola
          quicar por último no próprio lado perde o ponto); bola na rede ou fora da mesa não é vista com certeza, então dá para
          corrigir cada ponto ou somar +1 à mão.
        </li>
        <li>
          <strong>Vários celulares (3D)</strong>: um celular é o hub e os outros são câmeras, pareados por QR (ou código colado) na
          mesma rede Wi-Fi, sem servidor. A sincronia de relógio por pings tem erro de 1 a 5 ms em Wi-Fi bom (aparece na tela);
          a palma ajuda a corrigir o que sobra. O 3D precisa de 2+ câmeras com a mesa calibrada, os postes da rede marcados e o
          mesmo lado "perto". Se uma câmera cai, o app segue com as outras; com 1 só, volta ao 2D.
        </li>
        <li>
          No 3D, <strong>altura sobre a rede, ponto mais alto, ângulos e efeito</strong> são estimativas. O efeito vem da curva
          que a bola faz além da gravidade e do ar (com 60 fps e boa sincronia); com poucos pontos aparece "indefinido".
        </li>
        <li>O fps real depende do aparelho e da luz: em ambientes escuros muitas câmeras caem para 30 fps.</li>
      </ul>
      <p className="muted small">Versão {__APP_VERSION__} · Fase 9 (vários celulares e 3D) · ajustes para ginásio</p>
    </div>
  );
}
