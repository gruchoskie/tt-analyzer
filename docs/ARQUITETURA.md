# Arquitetura

## Papéis: câmera x hub

| Roda no **dispositivo-câmera** | Roda no **hub** |
| --- | --- |
| Captura (`camera/`) | Fusão das câmeras (`fusion/`) |
| Gravação local do vídeo (`camera/SessionRecorder`) | Sincronização de relógios (Fase 9) |
| Calibração da mesa (`calibration/`, Fase 2) | Triangulação 3D (Fase 9) |
| Detecção da bola (`tracking/`, Fase 3) | Métricas (`physics/`), rallies, relatório |
| Pose do jogador (`pose/`, Fase 6) | |

Com **1 celular** (`DeviceRole = 'standalone'`) o mesmo aparelho faz os dois papéis e o deslocamento
de relógio é 0. Com **2+ celulares**, cada câmera envia ao hub apenas detecções 2D carimbadas.

## Contrato de dados

Todo quadro (`FrameMeta`) e toda detecção (`BallDetection2D`) carregam:

- `cameraId` — identificador estável do aparelho (`getLocalCameraId()`),
- `sessionId` — sessão em gravação (ou `null` na pré-visualização),
- `timestamp: SyncedTimestamp` — `localMs`, `offsetMs`, `hubMs = localMs + offsetMs` e `uncertaintyMs`.

`DeviceClock` gera esses carimbos. Hoje o deslocamento é 0; na Fase 9 a sincronização estilo NTP chama
`clock.setOffset(...)` e nada mais muda.

## CameraSource

`camera/CameraSource.ts` define a interface. `LocalCameraSource` usa `getUserMedia` (≈720p, ideal 60 fps,
câmera traseira) e mede o fps real com `requestVideoFrameCallback` (fallback: `requestAnimationFrame`).
Na Fase 9 uma `RemoteCameraSource` (WebRTC) implementará a mesma interface.

## Fusão

`fusion/FusionHub.ts` recebe detecções de N câmeras, ordena pelo relógio do hub, agrupa as simultâneas
(tolerância configurável), espera câmeras atrasadas (janela de latência) e informa o modo:
**3D** só com 2+ câmeras ativas e calibradas; caso contrário, **2D**. Câmeras sem dados recentes saem do
cálculo (degradação suave).

## Armazenamento

IndexedDB via `idb` (`storage/`):

- `sessions` — `SessionRecord` com a lista de câmeras (`SessionCamera[]`) e calibrações por câmera;
- `chunks` — pedaços de vídeo de ~1 s, chave `[sessionId, cameraId, seq]`.

Os pedaços são salvos durante a gravação, então fechar o app ou acabar a bateria não perde o que já foi
gravado: ao abrir, sessões presas em "gravando" viram "interrompidas" e continuam reproduzíveis.
O app pede armazenamento persistente (`navigator.storage.persist()`) na primeira gravação.

## Calibração (Fase 2)

Referencial da mesa em metros, com a câmera atrás de uma extremidade:

- `x` = largura (0 = lateral esquerda, 1,525 = direita), `y` = comprimento (0 = fundo perto, 2,74 = fundo longe);
- rede em `y = 1,37`, linha central em `x = 0,7625`.

O usuário marca os 4 cantos; `computeHomography` (DLT com normalização de Hartley, mínimos quadrados para
N > 4 pontos) gera `H` imagem → mesa, salva em `TableCalibration.homography`. A inversa desenha mesa, rede e
grade sobre o vídeo. `checkCorners` recusa quadriláteros inválidos e avisa sobre ordem trocada ou mesa pequena.
`rescaleCalibration` adapta a calibração a outra resolução de mesma proporção (ex.: análise em resolução
reduzida na Fase 3).

A calibração atual de cada câmera fica no `localStorage` (o tripé costuma ficar no mesmo lugar) e uma cópia
vai para `SessionRecord.calibrations[cameraId]` ao gravar. Uma sessão também pode ser calibrada depois, sobre
o vídeo pausado.

