# Deck Scanner

Aponte a câmera para as cartas e receba a decklist pronta para importar na LigaMagic, Moxfield,
Archidekt ou MTG Arena. Arquitetura multi-jogo desde o início; Magic: The Gathering implementado.

**Estado:** Fase 1 (núcleo) completa e funcionando localmente. Fase 2 (coleção e confiança) ainda não iniciada —
o modelo de dados já prevê `PhysicalCard` com localização.

---

## Como rodar

Requisitos: Python 3.13, Node 22.

```powershell
# backend
cd backend
py -3.13 -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements.txt
.\.venv\Scripts\python -m app.indexer catalog   # bulk data da Scryfall → catálogo local (~1 min, baixa ~470 MB)
.\.venv\Scripts\python -m app.indexer hashes    # banco de pHash, 111 mil imagens pequenas (~25 min, retomável)
.\.venv\Scripts\python -m uvicorn app.main:app --port 8420

# frontend (outro terminal)
cd frontend
npm install
npm run dev          # http://localhost:5190 (proxy /api → 8420)
```

**No celular** (a câmera do navegador só funciona em HTTPS): `npm run dev:mobile` e abra
`https://<ip-do-pc>:5190` na mesma rede, aceitando o certificado autoassinado. Gravar um vídeo pelo app de câmera
e enviar funciona sempre, sem HTTPS.

**Um processo só:** `npm run build` no frontend; a API passa a servir a interface em `http://localhost:8420`.

**Modelo multimodal (opcional):** copie `backend/.env.example` para `backend/.env` e preencha `ANTHROPIC_API_KEY`.
Sem chave, tudo funciona; recortes que o hash não resolve vão para a revisão.

Atualizar dados da Scryfall (novas coleções, banlists): rode `catalog` e `hashes` de novo — o `hashes` só processa o
que falta.

---

## Fluxo

1. **Novo scan:** jogo → formato (obrigatório) → vídeo (recomendado) ou fotos.
2. **Captura**
   - *Vídeo ao vivo:* frames a ~10 fps pelo WebSocket; contorno da carta rastreada; bipe e vibração a cada carta lida.
   - *Vídeo gravado:* upload com progresso; o processamento publica cada carta assim que ela é identificada.
   - *Câmera guiada (fotos):* nitidez e reflexo medidos no próprio aparelho antes de aceitar a foto; guia de
     fileiras de até 5 cartas; "imagem tremida, tente de novo".
   - *Fotos da galeria:* arrastar e soltar, até 30, com checagem de qualidade por foto.
3. **Lista incremental** via SSE — as cartas aparecem conforme são lidas.
4. **Revisão:** "Confira primeiro" (não identificadas com posição, possíveis duplicatas lado a lado, repetições do
   vídeo), recorte real × imagem oficial, confiança colorida, busca PT/EN, `+`/`−`, zona, comandante, trocar carta ou
   impressão, adicionar carta que não apareceu. Painel de validação ao vivo.
5. **Exportar:** copiar ou baixar — LigaMagic/genérico (nomes EN ou PT), Moxfield, Archidekt, MTG Arena, CSV de coleção;
   opção de agrupar por tipo.

---

## Arquitetura

```
backend/
  app/
    vision/        detecção de retângulos (OpenCV), correção de perspectiva, qualidade, pHash, índice NumPy, ORB
    pipeline/      cascata de identificação, modo foto, modo vídeo, deduplicação, deck, persistência, modelo multimodal
    rules/         motor de regras genérico + predicados declarativos
    games/         GameAdapter (base, registro) e o adapter de Magic (Scryfall, exportadores, terrenos)
    api.py         REST + SSE (/events) + WebSocket (/live)
  rules/           DADOS: games.json, messages.pt-BR.json, mtg/game.json, mtg/formats/*.json
  tools/           gerador de cenas sintéticas, calibração, teste ponta a ponta, simulador da câmera ao vivo
  tests/           pytest (regras, exportadores, terrenos, API)
frontend/          React + TypeScript + Vite + Tailwind
```

### Cascata de identificação (por recorte, nunca a foto inteira)

1. **Detecção e recorte (local):** contornos em vários mapas de borda → quadriláteros com proporção de carta →
   supressão de contornos internos (caixa de arte/texto) e de blocos de cartas encostadas → perspectiva corrigida.
