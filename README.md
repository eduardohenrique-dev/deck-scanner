# Deck Scanner

Aponte a câmera para as cartas e receba a decklist pronta para LigaMagic, Moxfield, Archidekt ou MTG Arena — e saiba
onde cada carta física da coleção está. Arquitetura multi-jogo; Magic: The Gathering implementado.

**Estado:** Fase 1 (núcleo) e Fase 2 (coleção, conferência, histórico, preços, condição e bracket) completas.
Roda localmente (SQLite, um usuário) ou hospedado (Vercel + Supabase, com login).

---

## Como rodar localmente

Requisitos: Python 3.13, Node 22.

```powershell
# backend
cd backend
py -3.13 -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements-dev.txt
.\.venv\Scripts\python -m app.indexer all       # catálogo da Scryfall + banco de pHash (~30 min na 1ª vez, retomável)
.\.venv\Scripts\python -m uvicorn app.main:app --port 8420

# frontend (outro terminal)
cd frontend
npm install
npm run dev          # http://localhost:5190 (proxy /api → 8420)
```

**No celular** (a câmera do navegador só funciona em HTTPS): `npm run dev:mobile` e abra `https://<ip-do-pc>:5190`
na mesma rede, aceitando o certificado autoassinado.

**Leitura por IA (opcional):** `ANTHROPIC_API_KEY` em `backend/.env` (modelo de `backend/.env.example`). Sem chave
tudo funciona; recortes que o hash não resolve vão para a revisão.

Atualizar dados da Scryfall (coleções novas, banlists): `python -m app.indexer all` de novo — só o que falta é
processado. Game Changers: `python -m tools.sync_game_changers`.

## Hospedagem (Vercel + Supabase)

