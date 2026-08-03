const supabaseCliente = supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

const INTERVALO_ATUALIZACAO_MS = 3000;
const LIMITE_PADROES_EXIBIDOS = 20; // mostra só os mais recentes, mais antigo que isso não cabe na tela

const elementoStatus = document.getElementById("status");
const elementoPrecoValor = document.getElementById("preco-valor");
const elementoPrecoHorario = document.getElementById("preco-horario");
const elementoConteudoAcima = document.getElementById("conteudo-regiao-acima");
const elementoConteudoAbaixo = document.getElementById("conteudo-regiao-abaixo");
const elementoBannerDentro = document.getElementById("banner-dentro-regiao");
const elementoPainelAguardando = document.getElementById("painel-aguardando");
const elementoConteudoAguardando = document.getElementById("conteudo-aguardando");
const elementoListaPadroes = document.getElementById("lista-padroes");

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
    .select("id,operacao,minima,maxima,quantidade_travas");
  if (error) throw error;
  return data;
}

async function buscarNivelAguardando() {
  const { data, error } = await supabaseCliente
    .from("niveis_aguardando_3_tentativa")
    .select("nivel_preco,operacao")
    .eq("ativo", true)
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

/** Acha a região da mesma "direção" (acima ou abaixo do preço atual) mais próxima -- uma
 *  região pode ser compradora ou vendedora independente de estar acima ou abaixo, então as
 *  duas listas (acima/abaixo) misturam operação, só importa a distância. */
function encontrarRegioesProximas(regioes, precoAtual) {
  let maisProximaAcima = null;
  let maisProximaAbaixo = null;
  let regiaoAtual = null;

  for (const r of regioes) {
    if (precoAtual >= r.minima && precoAtual <= r.maxima) {
      if (!regiaoAtual || (r.maxima - r.minima) < (regiaoAtual.maxima - regiaoAtual.minima)) {
        regiaoAtual = r;
      }
      continue;
    }
    if (r.minima > precoAtual) {
      const distancia = r.minima - precoAtual;
      if (!maisProximaAcima || distancia < maisProximaAcima.distancia) {
        maisProximaAcima = { ...r, distancia };
      }
    } else if (r.maxima < precoAtual) {
      const distancia = precoAtual - r.maxima;
      if (!maisProximaAbaixo || distancia < maisProximaAbaixo.distancia) {
        maisProximaAbaixo = { ...r, distancia };
      }
    }
  }

  return { maisProximaAcima, maisProximaAbaixo, regiaoAtual };
}

function renderizarCardRegiao(elemento, regiao) {
  if (!regiao) {
    elemento.innerHTML = '<span class="card-conteudo vazio">nenhuma região mapeada</span>';
    return;
  }
  const tag = regiao.operacao === "compra" ? "compra" : "venda";
  elemento.innerHTML = `
    <span class="tag-operacao ${tag}">${regiao.operacao}</span>
    <span class="regiao-faixa">${formatarPreco(regiao.minima)} – ${formatarPreco(regiao.maxima)}</span>
    <span class="regiao-detalhe">${regiao.distancia.toFixed(2)} pts de distância · ${regiao.quantidade_travas} travas</span>
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

    const { maisProximaAcima, maisProximaAbaixo, regiaoAtual } = encontrarRegioesProximas(regioes, precoAtual.preco);
    renderizarCardRegiao(elementoConteudoAcima, maisProximaAcima);
    renderizarCardRegiao(elementoConteudoAbaixo, maisProximaAbaixo);

    if (regiaoAtual) {
      elementoBannerDentro.hidden = false;
      elementoBannerDentro.className = "banner-dentro-regiao " + regiaoAtual.operacao;
      elementoBannerDentro.textContent =
        `Preço dentro de uma região ${regiaoAtual.operacao} agora (${formatarPreco(regiaoAtual.minima)} – ${formatarPreco(regiaoAtual.maxima)}, ${regiaoAtual.quantidade_travas} travas)`;
    } else {
      elementoBannerDentro.hidden = true;
    }

    if (nivelAguardando) {
      elementoPainelAguardando.hidden = false;
      elementoPainelAguardando.className = "painel-aguardando " + nivelAguardando.operacao;
      elementoConteudoAguardando.innerHTML =
        `<span class="tag-operacao ${nivelAguardando.operacao}">${nivelAguardando.operacao}</span>` +
        `nível ${formatarPreco(nivelAguardando.nivel_preco)}`;
    } else {
      elementoPainelAguardando.hidden = true;
    }

    if (padroes.length === 0) {
      elementoListaPadroes.innerHTML = '<div class="padrao-vazio">nenhum padrão confirmado ainda</div>';
    } else {
      elementoListaPadroes.innerHTML = padroes.map((p) => `
        <div class="padrao-item">
          <span class="padrao-horario">${p.horario_segunda.slice(0, 8)}</span>
          <span class="tag-operacao ${p.operacao}">${p.operacao}</span>
          <span class="padrao-regiao">${formatarPreco(p.regiao_preco)}</span>
        </div>
      `).join("");
    }

    elementoStatus.textContent = `ao vivo — ${regioes.length} regiões, ${padroes.length} padrões (atualizado ${new Date().toLocaleTimeString("pt-BR")})`;
    elementoStatus.className = "status ok";
  } catch (erro) {
    console.error(erro);
    elementoStatus.textContent = "erro ao buscar dados do Supabase — veja o console";
    elementoStatus.className = "status erro";
  }
}

atualizar();
setInterval(atualizar, INTERVALO_ATUALIZACAO_MS);