2. **pHash local (ms, custo zero):** hash de 256 bits da região da arte + hash da carta inteira, contra **111.700**
   impressões físicas. A consulta testa 0°/180° e três recortes (como detectado, sem a margem da sleeve, com a borda
   preta). Banco e consulta passam pela mesma normalização, então a caixa da arte coincide em qualquer moldura e não
   depende do idioma impresso. **A confiança vem da margem** para o melhor candidato de *outra* carta — na calibração
   ela separou acerto de erro perfeitamente.
3. **Verificação ORB (local):** para o que ficou ambíguo, compara pontos-chave com a imagem oficial dos 3 melhores
   candidatos (homografia RANSAC).
4. **Modelo multimodal (opcional):** só no que sobrou; envia o recorte com contexto e exige JSON estruturado
   (nome, set, número de coletor, idioma, acabamento, bbox, vizinhos, confiança).
5. **Resolução canônica:** catálogo local por set+número+idioma → nome → API da Scryfall
   (`/cards/{set}/{number}/{lang}`, fallback `/cards/named?fuzzy=`), com rate limit, User-Agent próprio e cache.

Correções na revisão gravam o pHash do recorte apontando para a carta certa (`learned_hashes`), com bônus na busca.

### Modo vídeo

Agrupamento temporal por **estabilidade**: só frames com a carta parada formam grupos; frames em movimento são
transição. Carta sumindo ou movimento de retirada separa cópias físicas (inclusive básicos idênticos seguidos);
tremida sem mudança de identidade não separa. O melhor frame (nitidez, reflexo, frontalidade) é identificado; se não
resolver, os próximos melhores. Uma consolidação final junta fragmentos da mesma exibição e, numa exibição longa com
mudança de pose no meio, infere uma segunda cópia — sempre com aviso para conferir.

### Modo foto — deduplicação

Registro geométrico entre fotos (cantos de cartas-âncora de identidade única + ORB validado pelas próprias
detecções), composto num referencial comum da mesa. Mesma posição + mesma carta = mesma carta física; isso separa 4
cópias idênticas lado a lado. Arte repetida não serve de âncora (um Lightning Bolt não pode alinhar fotos que não se
sobrepõem). Duas detecções da mesma foto nunca colapsam. Sem registro confiável: impressão + vizinhos; na dúvida,
**"possível duplicata"** para revisão — conta as duas, nunca apaga sozinho.

### Regras são dados

Nenhum `if formato == ...` no código. Cada formato é um JSON em `backend/rules/mtg/formats/` (recarregado ao
salvar, sem reiniciar):

```json
{
  "id": "commander",
  "deck_size": { "exact": 100, "zones": ["deck", "commander"] },
  "copy_limit": 1,
  "copy_limit_exceptions": [
    { "match": "type_line_regex", "value": "\\bBasic\\b.*\\bLand\\b", "limit": null },
    { "match": "oracle_text_regex", "value": "A deck can have (?:any number of|up to (?P<n>\\w+)) cards named", "limit": "from_text" }
  ],
  "legality_key": "commander",
  "requires_commander": true,
  "enforces_color_identity": true
}
```

- Exceções detectadas pelo texto: Relentless Rats, Hare Apparent etc. sem lista fixa; "up to nine" vira teto 9.
- Normalização por `oracle_id`: "Desertos Calcinados" + "Scoured Barrens" violam juntas o singleton.
- Excesso nunca some: `quantity_detected` guarda o que foi encontrado, `quantity` o que entra após as regras, e a
  diferença gera o aviso ("2 cópias de Anel Solar — Commander (EDH) permite 1").
- Lista restrita do Vintage e legalidade vêm de `legalities` da Scryfall; comandante, pares (Partner, Background…)
  e identidade de cor também são declarativos.
- Sugestão de básicos: pips → fontes existentes (terrenos e artefatos de mana) → meta por cor com piso para custos
  de turno 1–2 → distribuição pelo **déficit**, com o raciocínio exibido.

### Adicionar um jogo

1. Uma classe `GameAdapter` (`app/games/base.py`): `resolve_card`, `art_hash_source`, `export_formats`/`export`,
   `identity_rules`, `card_fields`, busca.
