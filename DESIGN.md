# DESIGN.md — Deck Scanner

Resumo do visual. A fonte da verdade são os tokens em `frontend/src/index.css`; este arquivo explica as decisões.

## Direção: Canal amarelo

Chão amarelo vivo e em movimento, tinta preta, painéis de vidro escuro por cima e letra itálica pesada. A referência é a linguagem de menu de RPG japonês dos anos 2000 (amarelo e preto, blocos enviesados, retícula, letreiro correndo), feita com formas próprias.

## Dois contextos

| | Chão (amarelo) | Vidro (escuro) |
|---|---|---|
| Texto `mist` / `mist-dim` / `mist-faint` | #0b0b0c / #2b2606 / #574a05 | #f7f6f1 / #c6c4bb / #9a988f |
| Ação (`.btn-primary`) | bloco preto, letra amarela, sombra branca | amarelo, letra preta |
| Cor da área (`bg-area` + `text-area-ink`) | bloco preto com a cor na letra | a própria cor com tinta escura |
| Linhas | preto translúcido | branco translúcido |

- Os tokens são os mesmos nos dois: `text-mist` é preto no chão e branco no vidro. Cada superfície escura (`.glass`, `.well`, `.bar-glass`, `.glass-sheet`, `.field`, `.chip`, `.btn-secondary`, qualquer `bg-night-*`) redeclara as variáveis ao entrar. A seção "contexto" do `index.css` tem a lista.
- Uma superfície escura nova que não use essas classes leva `.on-dark`; um trecho claro dentro do vidro leva `.on-ground`.

## Cor

| Token | Valor | Função |
|---|---|---|
| `ground` / `arcane-400` | #ffd80a | o chão, a marca, a ação sobre o vidro, a seleção |
| `night-900` | #0b0b0c | tinta, barras do app |
| `astral-400` | #2ec4ff | escanear, ao vivo, informação |
| `rose-400` | #ff5c9d | decks |
| `tang-400` | #ff9a1f | coleção |
| `fire-400` | #ff4d3d | torneio |
| `gold-400` | #ffc53d | preço, carta valiosa, campeão |
| `moss` / `ember` / `wine` | verde / âmbar / carmim | só estado: certo, atenção, erro |

- O shell grava `data-area` no `<body>`; menu, abas, faixas, borda das barras e o letreiro do fundo seguem a área sozinhos.

## Fundo (`components/Backdrop.tsx`)

Canvas fixo atrás de tudo: retícula que cresce em diagonal e incha perto do ponteiro, anéis segmentados girando com paralaxe, fita preta em diagonal com o nome da área correndo, estrelas que fogem do ponteiro, estouro a cada toque e uma faixa na cor da área que varre a tela ao trocar de seção. Para com a aba oculta e com a câmera aberta; no celular roda a 30 quadros por segundo; com "reduzir movimento" é um quadro parado.

## Forma

- Cantos de 4 px (etiqueta 2–3 px, folha 6 px). A inclinação vem da letra e do corte enviesado: `.btn-primary`, `.slant`, item ativo do menu, indicador das abas.
- Painel (`.glass`): vidro escuro com desfoque do chão, fio claro em cima e sombra dura preta de 5 px. Vidro dentro de vidro perde sombra e desfoque.
- O que está direto no chão (campo, ficha, botão secundário) ganha sombra dura de 3 px (`--lift`); dentro do vidro, não.
- `.pop`: peça que salta na diagonal ao passar o mouse e afunda ao tocar.
- Título de página (`.tilt`) fica 2° torto; título de seção é a etiqueta `.slant`.

## Tipografia

- Barlow Condensed itálica, 700–800, caixa alta: títulos, rótulos, botões, abas, menu e marca.
- Instrument Sans: texto e nomes próprios (cartas, decks, jogadores).
- JetBrains Mono: números (`.tabular`), placares, preços, relógio e etiquetas.

## Marca

Carta preta inclinada sobre o amarelo, cortada pelo feixe do scanner: o feixe é preto fora da carta e amarelo dentro dela. `BrandMark` em `components/icons.tsx`, `public/favicon.svg` e `public/apple-touch-icon.png` usam o mesmo desenho.

## Câmera no celular

- A câmera aberta é uma camada no `<body>` (`.cam`): o vídeo ocupa a tela inteira e os controles flutuam por cima. Nenhum aviso muda o tamanho do visor.
- A moldura-guia ocupa cerca de 55% da largura de propósito: a carta fica a um palmo da lente, onde ela foca. Com zoom disponível no aparelho, abre em 2×.
- As barras do app continuam opacas: `backdrop-filter` numa barra prende `position: fixed` no Safari. Janelas e câmera são portais no `<body>`, fora de qualquer painel de vidro.

## Não fazer

- Texto solto e longo direto no chão: parágrafo vai dentro do vidro; no chão ficam títulos, rótulos e uma linha de apoio.
- Amarelo sobre amarelo ou cor de área como texto no chão (use os tokens: eles já trocam).
- Cápsula em botão, etiqueta ou aba.
