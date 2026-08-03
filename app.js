const supabaseCliente = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const INTERVALO_ATUALIZACAO_MS = 3000;
const TAMANHO_PAGINA = 1000; // teto de linhas por request do PostgREST/Supabase

// Paleta/estilo igual ao padrão do TradingView (candle teal/coral, grid sutil, linha de
// preço atual pontilhada com rótulo colorido à direita).
const COR_ALTA = "#26a69a";
const COR_BAIXA = "#ef5350";
const COR_BOLHA_COMPRA = "#4dff4d";
const COR_BOLHA_VENDA = "#ff4d4d";

// Mesma janela de preço que o servidor.py usa (LIMITE_JANELA_PRECO) pra considerar "mesma
// região" entre a 1ª e a 2ª tentativa -- o retângulo cobre região ± essa faixa.
const FAIXA_RETANGULO_PONTOS = 5;

const elementoStatus = document.getElementById("status");
const elementoRetangulos = document.getElementById("retangulos-padroes");

const grafico = LightweightCharts.createChart(document.getElementById("grafico"), {
  layout: { background: { color: "#131722" }, textColor: "#d1d4dc" },
  grid: {
    vertLines: { color: "#1e222d" },
    horzLines: { color: "#1e222d" },
  },
  rightPriceScale: { borderColor: "#2a2e39" },
  timeScale: { borderColor: "#2a2e39", timeVisible: true, secondsVisible: false },
  crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
});

const serieCandle = grafico.addCandlestickSeries({
  upColor: COR_ALTA,
  downColor: COR_BAIXA,
  borderUpColor: COR_ALTA,
  borderDownColor: COR_BAIXA,
  wickUpColor: COR_ALTA,
  wickDownColor: COR_BAIXA,
  priceLineVisible: true,
  priceLineStyle: LightweightCharts.LineStyle.Dotted,
  lastValueVisible: true,
});

