# DESIGN.md — Deck Scanner

Resumo do visual. A fonte da verdade são os tokens em `frontend/src/index.css`; este arquivo explica as decisões.

## Direção: Carta

O app tem o traço do objeto que ele lê: chão quase preto, texto marfim, moldura de fio duplo como a borda de uma carta e as cores de mana com função.

## Cor

| Token | Valor | Função |
|---|---|---|
| `night-900` / `night-800` | #0c0d10 / #14151a | chão e painel (neutros, sem tom de violeta) |
| `mist` / `mist-dim` / `mist-faint` | #e9e6dc / #b9b5a8 / #8f8c82 | texto (14,6:1, 9:1 e 5,4:1 sobre o painel) |
| `arcane-400` | #9b7bff | a ação da tela (botão primário), seleção, decks |
| `astral-400` | #4aa3ff | escanear, ao vivo, informação |
| `gold-400` | #e8c15a | coleção, preço, carta valiosa, campeão |
| `fire-400` | #e5533d | torneio |
| `moss` / `ember` / `wine` | verde / âmbar / carmim | só estado: certo, atenção, erro |

- Cada área tem uma cor: o shell grava `data-area` no `<body>` e os componentes usam `area`, `area-soft` e `area-ink` (`bg-area`, `text-area-soft`). Menu, abas, etiquetas, faixas e marcadores seguem a área sozinhos.
- O botão primário é sempre violeta: a cor da área orienta, o violeta age.
- Sem brilho, halo ou degradê decorativo. Elevação (sombra) só no que flutua: menus, janelas, avisos.

## Forma

- Cantos quase retos: etiqueta 2–3 px, controle e painel 4 px, folha 6 px. Círculo só no interruptor.
- Painel (`.glass`) é opaco, com borda de 1 px e um segundo fio por fora. Poço (`.well`) é o que se preenche.
- Marcador da casa é o losango (`.gem`), não a bolinha. Etiqueta (`.badge`) é contorno na cor do tom.
- Faixa cheia na cor da área (`.band`) abre mesas e blocos em destaque.

## Tipografia

- Marcellus: caixa alta com espaçamento nos rótulos, botões, abas e marca; caixa normal nos títulos. Só existe em um peso (sem negrito falso).
- Instrument Sans: texto e nomes próprios (cartas, decks, jogadores).
- JetBrains Mono: números (`.tabular`), placares, preços, relógio e etiquetas.

## Câmera no celular

- A câmera aberta é uma camada no `<body>` (`.cam`): o vídeo ocupa a tela inteira e os controles flutuam por cima. Nenhum aviso muda o tamanho do visor.
- A moldura-guia ocupa cerca de 55% da largura de propósito: a carta fica a um palmo da lente, onde ela foca. Com zoom disponível no aparelho, abre em 2×.
- Nada de `backdrop-filter` em barra ou painel: ele prende `position: fixed` no Safari.

## Não fazer

- Fundo, texto e acento da mesma cor.
- Caixa dentro de caixa; agrupar por espaço e linha.
- Cápsula em botão, etiqueta ou aba.
