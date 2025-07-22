// public/js/index.js

document.addEventListener('DOMContentLoaded', (event) => {
    
    // Mapeamento dos elementos do DOM
    const ruaInputElement = document.getElementById('ruaInput');
    const ruaSugestoesDivElement = document.getElementById('ruaSugestoes');
    const bairroInputElement = document.getElementById('bairroInput');
    const bairroSugestoesDivElement = document.getElementById('bairroSugestoes');
    const buracosContainerElement = document.getElementById('buracosContainer');
    const addBuracoBtnElement = document.getElementById('addBuracoBtn');
    const salvarTudoBtnElement = document.getElementById('salvarTudoBtn');
    const statusSalvarElement = document.getElementById('statusSalvar');
    const loadingSpinnerElement = document.getElementById('loadingSpinner');
    const observacaoInputElement = document.getElementById('observacaoInput');
    const successOverlay = document.getElementById('success-overlay');
    const dataLancamentoElement = document.getElementById('dataLancamento');

    let debounceTimer;
    let nextUniqueBuracoId = 1;
    let todosOsBairros = [];

    // Função para obter a data no formato YYYY-MM-DD
    function getISODate(date) {
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd}`;
    }

    // Função para resetar o formulário
    function resetarFormularioCompleto() {
        ruaInputElement.value = '';
        bairroInputElement.value = '';
        observacaoInputElement.value = '';
        buracosContainerElement.innerHTML = '';
        document.getElementById('tempoBom').checked = true;
        statusSalvarElement.textContent = '';
        statusSalvarElement.className = '';
        dataLancamentoElement.value = getISODate(new Date());
        adicionarNovoBuraco();
        dataLancamentoElement.focus();
    }
    
    // ==================================================================
    // ALTERAÇÃO APLICADA AQUI: Carrega os bairros para o autocompletar
    // ==================================================================
    function carregarBairrosParaAutocompletar() {
        fetch('/api/buscar-bairros')
            .then(response => response.json())
            .then(bairros => {
                todosOsBairros = bairros;
            })
            .catch(error => {
                console.error("Erro ao carregar bairros:", error);
            });
    }

    // Função genérica para exibir sugestões
    function exibirSugestoes(items, container, inputElement, onSelectCallback) {
        container.innerHTML = '';
        if (items && items.length > 0) {
            container.style.display = 'block';
            items.forEach(item => {
                const divItem = document.createElement('div');
                divItem.className = 'sugestao-item';
                divItem.textContent = item;
                divItem.addEventListener('click', () => {
                    inputElement.value = item;
                    container.style.display = 'none';
                    if(onSelectCallback) onSelectCallback();
                });
                container.appendChild(divItem);
            });
        } else {
            container.style.display = 'none';
        }
    }

    // Renumera os buracos
    function renumerarBuracosVisualmente() {
        const buracoEntries = buracosContainerElement.getElementsByClassName('buraco-entry');
        for (let i = 0; i < buracoEntries.length; i++) {
            const header = buracoEntries[i].querySelector('.buraco-header');
            if (header) header.textContent = `TAPA BURACO ${i + 1}`;
        }
    }

    // Adiciona um novo campo de buraco
    function adicionarNovoBuraco() {
        if (buracosContainerElement.children.length >= 50) {
            alert("Limite de 50 buracos por submissão atingido.");
            return;
        }
        const buracoId = nextUniqueBuracoId++;
        const novoBuracoDiv = document.createElement('div');
        novoBuracoDiv.className = 'buraco-entry';
        novoBuracoDiv.id = 'buracoEntry_' + buracoId;

        novoBuracoDiv.innerHTML = `
            <div style="display: flex; justify-content: space-between; align-items: center;">
                <div class="buraco-header">TAPA BURACO</div>
                <button type="button" class="remove-buraco-btn">Remover</button>
            </div>
            <label>Comprimento (m) (use vírgula):</label> <input type="text" inputmode="decimal" class="comprimento" placeholder="Ex: 5,00">
            <label>Largura (m) (use vírgula):</label> <input type="text" inputmode="decimal" class="largura" placeholder="Ex: 2,00">
            <label>Espessura (cm) (use vírgula):</label> <input type="text" inputmode="decimal" class="espessura" placeholder="Ex: 0,05">
        `;
        novoBuracoDiv.querySelector('.remove-buraco-btn').addEventListener('click', () => {
            novoBuracoDiv.remove();
            renumerarBuracosVisualmente();
        });
        buracosContainerElement.appendChild(novoBuracoDiv);
        renumerarBuracosVisualmente();
    };

    // Lógica de salvamento
    salvarTudoBtnElement.addEventListener('click', function() {
        const ruaSelecionada = ruaInputElement.value.trim();
        const bairroSelecionado = bairroInputElement.value.trim();
        if (!ruaSelecionada || !bairroSelecionado) {
            alert('Por favor, preencha a rua e o bairro.');
            return;
        }
        
        const dadosDosBuracos = [];
        const entries = buracosContainerElement.getElementsByClassName('buraco-entry');
        if (entries.length === 0) {
            alert("Adicione pelo menos um buraco para salvar.");
            return;
        }

        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            const larguraVal = entry.querySelector('.largura').value.trim();
            const comprimentoVal = entry.querySelector('.comprimento').value.trim();
            const espessuraVal = entry.querySelector('.espessura').value.trim();
            if (!larguraVal || !comprimentoVal || !espessuraVal) {
                alert(`Preencha todas as medidas para o TAPA BURACO ${i + 1}.`);
                return;
            }
            dadosDosBuracos.push({ identificador: `TAPA BURACO ${i + 1}`, largura: larguraVal, comprimento: comprimentoVal, espessura: espessuraVal });
        }

        loadingSpinnerElement.style.display = 'block';
        salvarTudoBtnElement.disabled = true;

        const dados = {
            rua: ruaSelecionada,
            bairro: bairroSelecionado,
            buracos: dadosDosBuracos,
            condicaoTempo: document.querySelector('input[name="condicaoTempo"]:checked').value,
            observacao: observacaoInputElement.value.trim(),
            username: localStorage.getItem('loggedInUser'),
            dataLancamento: dataLancamentoElement.value 
        };
        
        fetch('/api/salvar', { 
            method: 'POST', 
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(dados)
        })
        .then(response => response.json().then(data => ({ ok: response.ok, body: data })))
        .then(({ ok, body }) => {
            if (ok) {
                resetarFormularioCompleto();
                successOverlay.classList.add('active');
                setTimeout(() => successOverlay.classList.remove('active'), 2500);
            } else {
                statusSalvarElement.textContent = body.error || 'Ocorreu um erro.';
                statusSalvarElement.className = 'error';
            }
        })
        .catch(err => {
            statusSalvarElement.textContent = 'Erro de conexão. Verifique a rede.';
            statusSalvarElement.className = 'error';
        })
        .finally(() => {
            loadingSpinnerElement.style.display = 'none';
            salvarTudoBtnElement.disabled = false;
        });
    });

    // Event listener para autocompletar RUA
    ruaInputElement.addEventListener('input', (event) => {
        clearTimeout(debounceTimer);
        const textoDigitado = event.target.value;
        if (textoDigitado.length < 2) {
            ruaSugestoesDivElement.style.display = 'none';
            return;
        }
        debounceTimer = setTimeout(() => {
            fetch('/api/buscar-ruas?texto=' + encodeURIComponent(textoDigitado))
                .then(response => response.json())
                .then(listaDeRuas => exibirSugestoes(listaDeRuas, ruaSugestoesDivElement, ruaInputElement, () => bairroInputElement.focus()));
        }, 300);
    });

    // ==================================================================
    // ALTERAÇÃO APLICADA AQUI: Event listener para autocompletar BAIRRO
    // ==================================================================
    bairroInputElement.addEventListener('input', (event) => {
        const textoDigitado = event.target.value.toLowerCase();
        if (!textoDigitado) {
            bairroSugestoesDivElement.style.display = 'none';
            return;
        }
        const bairrosFiltrados = todosOsBairros.filter(bairro => 
            bairro.toLowerCase().includes(textoDigitado)
        );
        exibirSugestoes(bairrosFiltrados, bairroSugestoesDivElement, bairroInputElement);
    });

    // Oculta sugestões ao clicar fora
    document.addEventListener('click', function(event) {
        if (!ruaInputElement.contains(event.target)) ruaSugestoesDivElement.style.display = 'none';
        if (!bairroInputElement.contains(event.target)) bairroSugestoesDivElement.style.display = 'none';
    });
    
    addBuracoBtnElement.addEventListener('click', adicionarNovoBuraco);
    
    // Inicialização da página
    carregarBairrosParaAutocompletar();
    adicionarNovoBuraco();
    dataLancamentoElement.value = getISODate(new Date());
});
