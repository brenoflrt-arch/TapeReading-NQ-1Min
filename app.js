const supabaseCliente = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const INTERVALO_ATUALIZACAO_MS = 3000;
const TAMANHO_PAGINA = 1000; // o projeto Supabase corta toda resposta REST em 1000 linhas (max-rows)

const elementoStatus = document.getElementById("status");
const elementoBotaoSom = document.getElementById("botao-som");

// ---- Área restrita (login de verdade via Supabase Auth -- mesmo login já usado no painel MNPK,
// mesmo projeto Supabase). A sessão persiste sozinha (supabase-js guarda em localStorage).
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

// Pedido de 2026-08-10: valores borrados (Resultado total/Lucro/Prejuízo) -- hover já revela no
// desktop (CSS), aqui só cobre toque no celular (sem hover).
document.querySelectorAll(".valor-borrado").forEach((elemento) => {
  elemento.addEventListener("click", () => {
    elemento.classList.toggle("revelado");
  });
});

// Botão de som fica só como interruptor mudo por enquanto -- nenhum evento sonoro depende de
// direção (compra/venda) desde que a página passou a mostrar só performance agregada em pontos
// (pedido de 2026-08-11: reduzir a página inteira a isso, sem detalhe de operação nenhuma).
let somHabilitado = false;
elementoBotaoSom.addEventListener("click", () => {
  somHabilitado = !somHabilitado;
  elementoBotaoSom.textContent = somHabilitado ? "🔊 Som ativado" : "🔈 Ativar som";
  elementoBotaoSom.classList.toggle("ativo", somHabilitado);
});

// Pedido de 2026-08-11: card único de performance -- "Registros" (Resultado Análise), em pontos.
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

let periodoSelecionado2 = "total";
elementosAbaPeriodo2.forEach((botao) => {
  botao.addEventListener("click", () => {
    periodoSelecionado2 = botao.dataset.periodo;
    elementosAbaPeriodo2.forEach((b) => b.classList.toggle("aba-periodo-ativa", b === botao));
    atualizar();
  });
});

// Filtro de horário (2026-08-20): independente das abas de período acima -- aplicado DEPOIS
// do corte por data, sobre o que sobrar. "de" e "até" em HH:MM local, comparando só a hora do
// dia de cada operação (não a data). Campo vazio de um lado = sem limite nesse lado.
const elementoFiltroHorarioInicio2 = document.getElementById("filtro-horario-inicio-2");
const elementoFiltroHorarioFim2 = document.getElementById("filtro-horario-fim-2");
const elementoFiltroHorarioLimpar2 = document.getElementById("filtro-horario-limpar-2");

elementoFiltroHorarioInicio2.addEventListener("change", atualizar);
elementoFiltroHorarioFim2.addEventListener("change", atualizar);
elementoFiltroHorarioLimpar2.addEventListener("click", () => {
  elementoFiltroHorarioInicio2.value = "";
  elementoFiltroHorarioFim2.value = "";
  atualizar();
});

function filtrarPorHorario(resolvidas, inicio, fim) {
  if (!inicio && !fim) return resolvidas;
  return resolvidas.filter((o) => {
    const hhmm = new Date(o.criado_em).toTimeString().slice(0, 5);
    if (inicio && hhmm < inicio) return false;
    if (fim && hhmm > fim) return false;
    return true;
  });
}

// Pedido de 2026-08-21: card "Ordem limite (NQ) — preenchidas" -- mesmo modelo do card acima
// (elementoPerf2/abas2/filtro2), sufixo "-3".
const elementoPerf3 = {
  resultadoTotal: document.getElementById("perf-resultado-total-3"),
  lucroBruto: document.getElementById("perf-lucro-bruto-3"),
  prejuizoBruto: document.getElementById("perf-prejuizo-bruto-3"),
  operacoes: document.getElementById("perf-operacoes-3"),
  vencedoras: document.getElementById("perf-vencedoras-3"),
  operacoesPositivas: document.getElementById("perf-operacoes-positivas-3"),
  operacoesNegativas: document.getElementById("perf-operacoes-negativas-3"),
};
const elementoGraficoPatrimonio3 = document.getElementById("grafico-patrimonio-3");
const elementosAbaPeriodo3 = document.querySelectorAll(".aba-periodo-3");

let periodoSelecionado3 = "total";
elementosAbaPeriodo3.forEach((botao) => {
  botao.addEventListener("click", () => {
    periodoSelecionado3 = botao.dataset.periodo;
    elementosAbaPeriodo3.forEach((b) => b.classList.toggle("aba-periodo-ativa", b === botao));
    atualizar();
  });
});

