const supabaseCliente = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const INTERVALO_ATUALIZACAO_MS = 3000;
// Atualizado pelo usuário (2026-08-04): 1 NQ (não MNQ), U$400 por operação no alvo/stop de 20
// pontos (DISTANCIA_STOP_ALVO_PONTOS do analisador_tentativas_pequenas.py) -- U$20 por ponto.
const DOLAR_POR_PONTO_OPERACAO = 20;
// Pedido de 2026-08-11: card Registros (Resultado Análise) passa a valer U$200 por operação
// (U$10/ponto) em vez de U$400 -- separado do DOLAR_POR_PONTO_OPERACAO de cima, que continua
// valendo só pro card Operações (entrada real do NQ).
const DOLAR_POR_PONTO_ANALISE = 10;
// Pedido de 2026-08-07 (2ª vez): card de performance MNQ a mercado -- MNQ vale 1/10 do NQ
// ($2/ponto em vez de $20/ponto), mesmo stop/alvo de 20 pontos.
const DOLAR_POR_PONTO_MNQ = 2;
// Pedido de 2026-08-05: custo de corretagem por contrato (1 NQ), abatido do P/L pra virar
// líquido -- multiplica pelo total de operações resolvidas (cada uma negocia 1 contrato).
const CUSTO_CORRETAGEM_POR_CONTRATO = 3.10;
// Pedido de 2026-08-11: Mesa Lucid cobra $0,50 por lado (entrada e saída) no MNQ -- $1,00
// round-turn por contrato. Ver "pernasPorOperacao" em calcularResumoPerformance.
const CUSTO_CORRETAGEM_POR_CONTRATO_MNQ = 0.50;
const LIMITE_OPERACOES_SIMULADAS_EXIBIDAS = 200; // cobre um dia inteiro (hoje: ~25-30 operações)

const elementoStatus = document.getElementById("status");
const elementoPrecoValor = document.getElementById("preco-valor");
const elementoPrecoHorario = document.getElementById("preco-horario");
const elementoCorpoTabelaOperacoesSimuladas = document.getElementById("corpo-tabela-operacoes-simuladas");
const elementoCorpoTabelaOperacoes = document.getElementById("corpo-tabela-operacoes");
const elementoCorpoTabelaMnqMercado = document.getElementById("corpo-tabela-mnq-mercado");
const elementoGraficoAcumulado = document.getElementById("grafico-acumulado");
const elementoBotaoSom = document.getElementById("botao-som");

// ---- Área restrita (pedido de 2026-08-07: a página INTEIRA fica borrada até logar -- antes só
// as 3 tabelas de baixo eram protegidas, preço e performance ficavam públicos). Um único
// elemento (.protegido-total) e um único formulário cobrem tudo agora, em vez de 3 áreas
// separadas com login duplicado. Mesmo login já usado na "Área restrita" do painel MNPK, mesmo
// projeto Supabase -- a sessão persiste sozinha (supabase-js guarda em localStorage), então só
// pede login de novo se a sessão expirar ou o usuário nunca tiver logado nesse navegador.
const elementoProtegidoTotal = document.getElementById("protegido-total");
const elementoFormLogin = document.getElementById("form-login");
const elementoLoginEmail = document.getElementById("login-email");
const elementoLoginSenha = document.getElementById("login-senha");
const elementoBloqueioErro = document.getElementById("bloqueio-erro");

function atualizarBloqueio(sessao) {
  elementoProtegidoTotal.dataset.bloqueado = sessao ? "false" : "true";
}

supabaseCliente.auth.getSession().then(({ data }) => atualizarBloqueio(data.session));
supabaseCliente.auth.onAuthStateChange((_evento, sessao) => atualizarBloqueio(sessao));

async function tentarLogin(email, senha, elementoErro) {
  elementoErro.textContent = "";
  const { error } = await supabaseCliente.auth.signInWithPassword({ email, password: senha });
  if (error) {
    elementoErro.textContent = "E-mail ou senha inválidos.";
    return false;
  }
  return true;
}

elementoFormLogin.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  if (await tentarLogin(elementoLoginEmail.value, elementoLoginSenha.value, elementoBloqueioErro)) {
    elementoLoginSenha.value = "";
  }
});

// ---- Áudio: toca quando uma operação NOVA é validada (mesmo momento do áudio "compradores/
// vendedores travando" do analisador_tentativas_pequenas.py, que é a estrategia real em
// producao) -- navegador exige um clique antes de liberar autoplay, daí o botão "Ativar som".
let somHabilitado = false;
let primeiraCarga = true;
// Pedido de 2026-08-10: valores borrados (Resultado total/Lucro/Prejuízo/Custos) -- hover já
// revela no desktop (CSS), aqui só cobre toque no celular (sem hover).
document.querySelectorAll(".valor-borrado").forEach((elemento) => {
  elemento.addEventListener("click", () => {
    elemento.classList.toggle("revelado");
  });
});

