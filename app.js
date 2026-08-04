const supabaseCliente = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const INTERVALO_ATUALIZACAO_MS = 3000;
const LIMITE_PADROES_EXIBIDOS = 20; // mostra só os mais recentes, mais antigo que isso não cabe na tela
const LIMITE_ISOLADAS_EXIBIDAS = 20;
// Mesma régua do publicador_dashboard.py (MINIMO_TRAVAS_POR_REGIAO): região só conta pras
// tabelas principais/leitura direcional com 2+ travas -- o backend agora publica TUDO
// (inclusive 1 trava só), e é aqui no site que a gente separa confirmada de isolada.
const MINIMO_TRAVAS_CONFIRMADA = 2;

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
const elementoBotaoSom = document.getElementById("botao-som");

// ---- Áudio (os mesmos .mp3 de voz gravados pelo usuário, usados pelo servidor.py) tocado
// toda vez que aparece um padrão novo (linha nova em padroes_1_2_tentativa) -- compra e venda
// tocam arquivos diferentes. Ligado por padrão (o botão agora serve pra MUTAR, não pra
// ativar) -- mas navegadores só liberam áudio de verdade depois de alguma interação do
// usuário com a página, então destrava no primeiro clique em QUALQUER lugar, não só no
// botão (o botão continua funcionando como mute/unmute manual). ----
let somAtivado = true;
const audioCompra = new Audio("sons/compradores_travando.mp3");
const audioVenda = new Audio("sons/vendedores_travando.mp3");
const audioPadraoIdentificado = new Audio("sons/segunda_trava_validada.mp3");

elementoBotaoSom.textContent = "🔔 Som ativado";
elementoBotaoSom.classList.add("ativo");

let audioDestravado = false;
function destravarAudio() {
  if (audioDestravado) return;
  audioDestravado = true;
  for (const audio of [audioCompra, audioVenda, audioPadraoIdentificado]) {
    audio.play().then(() => audio.pause()).catch(() => {});
  }
}
document.addEventListener("click", destravarAudio, { once: true });

elementoBotaoSom.addEventListener("click", () => {
  somAtivado = !somAtivado;
  elementoBotaoSom.textContent = somAtivado ? "🔔 Som ativado" : "🔕 Som mutado";
  elementoBotaoSom.classList.toggle("ativo", somAtivado);
  if (somAtivado) {
    tocarBlip("compra"); // feedback imediato de que o som funciona
  }
});

function tocarBlip(operacao) {
  if (!somAtivado) return;
  const audio = operacao === "compra" ? audioCompra : audioVenda;
  audio.currentTime = 0;
  audio.play().catch((erro) => console.warn("Não foi possível tocar o áudio:", erro));
}

function tocarAudioPadraoIdentificado() {
  if (!somAtivado) return;
  audioPadraoIdentificado.currentTime = 0;
  audioPadraoIdentificado.play().catch((erro) => console.warn("Não foi possível tocar o áudio:", erro));
}

// ids de padrões já vistos -- na primeira carga só registra (não bipa o histórico do dia
// inteiro), da segunda em diante bipa quando aparece um id novo.
let idsPadroesVistos = null;

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
    .select("id,operacao,minima,maxima,quantidade_travas,ultima_trava_em");
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
    .select("id_oferta,nivel_preco,operacao")
    .eq("ativo", true)
    .order("atualizado_em", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data[0] || null;
}

async function buscarPadroesRecentes() {
  const { data, error } = await supabaseCliente
    .from("padroes_1_2_tentativa")
    .select("id,horario_segunda,regiao_preco,operacao")
    .order("horario_segunda", { ascending: false })
    .limit(LIMITE_PADROES_EXIBIDOS);
  if (error) throw error;
  return data;
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
    const [precoAtual, regioes, nivelAguardando, padroes] = await Promise.all([
      buscarPrecoAtual(),
      buscarRegioesMercado(),
      buscarNivelAguardando(),
      buscarPadroesRecentes(),
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

    // Ordena pela última trava (mais recente primeiro) -- a "distância" continua calculada e
    // mostrada na coluna, só não é mais o critério de ordem das linhas.
    const porUltimaTravaDesc = (a, b) => (b.ultima_trava_em || "").localeCompare(a.ultima_trava_em || "");
    const regioesCompra = regioesClassificadas.filter((r) => r.operacao === "compra").sort(porUltimaTravaDesc);
    const regioesVenda = regioesClassificadas.filter((r) => r.operacao === "venda").sort(porUltimaTravaDesc);

    elementoCorpoTabelaCompra.innerHTML = regioesCompra.length
      ? regioesCompra.map(linhaTabelaRegiao).join("")
      : '<tr><td colspan="4" class="linha-vazia">sem regiões</td></tr>';

    elementoCorpoTabelaVenda.innerHTML = regioesVenda.length
      ? regioesVenda.map(linhaTabelaRegiao).join("")
      : '<tr><td colspan="4" class="linha-vazia">sem regiões</td></tr>';

    const isoladasRecentes = [...regioesIsoladas]
      .sort((a, b) => (b.ultima_trava_em || "").localeCompare(a.ultima_trava_em || ""))
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
        `nível ${formatarPreco(nivelAguardando.nivel_preco)}`;
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
          <td><span class="tag-operacao ${p.operacao}">${p.operacao}</span></td>
          <td>${formatarPreco(p.regiao_preco)}</td>
        </tr>
      `).join("")
      : '<tr><td colspan="3" class="linha-vazia">nenhum padrão confirmado ainda</td></tr>';

    if (idsPadroesVistos === null) {
      // primeira carga da página: só registra o que já existe, não bipa o histórico do dia.
      idsPadroesVistos = new Set(padroes.map((p) => p.id));
    } else {
      // padroes vem ordenado por horario_segunda desc, então o primeiro não visto é o mais
      // recente -- usa a operação dele pra escolher qual áudio tocar. Só marca como "visto"
      // quando o som REALMENTE tocar -- fica pendente se o som ainda estiver desligado.
      const padraoNovo = padroes.find((p) => !idsPadroesVistos.has(p.id));
      if (padraoNovo && somAtivado) {
        tocarBlip(padraoNovo.operacao);
        idsPadroesVistos = new Set(padroes.map((p) => p.id));
      }
    }

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
