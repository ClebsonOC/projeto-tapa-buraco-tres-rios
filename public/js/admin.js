// public/js/admin.js

let todosOsDadosCombinados = [];
let lazyLoadObserver;
let lastVisibleTimestamp = null;
let isLoading = false;
let hasMoreData = true; // Nova variável para controlar se há mais dados a carregar

// Variáveis para armazenar os elementos do DOM
let loadingDiv;
let loadMoreButton;
let tableBody;
let filtroUsuario, filtroDataInicio, filtroDataFim, botoesFiltroTipo;

document.addEventListener('DOMContentLoaded', function() {
    const userRole = localStorage.getItem('userRole');
    if (userRole !== 'admin') {
        window.location.href = '/index.html';
        return;
    }

    const loggedInUser = localStorage.getItem('loggedInUser');
    if (!loggedInUser) {
        window.location.href = '/login.html';
        return;
    }
    
    // Captura os elementos essenciais do DOM uma única vez
    loadingDiv = document.getElementById('loading');
    tableBody = document.getElementById('admin-table-body');
    const container = document.querySelector('.container');
    filtroUsuario = document.getElementById('filtro-usuario');
    botoesFiltroTipo = document.querySelectorAll('.filter-btn');
    const lightbox = document.getElementById('lightbox-overlay');
    
    // Captura os novos campos de data
    filtroDataInicio = document.getElementById('filtro-data-inicio');
    filtroDataFim = document.getElementById('filtro-data-fim');

    if (!loadingDiv || !tableBody || !container || !filtroUsuario || !filtroDataInicio || !filtroDataFim) {
        console.error("Erro Crítico: Elementos essenciais do DOM não foram encontrados. Verifique o arquivo admin.html.");
        return;
    }

    carregarUsuarios();
    
    // Cria e adiciona o botão "Carregar Mais"
    loadMoreButton = document.createElement('button');
    loadMoreButton.id = 'loadMoreBtn';
    loadMoreButton.textContent = 'Carregar Mais';
    container.appendChild(loadMoreButton);

    iniciarCarregamentoDeDados(); // Inicia a primeira carga

    loadMoreButton.addEventListener('click', carregarPaginaDeDados);

    // Reinicia a lista ao mudar qualquer filtro
    const resetAndLoad = () => {
        todosOsDadosCombinados = [];
        lastVisibleTimestamp = null;
        hasMoreData = true; // Reseta a flag de mais dados
        tableBody.innerHTML = '';
        loadMoreButton.style.display = 'none';
        iniciarCarregamentoDeDados();
    };

    filtroUsuario.addEventListener('change', resetAndLoad);
    filtroDataInicio.addEventListener('change', resetAndLoad);
    filtroDataFim.addEventListener('change', resetAndLoad);
    botoesFiltroTipo.forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.classList.contains('active')) return;
            botoesFiltroTipo.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            resetAndLoad();
        });
    });
    
    if (lightbox) {
        lightbox.addEventListener('click', (e) => {
            if (e.target.id === 'lightbox-overlay' || e.target.classList.contains('lightbox-close')) {
                 closeLightbox();
            }
        });
    }
});

function getAuthHeaders() {
    const loggedInUser = localStorage.getItem('loggedInUser');
    return {
        'Content-Type': 'application/json',
        'Authorization': `User ${loggedInUser || ''}`
    };
}

async function carregarUsuarios() {
    try {
        const response = await fetch('/api/admin/usuarios', { headers: getAuthHeaders() });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Falha ao buscar usuários.');
        }
        const usuarios = await response.json();
        while (filtroUsuario.options.length > 1) filtroUsuario.remove(1);
        usuarios.forEach(usuario => {
            const option = document.createElement('option');
            option.value = usuario;
            option.textContent = usuario;
            filtroUsuario.appendChild(option);
        });
    } catch (error) {
        // Substituído alert por console.error para evitar interrupções no UX
        console.error(`Erro ao carregar usuários: ${error.message}`);
        // Poderia adicionar uma mensagem na tela para o usuário
    }
}

