# FVS Grid — Guia Rápido (README)

Visualização de FVS x Apartamentos hospedada no GitHub Pages, com HTML, CSS e JS separados.

## 🔧 Estrutura de Pastas

```
/ (raiz do repositório)
├─ index.html
└─ assets/
   ├─ css/
   │  └─ style.css
   └─ js/
      └─ main.js
```

> Coloque **index.html** na raiz e os arquivos **style.css** / **main.js** dentro de `assets/`.

---

## ▶️ Rodar Localmente

### Opção A) Duplo clique
Abra o `index.html` no navegador (funciona para testes simples).

### Opção B) Servidor local (recomendado)
Evita problemas de CORS e path:
- **Python** (3.x): `python -m http.server 8080`
- **Node (http-server)**: `npx http-server -p 8080`
Depois acesse: `http://localhost:8080`

---

## 🚀 Publicar no GitHub Pages

1. Faça **commit** de `index.html` e da pasta `assets/`.
2. No GitHub do repositório: **Settings → Pages**.
3. Em **Source**, escolha **Deploy from a branch**.
4. Branch: **main** (ou `master`) e **/ (root)** como pasta. Salve.
5. A URL ficará no formato: `https://SEU_USUARIO.github.io/NOME_DO_REPO/`.

> Se você estiver usando **user/organization site** (repositório `SEU_USUARIO.github.io`), o `index.html` **precisa** ficar na raiz.

---

## 🗂️ Onde ficam os dados

No JS (`assets/js/main.js`) há estas variáveis:
```js
const DATA_BASE = 'https://dogeconstrutora.github.io/doge/data';
const FVS_LIST_URL = `${DATA_BASE}/fvs-list.json`;
const APARTAMENTOS_URL = `${DATA_BASE}/apartamentos.json`;
const ESTRUTURA_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-.../pub?output=csv';
```
- **Troque** `DATA_BASE` e as URLs se seus arquivos estiverem em outro local.
- `fvs-list.json` e `apartamentos.json` precisam estar publicamente acessíveis.
- O CSV da estrutura vem de uma planilha pública (modo **publish to web**).

---

## 🧩 Como funciona (resumo)

1. **Dropdown** carrega a lista de FVS a partir de `fvs-list.json`.
2. Ao selecionar uma FVS, o app:
   - busca `apartamentos.json` e filtra os itens desta FVS;
   - busca o **CSV** de estrutura, calcula o grid (larguras/alturas) e grupos de células;
   - desenha o **SVG** com os apartamentos;
   - cada célula abre um **modal** com os detalhes do apartamento, quando há dados.

---

## 🛡️ Boas práticas

- **Sem tokens/chaves no front-end.** Se precisar acessar APIs privadas, use um **proxy** (Cloudflare Workers, Netlify Functions, etc.).
- Imagens/ícones: prefira SVG embutido ou arquivos **.svg** em `assets/`.
- Mantenha o código organizado em `assets/css` e `assets/js`.

### Formatação e lint (opcional, mas recomendado)
Crie estes arquivos na **raiz** para padrão de código:
- `.editorconfig`
- `.prettierrc`
- `.eslintrc.json`

> Eu já te enviei modelos prontos numa mensagem anterior. Se quiser, posso incluí-los neste repo.

---

## ♻️ Cache Busting (quando atualizar arquivos)

Navegadores podem guardar o CSS/JS em cache. Quando fizer mudanças grandes:
- Renomeie arquivos: `style.v2.css`, `main.v2.js` **e** atualize as referências no `index.html` **ou**
- Adicione query string: `style.css?v=2`, `main.js?v=2`

> O GitHub Pages também pode atrasar minutos entre um push e a página atualizada.

---

## 🩺 Troubleshooting

- **Dropdown travado em “Carregando FVS...”**  
  Verifique se `fvs-list.json` existe e está público; veja erros no **Console** (F12 → Console).
- **SVG não aparece**  
  Confira a URL do **CSV** e se a planilha está publicada (Publish to web).
- **CORS / Erros 403/404**  
  Os arquivos remotos precisam estar públicos e com caminho correto.
- **Modal abre sem dados**  
  O apartamento clicado pode não existir no `apartamentos.json` da FVS atual.

---

## 🧱 Estrutura mínima do `apartamentos.json` (exemplo)

```json
[
  {
    "fvs": "FVS-123",
    "apartamento": "301",
    "data_abertura": "2025-07-01",
    "data_termino_inicial": null,
    "duracao_inicial": 10,
    "percentual_ultima_inspecao": 65,
    "qtd_pend_ultima_inspecao": 2,
    "duracao_reaberturas": 3,
    "duracao_real": 13,
    "termino_final": null,
    "reaberturas": [
      { "codigo": "102", "data_abertura": "2025-07-10", "qtd_itens_pendentes": 2 }
    ],
    "id_ultima_inspecao": "abcdef"
  }
]
```

---

## 📦 Atualizações comuns

- **Trocar a paleta**: edite as **CSS variables** no topo de `style.css` (`:root { --blue, --green, ... }`).
- **Ajustar tamanho das células**: mude `DEFAULT_CELL_WIDTH/HEIGHT` no `main.js` ou edite o CSV publicado.
- **Remover/Editar o link do Inmeta**: dentro de `abrirModalDetalhes` em `main.js`.

---

## 📚 Licença
Defina a licença que preferir (ex.: MIT) criando um arquivo `LICENSE` na raiz.

---

## ✅ Checklist de Deploy

- [ ] `index.html` na raiz
- [ ] `assets/css/style.css` e `assets/js/main.js` nos caminhos corretos
- [ ] URLs de dados (`DATA_BASE`, `...json`, `CSV`) revisadas
- [ ] GitHub Pages ativado em **Settings → Pages**
- [ ] Testar a URL pública em modo anônimo/privado
