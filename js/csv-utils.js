// ==========================================================================
// UTILITÁRIO COMPARTILHADO PARA EXPORTAR TABELAS EM CSV
// ==========================================================================
// Usado pelas telas de Visitas, Máquinas e Estoque (botão "Exportar CSV").
// Gera um arquivo .csv com ponto e vírgula como separador (é o que o Excel
// em português espera para abrir as colunas certinho) e um "BOM" no começo
// do arquivo, pra acentuação não vir quebrada ao abrir no Excel.
// ==========================================================================

export function exportarCSV(nomeArquivo, cabecalhos, linhas) {
  const escapar = (valor) => {
    const texto = valor === null || valor === undefined ? "" : String(valor);
    if (/[;"\n\r]/.test(texto)) {
      return `"${texto.replace(/"/g, '""')}"`;
    }
    return texto;
  };

  const conteudoCsv = [cabecalhos, ...linhas]
    .map((linha) => linha.map(escapar).join(";"))
    .join("\r\n");

  // ﻿ (BOM) no início ajuda o Excel a reconhecer o arquivo como UTF-8.
  const blob = new Blob(["﻿" + conteudoCsv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = nomeArquivo;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Gera "visitas-2026-09-10.csv", por exemplo — o prefixo passado + a data
// de hoje no formato AAAA-MM-DD.
export function nomeArquivoComData(prefixo) {
  const hoje = new Date();
  const offset = hoje.getTimezoneOffset();
  const local = new Date(hoje.getTime() - offset * 60000);
  return `${prefixo}-${local.toISOString().slice(0, 10)}.csv`;
}