const idsOperacoesVistas = new Set();
const audioCompradores = new Audio("sons/compradores_travando.mp3");
const audioVendedores = new Audio("sons/vendedores_travando.mp3");

elementoBotaoSom.addEventListener("click", () => {
  somHabilitado = !somHabilitado;
  elementoBotaoSom.textContent = somHabilitado ? "🔊 Som ativado" : "🔈 Ativar som";
  elementoBotaoSom.classList.toggle("ativo", somHabilitado);
  if (somHabilitado) {
    // desbloqueia os dois áudios no gesto do clique (autoplay policy)
    audioCompradores.play().then(() => audioCompradores.pause());
    audioVendedores.play().then(() => audioVendedores.pause());
  }
});

function tocarAudioOperacaoValidada(operacao) {
  if (!somHabilitado) return;
  const audio = operacao === "compra" ? audioCompradores : audioVendedores;
  audio.currentTime = 0;
  audio.play().catch(() => {});
}

const elementoPerf = {
  resultadoTotal: document.getElementById("perf-resultado-total"),
  lucroBruto: document.getElementById("perf-lucro-bruto"),
  prejuizoBruto: document.getElementById("perf-prejuizo-bruto"),
  operacoes: document.getElementById("perf-operacoes"),
  vencedoras: document.getElementById("perf-vencedoras"),
  operacoesPositivas: document.getElementById("perf-operacoes-positivas"),
  operacoesNegativas: document.getElementById("perf-operacoes-negativas"),
};
const elementoGraficoPatrimonio = document.getElementById("grafico-patrimonio");
const elementosAbaPeriodo = document.querySelectorAll(".aba-periodo:not(.aba-periodo-2):not(.aba-periodo-mnq)");

// Pedido de 2026-08-06: 2º card de performance, clone do de cima -- fica entre Registros e
// Operações, contabilizando só o Resultado Análise (a única coluna de resultado que a tabela
// Registros mostra agora), não a fórmula resultadoEfetivo/resultado_real do card original. Tem
// seu próprio período selecionado (independente do card 1).
const elementoPerf2 = {
  resultadoTotal: document.getElementById("perf-resultado-total-2"),
  lucroBruto: document.getElementById("perf-lucro-bruto-2"),
  prejuizoBruto: document.getElementById("perf-prejuizo-bruto-2"),
  operacoes: document.getElementById("perf-operacoes-2"),
  vencedoras: document.getElementById("perf-vencedoras-2"),
  operacoesPositivas: document.getElementById("perf-operacoes-positivas-2"),
  operacoesNegativas: document.getElementById("perf-operacoes-negativas-2"),
};
const elementoGraficoPatrimonio2 = document.getElementById("grafico-patrimonio-2");
const elementosAbaPeriodo2 = document.querySelectorAll(".aba-periodo-2");

// Pedido de 2026-08-07 (2ª vez): 3º card de performance, entre Operações e ENTRADA ORDEM LIMITE
// MNQ (espelho NQ) -- usa direto operacoes_mnq_mercado.resultado_real (única coluna de resultado
// dessa tabela) e $2/ponto do MNQ.
const elementoPerfMnq = {
  resultadoTotal: document.getElementById("perf-resultado-total-mnq"),
  lucroBruto: document.getElementById("perf-lucro-bruto-mnq"),
  prejuizoBruto: document.getElementById("perf-prejuizo-bruto-mnq"),
  operacoes: document.getElementById("perf-operacoes-mnq"),
  vencedoras: document.getElementById("perf-vencedoras-mnq"),
  operacoesPositivas: document.getElementById("perf-operacoes-positivas-mnq"),
  operacoesNegativas: document.getElementById("perf-operacoes-negativas-mnq"),
  custos: document.getElementById("perf-custos-mnq"),
};
const elementoGraficoPatrimonioMnq = document.getElementById("grafico-patrimonio-mnq");
const elementosAbaPeriodoMnq = document.querySelectorAll(".aba-periodo-mnq");

let periodoSelecionadoMnq = "total";
elementosAbaPeriodoMnq.forEach((botao) => {
  botao.addEventListener("click", () => {
    periodoSelecionadoMnq = botao.dataset.periodo;
    elementosAbaPeriodoMnq.forEach((b) => b.classList.toggle("aba-periodo-ativa", b === botao));
    atualizar();
  });
});

// Sem cascata (ordem-limite/análise) igual o NQ -- essa tabela só tem resultado_real mesmo.
function resultadoMnq(o) {
  return o.resultado_real;
}

// Pedido de 2026-08-05: filtro de período pro gráfico de patrimônio (estilo relatório do
// NinjaTrader) -- "diario" pega só o dia calendário mais recente presente nos dados (não
// necessariamente "hoje" se o mercado ainda não abriu de novo), os outros contam pra trás a
// partir de agora.
let periodoSelecionado = "total";
elementosAbaPeriodo.forEach((botao) => {
  botao.addEventListener("click", () => {
    periodoSelecionado = botao.dataset.periodo;
    elementosAbaPeriodo.forEach((b) => b.classList.toggle("aba-periodo-ativa", b === botao));
    atualizar();
  });
});

