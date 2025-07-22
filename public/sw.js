// sw.js

importScripts('/js/dexie.js');

// Versão incrementada para v22 para implementar mudanças em geral.
const APP_CACHE_NAME = 'tapa-buracos-Tres-Rios-cache-v22';
const PHOTO_CACHE_NAME = 'tapa-buracos-photo-cache-v2';

const URLS_TO_CACHE = [
  '/',
  '/index.html',
  '/login.html',
  '/relatorio.html',
  '/efetivo.html',
  '/css/main.css',
  '/css/index.css',
  '/css/relatorio.css',
  '/css/efetivo.css',
  '/js/auth.js',
  '/js/index.js',
  '/js/relatorio.js',
  '/js/efetivo.js',
  '/images/logo.png',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
  '/js/dexie.js'
];

const db = new Dexie("photo-outbox-db");
db.version(3).stores({
  photo_outbox: '++id, submissionId, filename'
});

self.addEventListener('install', event => {
    console.log('Service Worker: Instalando nova versão (v21)...');
    event.waitUntil(
        caches.open(APP_CACHE_NAME)
        .then(cache => {
            console.log('Service Worker: Pré-cache de arquivos do app.');
            return cache.addAll(URLS_TO_CACHE);
        })
        .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', event => {
    console.log('Service Worker: Ativando nova versão...');
    event.waitUntil(
        caches.keys().then(cacheNames => {
        return Promise.all(
            cacheNames.map(cache => {
            if (cache !== APP_CACHE_NAME && cache !== PHOTO_CACHE_NAME) {
                console.log('Service Worker: Deletando cache antigo:', cache);
                return caches.delete(cache);
            }
            })
        );
        }).then(() => self.clients.claim())
    );
});

// ### LÓGICA DE FETCH ROBUSTA REIMPLEMENTADA ###
self.addEventListener('fetch', event => {
    const { request } = event;

    // Ignora requisições que não são GET (POST, PATCH, etc.) para não interferir com a API.
    if (request.method !== 'GET') {
        return;
    }
    
    // Ignora requisições da API para garantir que os dados sejam sempre buscados da rede.
    if (request.url.includes('/api/')) {
        return;
    }

    // Estratégia "Stale-While-Revalidate" para o App Shell (HTML, CSS, JS).
    event.respondWith(
        caches.open(APP_CACHE_NAME).then(cache => {
            return cache.match(request).then(response => {
                // Retorna a resposta do cache imediatamente se existir.
                const fetchPromise = fetch(request).then(networkResponse => {
                    // Atualiza o cache com a nova versão em segundo plano.
                    cache.put(request, networkResponse.clone());
                    return networkResponse;
                });
                // Retorna a versão do cache (rápido) ou espera a rede se não houver cache.
                return response || fetchPromise;
            });
        })
    );
});


self.addEventListener('sync', event => {
    if (event.tag === 'sync-photos') {
        console.log('Service Worker: Evento de sincronia de background recebido.');
        event.waitUntil(sendPendingPhotos());
    }
});


/**
 * Envia as fotos pendentes do IndexedDB.
 * A lógica aqui permanece a mesma, pois já é robusta.
 */
async function sendPendingPhotos() {
    const pendingPhotos = await db.photo_outbox.toArray();
    if (pendingPhotos.length === 0) {
        console.log('Service Worker: Fila de envio de fotos vazia.');
        return;
    }

    console.log(`Service Worker: Iniciando envio de ${pendingPhotos.length} foto(s) pendente(s).`);
    let hasFailures = false;

    for (const photo of pendingPhotos) {
        try {
            const formData = new FormData();
            const imageBlob = new Blob([photo.file], { type: photo.file.type });
            formData.append('foto', imageBlob, photo.filename);
            
            const response = await fetch(`/api/buracos/fotos/${photo.submissionId}`, {
                method: 'PATCH',
                body: formData,
            });

            if (response.ok) {
                await db.photo_outbox.delete(photo.id);
                console.log(`Service Worker: Foto ${photo.filename} (ID: ${photo.id}) enviada com sucesso.`);
                await notifyClients(photo.submissionId, true);
            } else {
                hasFailures = true;
                console.error(`Falha no envio da foto ${photo.filename}. Status: ${response.status}`);
                if (response.status === 404) {
                   console.warn(`A visita com submissionId ${photo.submissionId} não foi encontrada no servidor.`);
                }
                await notifyClients(photo.submissionId, false, `Erro ${response.status}`);
            }
        } catch (error) {
            hasFailures = true;
            console.error(`Falha de rede ao tentar enviar a foto ${photo.filename}.`, error);
            await notifyClients(photo.submissionId, false, 'Falha de rede');
        }
    }

    if (hasFailures) {
        console.log('Houve falhas no envio de uma ou mais fotos. Uma nova sincronização será agendada.');
        throw new Error('Alguns envios de fotos falharam e serão tentados novamente.');
    }

    console.log('Service Worker: Todas as fotos pendentes na fila foram processadas com sucesso.');
}

async function notifyClients(submissionId, success = false, error = null) {
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    clients.forEach(client => {
        client.postMessage({ 
            type: 'UPLOAD_STATUS_UPDATE', 
            submissionId: submissionId, 
            success: success,
            error: error
        });
    });
}
