const supabaseCliente = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const INTERVALO_ATUALIZACAO_MS = 3000;
const LIMITE_PADROES_EXIBIDOS = 20; // mostra só os mais recentes, mais antigo que isso não cabe na tela
const LIMITE_ISOLADAS_EXIBIDAS = 20;
// Mesma régua do publicador_dashboard.py (MINIMO_TRAVAS_POR_REGIAO): região só conta pras
// tabelas principais/leitura direcional com 2+ travas -- o backend agora publica TUDO
// (inclusive 1 trava só), e é aqui no site que a gente separa confirmada de isolada.
const MINIMO_TRAVAS_CONFIRMADA = 2;
// Mesmo valor de FORCA_MINIMA_NOTIFICACAO_PADRAO no servidor.py -- abaixo disso o Telegram
// NÃO manda o alerta "PADRÃO IDENTIFICADO" (mas o site continua mostrando, só marcado como
// "fraco", já que lê o log de forma independente e sem esse filtro).
const FORCA_MINIMA_NOTIFICACAO = 1;
// Confirmado pelo usuário (2026-08-04): 2 MNQ por operação = $80 no alvo/stop de 20 pontos
// (DISTANCIA_STOP_ALVO_PONTOS do analisador_tentativas_pequenas.py) -- $4 por ponto.
const DOLAR_POR_PONTO_2_MNQ = 4;

const elementoStatus = document.getElementById("status");
const elementoPrecoValor = document.getElementById("preco-valor");
const elementoPrecoHorario = document.getElementById("preco-horario");
const elementoViesValor = document.getElementById("vies-valor");
const elementoBannerDentro = document.getElementById("banner-dentro-regiao");
const elementoPainelAguardando = document.getElementById("painel-aguardando");
const elementoConteudoAguardando = document.getElementById("conteudo-aguardando");
const elementoLeituraCompraAbaixo = document.getElementById("leitura-compra-abaixo");
const elementoLeituraVendaAbaixo = document.getElementById("leitura-venda-abaixo");
const elementoLeituraCompraAcima = document.getElementById("leitura-compra-acima");
const elementoLeituraVendaAcima = document.getElementById("leitura-venda-acima");
const elementoLeituraConclusao = document.getElementById("leitura-conclusao");
const elementoCorpoTabelaCompra = document.getElementById("corpo-tabela-compra");
const elementoCorpoTabelaVenda = document.getElementById("corpo-tabela-venda");
const elementoCorpoTabelaPadroes = document.getElementById("corpo-tabela-padroes");
const elementoCorpoTabelaIsoladas = document.getElementById("corpo-tabela-isoladas");
const elementoCorpoTabelaOperacoesSimuladas = document.getElementById("corpo-tabela-operacoes-simuladas");
const LIMITE_OPERACOES_SIMULADAS_EXIBIDAS = 20;
const elementoResumoOperacoes = document.getElementById("resumo-operacoes");
const elementoResumoAcerto = document.getElementById("resumo-acerto");
const elementoResumoFinanceiro = document.getElementById("resumo-financeiro");
const elementoGraficoPerformance = document.getElementById("grafico-performance");
const elementoGraficoGainContagem = document.getElementById("grafico-gain-contagem");
const elementoGraficoStopContagem = document.getElementById("grafico-stop-contagem");
const elementoGraficoBarraGain = document.getElementById("grafico-barra-gain");
const elementoGraficoBarraStop = document.getElementById("grafico-barra-stop");
const elementoGraficoCurva = document.getElementById("grafico-curva");

// ---- Abas: só troca qual painel fica visível -- os dados continuam sendo buscados e
// atualizados nos dois em segundo plano, então trocar de aba mostra tudo já atualizado. ----
for (const botao of document.querySelectorAll(".aba-botao")) {
  botao.addEventListener("click", () => {
    for (const b of document.querySelectorAll(".aba-botao")) b.classList.remove("ativa");
    botao.classList.add("ativa");
    for (const painel of document.querySelectorAll(".aba-painel")) painel.hidden = true;
    document.getElementById("aba-" + botao.dataset.aba).hidden = false;
  });
}
const elementoBotaoSom = document.getElementById("botao-som");