const elementoFiltroHorarioInicio3 = document.getElementById("filtro-horario-inicio-3");
const elementoFiltroHorarioFim3 = document.getElementById("filtro-horario-fim-3");
const elementoFiltroHorarioLimpar3 = document.getElementById("filtro-horario-limpar-3");

elementoFiltroHorarioInicio3.addEventListener("change", atualizar);
elementoFiltroHorarioFim3.addEventListener("change", atualizar);
elementoFiltroHorarioLimpar3.addEventListener("click", () => {
  elementoFiltroHorarioInicio3.value = "";
  elementoFiltroHorarioFim3.value = "";
  atualizar();
});

const elementoTabelaRegistros3 = document.getElementById("tabela-registros-3");

// Pedido de 2026-09-15: card "Volumetric (NQ/MNQ)" -- mesmo modelo do card "Ordem limite"
// acima (elementoPerf3/abas3/filtro3), sufixo "-4".
const elementoPerf4 = {
  resultadoTotal: document.getElementById("perf-resultado-total-4"),
  lucroBruto: document.getElementById("perf-lucro-bruto-4"),
  prejuizoBruto: document.getElementById("perf-prejuizo-bruto-4"),
  operacoes: document.getElementById("perf-operacoes-4"),
  vencedoras: document.getElementById("perf-vencedoras-4"),
  operacoesPositivas: document.getElementById("perf-operacoes-positivas-4"),
  operacoesNegativas: document.getElementById("perf-operacoes-negativas-4"),
};
const elementoGraficoPatrimonio4 = document.getElementById("grafico-patrimonio-4");
const elementosAbaPeriodo4 = document.querySelectorAll(".aba-periodo-4");

let periodoSelecionado4 = "total";
elementosAbaPeriodo4.forEach((botao) => {
  botao.addEventListener("click", () => {
    periodoSelecionado4 = botao.dataset.periodo;
    elementosAbaPeriodo4.forEach((b) => b.classList.toggle("aba-periodo-ativa", b === botao));
    atualizar();
  });
});

const elementoFiltroHorarioInicio4 = document.getElementById("filtro-horario-inicio-4");
const elementoFiltroHorarioFim4 = document.getElementById("filtro-horario-fim-4");
const elementoFiltroHorarioLimpar4 = document.getElementById("filtro-horario-limpar-4");

elementoFiltroHorarioInicio4.addEventListener("change", atualizar);
elementoFiltroHorarioFim4.addEventListener("change", atualizar);
elementoFiltroHorarioLimpar4.addEventListener("click", () => {
  elementoFiltroHorarioInicio4.value = "";
  elementoFiltroHorarioFim4.value = "";
  atualizar();
});

const elementoTabelaRegistros4 = document.getElementById("tabela-registros-4");

/** O Supabase corta toda resposta REST em 1000 linhas (max-rows), então um `.limit(5000)` volta
 *  calado só com as 1000 mais recentes -- a aba "Todo período" ficava incompleta (sumia a 1ª
 *  semana de histórico e ia piorando a cada dia de operação nova). Aqui pagina via `.range()`
 *  até a última página vir curta, trazendo o histórico inteiro (ordem crescente por data). */
async function buscarTodasAsPaginas(tabela, colunas) {
  let todas = [];
  for (let inicio = 0; ; inicio += TAMANHO_PAGINA) {
    const { data, error } = await supabaseCliente
      .from(tabela)
      .select(colunas)
      .order("criado_em", { ascending: true })
      .range(inicio, inicio + TAMANHO_PAGINA - 1);
    if (error) throw error;
    todas = todas.concat(data);
    if (data.length < TAMANHO_PAGINA) break;
  }
  return todas;
}

/** Pedido de 2026-08-11: só a view pública `registros_performance_publica` -- sem operação,
 *  preço, horário ou nível, só pontos/resultado/data. Ver supabase_bloquear_dados_publicos.sql. */
async function buscarRegistrosPerformance() {
  return buscarTodasAsPaginas(
    "registros_performance_publica",
    "id,status,resultado,resultado_pontos,passaria_filtro_3min,criado_em"
  );
}

/** Pedido de 2026-08-21: mesma ideia, agora a partir de resultado_ordem_limite (simulação de
 *  ordem limite parada no nível, só as que preencheram de verdade -- ver
 *  supabase_registros_performance_ordem_limite.sql). A view já filtra
 *  status/data (>= 07/08), então tudo que volta aqui já é "resolvida". */
