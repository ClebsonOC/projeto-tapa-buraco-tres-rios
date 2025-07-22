// public/js/relatorio.js

let todosOsRegistros = [];
let isSyncingForeground = false;
let lazyLoadObserver;

let lastVisibleTimestamp = null;
let isLoading = false;
let loadMoreButton;

const db = new Dexie("photo-outbox-db");
db.version(3).stores({
  photo_outbox: '++id, submissionId, filename'
});

document.addEventListener('DOMContentLoaded', function() {
    // Elementos da página
    const filtroRuaInput = document.getElementById('filtro-rua');
    const gerarPdfBtn = document.getElementById('gerar-pdf-btn');
    
    // Elementos do Modal
    const dateModalOverlay = document.getElementById('date-modal-overlay');
    const modalConfirmBtn = document.getElementById('modal-confirm-btn');
    const modalCancelBtn = document.getElementById('modal-cancel-btn');
    const modalDateInput = document.getElementById('modal-date-input');

    // Filtro de rua agora é aplicado dinamicamente na tabela já carregada
    if (filtroRuaInput) filtroRuaInput.addEventListener('keyup', () => renderizarTabela());
    
    // Evento para abrir o modal do PDF
    if (gerarPdfBtn) gerarPdfBtn.addEventListener('click', () => {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        modalDateInput.value = `${yyyy}-${mm}-${dd}`;
        dateModalOverlay.classList.add('active');
    });

    // Eventos dos botões do modal
    if (modalCancelBtn) modalCancelBtn.addEventListener('click', () => dateModalOverlay.classList.remove('active'));
    if (modalConfirmBtn) modalConfirmBtn.addEventListener('click', () => {
        const selectedDate = modalDateInput.value;
        if (!selectedDate) {
            alert("Por favor, selecione uma data.");
            return;
        }
        gerarPDF(selectedDate); 
        dateModalOverlay.classList.remove('active');
    });

    // Evento do Lightbox
    const lightbox = document.getElementById('lightbox-overlay');
    if (lightbox) {
        lightbox.addEventListener('click', (e) => {
            if (e.target.id === 'lightbox-overlay' || e.target.classList.contains('lightbox-close')) {
                 closeLightbox();
            }
        });
    }

    // Botão de carregar mais
    const container = document.querySelector('.container');
    loadMoreButton = document.createElement('button');
    loadMoreButton.id = 'loadMoreBtn';
    loadMoreButton.textContent = 'Carregar Mais';
    loadMoreButton.style.display = 'none';
    loadMoreButton.addEventListener('click', carregarPaginaDeDados);
    container.appendChild(loadMoreButton);

    iniciarCarregamentoDeDados();

    // Listener para atualizações do Service Worker
    navigator.serviceWorker.addEventListener('message', event => {
        if (event.data && event.data.type === 'UPLOAD_STATUS_UPDATE') {
            updateIndividualStatus(event.data.submissionId, event.data.success);
        }
    });

    // Fallback para upload se Background Sync não for suportado
    if (!('SyncManager' in window)) {
        triggerForegroundSync();
    }
});

function iniciarCarregamentoDeDados() {
    const loadingDiv = document.getElementById('loading');
    loadingDiv.style.display = 'block';
    document.getElementById('report-table-body').innerHTML = '';
    lastVisibleTimestamp = null;
    todosOsRegistros = [];
    carregarPaginaDeDados();
}

async function carregarPaginaDeDados() {
    if (isLoading) return;
    isLoading = true;

    const loadingDiv = document.getElementById('loading');
    const loggedInUser = localStorage.getItem('loggedInUser');
    if (!loggedInUser) {
        loadingDiv.innerText = 'Usuário não identificado. Faça login novamente.';
        return;
    }

    loadingDiv.style.display = 'block';
    loadMoreButton.style.display = 'none';

    try {
        let apiUrl = `/api/buracos?usuario=${loggedInUser}`;
        if (lastVisibleTimestamp) {
            apiUrl += `&lastVisibleTimestamp=${lastVisibleTimestamp}`;
        }

        const response = await fetch(apiUrl);
        if (!response.ok) throw new Error('Falha ao carregar dados do servidor.');
        
        const { data: novosRegistros, lastVisibleTimestamp: newTimestamp } = await response.json();
        
        todosOsRegistros.push(...novosRegistros);
        lastVisibleTimestamp = newTimestamp;

        renderizarTabela();

        if (newTimestamp) {
            loadMoreButton.style.display = 'block';
        } else {
            loadMoreButton.style.display = 'none';
        }

    } catch (error) {
        loadingDiv.innerText = `Erro de conexão: ${error.message}`;
    } finally {
        isLoading = false;
        loadingDiv.style.display = 'none';
    }
}