// ---- Áudio (mesmo .mp3 de voz gravado pelo usuário, usado pelo servidor.py) tocado toda vez
// que um nível novo fica "aguardando 3ª tentativa". Ligado por padrão (o botão agora serve pra
// MUTAR, não pra ativar) -- mas navegadores só liberam áudio de verdade depois de alguma
// interação do usuário com a página, então destrava no primeiro clique em QUALQUER lugar, não
// só no botão (o botão continua funcionando como mute/unmute manual).
// Os áudios "compradores travando"/"vendedores travando" NÃO tocam mais aqui -- esse par foi
// realocado (2026-08-04) pro analisador_tentativas_pequenas.py, que os dispara pro padrão de
// times pequenos (<= 3 contratos), não pra este site (que só lê o times filtrado >= 3). ----
let somAtivado = true;
const audioPadraoIdentificado = new Audio("sons/segunda_trava_validada.mp3");

elementoBotaoSom.textContent = "🔔 Som ativado";
elementoBotaoSom.classList.add("ativo");

let audioDestravado = false;
function destravarAudio() {
  if (audioDestravado) return;
  audioDestravado = true;
  audioPadraoIdentificado.play().then(() => audioPadraoIdentificado.pause()).catch(() => {});
}
document.addEventListener("click", destravarAudio, { once: true });

elementoBotaoSom.addEventListener("click", () => {
  somAtivado = !somAtivado;
  elementoBotaoSom.textContent = somAtivado ? "🔔 Som ativado" : "🔕 Som mutado";
  elementoBotaoSom.classList.toggle("ativo", somAtivado);
});

function tocarAudioPadraoIdentificado() {
  if (!somAtivado) return;
  audioPadraoIdentificado.currentTime = 0;
  audioPadraoIdentificado.play().catch((erro) => console.warn("Não foi possível tocar o áudio:", erro));
}

// id_oferta do nível "aguardando 3ª tentativa" ativo visto por último -- na primeira carga só
// registra, depois toca o áudio quando um nível NOVO fica ativo (não repete a cada 3s
// enquanto o mesmo nível continua ativo).
let idNivelAguardandoVisto = undefined; // undefined = ainda não checou; null = nenhum ativo

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

async function buscarRegioesMercado() {
  const { data, error } = await supabaseCliente
    .from("regioes_mercado")
    .select("id,operacao,minima,maxima,quantidade_travas,ultima_trava_em,atualizado_em");
  if (error) throw error;
  return data;
}

