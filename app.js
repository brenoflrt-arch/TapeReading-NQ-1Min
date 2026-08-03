const supabaseCliente = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const INTERVALO_ATUALIZACAO_MS = 3000;
const LIMITE_NEGOCIACOES = 2000;
const LIMITE_RAJADAS = 500;

const COR_ALTA = "#22cc22";
const COR_BAIXA = "#dd2020";
const COR_BOLHA_COMPRA = "#4dff4d";
const COR_BOLHA_VENDA = "#ff4d4d";

const elementoStatus = document.getElementById("status");

const grafico = LightweightCharts.createChart(document.getElementById("grafico"), {
  layout: { background: { color: "#0d0d0d" }, textColor: "#cfcfcf" },
  grid: { vertLines: { visible: false }, horzLines: { visible: false } },
  rightPriceScale: { borderColor: "#262626" },
  timeScale: { borderColor: "#262626", timeVisible: true, secondsVisible: false },
  crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
});

const serieCandle = grafico.addCandlestickSeries({
  upColor: COR_ALTA,
  downColor: COR_BAIXA,
  borderVisible: false,
  wickUpColor: COR_ALTA,
  wickDownColor: COR_BAIXA,
});

new ResizeObserver((entradas) => {
  const { width, height } = entradas[0].contentRect;
  grafico.resize(width, height);
}).observe(document.getElementById("grafico"));

/** "HH:MM:SS.mmm" -> segundos desde meia-noite (UTCTimestamp ancorado no dia de hoje). */
function horarioParaTimestamp(horarioTexto, baseMeiaNoiteSegundos) {
  const [h, m, s] = horarioTexto.split(":");
  const segundosDoDia = Number(h) * 3600 + Number(m) * 60 + Math.floor(Number(s));
  return baseMeiaNoiteSegundos + segundosDoDia;
}

function minutoBase(horarioTexto) {
  return horarioTexto.slice(0, 5); // "HH:MM"
}

function montarCandles(negociacoes, baseMeiaNoiteSegundos) {
  const porMinuto = new Map();
  for (const n of negociacoes) {
    const chave = minutoBase(n.horario);
    const tempo = horarioParaTimestamp(chave + ":00.000", baseMeiaNoiteSegundos);
    let candle = porMinuto.get(chave);
    if (!candle) {
      candle = { time: tempo, open: n.preco, high: n.preco, low: n.preco, close: n.preco };
      porMinuto.set(chave, candle);
    } else {
      candle.high = Math.max(candle.high, n.preco);
      candle.low = Math.min(candle.low, n.preco);
      candle.close = n.preco;
    }
  }
  return Array.from(porMinuto.values()).sort((a, b) => a.time - b.time);
}

function montarMarcadores(rajadas, baseMeiaNoiteSegundos) {
  const marcadores = [];
  for (const r of rajadas) {
    const posicaoRajada = r.direcao_rajada === "compra" ? "belowBar" : "aboveBar";
    marcadores.push({
      time: horarioParaTimestamp(r.horario_rajada, baseMeiaNoiteSegundos),
      position: posicaoRajada,
      color: r.direcao_rajada === "compra" ? COR_BOLHA_COMPRA : COR_BOLHA_VENDA,
      shape: "circle",
      size: Math.min(0.6 + r.negocios * 0.12, 2.2),
      text: String(r.negocios),
    });
    if (r.confirmada && r.horario_confirmacao) {
      // Trava compradora (verde) ou vendedora (vermelha) -- cor = operação implícita,
      // igual ao gráfico local (grafico_ao_vivo.py).
      const corTrava = r.operacao === "compra" ? COR_ALTA : COR_BAIXA;
      marcadores.push({
        time: horarioParaTimestamp(r.horario_confirmacao, baseMeiaNoiteSegundos),
        position: r.operacao === "compra" ? "belowBar" : "aboveBar",
        color: corTrava,
        shape: "circle",
        size: 1.6,
        text: "★ " + (r.operacao || ""),
      });
    }
  }
  marcadores.sort((a, b) => a.time - b.time);
  return marcadores;
}

async function buscarDados() {
  const agora = new Date();
  const baseMeiaNoiteSegundos = Math.floor(
    new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime() / 1000
  );

  // desc + limit pega as linhas mais RECENTES (a tabela pode ter sobras antigas de sessões
  // passadas) -- depois inverte pra ordem cronológica antes de montar candle/marcador.
  const [respostaNegociacoes, respostaRajadas] = await Promise.all([
    supabaseCliente
      .from("negociacoes_tempo_real")
      .select("horario,preco,quantidade,direcao")
      .order("criado_em", { ascending: false })
      .limit(LIMITE_NEGOCIACOES),
    supabaseCliente
      .from("rajadas_trava_nq")
      .select("horario_rajada,preco_rajada,direcao_rajada,negocios,confirmada,horario_confirmacao,preco_confirmacao,operacao")
      .order("criado_em", { ascending: false })
      .limit(LIMITE_RAJADAS),
  ]);

  if (respostaNegociacoes.error) throw respostaNegociacoes.error;
  if (respostaRajadas.error) throw respostaRajadas.error;

  return {
    negociacoes: respostaNegociacoes.data.reverse(),
    rajadas: respostaRajadas.data.reverse(),
    baseMeiaNoiteSegundos,
  };
}

async function atualizar() {
  try {
    const { negociacoes, rajadas, baseMeiaNoiteSegundos } = await buscarDados();

    if (negociacoes.length === 0) {
      elementoStatus.textContent = "aguardando negociações do publicador_dashboard.py…";
      elementoStatus.className = "status";
      return;
    }

    serieCandle.setData(montarCandles(negociacoes, baseMeiaNoiteSegundos));
    serieCandle.setMarkers(montarMarcadores(rajadas, baseMeiaNoiteSegundos));

    elementoStatus.textContent = `ao vivo — ${negociacoes.length} negociações, ${rajadas.length} rajadas (atualizado ${new Date().toLocaleTimeString("pt-BR")})`;
    elementoStatus.className = "status ok";
  } catch (erro) {
    console.error(erro);
    elementoStatus.textContent = "erro ao buscar dados do Supabase — veja o console";
    elementoStatus.className = "status erro";
  }
}

atualizar();
setInterval(atualizar, INTERVALO_ATUALIZACAO_MS);