function renderizarTabela() {
    const tableBody = document.getElementById('report-table-body');
    const filtroRuaValue = document.getElementById('filtro-rua').value.toUpperCase();
    
    if (lazyLoadObserver) lazyLoadObserver.disconnect();

    let dadosFiltrados = todosOsRegistros;

    if (filtroRuaValue) {
        dadosFiltrados = dadosFiltrados.filter(item => item.rua.toUpperCase().includes(filtroRuaValue));
    }
    
    const groupedBySubmission = dadosFiltrados.reduce((acc, item) => {
        (acc[item.submissionId] = acc[item.submissionId] || []).push(item);
        return acc;
    }, {});

    tableBody.innerHTML = '';

    if (Object.keys(groupedBySubmission).length === 0 && !isLoading) {
        tableBody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Nenhum registro encontrado.</td></tr>';
        return;
    }

    const sortedVisits = Object.values(groupedBySubmission).sort((a, b) => b[0].registradoEm._seconds - a[0].registradoEm._seconds);

    for (const group of sortedVisits) {
        const firstItem = group[0];
        const submissionId = firstItem.submissionId;
        const dataRegistro = new Date(firstItem.registradoEm._seconds * 1000);
        
        // ==================================================================
        // ALTERAÇÃO APLICADA AQUI: Formatação da data para DD/MM/AAAA
        // ==================================================================
        const dataFormatada = dataRegistro.toLocaleDateString('pt-BR', {timeZone: 'UTC'});
        const dataParaEdicao = dataFormatada; // Usa o mesmo formato para o prompt

        const mainRow = document.createElement('tr');
        const acaoDeletarHtml = `<button class="btn-delete" onclick="deletarVisita('${submissionId}')">Deletar</button>`;
        const acaoEditarDataHtml = `<button class="btn-update" onclick="editarDataVisita('${submissionId}', '${dataParaEdicao}')">Editar Data</button>`;
        
        mainRow.innerHTML = `<td><button class="expand-btn" onclick="toggleDetails(this, 'details-${submissionId}')">+</button></td><td>${dataFormatada}</td><td>${firstItem.rua}</td><td>${firstItem.bairro}</td><td>${firstItem.registradoPor}</td><td class="actions">${acaoEditarDataHtml} ${acaoDeletarHtml}</td>`;
        tableBody.appendChild(mainRow);
        
        const detailsRow = document.createElement('tr');
        detailsRow.id = `details-${submissionId}`;
        detailsRow.className = 'details-row';

        let detailsHtml = '';
        group.sort((a,b) => a.identificadorBuraco.localeCompare(b.identificadorBuraco, undefined, {numeric: true}))
             .forEach(buraco => {
                const dim = buraco.dimensoes;
                const acaoEditarHtml = `<button class="btn-update" onclick="editarBuraco('${buraco.id}', '${dim.largura}', '${dim.comprimento}', '${dim.espessura}')">Editar</button>`;
                const acaoDeletarBuracoHtml = `<button class="btn-delete-item" onclick="deletarBuraco('${buraco.id}')">Deletar</button>`;
                
                detailsHtml += `<div class="pothole-detail"><span><strong>${buraco.identificadorBuraco}:</strong> C: ${dim.comprimento}m, L: ${dim.largura}m, E: ${dim.espessura}cm</span><div class="pothole-actions">${acaoEditarHtml} ${acaoDeletarBuracoHtml}</div></div>`;
        });
        
        const acaoAdicionarBuracoHtml = `<button class="btn-add" onclick="adicionarNovoBuraco('${submissionId}')">Adicionar Buraco</button>`;
        const acoesVisitaHtml = `<div class="visita-actions"><button class="btn-add-photo" onclick="document.getElementById('file-input-${submissionId}').click()">Adicionar Fotos</button><input type="file" multiple style="display:none;" id="file-input-${submissionId}" onchange="adicionarNovasFotos(this, '${submissionId}')"><div class="upload-status" id="status-${submissionId}"></div></div>`;
        
        let fotosHtml = '';
        const allPhotos = firstItem.fotos || [];
        
        if (allPhotos.length > 0) {
            fotosHtml = '<div class="photo-gallery">';
            allPhotos.forEach(foto => {
                if (foto && foto.id) {
                    const imageUrl = `/api/imagem/${foto.id}`;
                    fotosHtml += `<div class="thumbnail-container"><img data-src="${imageUrl}" alt="Miniatura" class="thumbnail-img lazy-load" onclick="openLightbox(event, '${foto.id}')"><button class="delete-photo-btn" onclick="deletePhoto(event, '${submissionId}', '${foto.id}')">×</button></div>`;
                }
            });
            fotosHtml += '</div>';
        } else {
            fotosHtml = 'Nenhuma foto.';
        }
        
        const observacaoHtml = `<p><strong>Observação:</strong> ${firstItem.observacao || 'Nenhuma.'}</p>`;
        detailsRow.innerHTML = `<td colspan="6"><div class="details-content"><div class="details-header"><h4>Detalhes dos Buracos</h4>${acaoAdicionarBuracoHtml}</div><div class="pothole-list">${detailsHtml}</div><hr><p><strong>Condição do Tempo:</strong> ${firstItem.condicaoTempo}</p>${observacaoHtml}<p><strong>Fotos:</strong></p>${fotosHtml}${acoesVisitaHtml}</div></td>`;
        tableBody.appendChild(detailsRow);
        
        updateIndividualStatus(submissionId);
    }
    setupLazyLoader();
}

