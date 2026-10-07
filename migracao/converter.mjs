// ==========================================================================
// CONVERSÃO DOS DOCUMENTOS DO FIRESTORE PARA AS TABELAS DO SUPABASE
// ==========================================================================
// Funções "puras" (sem acesso à rede), usadas por migrar.mjs. Cada uma
// recebe o documento do Firestore (id + dados) e o mapa de usuários
// (uid antigo do Firebase -> id novo do Supabase) e devolve a linha pronta
// para a tabela. Dados antigos/incompletos recebem valores padrão em vez de
// travar a migração.
// ==========================================================================

const ISO_DATA = /^\d{4}-\d{2}-\d{2}$/;
const LINK_GOOGLE = /^https:\/\/([a-z0-9-]+[.])*google[.]com\//;

/** Texto limpo com tamanho máximo. */
export function txt(valor, max, padrao = "") {
  if (valor === null || valor === undefined) return padrao;
  return String(valor).slice(0, max);
}

/** Texto obrigatório: se vier vazio, usa o padrão. */
function txtObrig(valor, max, padrao) {
  const t = txt(valor, max).trim();
  return t || padrao;
}

function umDe(valor, opcoes, padrao) {
  return opcoes.includes(valor) ? valor : padrao;
}

/** Timestamp do Firestore (ou Date/texto) -> texto ISO, ou null. */
export function ts(valor) {
  if (!valor) return null;
  let d = null;
  if (typeof valor.toDate === "function") d = valor.toDate();
  else if (valor instanceof Date) d = valor;
  else if (typeof valor === "string" || typeof valor === "number") d = new Date(valor);
  else if (typeof valor._seconds === "number") d = new Date(valor._seconds * 1000);
  return d && !isNaN(d.getTime()) ? d.toISOString() : null;
}

/** "AAAA-MM-DD" válido, ou o padrão. */
function dataISO(valor, padrao = "") {
  if (typeof valor === "string" && ISO_DATA.test(valor) && !isNaN(new Date(valor + "T00:00:00Z").getTime())) {
    return valor;
  }
  return padrao;
}

function dataDeTimestamp(valor) {
  const iso = ts(valor);
  return iso ? iso.slice(0, 10) : null;
}

function hoje() {
  return new Date().toISOString().slice(0, 10);
}

function mapUid(mapa, uid) {
  return uid && mapa.has(uid) ? mapa.get(uid) : null;
}

// ------------------------------------------------------------------ TABELAS

export function converterUsuario(uidNovo, d) {
  return {
    id: uidNovo,
    nome: txtObrig(d.nome, 120, String(d.email || "Usuário").split("@")[0]),
    email: String(d.email || "").trim().toLowerCase(),
    papel: umDe(d.papel, ["tecnico", "admin"], "tecnico"),
    criado_em: ts(d.criadoEm) || new Date().toISOString(),
  };
}

export function converterChamado(id, d, mapa) {
  const status = umDe(d.status, ["aberto", "andamento", "resolvido"], "aberto");
  const criado = ts(d.criadoEm) || ts(d.atualizadoEm) || new Date().toISOString();
  const atualizado = ts(d.atualizadoEm) || criado;
  const responsavel = mapUid(mapa, d.responsavelUid);
  return {
    id,
    numero: txt(d.numero ?? d.titulo, 100),
    area: txt(d.area ?? d.setor, 200),
    atividade: txt(d.atividade ?? d.descricao, 5000),
    prioridade: umDe(d.prioridade, ["baixa", "media", "alta"], "media"),
    status,
    responsavel_uid: responsavel,
    responsavel_nome: responsavel || d.responsavelNome ? txt(d.responsavelNome, 120, null) : null,
    criado_por_uid: mapUid(mapa, d.criadoPorUid),
    criado_por_nome: txt(d.criadoPorNome, 120, null),
    criado_em: criado,
    atualizado_em: atualizado,
    resolvido_em: status === "resolvido" ? (ts(d.resolvidoEm) || atualizado) : null,
  };
}