2. `rules/<jogo>/game.json` (zonas, idiomas) e `rules/<jogo>/formats/*.json`.
3. Uma linha em `rules/games.json` apontando `"adapter": "pacote.modulo:Classe"`.

O motor de regras, a visão e a interface não mudam.

### Mapeamento do modelo de dados

| Especificação | Implementação |
|---|---|
| ScanSession, CaptureItem, Detection | `scan_sessions`, `capture_items`, `detections` (app.db) |
| PhysicalCard | `physical_cards` (uma por detecção representante; localização pronta para a Fase 2) |
| CardRef | `card_refs` (impressão) + `oracle_cards` (carta) no catalog.db |
| Deck, DeckEntry | `decks`, `deck_entries` (`quantity`, `quantity_detected`, `quantity_override`, `rule_warnings`) |
| CorrectionLog | `correction_log` + `learned_hashes` |

---

## Testes

```powershell
cd backend
.\.venv\Scripts\python -m pytest                       # 25 testes
.\.venv\Scripts\python -m tools.calibrate --n 300 --hard  # detecção + confiança do pHash em cenas sintéticas
.\.venv\Scripts\python -m tools.e2e photos               # 10 fotos sobrepostas de uma mesa sintética
.\.venv\Scripts\python -m tools.e2e video                # vídeo sintético folheando 100 cartas
.\.venv\Scripts\python -m tools.live_client --session <id> --video data/synth/video100/deck.mp4
```

As cenas sintéticas usam imagens oficiais renderizadas como fotografadas: mesa, perspectiva, sleeves, reflexo,
desfoque, ruído, JPEG, sobreposição parcial, cartas cortadas pela borda e, no vídeo, a carta deslizando com borrão de
movimento e mão cobrindo a borda.

## Critérios de aceite da Fase 1

| # | Critério | Resultado |
|---|---|---|
| 1 | Vídeo de 100 cartas → lista e contagem certas | Semente 7: **100/100 exato** (98 por hash, 2 com ORB); semente 8: 98/100, sem sobras. Câmera ao vivo simulada: trecho de 22 cartas exato, 0 frames descartados |
| 2 | 10 fotos sobrepostas → sem carta contada duas vezes | Mesa principal: **22/22 exato**, 4 Lightning Bolts idênticos, 50 ocorrências unificadas. Mesas mais difíceis: 20–22/22; quando uma foto não se registra, pares viram "possível duplicata" para decisão |
| 3 | Carta em PT e em EN = mesma carta | Teste de regra + vídeo: "2 cópias de Desertos Calcinados — Commander permite 1" |
| 4 | Commander: básicos e Relentless Rats livres, Sol Ring reduzido | Teste (inclui Snow-Covered, Nazgûl ≤ 9, Seven Dwarves ≤ 7) |
| 5 | Modern: 4 cópias mantidas, a 5ª avisa | Teste |
| 6 | Coleção não reduz nada | Teste |
| 7 | Carta ilegível gera aviso visível | "Não identificada · posição 27% × 30% da foto 1", com "ver na foto" |
| 8 | Maioria resolve por pHash sem modelo multimodal | 96–100% por hash local nos testes (o modelo nem estava ligado) |
| 9 | Importa sem erro na LigaMagic e no Moxfield | Formatos seguem as convenções documentadas dos importadores (testes unitários); **não validado importando nos sites**, que exigem login |

## Limitações conhecidas

- **Validação feita com cenas sintéticas.** Fotos reais (luz, desgaste, variação de impressão, reflexo de sleeve)
  podem se comportar diferente; o próximo passo é escanear cartas de verdade e recalibrar com `tools/calibrate.py`.
- **Etapa multimodal implementada mas não exercitada** (sem `ANTHROPIC_API_KEY` nesta máquina).
- **Idioma e impressão:** sem o modelo multimodal, o idioma segue o padrão da sessão; quando a mesma arte existe em
  várias coleções a impressão fica marcada como incerta (a carta, para regras e listas por nome, está certa).
- **Cópias idênticas seguidas no vídeo** sem transição visível dependem de heurística (pose/duração) e geram aviso.
- **Muitas cartas empilhadas** numa foto viram "não identificada" quando nenhuma hipótese geométrica resolve.
- Roda localmente (FastAPI + SQLite + ~2 GB de dados); não há deploy.