async function buscarNivelAguardando() {
  // Por design só devia existir 1 linha ativo=true por vez (ver publicar_niveis_aguardando em
  // publicador_dashboard.py), mas ordena por atualizado_em desc por segurança -- se alguma
  // vez sobrar mais de uma ativa (ex.: corrida entre desativar a antiga e ativar a nova),
  // pega sempre a mais recente, não uma qualquer.
  const { data, error } = await supabaseCliente
    .from("niveis_aguardando_3_tentativa")
    .select("id_oferta,nivel_preco,operacao,forca")
    .eq("ativo", true)
    .order("atualizado_em", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data[0] || null;
}

async function buscarPadroesRecentes() {
  // Ordena por criado_em (timestamptz de verdade, com data), NÃO por horario_segunda (só
  // "HH:MM:SS", sem data) -- senão um padrão de 23h de ontem parece "mais recente" que um de
  // 06h de hoje, já que "23" > "06" como texto puro.
  const { data, error } = await supabaseCliente
    .from("padroes_1_2_tentativa")
    .select("id,horario_segunda,regiao_preco,operacao,forca")
    .order("criado_em", { ascending: false })
    .limit(LIMITE_PADROES_EXIBIDOS);
  if (error) throw error;
  return data;
}

async function buscarOperacoesSimuladas() {
  // Vem do analisador_tentativas_pequenas.py (times filtrado <= 3 contratos, rodando local,
  // separado do servidor.py) -- criado_em é timestamptz de verdade, ordena certo entre dias.
  // Sem limit aqui de propósito: a performance (resumo/gráfico) precisa de TODAS as operações do
  // dia, não só as mais recentes -- a tabela na tela é que corta pra LIMITE_OPERACOES_SIMULADAS_EXIBIDAS.
  const { data, error } = await supabaseCliente
    .from("operacoes_simuladas_pequenas")
    .select("id,operacao,preco_entrada,tentativas,negocios_acumulados,minutos_formacao,status,resultado,resultado_pontos,observacao,horario_entrada,horario_resultado,criado_em")
    .not("status", "in", "(cancelada,descartada)") // ruído de referências que nunca confirmaram -- não interessa aqui
    .order("criado_em", { ascending: false });
  if (error) throw error;
  return data;
}

function tagFraco(forca) {
  return forca < FORCA_MINIMA_NOTIFICACAO
    ? ' <span class="tag-fraco" title="Força da trava abaixo do mínimo -- o Telegram não notificou esse padrão">fraco</span>'
    : "";
}

function formatarPreco(preco) {
  return preco.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Classifica cada região em "abaixo" ou "acima" do preço atual (regiões que contêm o preço
 *  entram nas duas listas de cartões, mas não contam pra leitura direcional -- ver
 *  calcularLeituraDirecional). Cada região ganha uma "distância" (0 se contém o preço) pra
 *  ordenar as tabelas da mais próxima pra mais longe. */
function classificarRegioes(regioes, precoAtual) {
  const comDistancia = regioes.map((r) => {
    let distancia;
    let posicao;
    if (precoAtual >= r.minima && precoAtual <= r.maxima) {
      distancia = 0;
      posicao = "dentro";
    } else if (r.minima > precoAtual) {
      distancia = r.minima - precoAtual;
      posicao = "acima";
    } else {
      distancia = precoAtual - r.maxima;
      posicao = "abaixo";
    }
    return { ...r, distancia, posicao };
  });
  comDistancia.sort((a, b) => a.distancia - b.distancia);
  return comDistancia;
}

/** Suporte = travas de COMPRA abaixo do preço (defenderam a queda até aqui); resistência =
 *  travas de VENDA acima do preço (seguraram a alta até aqui). Regiões do lado "errado"
 *  (venda abaixo, compra acima) são zonas que o preço já superou/ainda não chegou -- entram
 *  na tabela de leitura como contexto, mas não pesam na conclusão do viés. */
function calcularLeituraDirecional(regioesClassificadas) {
  const soma = { compraAbaixo: 0, vendaAbaixo: 0, compraAcima: 0, vendaAcima: 0 };
  const contagem = { compraAbaixo: 0, vendaAbaixo: 0, compraAcima: 0, vendaAcima: 0 };

  for (const r of regioesClassificadas) {
    if (r.posicao === "dentro") continue;
    const chave = r.operacao === "compra"
      ? (r.posicao === "abaixo" ? "compraAbaixo" : "compraAcima")
      : (r.posicao === "abaixo" ? "vendaAbaixo" : "vendaAcima");
    soma[chave] += r.quantidade_travas;
    contagem[chave] += 1;
  }

  const suporte = soma.compraAbaixo;
  const resistencia = soma.vendaAcima;
  let vies = "neutro";
  if (suporte > resistencia) vies = "alta";
  else if (resistencia > suporte) vies = "baixa";

  return { soma, contagem, suporte, resistencia, vies };
}

function celulaLeitura(quantidadeRegioes, travas) {
  if (quantidadeRegioes === 0) return "—";
  return `${travas} trava${travas === 1 ? "" : "s"} <span class="detalhe-leve">(${quantidadeRegioes} região${quantidadeRegioes === 1 ? "" : "ões"})</span>`;
}

function celulaResultado(op) {
  if (op.status === "aberta") return '<span class="tag-resultado aberta">em aberto</span>';
  if (op.status === "cancelada") return '<span class="tag-resultado cancelada">cancelada</span>';
  const classe = op.status === "gain" ? "lucro" : "prejuizo";
  return `<span class="tag-resultado ${classe}">${op.resultado} (${op.resultado_pontos > 0 ? "+" : ""}${op.resultado_pontos} pts)</span>`;
}

function formatarDolar(valor) {
  const sinal = valor > 0 ? "+" : "";
  return `${sinal}$${valor.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Resumo (operações resolvidas, taxa de acerto, resultado em $ com 2 MNQ) + gráfico (barra
 *  gain/stop + curva de patrimônio acumulado) -- usa TODAS as operações do dia (não só as
 *  exibidas na tabela), em ordem cronológica (a query já vem desc, então inverte aqui). */
function atualizarPerformance(operacoesSimuladas) {
  const resolvidas = [...operacoesSimuladas]
    .filter((o) => o.status === "gain" || o.status === "stop")
    .sort((a, b) => a.criado_em.localeCompare(b.criado_em));

  if (resolvidas.length === 0) {
    elementoResumoOperacoes.textContent = "—";
    elementoResumoAcerto.textContent = "—";
    elementoResumoFinanceiro.textContent = "—";
    elementoGraficoPerformance.hidden = true;
    return;
  }

  const gains = resolvidas.filter((o) => o.status === "gain");
  const stops = resolvidas.filter((o) => o.status === "stop");
  const taxaAcerto = (gains.length / resolvidas.length) * 100;

  let acumulado = 0;
  const pontosCurva = resolvidas.map((o) => {
    acumulado += o.resultado_pontos * DOLAR_POR_PONTO_2_MNQ;
    return acumulado;
  });
  const resultadoTotal = acumulado;

  elementoResumoOperacoes.textContent = resolvidas.length;
  elementoResumoAcerto.textContent = `${taxaAcerto.toFixed(1)}%`;
  elementoResumoFinanceiro.textContent = formatarDolar(resultadoTotal);
  elementoResumoFinanceiro.className = "resumo-valor " + (resultadoTotal >= 0 ? "positivo" : "negativo");

  elementoGraficoPerformance.hidden = false;
  elementoGraficoGainContagem.textContent = gains.length;
  elementoGraficoStopContagem.textContent = stops.length;
  const maiorLado = Math.max(gains.length, stops.length, 1);
  elementoGraficoBarraGain.style.width = `${(gains.length / maiorLado) * 100}%`;
  elementoGraficoBarraStop.style.width = `${(stops.length / maiorLado) * 100}%`;

  desenharCurvaPatrimonio(pontosCurva);
}

function desenharCurvaPatrimonio(pontosCurva) {
  const largura = 600;
  const altura = 140;
  const minimo = Math.min(0, ...pontosCurva);
  const maximo = Math.max(0, ...pontosCurva);
  const amplitude = maximo - minimo || 1;

  const paraX = (i) => (pontosCurva.length <= 1 ? 0 : (i / (pontosCurva.length - 1)) * largura);
  const paraY = (valor) => altura - ((valor - minimo) / amplitude) * altura;

  const pontos = pontosCurva.map((v, i) => `${paraX(i).toFixed(1)},${paraY(v).toFixed(1)}`).join(" ");
  const corLinha = pontosCurva[pontosCurva.length - 1] >= 0 ? "#26a69a" : "#ef5350";
  const yZero = paraY(0).toFixed(1);

  elementoGraficoCurva.innerHTML = `
    <line x1="0" y1="${yZero}" x2="${largura}" y2="${yZero}" stroke="#2a2e39" stroke-width="1" stroke-dasharray="4,4" />
    <polyline points="${pontos}" fill="none" stroke="${corLinha}" stroke-width="2" />
  `;
}

function linhaTabelaRegiao(r) {
  const distanciaTexto = r.posicao === "dentro" ? "dentro agora" : `${r.distancia.toFixed(2)} pts ${r.posicao}`;
  const horario = r.ultima_trava_em ? r.ultima_trava_em.slice(0, 8) : "—";
  return `
    <tr>
      <td>${formatarPreco(r.minima)} – ${formatarPreco(r.maxima)}</td>
      <td>${distanciaTexto}</td>
      <td>${r.quantidade_travas}</td>
      <td>${horario}</td>
    </tr>
  `;
}

async function atualizar() {
  try {
    const [precoAtual, regioes, nivelAguardando, padroes, operacoesSimuladas] = await Promise.all([
      buscarPrecoAtual(),
      buscarRegioesMercado(),
      buscarNivelAguardando(),
      buscarPadroesRecentes(),
      buscarOperacoesSimuladas(),
    ]);

    if (!precoAtual) {
      elementoStatus.textContent = "aguardando negociações do publicador_dashboard.py…";
      elementoStatus.className = "status";
      return;
    }

    elementoPrecoValor.textContent = formatarPreco(precoAtual.preco);
    elementoPrecoHorario.textContent = precoAtual.horario.slice(0, 8);

    const regioesConfirmadas = regioes.filter((r) => r.quantidade_travas >= MINIMO_TRAVAS_CONFIRMADA);
    const regioesIsoladas = regioes.filter((r) => r.quantidade_travas < MINIMO_TRAVAS_CONFIRMADA);

    const regioesClassificadas = classificarRegioes(regioesConfirmadas, precoAtual.preco);
    const regiaoDentro = regioesClassificadas.find((r) => r.posicao === "dentro");

    if (regiaoDentro) {
      elementoBannerDentro.hidden = false;
      elementoBannerDentro.className = "banner-dentro-regiao " + regiaoDentro.operacao;
      elementoBannerDentro.textContent =
        `Preço dentro de uma região ${regiaoDentro.operacao} agora (${formatarPreco(regiaoDentro.minima)} – ${formatarPreco(regiaoDentro.maxima)}, ${regiaoDentro.quantidade_travas} travas)`;
    } else {
      elementoBannerDentro.hidden = true;
    }

    const leitura = calcularLeituraDirecional(regioesClassificadas);
    elementoLeituraCompraAbaixo.innerHTML = celulaLeitura(leitura.contagem.compraAbaixo, leitura.soma.compraAbaixo);
    elementoLeituraVendaAbaixo.innerHTML = celulaLeitura(leitura.contagem.vendaAbaixo, leitura.soma.vendaAbaixo);
    elementoLeituraCompraAcima.innerHTML = celulaLeitura(leitura.contagem.compraAcima, leitura.soma.compraAcima);
    elementoLeituraVendaAcima.innerHTML = celulaLeitura(leitura.contagem.vendaAcima, leitura.soma.vendaAcima);

    elementoViesValor.textContent = leitura.vies.toUpperCase();
    elementoViesValor.className = "hero-vies-valor " + leitura.vies;

    const textosConclusao = {
      alta: `Estrutura de ALTA — suporte (${leitura.suporte} travas de compra abaixo) mais forte que a resistência (${leitura.resistencia} travas de venda acima).`,
      baixa: `Estrutura de BAIXA — resistência (${leitura.resistencia} travas de venda acima) mais forte que o suporte (${leitura.suporte} travas de compra abaixo).`,
      neutro: `Neutro — suporte (${leitura.suporte}) e resistência (${leitura.resistencia}) equilibrados, ou nenhuma região relevante nos dois lados.`,
    };
    elementoLeituraConclusao.textContent = textosConclusao[leitura.vies];
    elementoLeituraConclusao.className = "leitura-conclusao " + leitura.vies;

    // Ordena por atualizado_em (timestamptz de verdade, com data) -- NÃO por ultima_trava_em
    // (só "HH:MM:SS", sem data), pelo mesmo motivo do buscarPadroesRecentes: senão uma trava
    // de 23h de ontem parece "mais recente" que uma de 06h de hoje. A "distância" continua
    // calculada e mostrada na coluna, só não é mais o critério de ordem das linhas.
    const porAtualizadoDesc = (a, b) => (b.atualizado_em || "").localeCompare(a.atualizado_em || "");
    const regioesCompra = regioesClassificadas.filter((r) => r.operacao === "compra").sort(porAtualizadoDesc);
    const regioesVenda = regioesClassificadas.filter((r) => r.operacao === "venda").sort(porAtualizadoDesc);

    elementoCorpoTabelaCompra.innerHTML = regioesCompra.length
      ? regioesCompra.map(linhaTabelaRegiao).join("")
      : '<tr><td colspan="4" class="linha-vazia">sem regiões</td></tr>';

    elementoCorpoTabelaVenda.innerHTML = regioesVenda.length
      ? regioesVenda.map(linhaTabelaRegiao).join("")
      : '<tr><td colspan="4" class="linha-vazia">sem regiões</td></tr>';

    const isoladasRecentes = [...regioesIsoladas]
      .sort(porAtualizadoDesc)
      .slice(0, LIMITE_ISOLADAS_EXIBIDAS);

    elementoCorpoTabelaIsoladas.innerHTML = isoladasRecentes.length
      ? isoladasRecentes.map((r) => `
        <tr>
          <td>${r.ultima_trava_em ? r.ultima_trava_em.slice(0, 8) : "—"}</td>
          <td><span class="tag-operacao ${r.operacao}">${r.operacao}</span></td>
          <td>${formatarPreco(r.minima)}</td>
        </tr>
      `).join("")
      : '<tr><td colspan="3" class="linha-vazia">nenhuma trava isolada</td></tr>';

    if (nivelAguardando) {
      elementoPainelAguardando.hidden = false;
      elementoPainelAguardando.className = "painel-aguardando " + nivelAguardando.operacao;
      elementoConteudoAguardando.innerHTML =
        `<span class="tag-operacao ${nivelAguardando.operacao}">${nivelAguardando.operacao}</span> ` +
        `nível ${formatarPreco(nivelAguardando.nivel_preco)}${tagFraco(nivelAguardando.forca)}`;
    } else {
      elementoPainelAguardando.hidden = true;
    }

    const idNivelAtual = nivelAguardando ? nivelAguardando.id_oferta : null;
    if (idNivelAguardandoVisto === undefined) {
      // primeira carga da página: só registra, não toca o histórico.
      idNivelAguardandoVisto = idNivelAtual;
    } else if (idNivelAtual && idNivelAtual !== idNivelAguardandoVisto) {
      // Só marca como "visto" quando o som REALMENTE tocar -- se o padrão ficou ativo com o
      // som desligado, fica pendente (continua tentando a cada ciclo) até o usuário ativar o
      // som, em vez de considerar "já avisado" silenciosamente.
      if (somAtivado) {
        tocarAudioPadraoIdentificado();
        idNivelAguardandoVisto = idNivelAtual;
      }
    } else if (!idNivelAtual) {
      idNivelAguardandoVisto = null;
    }

    elementoCorpoTabelaPadroes.innerHTML = padroes.length
      ? padroes.map((p) => `
        <tr>
          <td>${p.horario_segunda.slice(0, 8)}</td>
          <td><span class="tag-operacao ${p.operacao}">${p.operacao}</span>${tagFraco(p.forca)}</td>
          <td>${formatarPreco(p.regiao_preco)}</td>
        </tr>
      `).join("")
      : '<tr><td colspan="3" class="linha-vazia">nenhum padrão confirmado ainda</td></tr>';

    atualizarPerformance(operacoesSimuladas);

    const operacoesExibidas = operacoesSimuladas.slice(0, LIMITE_OPERACOES_SIMULADAS_EXIBIDAS);
    elementoCorpoTabelaOperacoesSimuladas.innerHTML = operacoesExibidas.length
      ? operacoesExibidas.map((o) => `
        <tr>
          <td>${o.horario_entrada.slice(0, 8)}</td>
          <td><span class="tag-operacao ${o.operacao}">${o.operacao}</span></td>
          <td>${formatarPreco(o.preco_entrada)}</td>
          <td>${o.tentativas}</td>
          <td>${o.negocios_acumulados ?? "—"}</td>
          <td>${o.minutos_formacao != null ? `${o.minutos_formacao.toFixed(1)}min` : "—"}</td>
          <td>${celulaResultado(o)}</td>
          <td>${o.resultado_pontos != null ? formatarDolar(o.resultado_pontos * DOLAR_POR_PONTO_2_MNQ) : "—"}</td>
          <td class="detalhe-leve">${o.observacao || "—"}</td>
        </tr>
      `).join("")
      : '<tr><td colspan="9" class="linha-vazia">nenhuma operação simulada ainda</td></tr>';

    elementoStatus.textContent = `ao vivo — ${regioesConfirmadas.length} regiões, ${regioesIsoladas.length} isoladas, ${padroes.length} padrões (atualizado ${new Date().toLocaleTimeString("pt-BR")})`;
    elementoStatus.className = "status ok";
  } catch (erro) {
    console.error(erro);
    elementoStatus.textContent = "erro ao buscar dados do Supabase — veja o console";
    elementoStatus.className = "status erro";
  }
}

atualizar();
setInterval(atualizar, INTERVALO_ATUALIZACAO_MS);