function iniciarCarregamentoDeDados() {
    loadingDiv.style.display = 'block';
    tableBody.innerHTML = '';
    carregarPaginaDeDados();
}

async function carregarPaginaDeDados() {
    if (isLoading || !hasMoreData) return; // Impede carregamento se já estiver carregando ou não houver mais dados
    isLoading = true;

    loadingDiv.style.display = 'block';
    loadMoreButton.style.display = 'none';

    try {
        const selectedUser = filtroUsuario.value;
        const dataInicio = filtroDataInicio.value;
        const dataFim = filtroDataFim.value;

        let apiUrl = `/api/admin/dados?`;
        if (selectedUser !== 'todos') {
            apiUrl += `usuario=${selectedUser}&`;
        }
        if (lastVisibleTimestamp) {
            apiUrl += `lastVisibleTimestamp=${lastVisibleTimestamp}&`;
        }
        if (dataInicio) {
            apiUrl += `dataInicio=${dataInicio}&`;
        }
        if (dataFim) {
            apiUrl += `dataFim=${dataFim}&`;
        }

        const response = await fetch(apiUrl, { headers: getAuthHeaders() });
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Falha ao carregar dados.');
        }
        
        const { data: novosDados, lastVisibleTimestamp: newTimestamp } = await response.json();
        
        todosOsDadosCombinados.push(...novosDados);
        lastVisibleTimestamp = newTimestamp;
        hasMoreData = !!newTimestamp; // Atualiza a flag de mais dados

        renderizarTabela();

        if (hasMoreData) {
            loadMoreButton.style.display = 'block';
        } else {
            loadMoreButton.style.display = 'none';
        }

    } catch (error) {
        // Substituído alert por console.error para evitar interrupções no UX
        console.error(`Erro ao carregar dados: ${error.message}`);
        // Poderia adicionar uma mensagem na tela para o usuário
    } finally {
        isLoading = false;
        loadingDiv.style.display = 'none';
    }
}

