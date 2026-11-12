# TT Analyzer

PWA para analisar jogos de tênis de mesa com a câmera do celular. Todo o processamento roda no navegador,
sem backend. Funciona com 1 celular (modo 2D) e, a partir da Fase 9, com 2+ celulares (modo 3D).

## Status

- [x] **Fase 1 — Base**: PWA instalável e offline, câmera ao vivo com fps real, gravar/parar, sessões no
  IndexedDB, lista e reprodução, tela sempre ligada, mensagens claras de permissão, modo debug.
- [x] **Fase 2 — Calibração**: toque nos 4 cantos da mesa (com lupa para ajustar), homografia para o plano
  da mesa em metros, mesa/rede/grade desenhadas sobre o vídeo, calibração salva no aparelho e em cada sessão
  (também dá para calibrar uma sessão já gravada).
- [x] **Fase 3 — Rastreio da bola**: detector clássico (diferença tripla de quadros + cor + forma) num Web
  Worker com OffscreenCanvas em resolução reduzida, filtro de Kalman para suavizar e preencher falhas, rastro
  sobre o vídeo, taxa de detecção, descarte de quadros quando atrasa. Funciona ao vivo e nas sessões gravadas.
- [x] **Fase 4 — Quiques e direção**: quique pela quebra da trajetória na imagem sobre o tampo, confirmado
  pelo "toc" do áudio (ao vivo e da gravação), posição na mesa em metros, mapa de calor por lado e zona,
  direção da jogada (cruzada, paralela, meio) e saque. Simulador de troca de bola nos testes.
- [x] **Fase 5 — Velocidade**: velocidade média de cada jogada (km/h, com margem ±) por uma parábola 3D
  ajustada entre a batida e o quique, usando a câmera estimada a partir dos cantos da mesa; máxima, média e
  por jogador no mapa; lista de jogadas na reprodução.
- [x] **Fase 6 — Pose do jogador**: MediaPipe Pose Landmarker (lite, até 2 pessoas, WASM e modelo servidos pelo
  próprio app e guardados offline), jogador perto/longe pelos pés na mesa, pico de velocidade do pulso e do
  braço, forehand/backhand pelo lado do corpo, saque pela bola e índice de potência (bola 60% + pulso 40%).
- [x] **Fase 7 — Rallies e placar**: rally pela pausa da bola, trocas, duração e ritmo (jogadas/min), placar
  estimado com regras de 11 pontos e troca de saque (corrigível ponto a ponto ou com +1), estatísticas por lado
  (pontos, jogadas, saques, direções, velocidade).
- [x] **Fase 8 — Relatório**: a análise (quiques, velocidades, golpes, rallies e correções do placar) é salva
  na sessão ao parar a gravação ou ao tocar o vídeo; tela de relatório com placar, rallies, ritmo, velocidade
  máx/média, gráfico de velocidade por jogada (com margem), trocas por rally, mapa de calor e tabela por lado;
  CSVs pt-BR (";" e vírgula decimal) e compartilhar (Web Share com os CSVs, ou copia o resumo).
- [ ] Fase 9 — Multi-câmera

## Rodando

```bash
npm install
npm run dev        # http://localhost:5173 (use --host para abrir no celular)
npm test           # testes unitários (Vitest)
npm run build      # gera dist/ com service worker
```

A câmera só funciona em HTTPS (ou `localhost`). Cada push em `main` (e nos branches das fases em revisão)
é publicado no GitHub Pages pelo workflow `.github/workflows/pages.yml`:
**https://gruchoskie.github.io/tt-analyzer/**

Testes no Chromium com câmera simulada:

```bash
npm run build && npx vite preview --port 4173 &
npm run e2e            # gravar, calibrar, sessões, permissões
npm run e2e:tracking   # gera um vídeo sintético com bola e confere o rastreio ao vivo e na reprodução
npm run e2e:selective  # vídeo com distrações: mesa automática + bola escolhida eliminam falsos candidatos
```

## Uso

1. Prenda o celular na horizontal num tripé vendo a mesa inteira: atrás de uma extremidade, na diagonal ou de lado.
2. Confira o fps no canto superior (verde ≥ 50, amarelo ≥ 25, vermelho abaixo).
3. Toque no botão vermelho para gravar e de novo para parar. Os vídeos ficam em **Sessões**.
4. Toque em **Mesa**: o app tenta achar a mesa sozinho (superfície azul ou verde). Confira os 4 pontos com a
   lupa ou marque à mão na ordem pedida (perto-esquerda, perto-direita, longe-direita, longe-esquerda).
   A grade verde deve coincidir com as linhas da mesa.
5. Toque em **Bola**, segure a bola parada sobre a mesa e toque nela: o rastreio passa a procurar só essa cor.
6. Com o rastreio ligado (Ajustes > Rastrear a bola), o rastro laranja segue a bola; trechos azuis tracejados
   são falhas preenchidas pelo filtro de Kalman. O selo **Bola NN%** mostra a taxa de detecção.
7. Ative o **modo debug** em Ajustes para ver resolução, fps anunciado x medido, maior intervalo entre
   quadros e o carimbo de tempo. Com a mesa calibrada, tocar na imagem mostra a posição em metros.

## Limitações

- Com 1 câmera a análise é no plano da mesa (2D). Altura e efeito só com 2+ câmeras, e efeito sempre como estimativa.
- Velocidades serão estimativas com margem de erro.
- O fps real depende do aparelho e da iluminação.
- No iPhone o Screen Wake Lock exige iOS 16.4+.

Veja [docs/ARQUITETURA.md](docs/ARQUITETURA.md).