new ResizeObserver((entradas) => {
  const { width, height } = entradas[0].contentRect;
  grafico.resize(width, height);
  desenharRetangulosPadroes();
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

/** Busca TODAS as linhas de uma tabela em ordem crescente, paginando pelo teto de linhas
 *  por request do PostgREST/Supabase (o .limit() sozinho não passa desse teto). */
async function buscarTudoPaginado(nomeTabela, colunas, colunaOrdem) {
  const linhas = [];
  let pagina = 0;
  while (true) {
    const inicio = pagina * TAMANHO_PAGINA;
    const { data, error } = await supabaseCliente
      .from(nomeTabela)
      .select(colunas)
      .order(colunaOrdem, { ascending: true })
      .range(inicio, inicio + TAMANHO_PAGINA - 1);
    if (error) throw error;
    linhas.push(...data);
    if (data.length < TAMANHO_PAGINA) break;
    pagina += 1;
  }
  return linhas;
}

async function buscarDados() {
  // O lightweight-charts formata os rótulos do eixo do tempo em UTC, sempre -- por isso a
  // âncora do "dia" também precisa ser meia-noite UTC (não meia-noite local). Se usasse local,
  // o rótulo mostrado ficaria deslocado pelo fuso do navegador (ex.: +3h no horário de
  // Brasília), mesmo o timestamp em si estando "certo" em termos absolutos.
  const agora = new Date();
  const baseMeiaNoiteSegundos =
    Date.UTC(agora.getFullYear(), agora.getMonth(), agora.getDate()) / 1000;

  // Pega o pregão inteiro que estiver armazenado (não só uma janela recente) -- ordena por
  // "horario" (hora real do negócio), não por "criado_em" (hora em que a linha foi gravada no
  // banco), porque quando o publicador_dashboard.py reinicia ele relê o servidor.log inteiro
  // e publica negociações antigas de uma vez só, com criado_em recente mas horario antigo.
  const [negociacoes, rajadas] = await Promise.all([
    buscarTudoPaginado("negociacoes_tempo_real", "horario,preco,quantidade,direcao", "horario"),
    buscarTudoPaginado(
      "rajadas_trava_nq",
      "horario_rajada,preco_rajada,direcao_rajada,negocios,confirmada,horario_confirmacao,preco_confirmacao,operacao",
      "horario_rajada",
    ),
  ]);

  return { negociacoes, rajadas, baseMeiaNoiteSegundos };
}

/** Busca os níveis "aguardando 3ª tentativa" ainda ativos (2ª tentativa confirmada, esperando
 *  o preço aproximar/confirmar ou invalidar) publicados pelo publicador_dashboard.py. */
async function buscarNiveisAguardando() {
  const { data, error } = await supabaseCliente
    .from("niveis_aguardando_3_tentativa")
    .select("id_oferta,nivel_preco,operacao")
    .eq("ativo", true);
  if (error) throw error;
  return data;
}

// id_oferta -> handle da linha de preço (LightweightCharts.IPriceLine) desenhada no candle.
const linhasDeNivelAtivas = new Map();

function atualizarLinhasDeNivel(niveisAtivos) {
  const idsAtivos = new Set(niveisAtivos.map((n) => n.id_oferta));

  for (const [id, linha] of linhasDeNivelAtivas) {
    if (!idsAtivos.has(id)) {
      serieCandle.removePriceLine(linha);
      linhasDeNivelAtivas.delete(id);
    }
  }

  for (const n of niveisAtivos) {
    if (linhasDeNivelAtivas.has(n.id_oferta)) continue;
    const cor = n.operacao === "compra" ? COR_ALTA : COR_BAIXA;
    const linha = serieCandle.createPriceLine({
      price: n.nivel_preco,
      color: cor,
      lineWidth: 2,
      lineStyle: LightweightCharts.LineStyle.Dashed,
      axisLabelVisible: true,
      title: n.operacao === "compra" ? "aguardando 3ª — compra" : "aguardando 3ª — venda",
    });
    linhasDeNivelAtivas.set(n.id_oferta, linha);
  }
}

/** Busca TODOS os padrões confirmados (histórico -- 1ª+2ª tentativa na mesma região),
 *  publicados pelo publicador_dashboard.py, pra desenhar um retângulo sobre os candles
 *  exatos de cada um. */
async function buscarPadroesConfirmados() {
  return buscarTudoPaginado(
    "padroes_1_2_tentativa",
    "id,horario_primeira,horario_segunda,regiao_preco,operacao",
    "horario_segunda",
  );
}

// Guarda o último lote buscado + a âncora de meia-noite, pra poder reposicionar os
// retângulos (pan/zoom/resize) sem precisar rebuscar do Supabase.
let ultimosPadroesConfirmados = [];
let ultimaBaseMeiaNoiteSegundos = 0;

function desenharRetangulosPadroes() {
  elementoRetangulos.innerHTML = "";
  const larguraContainer = elementoRetangulos.clientWidth;

  for (const p of ultimosPadroesConfirmados) {
    const inicioMinuto = minutoBase(p.horario_primeira) + ":00.000";
    const tempoInicio = horarioParaTimestamp(inicioMinuto, ultimaBaseMeiaNoiteSegundos);
    // Fim = início do minuto SEGUINTE ao da 2ª tentativa, pra cobrir o candle inteiro dela
    // (mesmo bucket de minuto usado em montarCandles), não só o instante em que ela ocorreu.
    const tempoFim = horarioParaTimestamp(minutoBase(p.horario_segunda) + ":00.000", ultimaBaseMeiaNoiteSegundos) + 60;

    const x1 = grafico.timeScale().timeToCoordinate(tempoInicio);
    const x2 = grafico.timeScale().timeToCoordinate(tempoFim);
    const yTopo = serieCandle.priceToCoordinate(p.regiao_preco + FAIXA_RETANGULO_PONTOS);
    const yBase = serieCandle.priceToCoordinate(p.regiao_preco - FAIXA_RETANGULO_PONTOS);

    if (x1 === null || x2 === null || yTopo === null || yBase === null) continue;
    if (x2 < 0 || x1 > larguraContainer) continue; // fora da área visível, não desenha

    const div = document.createElement("div");
    div.className = "retangulo-padrao " + (p.operacao === "compra" ? "retangulo-compra" : "retangulo-venda");
    div.style.left = `${x1}px`;
    div.style.top = `${Math.min(yTopo, yBase)}px`;
    div.style.width = `${Math.max(x2 - x1, 2)}px`;
    div.style.height = `${Math.max(Math.abs(yBase - yTopo), 2)}px`;
    elementoRetangulos.appendChild(div);
  }
}

grafico.timeScale().subscribeVisibleLogicalRangeChange(desenharRetangulosPadroes);

let primeiraCargaComDados = true;

async function atualizar() {
  try {
    const { negociacoes, rajadas, baseMeiaNoiteSegundos } = await buscarDados();

    if (negociacoes.length === 0) {
      elementoStatus.textContent = "aguardando negociações do publicador_dashboard.py…";
      elementoStatus.className = "status";
      return;
    }

    serieCandle.setData(montarCandles(negociacoes, baseMeiaNoiteSegundos));
    // Bolhas/estrelas desligadas por enquanto (poluíam demais com muitas rajadas) -- alinhando
    // o candle puro primeiro. Reativar chamando montarMarcadores(rajadas, baseMeiaNoiteSegundos).
    serieCandle.setMarkers([]);

    const niveisAguardando = await buscarNiveisAguardando();
    atualizarLinhasDeNivel(niveisAguardando);

    const padroesConfirmados = await buscarPadroesConfirmados();
    ultimosPadroesConfirmados = padroesConfirmados;
    ultimaBaseMeiaNoiteSegundos = baseMeiaNoiteSegundos;

    // Só centraliza/ajusta o zoom na primeira carga com dados -- depois disso deixa o
    // usuário controlar (senão toda atualização de 3 em 3s cancelaria o zoom/scroll manual).
    if (primeiraCargaComDados) {
      grafico.timeScale().fitContent();
      primeiraCargaComDados = false;
    }

    desenharRetangulosPadroes();

    elementoStatus.textContent = `ao vivo — ${negociacoes.length} negociações, ${rajadas.length} rajadas, ${niveisAguardando.length} aguardando 3ª, ${padroesConfirmados.length} padrões (atualizado ${new Date().toLocaleTimeString("pt-BR")})`;
    elementoStatus.className = "status ok";
  } catch (erro) {
    console.error(erro);
    elementoStatus.textContent = "erro ao buscar dados do Supabase — veja o console";
    elementoStatus.className = "status erro";
  }
}

atualizar();
setInterval(atualizar, INTERVALO_ATUALIZACAO_MS);