function renderizarTabela() {
    const selectedType = document.querySelector('.filter-btn.active').dataset.filter;
    
    if (lazyLoadObserver) lazyLoadObserver.disconnect();

    // Filtra os dados já carregados para exibir na tabela
    const dadosParaExibir = todosOsDadosCombinados.filter(record => {
        return (selectedType === 'todos' || record.tipo === selectedType);
    });

    tableBody.innerHTML = ''; // Limpa a tabela antes de renderizar
    
    if (dadosParaExibir.length === 0 && !isLoading) {
        tableBody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Nenhum registro encontrado para os filtros selecionados.</td></tr>';
        return;
    }

    dadosParaExibir.forEach(record => {
        // Verifica se o registro já existe na tabela para evitar duplicatas
        if (document.getElementById(`main-row-${record.id}`)) return; 

        const dataFormatada = new Date(record.data * 1000).toLocaleString('pt-BR');
        const recordId = record.id;
        const mainRow = document.createElement('tr');
        mainRow.id = `main-row-${recordId}`; // Adiciona um ID para a linha principal
        let resumo = '', tipoDisplay = '';

        if (record.tipo === 'buraco') {
            resumo = `${record.rua}, ${record.bairro}`;
            tipoDisplay = 'Visita em Campo';
        } else {
            resumo = `${record.itensPresentes.length} itens presentes`;
            tipoDisplay = 'Controle de Efetivo';
        }

        mainRow.innerHTML = `<td><button class="expand-btn" onclick="toggleDetails(this, 'details-${recordId}')">+</button></td><td>${dataFormatada}</td><td>${record.registradoPor}</td><td>${tipoDisplay}</td><td>${resumo}</td>`;
        
        const detailsRow = document.createElement('tr');
        detailsRow.id = `details-${recordId}`;
        detailsRow.className = 'details-row';
        
        let detailsHtml = '';
        if (record.tipo === 'buraco') {
            const buracosListHtml = record.buracos.sort((a,b) => a.identificador.localeCompare(b.identificador, undefined, {numeric: true})).map(b => `<li><strong>${b.identificador}:</strong> C: ${b.dimensoes.comprimento}m, L: ${b.dimensoes.largura}m, E: ${b.dimensoes.espessura}cm</li>`).join('');
            let fotosHtml = 'Nenhuma foto.';
            if (record.fotos && record.fotos.length > 0) {
                fotosHtml = '<div class="photo-gallery">';
                record.fotos.forEach(foto => {
                    if (foto && foto.id) {
                        const imageUrl = `/api/imagem/${foto.id}`;
                        fotosHtml += `<img data-src="${imageUrl}" alt="Miniatura" class="thumbnail-img lazy-load" onclick="openLightbox(event, '${foto.id}')">`;
                    }
                });
                fotosHtml += '</div>';
            }
            detailsHtml = `<div class="details-grid"><div class="details-section"><h3>Informações da Visita</h3><ul><li><strong>Rua:</strong> ${record.rua}</li><li><strong>Bairro:</strong> ${record.bairro}</li><li><strong>Condição do Tempo:</strong> ${record.condicaoTempo}</li></ul></div><div class="details-section"><h3>Buracos Registrados</h3><ul>${buracosListHtml}</ul></div></div><div class="details-section" style="grid-column: 1 / -1;"><h3>Fotos</h3>${fotosHtml}</div>`;
        } else {
            const itensHtml = record.itensPresentes.length > 0 ? `<li>${record.itensPresentes.join('</li><li>')}</li>` : '<li>Nenhum item marcado.</li>';
            detailsHtml = `<div class="details-section"><h3>Itens Presentes</h3><ul>${itensHtml}</ul></div>`;
        }

        detailsRow.innerHTML = `<td colspan="5"><div class="details-content">${detailsHtml}<div class="details-footer"><p><strong>Observação:</strong> ${record.observacao || 'Nenhuma.'}</p></div></div></td>`;
        
        tableBody.appendChild(mainRow);
        tableBody.appendChild(detailsRow);
    });
    
    setupLazyLoader();
}

function toggleDetails(button, detailsId) {
    const detailsRow = document.getElementById(detailsId);
    if (detailsRow) {
        detailsRow.classList.toggle('show');
        button.textContent = detailsRow.classList.contains('show') ? '−' : '+';
    }
}

function setupLazyLoader() {
    lazyLoadObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.dataset.src;
                img.classList.remove('lazy-load');
                observer.unobserve(img);
            }
        });
    }, { rootMargin: "0px 0px 200px 0px" });
    document.querySelectorAll('.lazy-load').forEach(img => lazyLoadObserver.observe(img));
}

function openLightbox(event, fileId) {
    event.stopPropagation();
    const lightbox = document.getElementById('lightbox-overlay');
    const lightboxImg = document.getElementById('lightbox-img');
    const spinner = document.getElementById('lightbox-spinner');
    lightbox.style.display = 'flex';
    spinner.style.display = 'block';
    lightboxImg.style.display = 'none';
    lightboxImg.src = `/api/imagem/${fileId}`;
    lightboxImg.onload = () => { spinner.style.display = 'none'; lightboxImg.style.display = 'block'; };
    lightboxImg.onerror = () => { spinner.style.display = 'none'; closeLightbox(); };
}

function closeLightbox() {
    const lightbox = document.getElementById('lightbox-overlay');
    if (lightbox) {
        const lightboxImg = document.getElementById('lightbox-img');
        lightboxImg.onload = null;
        lightboxImg.onerror = null;
        lightbox.style.display = 'none';
        lightboxImg.src = '';
    }
}