// ==================================================================
// ALTERAÇÃO APLICADA AQUI: Função de editar data agora aceita e envia o formato DD/MM/AAAA.
// ==================================================================
async function editarDataVisita(submissionId, dataAtual) {
    const novaDataInput = prompt("Digite a nova data no formato DD/MM/AAAA:", dataAtual);
    
    if (novaDataInput === null) { // Usuário cancelou
        return;
    }

    const regexData = /^\d{2}\/\d{2}\/\d{4}$/;
    if (!regexData.test(novaDataInput)) {
        alert("Formato de data inválido. Por favor, use DD/MM/AAAA.");
        return;
    }

    // Converte DD/MM/AAAA para YYYY-MM-DD para o backend
    const partesData = novaDataInput.split('/');
    const dataParaAPI = `${partesData[2]}-${partesData[1]}-${partesData[0]}`;

    try {
        const res = await fetch(`/api/buracos/visita/data/${submissionId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ novaData: dataParaAPI })
        });

        const data = await res.json();
        alert(data.message || data.error);

        if (res.ok) {
            // Recarrega todos os dados para garantir a ordenação correta
            iniciarCarregamentoDeDados();
        }
    } catch (err) {
        console.error("Erro ao editar data da visita:", err);
        alert('Erro de conexão ao tentar editar a data.');
    }
}

async function gerarPDF(selectedDate) {
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = loadingOverlay.querySelector('p');
    loadingText.textContent = 'Buscando dados do relatório...';
    loadingOverlay.classList.add('active');

    try {
        const loggedInUser = localStorage.getItem('loggedInUser');
        if (!loggedInUser) throw new Error('Usuário não logado.');

        const response = await fetch(`/api/buracos/por-data?data=${selectedDate}&usuario=${loggedInUser}`);
        const result = await response.json();

        if (!response.ok) throw new Error(result.error || `Erro ${response.status} ao buscar dados.`);
        if (result.data.length === 0) {
            alert("Nenhum registro encontrado para a data especificada.");
            return;
        }

        loadingText.textContent = 'Gerando PDF...';
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        if (typeof doc.autoTable !== 'function') throw new Error("Plugin jsPDF-AutoTable não carregado.");
        
        const ruasDoDia = result.data.reduce((acc, item) => {
            (acc[item.rua] = acc[item.rua] || []).push(item);
            return acc;
        }, {});

        const dataFormatada = new Date(selectedDate).toLocaleDateString('pt-BR', { timeZone: 'UTC' });

        doc.setFontSize(18);
        doc.text("Relatório Diário", 105, 22, { align: 'center' });
        doc.setFontSize(12);
        doc.text(`Data do Relatório: ${dataFormatada}`, 105, 32, { align: 'center' });
        doc.text(`Gerado por: ${loggedInUser}`, 105, 38, { align: 'center' });

        let grandTotalM2 = 0, grandTotalM3 = 0, grandTotalToneladas = 0;
        let lastY = 45;

        const sortedRuaNomes = Object.keys(ruasDoDia).sort();

        for (const ruaNome of sortedRuaNomes) {
            const buracosDaRua = ruasDoDia[ruaNome];
            const primeiroRegistro = buracosDaRua[0];
            const cabecalhoDetalhes = [["Buraco", "C (m)", "L (m)", "M²", "M³", "Ton"]];
            const corpoDetalhes = [];
            let totalRuaM2 = 0, totalRuaM3 = 0, totalRuaToneladas = 0;

            buracosDaRua.sort((a,b) => a.identificadorBuraco.localeCompare(b.identificadorBuraco, undefined, {numeric: true}))
                .forEach(buraco => {
                const { dimensoes, identificadorBuraco } = buraco;
                const comprimento = parseFloat(String(dimensoes.comprimento).replace(',', '.'));
                const largura = parseFloat(String(dimensoes.largura).replace(',', '.'));

                if (isNaN(comprimento) || isNaN(largura)) return;

                const m2 = comprimento * largura;
                const m3 = m2 * 0.05;
                const toneladas = m3 * 2.4;

                totalRuaM2 += m2;
                totalRuaM3 += m3;
                totalRuaToneladas += toneladas;

                corpoDetalhes.push([
                    identificadorBuraco.replace('TAPA BURACO ', 'TB '),
                    comprimento.toFixed(2),
                    largura.toFixed(2),
                    m2.toFixed(3),
                    m3.toFixed(4),
                    toneladas.toFixed(4)
                ]);
            });
            
            corpoDetalhes.push([
                { content: 'Total da Rua', colSpan: 3, styles: { halign: 'right', fontStyle: 'bold' } },
                { content: totalRuaM2.toFixed(3), styles: { fontStyle: 'bold' } },
                { content: totalRuaM3.toFixed(4), styles: { fontStyle: 'bold' } },
                { content: totalRuaToneladas.toFixed(4), styles: { fontStyle: 'bold' } }
            ]);

            grandTotalM2 += totalRuaM2;
            grandTotalM3 += totalRuaM3;
            grandTotalToneladas += totalRuaToneladas;
            
            doc.autoTable({
                head: [[`Rua: ${primeiroRegistro.rua} - Bairro: ${primeiroRegistro.bairro}`]],
                headStyles: { fillColor: [100, 100, 100], textColor: 255 },
                startY: lastY,
            });

            doc.autoTable({
                head: cabecalhoDetalhes,
                body: corpoDetalhes,
                startY: doc.lastAutoTable.finalY,
                theme: 'grid',
                headStyles: { fillColor: [41, 128, 185], fontSize: 9 },
                bodyStyles: { fontSize: 8 },
            });
            
            lastY = doc.lastAutoTable.finalY + 10;
        }

        if (doc.internal.pageSize.height < lastY + 40) {
            doc.addPage();
            lastY = 20;
        }
        
        doc.autoTable({
            head: [['Resumo Geral do Dia']],
            headStyles: { fillColor: [39, 174, 96], fontSize: 14, textColor: 255 },
            startY: lastY,
        });
        
        const cabecalhoGeral = [["Total Geral M²", "Total Geral M³", "Total Geral Toneladas"]];
        const corpoGeral = [[
            grandTotalM2.toFixed(3),
            grandTotalM3.toFixed(4),
            grandTotalToneladas.toFixed(4)
        ]];

        doc.autoTable({
            head: cabecalhoGeral,
            body: corpoGeral,
            startY: doc.lastAutoTable.finalY,
            theme: 'grid',
            headStyles: { fillColor: [39, 174, 96], textColor: 255 },
            styles: { fontStyle: 'bold', fontSize: 12, halign: 'center' }
        });

        const nomeArquivo = `Relatorio_Consolidado_${selectedDate}.pdf`;
        doc.save(nomeArquivo);

    } catch (error) {
        console.error("Ocorreu um erro ao gerar o PDF:", error);
        alert(`Ocorreu um erro inesperado: ${error.message}`);
    } finally {
        loadingOverlay.classList.remove('active');
        loadingText.textContent = 'Enviando fotos...';
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
    const imageUrl = `/api/imagem/${fileId}`;
    lightboxImg.src = imageUrl;
    lightboxImg.onload = () => { spinner.style.display = 'none'; lightboxImg.style.display = 'block'; };
    lightboxImg.onerror = () => { spinner.style.display = 'none'; alert('Não foi possível carregar a imagem.'); closeLightbox(); };
}

function closeLightbox() {
    const lightbox = document.getElementById('lightbox-overlay');
    const lightboxImg = document.getElementById('lightbox-img');
    lightbox.style.display = 'none';
    lightboxImg.src = ''; 
}

async function deletePhoto(event, submissionId, fileId) {
    event.stopPropagation();
    if (!confirm("Tem certeza que deseja deletar esta foto?")) return;
    try {
        const response = await fetch(`/api/fotos/${submissionId}/${fileId}`, { method: 'DELETE' });
        const result = await response.json();
        alert(result.message || result.error);
        if (response.ok) iniciarCarregamentoDeDados();
    } catch (error) {
        alert("Erro de conexão ao tentar deletar a foto.");
    }
}

function toggleDetails(button, detailsId) {
    const detailsRow = document.getElementById(detailsId);
    if (detailsRow) {
        detailsRow.classList.toggle('show');
        button.textContent = detailsRow.classList.contains('show') ? '−' : '+';
    }
}

async function deletarVisita(submissionId) {
    if (!confirm('Tem certeza que deseja deletar TODA esta visita e seus registros?')) return;
    try {
        const res = await fetch(`/api/buracos/submission/${submissionId}`, { method: 'DELETE' });
        const data = await res.json();
        alert(data.message || data.error);
        if(res.ok) {
            todosOsRegistros = todosOsRegistros.filter(reg => reg.submissionId !== submissionId);
            renderizarTabela();
        }
    } catch(err) {
        alert('Erro de conexão ao tentar deletar a visita.');
    }
}

async function editarBuraco(docId, larguraAtual, comprimentoAtual, espessuraAtual) {
    const novoComprimento = prompt("Novo Comprimento (m):", comprimentoAtual);
    if (novoComprimento === null) return;
    const novaLargura = prompt("Nova Largura (m):", larguraAtual);
    if (novaLargura === null) return;
    const novaEspessura = prompt("Nova Espessura (cm):", espessuraAtual);
    if (novaEspessura === null) return;
    
    const novasDimensoes = { largura: novaLargura.trim().replace('.',','), comprimento: novoComprimento.trim().replace('.',','), espessura: novaEspessura.trim().replace('.',',') };
    
    try {
        const res = await fetch(`/api/buracos/dimensoes/${docId}`, {
            method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ dimensoes: novasDimensoes })
        });
        const data = await res.json();
        alert(data.message || data.error);
        if(res.ok) iniciarCarregamentoDeDados();
    } catch (err) {
        alert('Erro de conexão ao tentar editar.');
    }
}

async function deletarBuraco(docId) {
    if (!confirm('Tem certeza que deseja deletar este buraco?')) return;
    try {
        const res = await fetch(`/api/buracos/${docId}`, { method: 'DELETE' });
        const data = await res.json();
        alert(data.message || data.error);
        if (res.ok) iniciarCarregamentoDeDados();
    } catch(err) {
        alert('Erro de conexão ao tentar deletar o buraco.');
    }
}

async function adicionarNovoBuraco(submissionId) {
    const comprimento = prompt("Digite o COMPRIMENTO (m) do novo buraco:");
    if (comprimento === null) return;
    const largura = prompt("Digite a LARGURA (m) do novo buraco:");
    if (largura === null) return;
    const espessura = prompt("Digite a ESPESSURA (cm) do novo buraco:");
    if (espessura === null) return;

    if (!comprimento || !largura || !espessura) {
        alert("Todos os campos são obrigatórios.");
        return;
    }

    const novasDimensoes = {
        comprimento: comprimento.trim().replace(',', '.'),
        largura: largura.trim().replace(',', '.'),
        espessura: espessura.trim().replace(',', '.')
    };

    try {
        const res = await fetch(`/api/buracos/visita/${submissionId}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ dimensoes: novasDimensoes })
        });
        const data = await res.json();
        alert(data.message || data.error);
        if (res.ok) iniciarCarregamentoDeDados();
    } catch(err) {
        alert('Erro de conexão ao tentar adicionar o novo buraco.');
    }
}