let periodoSelecionado2 = "total";
elementosAbaPeriodo2.forEach((botao) => {
  botao.addEventListener("click", () => {
    periodoSelecionado2 = botao.dataset.periodo;
    elementosAbaPeriodo2.forEach((b) => b.classList.toggle("aba-periodo-ativa", b === botao));
    atualizar();
  });
});

// Pedido de 2026-08-05: produção passou a rodar SEM o filtro de formação mínima (3min) --
// analisador_tentativas_pequenas.py continua calculando se cada operação passaria nele mesmo
// assim (passaria_filtro_3min), então dá pra comparar aqui "real" (todas as operações, o que
// está acontecendo de verdade na conta) vs "simulado com filtro" (só as que passariam, um
// subconjunto -- não é um resultado diferente por operação, é a mesma operação incluída ou não).
const elementosAbaFiltro = document.querySelectorAll(".aba-filtro");
let filtroSelecionado = "real";
elementosAbaFiltro.forEach((botao) => {
  botao.addEventListener("click", () => {
    filtroSelecionado = botao.dataset.filtro;
    elementosAbaFiltro.forEach((b) => b.classList.toggle("aba-filtro-ativa", b === botao));
    atualizar();
  });
});

/** Preço mais recente negociado -- não usa cotacao_atual (o servidor.py só grava lá fora do
 *  modo SOMENTE_ANALISE) -- negociacoes_tempo_real é publicado por publicador_dashboard.py
 *  independente disso, então é a fonte confiável de preço ao vivo aqui. */