Um projeto da Vercel com dois [serviços](https://vercel.com/docs/services) no mesmo domínio (`vercel.json`): `web`
(build estático do Vite) e `api` (FastAPI em `backend/`, região `gru1`). O Supabase guarda banco, login e arquivos.

1. Crie um projeto no Supabase (região São Paulo) e preencha `backend/.env.hosted` a partir de `backend/.env.example`
   (URL do *Transaction pooler*, URL do projeto, chaves publishable e secret). O arquivo nunca vai para o git.
2. `python -m tools.hosted check` → `python -m tools.hosted all`: cria as tabelas com RLS ligado, copia o catálogo
   (só as colunas que o servidor lê, ~250 MB) e envia o índice de hashes para o Storage.
3. `vercel link` e `python -m tools.hosted vercel-env`: grava as variáveis no projeto sem passar pelo terminal.
4. No Supabase → Authentication → URL Configuration: *Site URL* e *Redirect URLs* com o domínio da Vercel.

Sem banco e login configurados, a API hospedada responde 503 em vez de abrir sem autenticação.

---

## Fluxo

1. **Nova mesa:** montar lista (formato obrigatório), conferir um deck salvo ou guardar na coleção.
2. **Captura** — misture à vontade na mesma sessão:
   - *Câmera ao vivo:* a visão roda **no navegador** (OpenCV.js num Web Worker): contorno da carta, dicas
     ("segure firme", "reflexo na carta"), aviso sonoro a cada leitura, lanterna, tela sempre acesa; no celular ocupa
     a tela inteira. Só os melhores recortes de cada carta sobem para o servidor.
   - *Vídeo gravado:* lido quadro a quadro no navegador, com progresso; o arquivo não é enviado inteiro.
   - *Fotos da mesa:* várias cartas por foto, checagem de nitidez/reflexo no aparelho, redução antes do envio e
     progresso da leitura em tempo real.
3. **Revisão:** "confira primeiro" (não identificadas com candidatos e busca, possíveis duplicatas lado a lado,
   repetições do vídeo, impressões que não existem), lista agrupada por tipo ou zona com filtro, recorte × imagem
   oficial, idioma/acabamento/condição, comandante, quadro de avisos do formato, valor e bracket.
4. **Guardar:** novo deck, atualizar um deck (a versão anterior vai para o histórico) ou coleção (solto, pasta,
   caixa). A prévia mostra cartas que você já tem em outro lugar: é a mesma carta que mudou de lugar ou outra cópia?
5. **Exportar:** LigaMagic/genérico (nomes PT ou EN), Moxfield, Archidekt, MTG Arena, CSV.

### Fase 2

- **Inventário compartilhado:** cada carta física tem um lugar. A aba *cartas físicas* do deck mostra o que já está
  nele, o que dá para trazer da coleção e o que está preso em outro deck ("este Sol Ring já está alocado no deck
  Atraxa") — tirar de outro deck sempre pede confirmação.
- **Conferência:** escanear um deck salvo mostra faltando, sobrando, trocadas de edição/idioma e trocas prováveis;
  dá para adotar o scan como nova lista.
- **Histórico:** versões a cada scan, conferência ou importação, com diff (entraram, saíram, quantidade, edição).
- **Impressão impossível:** set/número inexistente, idioma ou acabamento que nunca foram impressos viram aviso
  investigativo (leitura errada ou carta falsa?), não bloqueio.
- **Preços e compras:** preço da Scryfall × dólar PTAX do Banco Central, valor do deck e da coleção, achados valiosos,
  lista do que falta com links e texto pronto para a Compra por Lista da LigaMagic.
- **Condição estimada** pela foto (desgaste de borda e cantos → NM/SP/MP/HP), sempre editável.
- **Bracket de Commander (1–5)** com o raciocínio: Game Changers (lista versionada em `rules/mtg/data`), destruição
  em massa de terrenos, turnos extras, tutores e combos de 2 cartas via Commander Spellbook.

---

## Arquitetura

```
backend/
  app/
    vision/        detecção (OpenCV), qualidade, pHash, índice NumPy, ORB, alinhamento de impressão/idioma
    pipeline/      cascata de identificação, fotos, leituras do navegador (sightings), deduplicação, deck, IA
    collection/    locais, inventário, alocação, conferência, salvar scan, impressões, preços, condição, brackets
    api/           REST por área (sessões, entradas, cartas, decks, coleção, sistema)
    games/         GameAdapter e o adapter de Magic (Scryfall, importadores, exportadores, terrenos)
    db.py          mesmo SQL em SQLite (local) e Postgres (hospedado)
    storage.py     disco local ou Supabase Storage
    auth.py        usuário local ou JWT do Supabase
  rules/           DADOS: formatos, mensagens, brackets, Game Changers
  tools/           cenas sintéticas, calibração, e2e, avaliação de idioma, preparação da hospedagem
  tests/           pytest
frontend/
  src/vision/      porta em TypeScript da detecção, qualidade, assinatura e agrupamento temporal (Web Worker)
  src/pages/       taverna, nova mesa, sessão de scan, decks, deck, coleção, login
  src/components/  captura, revisão, deck, símbolos de Magic, UI da taverna
tools-js/          e2e da visão do navegador, perfil de tempo, capturas de tela com emulação de celular
vercel.json        serviços web + api
```

### Cascata de identificação (por recorte, nunca a foto inteira)

1. **Detecção e recorte:** contornos em sete mapas de borda → quadriláteros com proporção de carta → supressão de
   contornos internos e de blocos de cartas encostadas → perspectiva corrigida.
2. **pHash (ms, custo zero):** 256 bits da região da arte + carta inteira contra **111.700** impressões, testando
   0°/180° e três recortes (como detectado, sem margem de sleeve, com a borda). A confiança vem da margem para o
   melhor candidato de *outra* carta.
3. **Verificação ORB** para o que ficou ambíguo (homografia contra a imagem oficial dos melhores candidatos).
4. **Impressão e idioma pela imagem:** a arte alinha o recorte às impressões candidatas e regiões (símbolo de
   coleção, rodapé, nome, linha de tipo, caixa de texto) votam por comparação de gradientes com máscara de reflexo.
   Idioma: 95% de acerto no teste, 100% quando o sistema se declara confiante; o resto fica "idioma não confirmado".
5. **IA (opcional):** só no que sobrou, com JSON estruturado (nome, set, número, idioma, acabamento, confiança).
6. **Resolução canônica:** set+número+idioma → nome → API da Scryfall, com rate limit e cache.

Correções na revisão gravam o pHash do recorte apontando para a carta certa, por usuário.

### Vídeo e câmera ao vivo

Agrupamento temporal por **estabilidade**: só frames com a carta parada formam grupos; carta sumindo ou movimento de
retirada separa cópias físicas (inclusive básicos idênticos seguidos). Os três melhores frames (nitidez, reflexo,
frontalidade) de cada grupo viram uma *leitura*; o servidor identifica e consolida fragmentos da mesma exibição.
A mesma lógica existe em Python (`pipeline/video.py`, referência) e em TypeScript (`frontend/src/vision`).

### Regras são dados

Cada formato é um JSON em `backend/rules/mtg/formats/` (recarregado sem reiniciar): tamanho, limite de cópias com
exceções detectadas pelo texto (Relentless Rats, "up to nine"), legalidade, comandante e identidade de cor.
Normalização por `oracle_id`: "Desertos Calcinados" + "Scoured Barrens" violam juntas o singleton. Excesso nunca
some: `quantity_detected` guarda o que foi lido e o aviso explica a diferença.

### Adicionar um jogo

1. Uma classe `GameAdapter` (`app/games/base.py`).
2. `rules/<jogo>/game.json` e `rules/<jogo>/formats/*.json`.
3. Uma linha em `rules/games.json`. Motor de regras, visão e interface não mudam.

---

## Testes

```powershell
cd backend
.\.venv\Scripts\python -m pytest                          # 36 testes
.\.venv\Scripts\python -m tools.e2e video                   # vídeo sintético de 100 cartas (visão em Python)
.\.venv\Scripts\python -m tools.e2e photos                  # 10 fotos sobrepostas de uma mesa sintética
.\.venv\Scripts\python -m tools.printlang_eval --n 200      # impressão e idioma pela imagem
cd ..
node --experimental-strip-types tools-js/e2e-video.mjs      # mesmo vídeo pela visão do NAVEGADOR (API local rodando)
node tools-js/shot.mjs http://localhost:5190/escanear out.png --width 390   # tela de celular, detecta rolagem lateral
```

## Critérios de aceite

| # | Critério | Resultado |
|---|---|---|
| 1 | Vídeo de 100 cartas → lista certa | **100/100** na visão em Python e na do navegador (detecção a 960 e 800 px) |
| 2 | 10 fotos sobrepostas → sem carta contada duas vezes | Mesa principal **22/22**, 4 Lightning Bolts idênticos |
| 3 | Carta em PT e EN = mesma carta | Teste de regra + vídeo |
| 4–6 | Commander, Modern e Coleção aplicam os limites certos | Testes |
| 7 | Carta ilegível gera aviso visível | "confira primeiro" com posição e "ver na foto" |
| 8 | Maioria resolve sem IA | 96–100% por hash local nos testes |
| 9 | Importa na LigaMagic e no Moxfield | Formatos seguem os importadores (testes); não validado nos sites |
| 10 | Sol Ring do deck A usado no deck B → conflito | Teste + interface: aviso e confirmação antes de mover |
| 11 | Escanear deck salvo aponta faltando/sobrando | Teste + interface (conferência) |
| 12 | Set inexistente para o número → impressão impossível | Teste + aviso na revisão e na importação |

## Limitações conhecidas

- **Validação com cenas sintéticas.** Luz real, desgaste e reflexo de sleeve podem se comportar diferente; o próximo
  passo é escanear cartas de verdade e recalibrar (`tools/calibrate.py`, `tools/printlang_eval.py`).
- **Edição entre reimpressões de arte idêntica** acerta ~72% sem IA; quando incerta, fica marcada ("SET?").
- **Condição pela foto** é estimativa grosseira (bordas e cantos), sempre marcada como "est.".
- **OpenCV.js tem ~13 MB:** baixado uma vez, na primeira captura por câmera ou vídeo.
- **Vídeo gravado** depende do codec que o navegador abre (MP4 H.264 funciona em todos).
