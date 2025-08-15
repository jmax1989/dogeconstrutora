 (cd "$(git rev-parse --show-toplevel)" && git apply --3way <<'EOF' 
diff --git a/README.md b/README.md
index 11556cb58232c1701527d871175381fb57e53bf7..f913a1ed803481af9147eaefac5fb1bb14a49bc6 100644
--- a/README.md
+++ b/README.md
@@ -1,54 +1,57 @@
 # FVS Grid
 
 Visualização de FVS x Apartamentos hospedada no GitHub Pages, com HTML, CSS e JS separados.
 
+## Objetivo do projeto
+Fornecer uma visualização interativa da relação entre as fichas de verificação de serviços (FVS) e os apartamentos, facilitando o acompanhamento das inspeções diretamente no navegador.
+
 ## Estrutura de pastas
 ```
 / (raiz do repositório)
 ├─ index.html
 └─ assets/
    ├─ css/
    │  └─ style.css
    └─ js/
       └─ main.js
 ```
 
-## Executar localmente
-**Opção A**: abrir `index.html` diretamente no navegador.  
-**Opção B** (recomendado): servidor local.
-- Python 3: `python -m http.server 8080`
-- Node (http-server): `npx http-server -p 8080`
-
-Acesse: `http://localhost:8080`.
+## Instalação local
+1. Certifique-se de ter o **Python 3** ou o **Node.js** instalados no sistema.
+2. Clone este repositório e acesse a pasta do projeto.
+3. Inicie um servidor local:
+   - Python 3: `python -m http.server 8080`
+   - Node.js (http-server): `npx http-server -p 8080`
+4. Abra `http://localhost:8080` no navegador para visualizar.
 
-## Publicar no GitHub Pages
-1. Fazer commit de `index.html` e `assets/`.
-2. No repositório: **Settings → Pages**.
-3. Em **Source**, selecionar **Deploy from a branch**.
-4. Branch: **main**. Pasta: **/** (root). Salvar.
-5. URL: `https://SEU_USUARIO.github.io/NOME_DO_REPO/`.
+## Publicação no GitHub Pages
+1. Faça commit de `index.html` e da pasta `assets/` no repositório.
+2. No repositório, acesse **Settings → Pages**.
+3. Em **Source**, selecione **Deploy from a branch**.
+4. Branch: **main** e pasta **/** (root). Salve.
+5. A página ficará disponível em `https://SEU_USUARIO.github.io/NOME_DO_REPO/`.
 
 ## Configuração das fontes de dados
 No arquivo `assets/js/main.js`:
 ```js
 const DATA_BASE = 'https://dogeconstrutora.github.io/doge/data';
 const FVS_LIST_URL = `${DATA_BASE}/fvs-list.json`;
 const APARTAMENTOS_URL = `${DATA_BASE}/apartamentos.json`;
 const ESTRUTURA_CSV = 'https://docs.google.com/spreadsheets/d/e/2PACX-.../pub?output=csv';
 ```
 Ajustar as URLs conforme o local dos arquivos. Os JSON devem estar públicos. A planilha do CSV deve estar publicada (Publish to web).
 
 ## Funcionamento
 1. Carrega `fvs-list.json` e popula o dropdown.
 2. Ao selecionar uma FVS: carrega `apartamentos.json`, filtra pela FVS e busca o CSV da estrutura.
 3. Renderiza o SVG do prédio e habilita o modal de detalhes ao clicar em um apartamento com dados.
 
 ## Personalização
 - Cores: editar variáveis CSS em `:root` no `style.css`.
 - Tamanho padrão das células: `DEFAULT_CELL_WIDTH` e `DEFAULT_CELL_HEIGHT` em `main.js`.
 - Link externo no modal: ajustar na função `abrirModalDetalhes` em `main.js`.
 
 ## Cache busting
 - Renomear arquivos (ex.: `style.v2.css`, `main.v2.js`) e atualizar referências no `index.html`, ou
 - Usar query string (ex.: `style.css?v=2`, `main.js?v=2`).
 
diff --git a/README.md b/README.md
index 11556cb58232c1701527d871175381fb57e53bf7..f913a1ed803481af9147eaefac5fb1bb14a49bc6 100644
--- a/README.md
+++ b/README.md
@@ -58,34 +61,36 @@ Ajustar as URLs conforme o local dos arquivos. Os JSON devem estar públicos. A
 - Erros 403/404/CORS: conferir caminhos e permissões públicas.
 - Modal sem dados: apartamento inexistente no `apartamentos.json` da FVS selecionada.
 
 ## Exemplo mínimo de `apartamentos.json`
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
 
-## Licença
-Adicionar arquivo `LICENSE` na raiz (ex.: MIT).
+## Licença e créditos
+Este projeto está disponível sob a licença MIT; consulte o arquivo `LICENSE` para mais detalhes.
+
+Créditos: equipe da Doge Construtora e demais colaboradores.
 
 ## Checklist de deploy
 - [ ] `index.html` na raiz
 - [ ] `assets/css/style.css` e `assets/js/main.js` nos caminhos corretos
 - [ ] URLs de dados revisadas
 - [ ] GitHub Pages ativado em Settings → Pages
 - [ ] Teste da URL pública em janela anônima
 
EOF
)
