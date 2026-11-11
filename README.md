# TT Analyzer

PWA para analisar jogos de tênis de mesa com a câmera do celular. Todo o processamento roda no navegador,
sem backend. Funciona com 1 celular (modo 2D) e, a partir da Fase 9, com 2+ celulares (modo 3D).

## Status

- [x] **Fase 1 — Base**: PWA instalável e offline, câmera ao vivo com fps real, gravar/parar, sessões no
  IndexedDB, lista e reprodução, tela sempre ligada, mensagens claras de permissão, modo debug.
- [x] **Fase 2 — Calibração**: toque nos 4 cantos da mesa (com lupa para ajustar), homografia para o plano
  da mesa em metros, mesa/rede/grade desenhadas sobre o vídeo, calibração salva no aparelho e em cada sessão
  (também dá para calibrar uma sessão já gravada).
- [ ] Fase 3 — Rastreio da bola
- [ ] Fase 4 — Quiques e direção
- [ ] Fase 5 — Velocidade
- [ ] Fase 6 — Pose do jogador
- [ ] Fase 7 — Rallies e placar
- [ ] Fase 8 — Relatório
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

Teste de fumaça no Chromium com câmera simulada:

```bash
npm run build && npx vite preview --port 4173 &
npm run e2e
```

## Uso

1. Prenda o celular na horizontal num tripé, atrás de uma extremidade da mesa, vendo a mesa inteira.
2. Confira o fps no canto superior (verde ≥ 50, amarelo ≥ 25, vermelho abaixo).
3. Toque no botão vermelho para gravar e de novo para parar. Os vídeos ficam em **Sessões**.
4. Toque em **Mesa** e marque os 4 cantos na ordem pedida (perto-esquerda, perto-direita, longe-direita,
   longe-esquerda). Arraste para ajustar. A grade verde deve coincidir com as linhas da mesa.
5. Ative o **modo debug** em Ajustes para ver resolução, fps anunciado x medido, maior intervalo entre
   quadros e o carimbo de tempo. Com a mesa calibrada, tocar na imagem mostra a posição em metros.

## Limitações

- Com 1 câmera a análise é no plano da mesa (2D). Altura e efeito só com 2+ câmeras, e efeito sempre como estimativa.
- Velocidades serão estimativas com margem de erro.
- O fps real depende do aparelho e da iluminação.
- No iPhone o Screen Wake Lock exige iOS 16.4+.

Veja [docs/ARQUITETURA.md](docs/ARQUITETURA.md).