export function converterRelatorio(id, d, mapa) {
  let atividades = Array.isArray(d.atividades) ? d.atividades : [];
  atividades = atividades.slice(0, 100).map((a) => ({
    categoria: txt(a && a.categoria, 200),
    atividade: txt(a && a.atividade, 2000),
    quantidadeArea: txt(a && a.quantidadeArea, 200),
    status: umDe(a && a.status, ["concluido", "andamento", "pendente"], "concluido"),
  }));
  if (atividades.length === 0 && d.descricao) {
    atividades = [{ categoria: "", atividade: txt(d.descricao, 2000), quantidadeArea: "", status: "concluido" }];
  }
  const criado = ts(d.criadoEm) || new Date().toISOString();
  return {
    id,
    tecnico_uid: mapUid(mapa, d.tecnicoUid),
    tecnico_nome: txt(d.tecnicoNome, 120, null),
    data: dataISO(d.data, dataDeTimestamp(d.criadoEm) || hoje()),
    atividades,
    resumo: txt(d.resumo, 5000),
    criado_em: criado,
    atualizado_em: ts(d.atualizadoEm) || criado,
  };
}

export function converterMaquina(id, d) {
  const criado = ts(d.criadoEm) || new Date().toISOString();
  return {
    id,
    nome: txtObrig(d.nome, 200, "(sem nome)"),
    setor: txt(d.setor, 200),
    responsavel_uso: txt(d.responsavelUso, 200),
    status: umDe(d.status, ["ativa", "manutencao", "baixada", "entregue"], "ativa"),
    so: txt(d.so, 200),
    ip: txt(d.ip, 200),
    processador: txt(d.processador, 200),
    memoria_ram: txt(d.memoriaRam, 200),
    armazenamento: txt(d.armazenamento, 200),
    observacoes: txt(d.observacoes, 5000),
    criado_em: criado,
    atualizado_em: ts(d.atualizadoEm) || criado,
  };
}

export function converterHistorico(id, maquinaId, d, mapa) {
  return {
    id,
    maquina_id: maquinaId,
    descricao: txtObrig(d.descricao, 5000, "(sem descrição)"),
    tecnico_uid: mapUid(mapa, d.tecnicoUid),
    tecnico_nome: txt(d.tecnicoNome, 120, null),
    criado_em: ts(d.criadoEm) || new Date().toISOString(),
  };
}

export function converterItemEstoque(id, d, mapa) {
  const criado = ts(d.criadoEm) || new Date().toISOString();
  return {
    id,
    equipamento: txtObrig(d.equipamento ?? d.nome, 200, "(sem nome)"),
    serial: txt(d.serial, 200),
    ativo: txt(d.ativo, 200),
    chegada: dataISO(d.chegada, ""),
    saida: dataISO(d.saida, ""),
    delegacao: txt(d.delegacao, 200),
    loja_setor: txt(d.lojaSetor, 200),
    prioridade: umDe(d.prioridade, ["baixa", "media", "alta"], "media"),
    tecnico_uid: mapUid(mapa, d.tecnicoUid),
    tecnico_nome: txt(d.tecnicoNome, 120, null),
    situacao: umDe(d.situacao, ["recebido", "em_configuracao", "aguardando_peca", "concluido", "entregue"], "recebido"),
    observacoes: txt(d.observacoes, 5000),
    criado_por_uid: mapUid(mapa, d.criadoPorUid),
    criado_por_nome: txt(d.criadoPorNome, 120, null),
    criado_em: criado,
    atualizado_em: ts(d.atualizadoEm) || criado,
  };
}

export function converterVisita(id, d, mapa) {
  const criado = ts(d.criadoEm) || new Date().toISOString();
  const laudoUrl = typeof d.laudoUrl === "string" && LINK_GOOGLE.test(d.laudoUrl) ? d.laudoUrl.slice(0, 500) : null;
  return {
    id,
    numero: txt(d.numero, 100),
    titulo: txtObrig(d.titulo, 300, "(sem título)"),
    recurso_responsavel: txtObrig(d.recursoResponsavel, 200, "—"),
    cidade: txt(d.cidade, 200),
    data: dataISO(d.data, dataDeTimestamp(d.criadoEm) || hoje()),
    area: txt(d.area, 200),
    tipo_atendimento: txt(d.tipoAtendimento, 50),
    status: umDe(d.status, ["agendada", "realizada", "cancelada"], "agendada"),
    empresa_responsavel: txt(d.empresaResponsavel, 100),
    observacoes: txt(d.observacoes, 5000),
    laudo_path: null,
    laudo_url: laudoUrl,
    laudo_nome: laudoUrl ? txt(d.laudoNome, 300, null) : null,
    criado_por_uid: mapUid(mapa, d.criadoPorUid),
    criado_por_nome: txt(d.criadoPorNome, 120, null),
    criado_em: criado,
    atualizado_em: ts(d.atualizadoEm) || criado,
  };
}
