// public/js/efetivo.js

const ITENS_EFETIVO = [
    "CAMINHÃO CACHORREIRA", "CAMINHÃO CAÇAMBA", "ROLO DE CHAPA", "CORTADORA DE PISO",
    "OPERADOR ROLO", "MOTORISTA 1", "MOTORISTA 2", "ENCARREGADO", "APONTADOR",
    "AJUDANTE 1", "AJUDANTE 2", "AJUDANTE 3", "AJUDANTE 4", "AJUDANTE 5",
    "RASTELEIRO 1", "RASTELEIRO 2"
];

// ==================================================================
// ALTERAÇÃO APLICADA AQUI: Variáveis e elementos para controle de data
// ==================================================================
let efetivoDoDiaId = null;
let dataEfetivoInput; 

// Função para obter a data no formato YYYY-MM-DD
function getISODate(date) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

document.addEventListener('DOMContentLoaded', function() {
    const loggedInUser = localStorage.getItem('loggedInUser');
    if (!loggedInUser) {
        window.location.href = '/login.html';
        return;
    }

    dataEfetivoInput = document.getElementById('dataEfetivo');

    // Define a data padrão e adiciona um listener para carregar dados quando a data mudar
    dataEfetivoInput.value = getISODate(new Date());
    dataEfetivoInput.addEventListener('change', () => {
        carregarEfetivoParaData(loggedInUser);
    });

    initializeForm();
    carregarEfetivoParaData(loggedInUser); // Carga inicial para a data de hoje
    carregarHistorico(loggedInUser);

    const form = document.getElementById('efetivo-form');
    if (form) {
        form.addEventListener('submit', salvarEfetivo);
    }
});

function initializeForm() {
    const gridContainer = document.querySelector('.efetivo-grid');
    gridContainer.innerHTML = '';
    ITENS_EFETIVO.forEach(item => {
        const itemDiv = document.createElement('div');
        itemDiv.className = 'item-group';
        const itemId = `check-${item.replace(/ /g, '-')}`;
        itemDiv.innerHTML = `<input type="checkbox" id="${itemId}" name="item" value="${item}"><label for="${itemId}">${item}</label>`;
        gridContainer.appendChild(itemDiv);
    });
}

// ==================================================================
// ALTERAÇÃO APLICADA AQUI: Função modificada para carregar dados da data selecionada
// ==================================================================
async function carregarEfetivoParaData(usuario) {
    // Reseta o estado do formulário antes de carregar novos dados
    efetivoDoDiaId = null;
    document.getElementById('efetivo-form').reset();
    document.getElementById('salvar-btn').textContent = "Salvar Efetivo";
    
    const selectedDate = dataEfetivoInput.value;

    try {
        const response = await fetch(`/api/efetivo?usuario=${usuario}`);
        if (!response.ok) throw new Error('Falha ao buscar dados.');
        const historico = await response.json();
        
        // Procura pelo registro que corresponde à data selecionada no frontend
        const registroDoDia = historico.find(reg => {
            if (!reg.registradoEm || !reg.registradoEm._seconds) return false;
            const registroDate = new Date(reg.registradoEm._seconds * 1000);
            const tzOffset = registroDate.getTimezoneOffset() * 60000;
            const localISOTime = (new Date(registroDate - tzOffset)).toISOString().split('T')[0];
            return localISOTime === selectedDate;
        });

        if (registroDoDia) {
            efetivoDoDiaId = registroDoDia.id;
            document.getElementById('salvar-btn').textContent = "Atualizar Efetivo";
            document.getElementById('observacao').value = registroDoDia.observacao;
            ITENS_EFETIVO.forEach(item => {
                const checkbox = document.querySelector(`input[value="${item}"]`);
                if (checkbox) {
                    checkbox.checked = registroDoDia.itensPresentes.includes(item);
                }
            });
        }
    } catch (error) {
        console.error("Erro ao carregar efetivo para a data selecionada:", error);
    }
}

async function carregarHistorico(usuario) {
    const loadingDiv = document.getElementById('loading-historico');
    const tableBody = document.getElementById('historico-table-body');
    loadingDiv.style.display = 'block';
    tableBody.innerHTML = '';

    try {
        const response = await fetch(`/api/efetivo?usuario=${usuario}`);
        const historico = await response.json();
        loadingDiv.style.display = 'none';

        if (historico.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="3" style="text-align:center;">Nenhum histórico encontrado.</td></tr>';
            return;
        }

        historico.forEach(registro => {
            const dataFormatada = new Date(registro.registradoEm._seconds * 1000).toLocaleDateString('pt-BR');
            const resumoItens = `${registro.itensPresentes.length} de ${ITENS_EFETIVO.length} itens presentes`;
            const docId = registro.id;

            const mainRow = document.createElement('tr');
            mainRow.innerHTML = `
                <td><button class="expand-btn" onclick="toggleDetails(this, 'details-${docId}')">+</button></td>
                <td>${dataFormatada}</td>
                <td>${resumoItens}</td>
            `;
            tableBody.appendChild(mainRow);

            const detailsRow = document.createElement('tr');
            detailsRow.id = `details-${docId}`;
            detailsRow.className = 'details-row';
            const itensHtml = registro.itensPresentes.length > 0 ? `<li>${registro.itensPresentes.join('</li><li>')}</li>` : '<li>Nenhum item marcado como presente.</li>';

            detailsRow.innerHTML = `
                <td colspan="3">
                    <div class="details-content">
                        <p><strong>Itens Presentes:</strong></p>
                        <ul>${itensHtml}</ul>
                        <p><strong>Observação:</strong></p>
                        <p>${registro.observacao || 'Nenhuma observação foi feita.'}</p>
                    </div>
                </td>
            `;
            tableBody.appendChild(detailsRow);
        });
    } catch (error) {
        console.error("Erro ao carregar histórico:", error);
        loadingDiv.innerText = 'Erro ao carregar histórico.';
    }
}

function toggleDetails(button, detailsId) {
    const detailsRow = document.getElementById(detailsId);
    if (detailsRow) {
        detailsRow.classList.toggle('show');
        button.textContent = detailsRow.classList.contains('show') ? '−' : '+';
    }
}

// ==================================================================
// ALTERAÇÃO APLICADA AQUI: Função de salvar envia a data selecionada
// ==================================================================
async function salvarEfetivo(event) {
    event.preventDefault();
    const salvarBtn = document.getElementById('salvar-btn');
    salvarBtn.disabled = true;
    salvarBtn.textContent = 'Salvando...';
    
    const itensPresentes = Array.from(document.querySelectorAll('input[name="item"]:checked')).map(cb => cb.value);
    const observacao = document.getElementById('observacao').value;

    const payload = {
        registradoPor: localStorage.getItem('loggedInUser'),
        itensPresentes,
        observacao,
        dataLancamento: dataEfetivoInput.value // Envia a data selecionada para a API
    };
    
    try {
        // A requisição agora é sempre POST. O backend decide se cria um novo ou atualiza.
        const response = await fetch('/api/efetivo', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        
        const successOverlay = document.getElementById('success-overlay');
        successOverlay.classList.add('active');

        setTimeout(() => {
            window.location.reload();
        }, 2000);

    } catch (error) {
        alert(`Erro: ${error.message}`);
        salvarBtn.disabled = false;
        salvarBtn.textContent = efetivoDoDiaId ? 'Atualizar Efetivo' : 'Salvar Efetivo';
    }
}
