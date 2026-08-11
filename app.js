const supabaseCliente = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const INTERVALO_ATUALIZACAO_MS = 3000;
const LIMITE_REGISTROS = 5000; // cobre meses de histórico sem paginação

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

/** Pedido de 2026-08-11: só a view pública `registros_performance_publica` -- sem operação,
 *  preço, horário ou nível, só pontos/resultado/data. Ver supabase_bloquear_dados_publicos.sql. */
async function buscarRegistrosPerformance() {
  const { data, error } = await supabaseCliente
    .from("registros_performance_publica")
    .select("id,status,resultado,resultado_pontos,passaria_filtro_3min,criado_em")
    .order("criado_em", { ascending: false })
    .limit(LIMITE_REGISTROS);
  if (error) throw error;
  return data;
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

/** Mesmo corte usado sempre: "diario" usa a SESSÃO de mercado (19:00 até 19:00), Semanal/Mensal
 *  contam pra trás a partir da operação mais recente, "total" não filtra nada. */
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

function resultadoAnalise(o) {
  return o.resultado;
}

/** Constrói a curva de patrimônio acumulado (em pontos, sem custo) e o resumo pra tira de
 *  estatísticas no topo. Usa resultado_pontos real quando disponível, senão ±20 fixo. */
function calcularResumoPerformance(resolvidas, funcaoResultado = resultadoAnalise) {
  const comResultado = resolvidas.map((o) => ({
    o,
    resultado: funcaoResultado(o),
    pontos: o.resultado_pontos != null ? Math.abs(o.resultado_pontos) : 20,
  }));
  const gains = comResultado.filter((x) => x.resultado === "lucro");
  const stops = comResultado.filter((x) => x.resultado === "prejuizo");
  const valoresGain = gains.map((x) => x.pontos);
  const valoresStop = stops.map((x) => -x.pontos);

  let acumulado = 0;
  const curva = comResultado.map(({ o, resultado, pontos }) => {
    acumulado += resultado === "lucro" ? pontos : -pontos;
    return { valor: acumulado, data: new Date(o.criado_em), status: resultado === "lucro" ? "gain" : "stop" };
  });

  return {
    curva,
    resultadoTotal: somar(valoresGain) + somar(valoresStop),
    lucroBruto: somar(valoresGain),
    prejuizoBruto: somar(valoresStop),
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

async function atualizar() {
  try {
    const registros = await buscarRegistrosPerformance();

    const resolvidas = registros
      .filter((o) => o.status === "gain" || o.status === "stop")
      .sort((a, b) => a.criado_em.localeCompare(b.criado_em));
    const resolvidasNoPeriodo = filtrarPorPeriodo(resolvidas, periodoSelecionado2);
    const resumo = calcularResumoPerformance(resolvidasNoPeriodo);
    preencherTiraPerformance(elementoPerf2, resumo, formatarPontos);
    desenharGraficoPatrimonio(elementoGraficoPatrimonio2, resumo.curva, "2");

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