async function adicionarNovasFotos(fileInput, submissionId) {
    if (fileInput.files.length === 0) return;
    const statusDiv = document.getElementById(`status-${submissionId}`);
    statusDiv.innerHTML = `<span class="status-pending">Preparando fotos...</span>`;

    try {
        for (const file of fileInput.files) {
            await db.photo_outbox.add({
                submissionId,
                file: file,
                filename: file.name
            });
        }
        
        updateIndividualStatus(submissionId);
        
        if ('serviceWorker' in navigator && 'SyncManager' in window) {
            const registration = await navigator.serviceWorker.ready;
            await registration.sync.register('sync-photos');
        } else {
            triggerForegroundSync();
        }
    } catch (error) {
        statusDiv.innerHTML = `<span class="status-error">Erro ao preparar fotos!</span>`;
    } finally {
        fileInput.value = '';
    }
}


async function triggerForegroundSync() {
    if (isSyncingForeground) return;
    const totalPending = await db.photo_outbox.count();
    if (totalPending > 0) sendPendingPhotosInForeground();
}

async function sendPendingPhotosInForeground() {
    if (isSyncingForeground) return;
    isSyncingForeground = true;

    let wakeLock = null;
    try {
        if ('wakeLock' in navigator) {
             try { wakeLock = await navigator.wakeLock.request('screen'); } catch(e) { console.error('Wake Lock failed:', e); }
        }

        const pendingPhotos = await db.photo_outbox.toArray();
        const uploadPromises = pendingPhotos.map(photo => {
            const formData = new FormData();
            const imageBlob = new Blob([photo.file], { type: photo.file.type });
            formData.append('foto', imageBlob, photo.filename);
            
            return fetch(`/api/buracos/fotos/${photo.submissionId}`, { method: 'PATCH', body: formData })
                .then(response => {
                    if (response.ok) {
                        return db.photo_outbox.delete(photo.id).then(() => {
                            updateIndividualStatus(photo.submissionId, true);
                            return { success: true };
                        });
                    }
                    return { success: false };
                })
                .catch(err => ({ success: false }));
        });

        await Promise.all(uploadPromises);
        iniciarCarregamentoDeDados();

    } catch (error) {
        alert("Houve uma falha inesperada ao enviar as fotos.");
    } finally {
        if (wakeLock) await wakeLock.release();
        isSyncingForeground = false;
        updateAllStatuses();
    }
}

function updateAllStatuses() {
    document.querySelectorAll('.upload-status').forEach(div => {
        const submissionId = div.id.replace('status-', '');
        if (submissionId) updateIndividualStatus(submissionId);
    });
}

async function updateIndividualStatus(submissionId, success = false) {
    const statusDiv = document.getElementById(`status-${submissionId}`);
    if (!statusDiv) return;
    const pendingCount = await db.photo_outbox.where('submissionId').equals(submissionId).count();
    
    if (pendingCount > 0) {
        statusDiv.innerHTML = `<span class="status-pending">Na fila: ${pendingCount} foto(s)</span>`;
    } else {
        if(success) {
            statusDiv.innerHTML = `<span class="status-success">Envios completos!</span>`;
            setTimeout(() => { if (statusDiv) statusDiv.innerHTML = ''; }, 5000);
        } else {
             statusDiv.innerHTML = '';
        }
    }
}
