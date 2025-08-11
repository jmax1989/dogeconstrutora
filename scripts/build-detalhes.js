// scripts/build-detalhes.js
const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// URL base da sua API (igual à do HTML)
const API_BASE = 'https://script.google.com/macros/s/AKfycbyQiJpxajuC0alNhKwiyzLH5nldPlQoe4SR8vE-CXE8IvmQNDKJLHrRFeQQkl6gD24e/exec';

// Função para salvar um JSON em /data/fvs
function saveJson(fvs, data) {
  const dir = path.join(__dirname, '..', 'data', 'fvs');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const filePath = path.join(dir, `${fvs}.json`);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
  console.log(`✅ JSON salvo: ${filePath}`);
}

// Função principal
(async () => {
  try {
    console.log('📡 Buscando lista de FVS...');
    const resFvs = await fetch(`${API_BASE}?tipo=fvs`);
    if (!resFvs.ok) throw new Error(`Erro ao buscar FVS: ${resFvs.statusText}`);
    const fvsList = await resFvs.json();

    for (const fvs of fvsList) {
      console.log(`🔍 Processando FVS: ${fvs}`);

      const resDetalhes = await fetch(`${API_BASE}?tipo=apartamento&fvs=${encodeURIComponent(fvs)}`);
      if (!resDetalhes.ok) throw new Error(`Erro ao buscar detalhes para ${fvs}: ${resDetalhes.statusText}`);
      const detalhes = await resDetalhes.json();

      // Filtrar apenas os campos necessários para o HTML
      const dadosFiltrados = {};
      for (const apt of detalhes) {
        dadosFiltrados[apt.apartamento] = {
          duracao_real: apt.duracao_real ?? null,
          duracao_inicial: apt.duracao_inicial ?? null,
          data_abertura: apt.data_abertura ?? null,
          data_termino_inicial: apt.data_termino_inicial ?? null,
          reaberturas: Array.isArray(apt.reaberturas) ? apt.reaberturas : [],
          id: apt.id || null
        };
      }

      saveJson(fvs, dadosFiltrados);
    }

    console.log('🏁 Finalizado com sucesso!');
  } catch (err) {
    console.error('❌ Erro ao gerar JSONs:', err);
    process.exit(1);
  }
})();