async function buscarRegistrosPerformanceOrdemLimite() {
  return buscarTodasAsPaginas("registros_performance_ordem_limite_publica", "id,resultado,criado_em");
}

/** Pedido de 2026-09-15: card "Volumetric (NQ/MNQ)" -- operações reais do bot Volumetric,
 *  mesmo modelo do card "Ordem limite" (ver supabase_operacoes_volumetric.sql). A view já
 *  filtra resultado in ('lucro','prejuizo'), então tudo que volta aqui já é "resolvida". */
async function buscarRegistrosPerformanceVolumetric() {
  return buscarTodasAsPaginas(
    "registros_performance_volumetric_publica",
    "id,resultado,resultado_pontos,criado_em"
  );
}

function formatarDolar(valor) {
  const sinal = valor > 0 ? "+" : valor < 0 ? "-" : "";
  return `${sinal}${Math.abs(valor).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
}

function formatarPontos(valor) {
  const sinal = valor > 0 ? "+" : valor < 0 ? "-" : "";
  return `${sinal}${Math.abs(valor).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 })} pts`;
}

// ---- Gráfico de performance (estilo relatório "Patrimônio" do NinjaTrader) ----

function somar(lista) {
  return lista.reduce((a, b) => a + b, 0);
}

/** Mesmo corte usado sempre: "diario" usa a SESSÃO de mercado (19:00 até 19:00), "semanal" usa
 *  a SEMANA de mercado (domingo 19:00 até sexta 18:00, mesmo horário de abertura/fechamento da
 *  CME), "mensal" é o mês-calendário corrente (dia 1, 00:00 local), "total" não filtra nada. */
function filtrarPorPeriodo(resolvidas, periodo) {
  if (periodo === "total" || resolvidas.length === 0) return resolvidas;
  const agora = new Date();
  let corte;
  if (periodo === "diario") {
    corte = new Date(agora);
    corte.setHours(19, 0, 0, 0);
    if (corte > agora) corte.setDate(corte.getDate() - 1);
  } else if (periodo === "semanal") {
    corte = new Date(agora);
    corte.setHours(19, 0, 0, 0);
    corte.setDate(corte.getDate() - corte.getDay());
    if (corte > agora) corte.setDate(corte.getDate() - 7);
  } else {
    corte = new Date(agora.getFullYear(), agora.getMonth(), 1, 0, 0, 0, 0);
  }
  return resolvidas.filter((o) => new Date(o.criado_em) >= corte);
}

function resultadoAnalise(o) {
  return o.resultado;
}

// Pedido de 2026-09-14: card "Registros" (Resultado Análise) passa a simular 5 contratos de MNQ
// (US$2/ponto cada = US$10/ponto no total) em vez de mostrar pontos crus, com a corretagem real
// descontada por operação resolvida (não por contrato individual dentro do bruto -- ver como
// custoPorOperacao é usado abaixo, só no resultado líquido).
const SIMULACAO_MNQ_REGISTROS = {
  contratos: 5,
  dolarPorPonto: 2, // MNQ = 1/10 do valor do tick do NQ
  custoPorContrato: 0.5, // USD, cobrado 1x por operação resolvida (não por perna)
};

/** Constrói a curva de patrimônio acumulado e o resumo pra tira de estatísticas no topo. Usa
 *  resultado_pontos real quando disponível, senão ±20 fixo. Sem `simulacao`, os valores continuam
 *  em pontos puros (card "Ordem limite"); com `simulacao` (contratos/dolarPorPonto/custoPorContrato),
 *  vira dólares -- Lucro/Prejuízo Bruto ficam sem custo (é a soma bruta dos contratos), a corretagem
 *  só desconta do Resultado Total e da curva de patrimônio (que é o valor líquido acumulado). */
function calcularResumoPerformance(resolvidas, { funcaoResultado = resultadoAnalise, simulacao = null } = {}) {
  const custoPorOperacao = simulacao ? simulacao.contratos * simulacao.custoPorContrato : 0;
  const comResultado = resolvidas.map((o) => {
    const pontos = o.resultado_pontos != null ? Math.abs(o.resultado_pontos) : 20;
    const bruto = simulacao ? pontos * simulacao.contratos * simulacao.dolarPorPonto : pontos;
    return { o, resultado: funcaoResultado(o), bruto };
  });
  const gains = comResultado.filter((x) => x.resultado === "lucro");
  const stops = comResultado.filter((x) => x.resultado === "prejuizo");
  const lucroBruto = somar(gains.map((x) => x.bruto));
  const prejuizoBruto = -somar(stops.map((x) => x.bruto));
  const custoTotal = resolvidas.length * custoPorOperacao;

  let acumulado = 0;
  const curva = comResultado.map(({ o, resultado, bruto }) => {
    acumulado += (resultado === "lucro" ? bruto : -bruto) - custoPorOperacao;
    return { valor: acumulado, data: new Date(o.criado_em), status: resultado === "lucro" ? "gain" : "stop" };
  });

  return {
    curva,
    resultadoTotal: lucroBruto + prejuizoBruto - custoTotal,
    lucroBruto,
    prejuizoBruto,
    custoTotal,
    numOperacoes: resolvidas.length,
    numOperacoesPositivas: gains.length,
    numOperacoesNegativas: stops.length,
    taxaVencedoras: resolvidas.length ? (gains.length / resolvidas.length) * 100 : 0,
  };
}

function preencherTiraPerformance(el, resumo, formatarValor = formatarDolar) {
  el.resultadoTotal.textContent = formatarValor(resumo.resultadoTotal);
  el.resultadoTotal.className = "tira-valor " + (resumo.resultadoTotal >= 0 ? "positivo" : "negativo");
  el.lucroBruto.textContent = formatarValor(resumo.lucroBruto);
  el.lucroBruto.className = "tira-valor positivo";
  el.prejuizoBruto.textContent = formatarValor(resumo.prejuizoBruto);
  el.prejuizoBruto.className = "tira-valor negativo";
  el.operacoes.textContent = resumo.numOperacoes;
  el.vencedoras.textContent = `${resumo.taxaVencedoras.toFixed(2)}%`;
  el.operacoesPositivas.textContent = resumo.numOperacoesPositivas;
  el.operacoesPositivas.className = "tira-valor positivo";
  el.operacoesNegativas.textContent = resumo.numOperacoesNegativas;
  el.operacoesNegativas.className = "tira-valor negativo";
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

  const NUM_FAIXAS = 6;
  let grade = "";
  for (let i = 0; i <= NUM_FAIXAS; i++) {
    const valor = maximo - (i / NUM_FAIXAS) * amplitude;
    const y = paraY(valor);
    grade += `<line x1="0" y1="${y.toFixed(1)}" x2="${larguraUtil}" y2="${y.toFixed(1)}" stroke="#1c1c1c" stroke-width="1" />`;
    grade += `<text x="${larguraUtil + 8}" y="${(y + 4).toFixed(1)}" fill="#666" font-size="10.5">${formatarEixoY(valor)}</text>`;
  }

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

  // viewBox 900x340 com preserveAspectRatio="none" estica X e Y em proporções diferentes pra
  // preencher o card inteiro -- isso deforma o texto dos rótulos junto. Corrige aplicando um
  // scale horizontal inverso nos <text> e recalcula o font-size pra sempre renderizar em ~11px
  // reais na tela, não importa o tamanho do card (desktop ou celular).
  const caixa = elementoSvg.getBoundingClientRect();
  if (caixa.width > 0 && caixa.height > 0) {
    const escalaX = caixa.width / largura;
    const escalaY = caixa.height / altura;
    const fatorCorrecao = escalaY / escalaX;
    const FONTE_ALVO_PX = 11;
    const fontSizeViewBox = (FONTE_ALVO_PX / escalaY).toFixed(2);
    elementoSvg.querySelectorAll("text").forEach((texto) => {
      const x = texto.getAttribute("x");
      const y = texto.getAttribute("y");
      texto.setAttribute("font-size", fontSizeViewBox);
      texto.setAttribute("transform", `translate(${x} ${y}) scale(${fatorCorrecao.toFixed(4)} 1) translate(${-x} ${-y})`);
    });
  }
}

const elementoTabelaRegistros2 = document.getElementById("tabela-registros-2");
const elementoTabelaMensal2 = document.getElementById("tabela-mensal-2");

/** Quebra por mês-calendário (hora local): operações, % de acerto e resultado em dólares (mesma
 *  simulação de 5 MNQ + corretagem do resto do card, ver SIMULACAO_MNQ_REGISTROS). Independe da
 *  aba de período (que controla a tira/gráfico) -- só respeita o filtro de horário, pra ficar
 *  coerente com o resto do card. Mês mais recente primeiro. */
function preencherTabelaMensal(el, resolvidas) {
  if (resolvidas.length === 0) {
    el.innerHTML = `<tr><td colspan="4" class="linha-vazia">sem operações nesse filtro</td></tr>`;
    return;
  }
  const { contratos, dolarPorPonto, custoPorContrato } = SIMULACAO_MNQ_REGISTROS;
  const custoPorOperacao = contratos * custoPorContrato;
  const meses = new Map();
  for (const o of resolvidas) {
    const d = new Date(o.criado_em);
    const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    if (!meses.has(chave)) meses.set(chave, { n: 0, gains: 0, valor: 0 });
    const m = meses.get(chave);
    const pontos = o.resultado_pontos != null ? Math.abs(o.resultado_pontos) : 20;
    const bruto = pontos * contratos * dolarPorPonto;
    m.n += 1;
    if (o.resultado === "lucro") m.gains += 1;
    m.valor += (o.resultado === "lucro" ? bruto : -bruto) - custoPorOperacao;
  }
  const nomeMes = (chave) => {
    const [ano, mes] = chave.split("-").map(Number);
    return new Date(ano, mes - 1, 1).toLocaleDateString("pt-BR", { month: "short", year: "numeric" });
  };
  el.innerHTML = [...meses.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([chave, m]) => {
      const acerto = ((m.gains / m.n) * 100).toFixed(1);
      const classe = m.valor >= 0 ? "lucro" : "prejuizo";
      return `<tr><td>${nomeMes(chave)}</td><td>${m.n}</td><td>${acerto}%</td><td><span class="tag-resultado ${classe}">${formatarDolar(m.valor)}</span></td></tr>`;
    })
    .join("");
}

/** Lista simples horário + resultado, mais recente primeiro -- mesmo conjunto já filtrado por
 *  período e horário que alimenta a tira e o gráfico, então fica sempre consistente com eles. */
function preencherTabelaRegistros(el, resolvidas) {
  if (resolvidas.length === 0) {
    el.innerHTML = `<tr><td colspan="2" class="linha-vazia">nenhuma operação nesse filtro</td></tr>`;
    return;
  }
  const linhas = [...resolvidas]
    .sort((a, b) => b.criado_em.localeCompare(a.criado_em))
    .map((o) => {
      const data = new Date(o.criado_em);
      const horario = data.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
      const rotulo = o.resultado === "lucro" ? "Lucro" : "Prejuízo";
      return `<tr><td>${horario}</td><td><span class="tag-resultado ${o.resultado}">${rotulo}</span></td></tr>`;
    })
    .join("");
  el.innerHTML = linhas;
}

async function atualizar() {
  try {
    const registros = await buscarRegistrosPerformance();

    const resolvidas = registros
      .filter((o) => o.status === "gain" || o.status === "stop")
      .sort((a, b) => a.criado_em.localeCompare(b.criado_em));
    const resolvidasNoPeriodo = filtrarPorPeriodo(resolvidas, periodoSelecionado2);
    const resolvidasNoHorario = filtrarPorHorario(
      resolvidasNoPeriodo,
      elementoFiltroHorarioInicio2.value,
      elementoFiltroHorarioFim2.value
    );
    const resumo = calcularResumoPerformance(resolvidasNoHorario, { simulacao: SIMULACAO_MNQ_REGISTROS });
    preencherTiraPerformance(elementoPerf2, resumo, formatarDolar);
    desenharGraficoPatrimonio(elementoGraficoPatrimonio2, resumo.curva, "2");
    preencherTabelaRegistros(elementoTabelaRegistros2, resolvidasNoHorario);
    preencherTabelaMensal(
      elementoTabelaMensal2,
      filtrarPorHorario(resolvidas, elementoFiltroHorarioInicio2.value, elementoFiltroHorarioFim2.value)
    );

    // Card "Ordem limite (NQ) — preenchidas" (2026-08-21) -- view já vem só com lucro/prejuizo
    // (preenchidas) e >= 07/08, não precisa filtrar status aqui.
    const registrosOrdemLimite = await buscarRegistrosPerformanceOrdemLimite();
    const resolvidasOrdemLimite = [...registrosOrdemLimite].sort((a, b) => a.criado_em.localeCompare(b.criado_em));
    const ordemLimiteNoPeriodo = filtrarPorPeriodo(resolvidasOrdemLimite, periodoSelecionado3);
    const ordemLimiteNoHorario = filtrarPorHorario(
      ordemLimiteNoPeriodo,
      elementoFiltroHorarioInicio3.value,
      elementoFiltroHorarioFim3.value
    );
    const resumoOrdemLimite = calcularResumoPerformance(ordemLimiteNoHorario);
    preencherTiraPerformance(elementoPerf3, resumoOrdemLimite, formatarPontos);
    desenharGraficoPatrimonio(elementoGraficoPatrimonio3, resumoOrdemLimite.curva, "3");
    preencherTabelaRegistros(elementoTabelaRegistros3, ordemLimiteNoHorario);

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