## Rastreio da bola (Fase 3)

```
<video> --quadro--> AnalysisPipeline --ImageBitmap reduzido--> tracker.worker
 (rVFC)             (descarta se ocupado)                     ClassicDetector -> BallTracker (Kalman)
                                                              <-- FrameResult (BallDetection2D, rastro, stats)
```

- **Resolução de análise** padrão 640 px de largura (ajustável: 480/640/960). O quadro é reduzido com
  `createImageBitmap(video, {resizeWidth})` e transferido ao Worker, que lê os pixels num `OffscreenCanvas`.
  Sem OffscreenCanvas (Safari antigo), a redução é feita num canvas da página e o buffer RGBA é transferido.
- **Descarte**: só há um quadro no Worker por vez; se outro chega antes, é descartado e contado.
- **Detector clássico** (`tracking/classicDetector.ts`): pixel conta se mudou em relação aos 2 quadros
  anteriores E tem cor de bola (branca ou laranja) E está na ROI (mesa + espaço acima, a partir da calibração).
  Componentes conexos → filtros de área, preenchimento (disco ≈ 0,785) e alongamento (aceita o borrão de
  movimento). Quadros com mudança global (luz, câmera mexida) são ignorados.
- **Interface trocável**: `BallDetector` (`tracking/BallDetector.ts`) é o contrato para um detector por modelo
  (ONNX/TF.js) no futuro; o resultado já sai como `BallDetection2D` com cameraId, sessionId e timestamp.
- **Rastreador** (`tracking/BallTracker.ts`): Kalman de velocidade constante (também há o modelo de aceleração
  constante, melhor para arcos), associação por distância de Mahalanobis com gate χ² 99%, início exige 2
  detecções seguidas com movimento, até 6 quadros preenchidos por previsão antes de perder o rastro.
- **Seletividade** (depois do primeiro teste real, em que "qualquer coisa puxava a atenção"):
  - **Mesa automática** (`calibration/autoDetect.ts`), refeita após o 2º teste real (mesa cortada no quadro,
    barreira e painel azuis ao lado): cor de referência do tampo (matiz + saturação + brilho, ponderada pelo
    centro-baixo da imagem) → máscara → região central + pedaços vizinhos (rede e linha central partem o
    tampo) → retas candidatas por Hough no contorno, sem a moldura da imagem → escolha das 2 bordas
    "horizontais" + 2 laterais que melhor cobrem a região sem invadir o fundo → refino pelas bordas e pelo
    lado externo da faixa branca de 2 cm → cantos = interseções. Um canto até 20% fora do quadro é estimado
    pelas retas (aviso na calibração); sem a borda de perto visível, recusa ("cortada").
    Funciona de qualquer ângulo (atrás, diagonal, lateral): a busca testa todos os conjuntos de 4 retas, e
    `orderCorners` decide qual par de lados é a cabeceira (1,525 m) pela geometria da perspectiva (procura a
    distância focal que deixa as direções da mesa perpendiculares e na mesma escala; o rótulo errado não
    fecha). "Perto" é a cabeceira mais baixa na imagem. A mesma ordenação vale para os toques manuais.
    Testado em cenas sintéticas por traçado de raios (`calibration/tableScene.ts`).
  - **Prior da calibração** (`tracking/ballPrior.ts`): raio esperado da bola (40 mm) por linha da imagem a
    partir da homografia; região do jogo como polígono (mesa + folga + espaço acima), por linha; velocidade
    máxima plausível (32 m/s) em px/s. Blobs com espessura fora do esperado são descartados.
  - **Bola escolhida** (`tracking/ballProfile.ts`): o usuário toca na bola parada; o app amostra a cor média
    (crescimento de região) e o detector só aceita pixels com a mesma cromaticidade (tolerante a escurecer
    pelo borrão).
  - **Início do rastro** exige 3 detecções seguidas em movimento quase retilíneo, e a associação recusa
    saltos acima da velocidade máxima.
