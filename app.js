const supabaseCliente = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const INTERVALO_ATUALIZACAO_MS = 3000;
// Atualizado pelo usuário (2026-08-04): 1 NQ (não MNQ), U$400 por operação no alvo/stop de 20
// pontos (DISTANCIA_STOP_ALVO_PONTOS do analisador_tentativas_pequenas.py) -- U$20 por ponto.
const DOLAR_POR_PONTO_OPERACAO = 20;
// Pedido de 2026-08-05: custo de corretagem por contrato (1 NQ), abatido do P/L pra virar
// líquido -- multiplica pelo total de operações resolvidas (cada uma negocia 1 contrato).
const CUSTO_CORRETAGEM_POR_CONTRATO = 3.10;
const LIMITE_OPERACOES_SIMULADAS_EXIBIDAS = 200; // cobre um dia inteiro (hoje: ~25-30 operações)

const elementoStatus = document.getElementById("status");
const elementoPrecoValor = document.getElementById("preco-valor");
const elementoPrecoHorario = document.getElementById("preco-horario");
const elementoCorpoTabelaOperacoesSimuladas = document.getElementById("corpo-tabela-operacoes-simuladas");
const elementoGraficoAcumulado = document.getElementById("grafico-acumulado");
const elementoBotaoSom = document.getElementById("botao-som");

// ---- Área restrita (tabela de operações fica borrada até logar, pedido de 2026-08-04) --
// mesmo login (Supabase Auth) já usado na "Área restrita" do painel MNPK, mesmo projeto
// Supabase -- a sessão persiste sozinha (supabase-js guarda em localStorage), então só pede
// login de novo se a sessão expirar ou o usuário nunca tiver logado nesse navegador.
const elementoProtegidoOperacoes = document.getElementById("protegido-operacoes");
const elementoFormLogin = document.getElementById("form-login");
const elementoLoginEmail = document.getElementById("login-email");
const elementoLoginSenha = document.getElementById("login-senha");
const elementoBloqueioErro = document.getElementById("bloqueio-erro");

function atualizarBloqueio(sessao) {
  elementoProtegidoOperacoes.dataset.bloqueado = sessao ? "false" : "true";
}

supabaseCliente.auth.getSession().then(({ data }) => atualizarBloqueio(data.session));
supabaseCliente.auth.onAuthStateChange((_evento, sessao) => atualizarBloqueio(sessao));

elementoFormLogin.addEventListener("submit", async (evento) => {
  evento.preventDefault();
  elementoBloqueioErro.textContent = "";
  const { error } = await supabaseCliente.auth.signInWithPassword({
    email: elementoLoginEmail.value,
    password: elementoLoginSenha.value,
  });
  if (error) {
    elementoBloqueioErro.textContent = "E-mail ou senha inválidos.";
    return;
  }
  elementoLoginSenha.value = "";
});

// ---- Áudio: toca quando uma operação NOVA é validada (mesmo momento do áudio "compradores/
// vendedores travando" do analisador_tentativas_pequenas.py, que é a estrategia real em
// producao) -- navegador exige um clique antes de liberar autoplay, daí o botão "Ativar som".
let somHabilitado = false;
let primeiraCarga = true;
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

const elementosRelatorio = {
  plBruto: document.getElementById("rel-pl-bruto"),
  numOperacoes: document.getElementById("rel-num-operacoes"),
  tempoMedio: document.getElementById("rel-tempo-medio"),
  tempoMaior: document.getElementById("rel-tempo-maior"),
  taxaAcerto: document.getElementById("rel-taxa-acerto"),
  expectativa: document.getElementById("rel-expectativa"),
  lucroTotal: document.getElementById("rel-lucro-total"),
  numGain: document.getElementById("rel-num-gain"),
  maiorGain: document.getElementById("rel-maior-gain"),
  mediaGain: document.getElementById("rel-media-gain"),
  desvioGain: document.getElementById("rel-desvio-gain"),
  tempoGain: document.getElementById("rel-tempo-gain"),
  maxRunup: document.getElementById("rel-max-runup"),
  prejuizoTotal: document.getElementById("rel-prejuizo-total"),
  numStop: document.getElementById("rel-num-stop"),
  maiorStop: document.getElementById("rel-maior-stop"),
  mediaStop: document.getElementById("rel-media-stop"),
  desvioStop: document.getElementById("rel-desvio-stop"),
  tempoStop: document.getElementById("rel-tempo-stop"),
  maxDrawdown: document.getElementById("rel-max-drawdown"),
};

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
    .select("id,operacao,preco_entrada,preco_real_entrada,negocios_acumulados,status,resultado,resultado_real,resultado_ordem_limite,resultado_pontos,horario_entrada,horario_resultado,criado_em")
    .not("status", "in", "(cancelada,descartada)") // ruído de referências que nunca confirmaram -- não interessa aqui
    .order("criado_em", { ascending: false });
  if (error) throw error;
  return data;
}