async function buscarPrecoAtual() {
  const { data, error } = await supabaseCliente
    .from("negociacoes_tempo_real")
    .select("preco,horario")
    .order("criado_em", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data[0] || null;
}

async function buscarOperacoesSimuladas() {
  // Vem do analisador_tentativas_pequenas.py (times filtrado <= 3 contratos, rodando local,
  // separado do servidor.py). Sem limit aqui de propósito: o relatório de performance precisa
  // de TODAS as operações do dia, não só as mais recentes -- a tabela na tela é que corta pra
  // LIMITE_OPERACOES_SIMULADAS_EXIBIDAS.
  //
  // Ordena por criado_em (timestamp de verdade, com data) -- pedido de 2026-08-04 era usar
  // horario_entrada (texto "HH:MM:SS", sem data) pra não sofrer com o replay de um restart
  // regravando uma operação antiga bem depois. Mas horario_entrada quebra de um jeito pior e mais
  // frequente: sem data, "04:28" (hoje) ordena ANTES de "23:36" (ontem) como texto, mesmo sendo
  // depois no tempo real -- bug encontrado em 2026-08-05 assim que a sessão atravessou a meia-
  // noite (toda operação de madrugada sumia do topo da tabela). criado_em tem data embutida,
  // então não quebra nisso -- o caso do restart que motivou a troca original é bem mais raro hoje
  // (o processo já preserva o estado real entre restarts, então a maioria das operações já é
  // gravada perto da hora real do mercado, não só num replay tardio).
  const { data, error } = await supabaseCliente
    .from("operacoes_simuladas_pequenas")
    .select("id,operacao,preco_entrada,preco_real_entrada,negocios_acumulados,status,resultado,resultado_real,resultado_ordem_limite,resultado_pontos,horario_entrada,horario_resultado,criado_em,passaria_filtro_3min")
    .not("status", "in", "(cancelada,descartada)") // ruído de referências que nunca confirmaram -- não interessa aqui
    .order("criado_em", { ascending: false });
  if (error) throw error;
  return data;
}

/** Pedido de 2026-08-07: MNQ rodando em paralelo ao NQ, a MERCADO, tabela separada (não mistura
 *  com operacoes_simuladas_pequenas, que é só o NQ) -- vem do analisador_mnq_mercado.py. */
async function buscarOperacoesMnqMercado() {
  const { data, error } = await supabaseCliente
    .from("operacoes_mnq_mercado")
    .select("id,operacao,preco_entrada,preco_real_entrada,status,resultado,resultado_real,resultado_pontos,horario_entrada,horario_resultado,criado_em,quantidade")
    .not("status", "in", "(cancelada,descartada)")
    .order("criado_em", { ascending: false })
    .limit(LIMITE_OPERACOES_SIMULADAS_EXIBIDAS);
  if (error) throw error;
  return data;
}

function formatarPreco(preco) {
  return preco.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatarDolar(valor) {
  const sinal = valor > 0 ? "+" : valor < 0 ? "-" : "";
  return `${sinal}${Math.abs(valor).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
}

// Resultado ANÁLISE: baseado no nível calculado (nível médio/referência), stop/alvo de
// DISTANCIA_STOP_ALVO_PONTOS do analisador_tentativas_pequenas.py -- é a simulação teórica,
// não depende de execução real nenhuma.
function celulaResultadoAnalise(op) {
  if (op.status === "aberta") return '<span class="tag-resultado aberta">em aberto</span>';
  const classe = op.status === "gain" ? "lucro" : "prejuizo";
  const valorDolar = op.resultado_pontos * DOLAR_POR_PONTO_ANALISE;
  return `<span class="tag-resultado ${classe}">${formatarDolar(valorDolar)}</span>`;
}

// Resultado ENTRADA: o que a strategy real (ExecutorRegiaoReferenciaMNQ.cs) reportou de volta
// -- preco_real_entrada != null mas resultado_real ainda null = posição real aberta na conta;
// preco_real_entrada null = essa operação nunca chegou a ser enviada/preenchida de verdade.
function celulaResultadoEntrada(op) {
  if (op.preco_real_entrada == null) return '<span class="detalhe-leve">—</span>';
  if (op.resultado_real == null) return '<span class="tag-resultado aberta">em aberto</span>';
  const classe = op.resultado_real === "lucro" ? "lucro" : "prejuizo";
  return `<span class="tag-resultado ${classe}">${op.resultado_real}</span>`;
}

// Pedido de 2026-08-10: resultado em PONTOS (não só lucro/prejuízo) -- pra saber quantos
// pagaram o alvo (20) ou a proteção (1), mandado pelo Executor (C#) desde a reescrita sem ATM.
function celulaResultadoPontos(op) {
  if (op.resultado_real == null || op.resultado_pontos == null) return '<span class="detalhe-leve">—</span>';
  const classe = op.resultado_real === "lucro" ? "lucro" : "prejuizo";
  const sinal = op.resultado_pontos > 0 ? "+" : "";
  return `<span class="tag-resultado ${classe}">${sinal}${op.resultado_pontos.toFixed(2)}</span>`;
}

// ---- Gráfico de performance (estilo relatório "Patrimônio" do NinjaTrader) ----

function somar(lista) {
  return lista.reduce((a, b) => a + b, 0);
}

/** Só as operações resolvidas dentro do período escolhido nas abas (Diário/Semanal/Mensal/Todo
 *  período) -- "diario" usa a SESSÃO de mercado (19:00 até 19:00, mesmo corte diurno/noturno do
 *  resto do sistema -- ver CLAUDE.md), não a meia-noite do calendário. Corrigido em 2026-08-05:
 *  meia-noite cortava a sessão da noite ao meio, mostrando só metade das operações do dia.
 *
 *  Corrigido em 2026-08-06: "diario" agora ancora no horário ATUAL (agora), não mais na última
 *  operação real -- bug real: virou 19h, mercado reabriu, mas o Ninja não tinha sido reativado
 *  (nenhuma operação real nova), e o Diário continuava mostrando a sessão ANTERIOR inteira (a
 *  âncora ficava presa na última operação real, que era de antes das 19h). Ancorar em "agora"
 *  mostra corretamente vazio até a primeira operação real da sessão atual. Semanal/Mensal
 *  continuam ancorados na operação mais recente (sem essa ambiguidade -- não muda). */
function filtrarPorPeriodo(resolvidas, periodo) {
  if (periodo === "total" || resolvidas.length === 0) return resolvidas;
  const maisRecente = new Date(resolvidas[resolvidas.length - 1].criado_em);
  let corte;
  if (periodo === "diario") {
    const agora = new Date();
    corte = new Date(agora);
    corte.setHours(19, 0, 0, 0);
    if (corte > agora) corte.setDate(corte.getDate() - 1);
  } else if (periodo === "semanal") {
    corte = new Date(maisRecente.getTime() - 7 * 24 * 60 * 60 * 1000);
  } else {
    corte = new Date(maisRecente.getTime() - 30 * 24 * 60 * 60 * 1000);
  }
  return resolvidas.filter((o) => new Date(o.criado_em) >= corte);
}

/** Resultado "de verdade" de uma operação -- fórmula original (Ordem Limite -> Entrada ->
 *  Análise), usada pelas abas Semanal/Mensal/Todo período, sem mudar. A aba Diário usa uma
 *  fórmula diferente (só resultado_real) -- ver resultadoEfetivoDiario e atualizar(). */
function resultadoEfetivo(o) {
  if (o.resultado_ordem_limite === "lucro" || o.resultado_ordem_limite === "prejuizo") {
    return o.resultado_ordem_limite;
  }
  if (o.preco_real_entrada != null && o.resultado_real != null) return o.resultado_real;
  return o.resultado;
}

/** Corrigido em 2026-08-05: só pra aba Diário -- Resultado Ordem Limite/Análise de padrões que
 *  NUNCA viraram posição real estava entrando na conta junto com as operações reais, dando
 *  -1.221,70 quando a conta real do dia só tinha -409,30. Só conta resultado_real. */
function resultadoEfetivoDiario(o) {
  return o.resultado_real;
}

/** Pedido de 2026-08-06: usada só pelo 2º card de performance (entre Registros e Operações) --
 *  conta APENAS o Resultado Análise (o campo `resultado`, mesma coluna única que a tabela
 *  Registros mostra), pra todos os períodos igual, sem a fórmula em cascata do card original. */
function resultadoAnalise(o) {
  return o.resultado;
}

/** Constrói a curva de patrimônio acumulado (líquido de corretagem) em ordem cronológica real
 *  (por data/hora, não só por índice) e o resumo pra tira de estatísticas no topo. */
// Pedido de 2026-08-11: "dolarPorPonto" agora é POR CONTRATO -- multiplica pela "quantidade" de
// cada operação (coluna nova em operacoes_mnq_mercado, default 1 se não existir -- é o caso do
// NQ, que sempre negocia 1 contrato e nunca teve essa coluna). Sem isso, o financeiro do MNQ
// ficava sempre calculado como se fosse 1 contrato, mesmo depois de mudar pra 2 (2026-08-10).
// Pedido de 2026-08-11 (2ª mudança): usa resultado_pontos REAL da operação quando disponível
// (extrato do NinjaTrader tem o preço exato de saída, que quase nunca é exatamente ±20 --
// slippage/protected stop mudam o valor) -- só cai pro ±20 fixo se resultado_pontos for null
// (bot ainda não sabe o ponto exato, caso comum pra operações novas até o extrato confirmar).
// "pernasPorOperacao" (2026-08-11): custo cobrado por CONTRATO POR PERNA (entrada e saída cada
// uma cobra) -- pro NQ (1 contrato, custo já era só por operação) fica 1 perna, sem mudar o
// comportamento de sempre. Pro MNQ, 2 pernas × quantidade de contratos × $0,50 (confirmado pelo
// usuário: $28 pra 56 contratos negociados = $0,50/contrato).
function calcularResumoPerformance(resolvidas, funcaoResultado = resultadoEfetivo, dolarPorPonto = DOLAR_POR_PONTO_OPERACAO, custoPorContrato = CUSTO_CORRETAGEM_POR_CONTRATO, pernasPorOperacao = 1) {
  const comResultado = resolvidas.map((o) => ({
    o,
    resultado: funcaoResultado(o),
    quantidade: o.quantidade || 1,
    pontos: o.resultado_pontos != null ? Math.abs(o.resultado_pontos) : 20,
  }));
  const gains = comResultado.filter((x) => x.resultado === "lucro");
  const stops = comResultado.filter((x) => x.resultado === "prejuizo");
  const valoresGain = gains.map((x) => dolarPorPonto * x.pontos * x.quantidade);
  const valoresStop = stops.map((x) => -dolarPorPonto * x.pontos * x.quantidade);
  const custos = comResultado.reduce((acc, x) => acc + x.quantidade * pernasPorOperacao * custoPorContrato, 0);

  let acumulado = 0;
  const curva = comResultado.map(({ o, resultado, quantidade, pontos }) => {
    const pontosComSinal = resultado === "lucro" ? pontos : -pontos;
    acumulado += pontosComSinal * dolarPorPonto * quantidade - quantidade * pernasPorOperacao * custoPorContrato;
    return { valor: acumulado, data: new Date(o.criado_em), status: resultado === "lucro" ? "gain" : "stop" };
  });

  return {
    curva,
    resultadoTotal: somar(valoresGain) + somar(valoresStop) - custos,
    lucroBruto: somar(valoresGain),
    prejuizoBruto: somar(valoresStop),
    numOperacoes: resolvidas.length,
    numOperacoesPositivas: gains.length,
    numOperacoesNegativas: stops.length,
    taxaVencedoras: resolvidas.length ? (gains.length / resolvidas.length) * 100 : 0,
    custos,
  };
}

function preencherTiraPerformance(el, resumo) {
  el.resultadoTotal.textContent = formatarDolar(resumo.resultadoTotal);
  el.resultadoTotal.className = "tira-valor " + (resumo.resultadoTotal >= 0 ? "positivo" : "negativo");
  el.lucroBruto.textContent = formatarDolar(resumo.lucroBruto);
  el.lucroBruto.className = "tira-valor positivo";
  el.prejuizoBruto.textContent = formatarDolar(resumo.prejuizoBruto);
  el.prejuizoBruto.className = "tira-valor negativo";
  el.operacoes.textContent = resumo.numOperacoes;
  el.vencedoras.textContent = `${resumo.taxaVencedoras.toFixed(2)}%`;
  el.operacoesPositivas.textContent = resumo.numOperacoesPositivas;
  el.operacoesPositivas.className = "tira-valor positivo";
  el.operacoesNegativas.textContent = resumo.numOperacoesNegativas;
  el.operacoesNegativas.className = "tira-valor negativo";
  // Pedido de 2026-08-11: campo Custos voltou só pro card MNQ (Mesa Lucid cobra por lado) --
  // os outros cards não têm mais esse elemento no HTML, então "el.custos" fica undefined ali.
  if (el.custos) {
    el.custos.textContent = formatarDolar(-resumo.custos);
  }
}

/** Formata valores do eixo Y abreviados em milhares (estilo "4,33k"), igual o relatório de
 *  Patrimônio do NinjaTrader. */
function formatarEixoY(valor) {
  if (Math.abs(valor) >= 1000) {
    return `${(valor / 1000).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}k`;
  }
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Gráfico de área do patrimônio acumulado, no estilo do relatório "Patrimônio" do NinjaTrader:
 *  linha + preenchimento em degradê, verde acima de zero e vermelho abaixo, eixo de preço à
 *  direita e datas no eixo X (posicionadas pelo tempo real decorrido, não por índice). */
function desenharGraficoPatrimonio(elementoSvg, curva, sufixoId = "") {
  const largura = 900;
  const altura = 340;
  const margemDireita = 70;
  const margemBaixo = 24;
  // Pedido de 2026-08-05: sem margem em cima, o rótulo do valor máximo (bem no topo do
  // gráfico) ficava colado na borda do SVG e cortava a metade de cima do texto.
  const margemCima = 16;
  const larguraUtil = largura - margemDireita;
  const alturaUtil = altura - margemBaixo - margemCima;

  if (curva.length === 0) {
    elementoSvg.innerHTML = `
      <text x="${largura / 2}" y="${altura / 2}" fill="#555" font-size="13" text-anchor="middle">
        nenhuma operação resolvida nesse período
      </text>`;
    return;
  }

  const valores = curva.map((p) => p.valor);
  const minimo = Math.min(0, ...valores);
  const maximo = Math.max(0, ...valores);
  const amplitude = (maximo - minimo) || 1;
  const paraY = (v) => margemCima + alturaUtil - ((v - minimo) / amplitude) * alturaUtil;
  const yZero = paraY(0);

  const tempoInicio = curva[0].data.getTime();
  const tempoFim = curva[curva.length - 1].data.getTime();
  const duracaoTotal = (tempoFim - tempoInicio) || 1;
  const paraX = (data) => ((data.getTime() - tempoInicio) / duracaoTotal) * larguraUtil;

  // Linhas de grade horizontais + rótulos do eixo Y (5 faixas, de cima a baixo).
  const NUM_FAIXAS = 6;
  let grade = "";
  for (let i = 0; i <= NUM_FAIXAS; i++) {
    const valor = maximo - (i / NUM_FAIXAS) * amplitude;
    const y = paraY(valor);
    grade += `<line x1="0" y1="${y.toFixed(1)}" x2="${larguraUtil}" y2="${y.toFixed(1)}" stroke="#1c1c1c" stroke-width="1" />`;
    grade += `<text x="${larguraUtil + 8}" y="${(y + 4).toFixed(1)}" fill="#666" font-size="10.5">${formatarEixoY(valor)}</text>`;
  }

  // Rótulos de data no eixo X -- só quando o dia muda (ou no primeiro ponto).
  let rotulosData = "";
  let ultimoDia = null;
  for (const ponto of curva) {
    const chaveDia = ponto.data.toLocaleDateString("pt-BR");
    if (chaveDia !== ultimoDia) {
      const x = paraX(ponto.data);
      rotulosData += `<text x="${x.toFixed(1)}" y="${altura - 6}" fill="#666" font-size="10.5" text-anchor="middle">${chaveDia}</text>`;
      ultimoDia = chaveDia;
    }
  }

  // Caminho da linha/área -- inclui um ponto inicial em (0, patrimônio=0) pra área começar do zero.
  const pontos = [{ x: 0, y: yZero }, ...curva.map((p) => ({ x: paraX(p.data), y: paraY(p.valor) }))];
  const caminhoLinha = pontos.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
  const caminhoArea = `${caminhoLinha} L${pontos[pontos.length - 1].x.toFixed(1)},${yZero.toFixed(1)} L0,${yZero.toFixed(1)} Z`;

  const fracaoZero = Math.max(0, Math.min(1, (yZero - margemCima) / alturaUtil));

  elementoSvg.innerHTML = `
    <defs>
      <linearGradient id="areaPatrimonio${sufixoId}" gradientUnits="userSpaceOnUse" x1="0" y1="${margemCima}" x2="0" y2="${margemCima + alturaUtil}">
        <stop offset="0" stop-color="#15803d" stop-opacity="0.5" />
        <stop offset="${fracaoZero.toFixed(3)}" stop-color="#15803d" stop-opacity="0.03" />
        <stop offset="${fracaoZero.toFixed(3)}" stop-color="#ef5350" stop-opacity="0.03" />
        <stop offset="1" stop-color="#ef5350" stop-opacity="0.5" />
      </linearGradient>
      <linearGradient id="linhaPatrimonio${sufixoId}" gradientUnits="userSpaceOnUse" x1="0" y1="${margemCima}" x2="0" y2="${margemCima + alturaUtil}">
        <stop offset="0" stop-color="#22c55e" />
        <stop offset="${fracaoZero.toFixed(3)}" stop-color="#22c55e" />
        <stop offset="${fracaoZero.toFixed(3)}" stop-color="#ef5350" />
        <stop offset="1" stop-color="#ef5350" />
      </linearGradient>
    </defs>
    ${grade}
    <line x1="0" y1="${yZero.toFixed(1)}" x2="${larguraUtil}" y2="${yZero.toFixed(1)}" stroke="#333333" stroke-width="1" />
    <path d="${caminhoArea}" fill="url(#areaPatrimonio${sufixoId})" stroke="none" />
    <path d="${caminhoLinha}" fill="none" stroke="url(#linhaPatrimonio${sufixoId})" stroke-width="1.75" />
    ${rotulosData}
  `;
}

async function atualizar() {
  try {
    const [precoAtual, operacoesSimuladas, operacoesMnqMercado] = await Promise.all([
      buscarPrecoAtual(),
      buscarOperacoesSimuladas(),
      buscarOperacoesMnqMercado(),
    ]);

    if (!precoAtual) {
      elementoStatus.textContent = "aguardando negociações do publicador_dashboard.py…";
      elementoStatus.className = "status";
      return;
    }

    elementoPrecoValor.textContent = formatarPreco(precoAtual.preco);
    elementoPrecoHorario.textContent = precoAtual.horario.slice(0, 8);

    if (primeiraCarga) {
      operacoesSimuladas.forEach((o) => idsOperacoesVistas.add(o.id));
      primeiraCarga = false;
    } else {
      for (const o of operacoesSimuladas) {
        if (!idsOperacoesVistas.has(o.id)) {
          idsOperacoesVistas.add(o.id);
          tocarAudioOperacaoValidada(o.operacao);
        }
      }
    }

    // Pedido de 2026-08-05 (2ª vez): daqui pra frente o resumo de performance conta só as
    // operações com Resultado Ordem Limite resolvido (lucro/prejuízo) -- não mais Resultado
    // Análise nem Resultado Entrada. Isso não muda o histórico (resultado_ordem_limite já era
    // calculado antes), só troca qual campo alimenta o resumo/gráfico do topo.
    //
    // passaria_filtro_3min null = operação de antes dessa coluna existir (quando o filtro ainda
    // estava ligado de verdade em produção) -- conta como "passaria" pra não sumir do histórico
    // antigo quando o filtro simulado está selecionado.
    //
    // Corrigido em 2026-08-05: só a aba DIÁRIO usa resultado_real puro (pra bater com o extrato
    // do Ninja) -- Semanal/Mensal/Todo período continuam com a fórmula original
    // (resultadoEfetivo: Ordem Limite -> Entrada -> Análise), sem mudar.
    const baseParaResumo = periodoSelecionado === "diario"
      ? [...operacoesSimuladas].filter((o) => o.preco_real_entrada != null && (o.resultado_real === "lucro" || o.resultado_real === "prejuizo"))
      : [...operacoesSimuladas].filter((o) => o.status === "gain" || o.status === "stop");
    const resolvidas = baseParaResumo
      .filter((o) => filtroSelecionado === "real" || o.passaria_filtro_3min !== false)
      .sort((a, b) => a.criado_em.localeCompare(b.criado_em));
    const resolvidasNoPeriodo = filtrarPorPeriodo(resolvidas, periodoSelecionado);
    const resumo = calcularResumoPerformance(
      resolvidasNoPeriodo,
      periodoSelecionado === "diario" ? resultadoEfetivoDiario : resultadoEfetivo,
    );
    preencherTiraPerformance(elementoPerf, resumo);
    desenharGraficoPatrimonio(elementoGraficoPatrimonio, resumo.curva);

    // Pedido de 2026-08-06: 2º card de performance (entre Registros e Operações) -- conta só o
    // Resultado Análise (a única coluna de resultado que a tabela Registros mostra), igual pra
    // todos os períodos (sem o caso especial "diario" do card 1, que não se aplica aqui já que
    // não existe execução real na Resultado Análise).
    const resolvidasAnalise = [...operacoesSimuladas]
      .filter((o) => o.status === "gain" || o.status === "stop")
      .filter((o) => filtroSelecionado === "real" || o.passaria_filtro_3min !== false)
      .sort((a, b) => a.criado_em.localeCompare(b.criado_em));
    const resolvidasAnaliseNoPeriodo = filtrarPorPeriodo(resolvidasAnalise, periodoSelecionado2);
    const resumo2 = calcularResumoPerformance(resolvidasAnaliseNoPeriodo, resultadoAnalise, DOLAR_POR_PONTO_ANALISE);
    preencherTiraPerformance(elementoPerf2, resumo2);
    desenharGraficoPatrimonio(elementoGraficoPatrimonio2, resumo2.curva, "2");

    // Tabela nova "Operações" (lista separada, não influencia o resumo acima): pedido de
    // 2026-08-05 (2ª vez) -- agora é baseada em EXECUÇÃO REAL (preco_real_entrada preenchido e
    // resultado_real resolvido), não mais Resultado Ordem Limite, pra bater exatamente com o
    // extrato do Ninja. Pedido de 2026-08-06 (2ª vez): segue a mesma aba de período do card de
    // performance de cima (periodoSelecionado) -- antes era fixa em "diario", agora mostra a
    // semana/mês/tudo igual quando o usuário troca de aba ali.
    const operacoesReaisResolvidas = filtrarPorPeriodo(
      [...operacoesSimuladas]
        .filter((o) => o.preco_real_entrada != null && (o.resultado_real === "lucro" || o.resultado_real === "prejuizo"))
        .sort((a, b) => a.criado_em.localeCompare(b.criado_em)), // ordem crescente exigida por filtrarPorPeriodo
      periodoSelecionado,
    );
    // Pedido de 2026-08-06: mais recente primeiro na exibição -- inverte só aqui, depois do
    // filtro de período (que precisa da ordem crescente pra achar a "mais recente" certa).
    const operacoesRegistradas = [...operacoesReaisResolvidas].reverse().slice(0, LIMITE_OPERACOES_SIMULADAS_EXIBIDAS);
    elementoCorpoTabelaOperacoes.innerHTML = operacoesRegistradas.length
      ? operacoesRegistradas.map((o) => `
        <tr>
          <td>${o.horario_entrada.slice(0, 8)}</td>
          <td><span class="tag-operacao ${o.operacao}">${o.operacao}</span></td>
          <td>${formatarPreco(o.preco_real_entrada)}</td>
          <td>${celulaResultadoEntrada(o)}</td>
        </tr>
      `).join("")
      : '<tr><td colspan="4" class="linha-vazia">nenhuma operação registrada ainda hoje</td></tr>';

    // Pedido de 2026-08-07 (2ª vez): card de performance da tabela MNQ a mercado -- só resolvidas
    // (resultado_real lucro/prejuizo), mesmas abas de período (Diário/Semanal/Mensal/Todo
    // período) das outras duas, com $2/ponto do MNQ.
    const operacoesMnqResolvidas = filtrarPorPeriodo(
      [...operacoesMnqMercado]
        .filter((o) => o.resultado_real === "lucro" || o.resultado_real === "prejuizo")
        .sort((a, b) => a.criado_em.localeCompare(b.criado_em)),
      periodoSelecionadoMnq,
    );
    const resumoMnq = calcularResumoPerformance(operacoesMnqResolvidas, resultadoMnq, DOLAR_POR_PONTO_MNQ, CUSTO_CORRETAGEM_POR_CONTRATO_MNQ, 2);
    preencherTiraPerformance(elementoPerfMnq, resumoMnq);
    desenharGraficoPatrimonio(elementoGraficoPatrimonioMnq, resumoMnq.curva, "Mnq");

    // Pedido de 2026-08-07: MNQ a mercado, tabela separada -- já vem mais recente primeiro
    // (order criado_em desc na busca), sem filtro de período (mostra tudo até o limite).
    elementoCorpoTabelaMnqMercado.innerHTML = operacoesMnqMercado.length
      ? operacoesMnqMercado.map((o) => `
        <tr>
          <td>${o.horario_entrada.slice(0, 8)}</td>
          <td><span class="tag-operacao ${o.operacao}">${o.operacao}</span></td>
          <td>${formatarPreco(o.preco_real_entrada != null ? o.preco_real_entrada : o.preco_entrada)}</td>
          <td>${celulaResultadoEntrada(o)}</td>
          <td>${celulaResultadoPontos(o)}</td>
        </tr>
      `).join("")
      : '<tr><td colspan="5" class="linha-vazia">nenhuma operação registrada ainda</td></tr>';

    const operacoesExibidas = operacoesSimuladas.slice(0, LIMITE_OPERACOES_SIMULADAS_EXIBIDAS);
    elementoCorpoTabelaOperacoesSimuladas.innerHTML = operacoesExibidas.length
      ? operacoesExibidas.map((o) => `
        <tr>
          <td>${o.horario_entrada.slice(0, 8)}</td>
          <td><span class="tag-operacao ${o.operacao}">${o.operacao}</span></td>
          <td>${formatarPreco(o.preco_entrada)}</td>
          <td>${celulaResultadoAnalise(o)}</td>
        </tr>
      `).join("")
      : '<tr><td colspan="4" class="linha-vazia">nenhuma operação simulada ainda</td></tr>';

    elementoStatus.textContent = `ao vivo — ${resolvidas.length} operações resolvidas (atualizado ${new Date().toLocaleTimeString("pt-BR")})`;
    elementoStatus.className = "status ok";
  } catch (erro) {
    console.error(erro);
    elementoStatus.textContent = "erro ao buscar dados do Supabase — veja o console";
    elementoStatus.className = "status erro";
  }
}

atualizar();
setInterval(atualizar, INTERVALO_ATUALIZACAO_MS);