- **Taxas**: `trackedRate` = quadros com detecção / quadros com rastro ativo (qualidade do rastreio, o selo
  "Bola NN%"); `detectionRate` = quadros com detecção / todos os quadros (inclui intervalos sem bola em jogo).

## Quiques, áudio e direção (Fase 4)

- **Quique** (`physics/bounce.ts`, `BounceDetector`): recebe as posições medidas da bola (sem a suavização do
  Kalman, que arredonda a quebra). Em cada ponto ajusta uma reta y(t) antes e outra depois (janela de ~60 ms,
  maior em fps baixo) e mede a quebra vertical em m/s usando a escala local da homografia. Testa também o
  quique entre dois quadros (comum em 30 fps). Máximos locais acima de 2 m/s viram candidatos; o instante é o
  cruzamento das duas retas.
- **Quique x raquetada**: a quebra precisa cair sobre o tampo (homografia, folga de 5 cm). Duas quebras
  seguidas no mesmo lado sem raquetada entre elas não são dois quiques: a segunda é a raquetada do jogador
  daquele lado (vista de trás, a bola no ar se projeta sobre a cabeceira dele). Quebras fora do tampo são
  raquetadas e viram a origem da próxima jogada.
- **Raio da bola**: o centro está 2 cm acima do contato. A posição da câmera é estimada dos 4 cantos
  (`estimateCamera`: distância focal pela perpendicularidade + decomposição da homografia) e o ponto é puxado
  para o pé da câmera na proporção raio/altura.
- **Áudio** (`physics/audioOnsets.ts`): passa-alta de 2ª ordem (~1,5 kHz), energia em blocos de 128 amostras,
  toc = subida rápida (em ~10 ms) de 14 dB acima da mediana dos últimos 400 ms, refratário de 60 ms. Ao vivo
  um AudioWorklet mínimo (criado de uma string) entrega o áudio e o tempo do AudioContext vira relógio local
  por `getOutputTimestamp()` (`camera/liveAudio.ts`); na reprodução a trilha da gravação é decodificada com
  `OfflineAudioContext` (`physics/playbackAudio.ts`). Um toc a até ±60 ms confirma o quique e passa a marcar
  o instante.
- **Direção** (`classifyDirection`): terços da largura; quique no terço central = meio; mesmo terço da origem
  = paralela; terço oposto = cruzada; origem no meio decide pelo deslocamento lateral (≥ 40 cm = cruzada).
  Origem = última raquetada vista ou, sem ela, o quique anterior/início do trecho.
- **Rastreio no quique**: a previsão do Kalman erra feio quando a bola quica; o `BallTracker` aceita um
  candidato no "anel" ao redor da última medida (velocidade parecida, direção nova) e recomeça o filtro dali,
  em vez de perder a bola por vários quadros.
- **Resumo e mapa** (`physics/bounceStats.ts`, `ui/BounceMap.tsx`): contagem por lado, grade 3x3 por meia-mesa
  (curta/média/longa x esquerda/meio/direita), direções, confirmação por áudio; mapa de calor com manchas
  somadas sobre a mesa vista de cima.
- **Testes**: `physics/rallySim.ts` simula trocas de bola (gravidade, restituição, raquetadas) projetadas por
  uma câmera pinhole (`physics/pinhole.ts`) atrás, na diagonal e de lado, em 30 e 60 fps, com ruído e quadros
  perdidos.

## Pastas

```
src/
  core/         tipos, relógio sincronizável, ids
  camera/       CameraSource, câmera local, fps, gravação, wake lock, erros de permissão
  calibration/  calibração da mesa (Fase 2)
  tracking/     detector da bola (Fase 3) — interface BallDetector trocável por modelo
  physics/      constantes, quiques, áudio, direção, simulador (Fases 4-5)
  pose/         pose do jogador (Fase 6)
  fusion/       lado hub: junta as câmeras
  storage/      IndexedDB
  ui/           telas React
```