function formatarPreco(preco) {
  return preco.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatarDolar(valor) {
  const sinal = valor > 0 ? "+" : valor < 0 ? "-" : "";
  return `${sinal}U$ ${Math.abs(valor).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Resultado ANÁLISE: baseado no nível calculado (nível médio/referência), stop/alvo de
// DISTANCIA_STOP_ALVO_PONTOS do analisador_tentativas_pequenas.py -- é a simulação teórica,
// não depende de execução real nenhuma.
function celulaResultadoAnalise(op) {
  if (op.status === "aberta") return '<span class="tag-resultado aberta">em aberto</span>';
  const classe = op.status === "gain" ? "lucro" : "prejuizo";
  const valorDolar = op.resultado_pontos * DOLAR_POR_PONTO_OPERACAO;
  return `<span class="tag-resultado ${classe}">${op.resultado} (${formatarDolar(valorDolar)})</span>`;
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

// Resultado ORDEM LIMITE: simulação separada do analisador_tentativas_pequenas.py, não afeta
// execução real nenhuma (que voltou a ser a mercado) -- calcula o que teria acontecido se a
// entrada fosse uma ordem limite parada no nível de análise, esperando o preço genuinamente
// retornar até lá. "nao_preenchida" = o preço se estendeu demais antes de voltar (nunca
// preencheria); null = ainda em andamento (preenchida ou não, esperando resolver).
function celulaResultadoOrdemLimite(op) {
  if (op.resultado_ordem_limite === "nao_preenchida") return '<span class="detalhe-leve">—</span>';
  if (op.resultado_ordem_limite == null) return '<span class="tag-resultado aberta">em aberto</span>';
  const classe = op.resultado_ordem_limite === "lucro" ? "lucro" : "prejuizo";
  return `<span class="tag-resultado ${classe}">${op.resultado_ordem_limite}</span>`;
}

// ---- Relatório de performance (estilo "Trade Performance" do NinjaTrader) ----

function horarioParaMs(horario) {
  const [hh, mm, ss] = horario.split(":");
  return (parseInt(hh, 10) * 3600 + parseInt(mm, 10) * 60 + parseFloat(ss)) * 1000;
}

function formatarDuracao(ms) {
  if (!isFinite(ms) || ms < 0) return "—";
  const totalSeg = Math.round(ms / 1000);
  const min = Math.floor(totalSeg / 60);
  const seg = totalSeg % 60;
  return `${min}min ${seg}s`;
}

function somar(lista) {
  return lista.reduce((a, b) => a + b, 0);
}

function media(lista) {
  return lista.length ? somar(lista) / lista.length : 0;
}

function desvioPadrao(lista) {
  if (lista.length < 2) return 0;
  const m = media(lista);
  const variancia = somar(lista.map((v) => (v - m) ** 2)) / (lista.length - 1);
  return Math.sqrt(variancia);
}

/** Constrói a curva de patrimônio acumulado (1 ponto por operação resolvida, em ordem
 *  cronológica) e junto calcula máx. run-up (maior alta do vale até o pico seguinte) e máx.
 *  drawdown (maior queda do pico até o vale seguinte) -- mesmo conceito do relatório do Ninja. */
function calcularEstatisticas(resolvidas) {
  const gains = resolvidas.filter((o) => o.status === "gain");
  const stops = resolvidas.filter((o) => o.status === "stop");

  const valores = resolvidas.map((o) => o.resultado_pontos * DOLAR_POR_PONTO_OPERACAO);
  const valoresGain = gains.map((o) => o.resultado_pontos * DOLAR_POR_PONTO_OPERACAO);
  const valoresStop = stops.map((o) => o.resultado_pontos * DOLAR_POR_PONTO_OPERACAO);

  const duracao = (o) => horarioParaMs(o.horario_resultado) - horarioParaMs(o.horario_entrada);
  const duracoesTodas = resolvidas.map(duracao);
  const duracoesGain = gains.map(duracao);
  const duracoesStop = stops.map(duracao);

  let acumulado = 0;
  const curva = resolvidas.map((o) => {
    acumulado += o.resultado_pontos * DOLAR_POR_PONTO_OPERACAO;
    return { valor: acumulado, horario: o.horario_resultado, status: o.status };
  });

  let maxRunup = 0, runupDe = null, runupPara = null;
  let maxDrawdown = 0, drawdownDe = null, drawdownPara = null;
  let minAteAgora = 0, horarioMin = resolvidas[0] ? resolvidas[0].horario_entrada : null;
  let maxAteAgora = 0, horarioMax = resolvidas[0] ? resolvidas[0].horario_entrada : null;

  for (const ponto of curva) {
    const runupAtual = ponto.valor - minAteAgora;
    if (runupAtual > maxRunup) {
      maxRunup = runupAtual;
      runupDe = horarioMin;
      runupPara = ponto.horario;
    }
    if (ponto.valor < minAteAgora) {
      minAteAgora = ponto.valor;
      horarioMin = ponto.horario;
    }

    const drawdownAtual = ponto.valor - maxAteAgora;
    if (drawdownAtual < maxDrawdown) {
      maxDrawdown = drawdownAtual;
      drawdownDe = horarioMax;
      drawdownPara = ponto.horario;
    }
    if (ponto.valor > maxAteAgora) {
      maxAteAgora = ponto.valor;
      horarioMax = ponto.horario;
    }
  }

  return {
    curva,
    // P/L líquido = bruto - corretagem (custo por contrato x total de operações, cada uma
    // negocia 1 contrato) -- pedido de 2026-08-05.
    plBruto: somar(valores) - resolvidas.length * CUSTO_CORRETAGEM_POR_CONTRATO,
    numOperacoes: resolvidas.length,
    tempoMedio: media(duracoesTodas),
    tempoMaior: duracoesTodas.length ? Math.max(...duracoesTodas) : 0,
    taxaAcerto: resolvidas.length ? (gains.length / resolvidas.length) * 100 : 0,
    expectativa: resolvidas.length ? somar(valores) / resolvidas.length : 0,

    lucroTotal: somar(valoresGain),
    numGain: gains.length,
    maiorGain: valoresGain.length ? Math.max(...valoresGain) : 0,
    mediaGain: media(valoresGain),
    desvioGain: desvioPadrao(valoresGain),
    tempoGain: media(duracoesGain),
    maxRunup, runupDe, runupPara,

    prejuizoTotal: somar(valoresStop),
    numStop: stops.length,
    maiorStop: valoresStop.length ? Math.min(...valoresStop) : 0,
    mediaStop: media(valoresStop),
    desvioStop: desvioPadrao(valoresStop),
    tempoStop: media(duracoesStop),
    maxDrawdown, drawdownDe, drawdownPara,
  };
}

function preencherRelatorio(est) {
  const el = elementosRelatorio;
  el.plBruto.textContent = formatarDolar(est.plBruto);
  el.plBruto.className = est.plBruto >= 0 ? "positivo" : "negativo";
  el.numOperacoes.textContent = est.numOperacoes;
  el.tempoMedio.textContent = formatarDuracao(est.tempoMedio);
  el.tempoMaior.textContent = formatarDuracao(est.tempoMaior);
  el.taxaAcerto.textContent = `${est.taxaAcerto.toFixed(1)}%`;
  el.expectativa.textContent = formatarDolar(est.expectativa);

  el.lucroTotal.textContent = formatarDolar(est.lucroTotal);
  el.numGain.textContent = est.numGain;
  el.maiorGain.textContent = formatarDolar(est.maiorGain);
  el.mediaGain.textContent = formatarDolar(est.mediaGain);
  el.desvioGain.textContent = formatarDolar(est.desvioGain);
  el.tempoGain.textContent = est.numGain ? formatarDuracao(est.tempoGain) : "—";
  el.maxRunup.textContent = est.runupPara
    ? `${formatarDolar(est.maxRunup)} (${est.runupDe.slice(0, 8)} → ${est.runupPara.slice(0, 8)})`
    : "—";

  el.prejuizoTotal.textContent = formatarDolar(est.prejuizoTotal);
  el.numStop.textContent = est.numStop;
  el.maiorStop.textContent = formatarDolar(est.maiorStop);
  el.mediaStop.textContent = formatarDolar(est.mediaStop);
  el.desvioStop.textContent = formatarDolar(est.desvioStop);
  el.tempoStop.textContent = est.numStop ? formatarDuracao(est.tempoStop) : "—";
  el.maxDrawdown.textContent = est.drawdownPara
    ? `${formatarDolar(est.maxDrawdown)} (${est.drawdownDe.slice(0, 8)} → ${est.drawdownPara.slice(0, 8)})`
    : "—";
}

/** Gráfico de barras do resultado acumulado (1 barra por operação, altura = patrimônio
 *  acumulado naquele ponto, cor = se aquela operação foi gain/stop) -- mesmo estilo do
 *  relatório "P&L History" do NinjaTrader. */
function desenharGraficoAcumulado(curva) {
  const largura = 600;
  const altura = 200;

  if (curva.length === 0) {
    elementoGraficoAcumulado.innerHTML = "";
    return;
  }

  const valores = curva.map((p) => p.valor);
  const minimo = Math.min(0, ...valores);
  const maximo = Math.max(0, ...valores);
  const amplitude = (maximo - minimo) || 1;

  const paraY = (v) => altura - ((v - minimo) / amplitude) * altura;
  const yZero = paraY(0);
  const larguraBarra = Math.max(1, largura / curva.length - 1);

  const barras = curva.map((p, i) => {
    const x = (i / curva.length) * largura;
    const yValor = paraY(p.valor);
    const y = Math.min(yValor, yZero);
    const alturaBarra = Math.max(1, Math.abs(yValor - yZero));
    const cor = p.status === "gain" ? "#15803d" : "#ef5350";
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${larguraBarra.toFixed(1)}" height="${alturaBarra.toFixed(1)}" fill="${cor}" />`;
  }).join("");

  elementoGraficoAcumulado.innerHTML = `
    <line x1="0" y1="${yZero.toFixed(1)}" x2="${largura}" y2="${yZero.toFixed(1)}" stroke="#333333" stroke-width="1" stroke-dasharray="4,4" />
    ${barras}
  `;
}

