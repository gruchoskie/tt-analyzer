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

## Pastas

```
src/
  core/         tipos, relógio sincronizável, ids
  camera/       CameraSource, câmera local, fps, gravação, wake lock, erros de permissão
  calibration/  calibração da mesa (Fase 2)
  tracking/     detector da bola (Fase 3) — interface BallDetector trocável por modelo
  physics/      constantes oficiais e unidades (Fases 4-5)
  pose/         pose do jogador (Fase 6)
  fusion/       lado hub: junta as câmeras
  storage/      IndexedDB
  ui/           telas React
```