async function atualizar() {
  try {
    const [precoAtual, operacoesSimuladas] = await Promise.all([
      buscarPrecoAtual(),
      buscarOperacoesSimuladas(),
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

    const resolvidas = [...operacoesSimuladas]
      .filter((o) => o.status === "gain" || o.status === "stop")
      .sort((a, b) => a.criado_em.localeCompare(b.criado_em));
    const est = calcularEstatisticas(resolvidas);
    preencherRelatorio(est);
    desenharGraficoAcumulado(est.curva);

    const operacoesExibidas = operacoesSimuladas.slice(0, LIMITE_OPERACOES_SIMULADAS_EXIBIDAS);
    elementoCorpoTabelaOperacoesSimuladas.innerHTML = operacoesExibidas.length
      ? operacoesExibidas.map((o) => `
        <tr>
          <td>${o.horario_entrada.slice(0, 8)}</td>
          <td><span class="tag-operacao ${o.operacao}">${o.operacao}</span></td>
          <td>${formatarPreco(o.preco_entrada)}</td>
          <td>${o.preco_real_entrada != null ? formatarPreco(o.preco_real_entrada) : "—"}</td>
          <td>${o.negocios_acumulados ?? "—"}</td>
          <td>${celulaResultadoAnalise(o)}</td>
          <td>${celulaResultadoEntrada(o)}</td>
          <td>${celulaResultadoOrdemLimite(o)}</td>
        </tr>
      `).join("")
      : '<tr><td colspan="8" class="linha-vazia">nenhuma operação simulada ainda</td></tr>';

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
