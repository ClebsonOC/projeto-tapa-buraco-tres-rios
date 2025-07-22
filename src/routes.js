const express = require("express");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const { v4: uuidv4 } = require("uuid");
const config = require("./config");
const utils = require("./utils");
const { getDriveClient, uploadFiles, getRuasComCache, getBairrosComCache } = require("./google-services");
const { firestore, admin } = require("./firebase-init");

const router = express.Router();

const upload = multer({ dest: "uploads/" });

const NodeCache = require("node-cache");
const appCache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

// Rota de login (sem alterações)
router.post("/login", (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Usuário e senha são obrigatórios." });
    const lowercasedUsername = username.toLowerCase().trim();
    const user = config.USERS_DATABASE[lowercasedUsername];
    if (user && user.password === password) {
        res.json({ message: "Login bem-sucedido!", username: lowercasedUsername, role: user.role || 'user' });
    } else {
        res.status(401).json({ error: "Usuário ou senha inválidos." });
    }
});

// Middleware de admin (sem alterações)
const isAdmin = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('User ')) return res.status(401).json({ error: "Acesso não autorizado." });
    const username = authHeader.split(' ')[1];
    if (!username) return res.status(401).json({ error: "Acesso não autorizado." });
    const user = config.USERS_DATABASE[username];
    if (user && user.role === 'admin') {
        next();
    } else {
        res.status(403).json({ error: "Acesso proibido." });
    }
};

// Rotas de admin (sem alterações)
router.get("/admin/usuarios", isAdmin, async (req, res) => {
    const cacheKey = "admin_user_list";
    const cachedUsers = appCache.get(cacheKey);
    if (cachedUsers) return res.status(200).json(cachedUsers);
    try {
        const buracosSnapshot = await firestore.collection('buracos').select('registradoPor').get();
        const efetivoSnapshot = await firestore.collection('efetivo').select('registradoPor').get();
        const usuarios = new Set();
        buracosSnapshot.forEach(doc => usuarios.add(doc.data().registradoPor));
        efetivoSnapshot.forEach(doc => usuarios.add(doc.data().registradoPor));
        const sortedUsers = [...usuarios].sort();
        appCache.set(cacheKey, sortedUsers);
        res.status(200).json(sortedUsers);
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar lista de usuários." });
    }
});

router.get("/admin/dados", isAdmin, async (req, res) => {
    try {
        const { usuario, lastVisibleTimestamp, dataInicio, dataFim } = req.query;
        const limit = 7;

        let buracosQuery = firestore.collection('buracos');
        let efetivoQuery = firestore.collection('efetivo');

        if (usuario) {
            buracosQuery = buracosQuery.where('registradoPor', '==', usuario);
            efetivoQuery = efetivoQuery.where('registradoPor', '==', usuario);
        }

        if (dataInicio) {
            const inicioDate = new Date(dataInicio);
            buracosQuery = buracosQuery.where('registradoEm', '>=', inicioDate);
            efetivoQuery = efetivoQuery.where('registradoEm', '>=', inicioDate);
        }
        if (dataFim) {
            const fimDate = new Date(dataFim);
            fimDate.setUTCHours(23, 59, 59, 999);
            buracosQuery = buracosQuery.where('registradoEm', '<=', fimDate);
            efetivoQuery = efetivoQuery.where('registradoEm', '<=', fimDate);
        }

        buracosQuery = buracosQuery.orderBy('registradoEm', 'desc');
        efetivoQuery = efetivoQuery.orderBy('registradoEm', 'desc');

        if (lastVisibleTimestamp) {
            const lastDate = new Date(parseInt(lastVisibleTimestamp));
            buracosQuery = buracosQuery.startAfter(lastDate);
            efetivoQuery = efetivoQuery.startAfter(lastDate);
        }

        const fetchLimit = limit + 10;
        buracosQuery = buracosQuery.limit(fetchLimit);
        efetivoQuery = efetivoQuery.limit(fetchLimit);

        const [buracosSnapshot, efetivoSnapshot] = await Promise.all([
            buracosQuery.get(),
            efetivoQuery.get()
        ]);

        const buracosList = buracosSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), type: 'buraco' }));
        const efetivoList = efetivoSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data(), type: 'efetivo' }));
        const combinedList = [...buracosList, ...efetivoList];
        combinedList.sort((a, b) => b.registradoEm.toMillis() - a.registradoEm.toMillis());

        const finalResults = [];
        const processedSubmissions = new Set();
        for (const item of combinedList) {
            if (finalResults.length >= limit) break;
            if (item.type === 'efetivo') {
                finalResults.push({ ...item, tipo: 'efetivo', data: item.registradoEm._seconds });
            } else if (item.type === 'buraco' && !processedSubmissions.has(item.submissionId)) {
                const allBuracosForSubmission = combinedList.filter(b => b.submissionId === item.submissionId);
                const firstItem = allBuracosForSubmission[0];
                finalResults.push({
                    id: firstItem.submissionId,
                    tipo: 'buraco',
                    data: firstItem.registradoEm._seconds,
                    registradoPor: firstItem.registradoPor,
                    rua: firstItem.rua,
                    bairro: firstItem.bairro,
                    observacao: firstItem.observacao,
                    condicaoTempo: firstItem.condicaoTempo,
                    fotos: firstItem.fotos || [],
                    buracos: allBuracosForSubmission.map(b => ({ identificador: b.identificadorBuraco, dimensoes: b.dimensoes }))
                });
                processedSubmissions.add(item.submissionId);
            }
        }

        const newLastVisibleTimestamp = finalResults.length === limit ? combinedList[limit -1].registradoEm.toMillis() : null;
        
        res.status(200).json({
            data: finalResults,
            lastVisibleTimestamp: newLastVisibleTimestamp
        });
    } catch (error) {
        console.error("Erro ao buscar dados de admin:", error);
        res.status(500).json({ error: "Não foi possível buscar os dados." });
    }
});


// Rota de upload de fotos (sem alterações)
router.patch("/buracos/fotos/:submissionId", upload.single("foto"), async (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "Nenhuma foto foi enviada." });
    }

    const originalPath = req.file.path;
    const compressedPath = path.join('uploads', `compressed-${req.file.filename}.jpg`);

    try {
        const { submissionId } = req.params;
        const initialCheck = await firestore.collection('buracos').where('submissionId', '==', submissionId).limit(1).get();
        if (initialCheck.empty) {
            fs.unlinkSync(originalPath);
            return res.status(404).json({ error: "Visita não encontrada. A foto não pode ser salva." });
        }

        await sharp(originalPath)
            .resize({ width: 2560, height: 2560, fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80, progressive: true })
            .toFile(compressedPath);

        const primeiroDocData = initialCheck.docs[0].data();
        const username = primeiroDocData.registradoPor || 'desconhecido';

        const compressedFile = {
            ...req.file,
            path: compressedPath,
            mimetype: 'image/jpeg',
            originalname: `${path.parse(req.file.originalname).name}.jpg`
        };

        const [novaFotoInfo] = await uploadFiles([compressedFile], primeiroDocData.rua, primeiroDocData.registradoEm.toDate(), username);

        if (!novaFotoInfo) {
            return res.status(500).json({ error: "Falha ao fazer upload da foto para o Drive." });
        }

        await firestore.runTransaction(async (transaction) => {
            const visitaDocsQuery = firestore.collection('buracos').where('submissionId', '==', submissionId);
            const visitaDocsSnapshot = await transaction.get(visitaDocsQuery);
            if (visitaDocsSnapshot.empty) {
                throw new Error("A visita foi deletada durante o upload da foto.");
            }
            visitaDocsSnapshot.docs.forEach(doc => {
                transaction.update(doc.ref, { fotos: admin.firestore.FieldValue.arrayUnion(novaFotoInfo) });
            });
        });

        res.status(200).json({ message: "Foto adicionada com sucesso!" });
    } catch (error) {
        console.error("Erro no endpoint de upload de fotos:", error);
        if (error.message.includes("A visita foi deletada")) {
            return res.status(404).json({ error: error.message });
        }
        res.status(500).json({ error: "Erro interno ao processar ou adicionar a nova foto." });
    } finally {
        fs.unlink(originalPath, (err) => {
            if (err) console.error("Erro ao deletar arquivo original temporário:", originalPath, err);
        });
        fs.unlink(compressedPath, (err) => {
            if (err && err.code !== 'ENOENT') console.error("Erro ao deletar arquivo compactado temporário:", compressedPath, err);
        });
    }
});

// Rotas de busca (sem alterações)
router.get("/buscar-ruas", async (req, res) => {
    try {
        const textoParcial = req.query.texto || "";
        if (textoParcial.trim().length < 2) return res.json([]);
        const todasRuas = await getRuasComCache();
        const textoBusca = utils.removerAcentos(textoParcial).toLowerCase().trim();
        const ruasEncontradas = todasRuas.filter(rua => utils.removerAcentos(rua).toLowerCase().includes(textoBusca)).slice(0, config.MAX_SUGESTOES_RUAS);
        res.json(ruasEncontradas);
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar ruas." });
    }
});

router.get("/buscar-bairros", async (req, res) => {
    try {
        res.json(await getBairrosComCache());
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar bairros." });
    }
});

// Rota para salvar registros de buracos (sem alterações)
router.post("/salvar", async (req, res) => {
    try {
        const { rua, bairro, buracos, condicaoTempo, observacao, username, dataLancamento } = req.body;
        if (!username || !rua || !bairro || !buracos || buracos.length === 0) return res.status(400).json({ error: "Dados obrigatórios ausentes." });
        const dataDoRegistro = dataLancamento ? new Date(dataLancamento + 'T12:00:00') : new Date();
        const submissionId = uuidv4();
        const batch = firestore.batch();
        for (const b of buracos) {
            const dadosParaFirestore = {
                submissionId,
                identificadorBuraco: b.identificador,
                rua: rua.toUpperCase().trim(),
                bairro: bairro.toUpperCase().trim(),
                dimensoes: { largura: String(b.largura).replace(".", ","), comprimento: String(b.comprimento).replace(".", ","), espessura: String(b.espessura).replace(".", ",") },
                condicaoTempo: (condicaoTempo || "NÃO INFORMADO").toUpperCase(),
                observacao: observacao || "",
                fotos: [],
                registradoPor: username,
                registradoEm: dataDoRegistro,
            };
            const novoBuracoRef = firestore.collection("buracos").doc();
            batch.set(novoBuracoRef, dadosParaFirestore);
        }
        await batch.commit();
        res.json({ message: `${buracos.length} registro(s) salvo(s) com sucesso.` });
    } catch (error) {
        console.error("Erro ao salvar registro de buraco:", error);
        res.status(500).json({ error: "Erro interno ao salvar." });
    }
});

// ==================================================================
// CORREÇÃO APLICADA AQUI: Rota de busca de buracos foi revertida para remover
// os filtros de data que estavam causando o problema.
// ==================================================================
router.get("/buracos", async (req, res) => {
    try {
        const { usuario, lastVisibleTimestamp } = req.query;
        const limit = 7;

        let query = firestore.collection('buracos');
        if (usuario) query = query.where('registradoPor', '==', usuario);
        
        query = query.orderBy('registradoEm', 'desc');

        if (lastVisibleTimestamp) {
            const lastDate = new Date(parseInt(lastVisibleTimestamp));
            query = query.startAfter(lastDate);
        }

        const snapshot = await query.limit(limit * 5).get(); // Fetch more to group by submission
        
        const visits = new Map();
        snapshot.docs.forEach(doc => {
            const data = { id: doc.id, ...doc.data() };
            const { submissionId } = data;
            if (!visits.has(submissionId)) {
                visits.set(submissionId, []);
            }
            visits.get(submissionId).push(data);
        });

        const paginatedVisits = Array.from(visits.values()).slice(0, limit);
        const buracosList = [].concat(...paginatedVisits);

        let newLastVisibleTimestamp = null;
        if (visits.size > limit) {
            const lastVisit = paginatedVisits[paginatedVisits.length - 1];
            const lastItemOfLastVisit = lastVisit.sort((a,b) => b.registradoEm.toMillis() - a.registradoEm.toMillis())[0];
            newLastVisibleTimestamp = lastItemOfLastVisit.registradoEm.toMillis();
        }

        res.status(200).json({
            data: buracosList,
            lastVisibleTimestamp: newLastVisibleTimestamp
        });

    } catch (error) {
        console.error("Erro ao buscar registros de buracos:", error);
        res.status(500).json({ error: "Não foi possível buscar os registros." });
    }
});

// ==================================================================
// NOVA ROTA: Adicionada rota para permitir a alteração da data de uma visita inteira.
// ==================================================================
router.patch("/buracos/visita/data/:submissionId", async (req, res) => {
    try {
        const { submissionId } = req.params;
        const { novaData } = req.body;

        if (!submissionId || !novaData) {
            return res.status(400).json({ error: "ID da submissão e nova data são obrigatórios." });
        }

        const dataParaSalvar = new Date(novaData + 'T12:00:00'); // Evita problemas de fuso

        const visitaQuery = firestore.collection('buracos').where('submissionId', '==', submissionId);
        
        await firestore.runTransaction(async (transaction) => {
            const visitaSnapshot = await transaction.get(visitaQuery);
            if (visitaSnapshot.empty) {
                throw new Error("Visita não encontrada.");
            }
            visitaSnapshot.docs.forEach(doc => {
                transaction.update(doc.ref, { registradoEm: dataParaSalvar });
            });
        });

        res.status(200).json({ message: "Data da visita atualizada com sucesso!" });
    } catch (error) {
        console.error("Erro ao atualizar data da visita:", error);
        if (error.message.includes("Visita não encontrada")) {
            return res.status(404).json({ error: error.message });
        }
        res.status(500).json({ error: "Não foi possível atualizar a data da visita." });
    }
});


// Rota para adicionar buraco a uma visita (sem alterações)
router.post("/buracos/visita/:submissionId", async (req, res) => {
    try {
        const { submissionId } = req.params;
        const { dimensoes } = req.body;
        if (!submissionId || !dimensoes || !dimensoes.comprimento || !dimensoes.largura || !dimensoes.espessura) {
            return res.status(400).json({ error: "Dados obrigatórios ausentes." });
        }
        const visitaSnapshot = await firestore.collection('buracos').where('submissionId', '==', submissionId).limit(1).get();
        if (visitaSnapshot.empty) {
            return res.status(404).json({ error: "Visita original não encontrada." });
        }
        const dadosVisita = visitaSnapshot.docs[0].data();
        const todosBuracosSnapshot = await firestore.collection('buracos').where('submissionId', '==', submissionId).get();
        let maxId = 0;
        todosBuracosSnapshot.forEach(doc => {
            const identificador = doc.data().identificadorBuraco || "";
            const match = identificador.match(/\d+/);
            if (match) {
                const idNum = parseInt(match[0], 10);
                if (idNum > maxId) maxId = idNum;
            }
        });
        const novoIdentificador = `TAPA BURACO ${maxId + 1}`;
        const novoBuraco = { ...dadosVisita, identificadorBuraco: novoIdentificador, dimensoes: { largura: String(dimensoes.largura).replace(".", ","), comprimento: String(dimensoes.comprimento).replace(".", ","), espessura: String(dimensoes.espessura).replace(".", ",") }, registradoEm: new Date() };
        delete novoBuraco.id;
        const novoBuracoRef = firestore.collection("buracos").doc();
        await novoBuracoRef.set(novoBuraco);
        res.status(201).json({ message: `Novo buraco adicionado à visita.`, novoId: novoBuracoRef.id });
    } catch (error) {
        res.status(500).json({ error: "Erro interno ao adicionar novo buraco." });
    }
});

// Rota para deletar buraco individual (sem restrições)
router.delete("/buracos/:docId", async (req, res) => {
    const { docId } = req.params;
    if (!docId) return res.status(400).json({ error: "ID do documento é obrigatório." });
    const buracoRef = firestore.collection('buracos').doc(docId);
    try {
        await firestore.runTransaction(async (transaction) => {
            const doc = await transaction.get(buracoRef);
            if (!doc.exists) throw new Error("Registro não encontrado.");
            
            const submissionId = doc.data().submissionId;
            const visitaQuery = firestore.collection('buracos').where('submissionId', '==', submissionId);
            const visitaSnapshot = await transaction.get(visitaQuery);
            
            transaction.delete(buracoRef);
            
            const remainingDocsRefs = visitaSnapshot.docs.filter(d => d.id !== docId);
            if (remainingDocsRefs.length > 0) {
                const remainingDocsSorted = remainingDocsRefs.map(d => ({ id: d.id, ...d.data() })).sort((a, b) => {
                    const numA = parseInt((a.identificadorBuraco || "").match(/\d+/)?.[0] || 0, 10);
                    const numB = parseInt((b.identificadorBuraco || "").match(/\d+/)?.[0] || 0, 10);
                    return numA - numB;
                });
                remainingDocsSorted.forEach((buraco, index) => {
                    const novoIdentificador = `TAPA BURACO ${index + 1}`;
                    if (buraco.identificadorBuraco !== novoIdentificador) {
                        const docToUpdateRef = firestore.collection('buracos').doc(buraco.id);
                        transaction.update(docToUpdateRef, { identificadorBuraco: novoIdentificador });
                    }
                });
            }
        });
        res.status(200).json({ message: `Registro deletado e sequência atualizada.` });
    } catch (error) {
        if (error.message.includes("Registro não encontrado")) return res.status(404).json({ error: error.message });
        res.status(500).json({ error: "Não foi possível deletar o registro." });
    }
});

// Rota para editar dimensões (sem restrições)
router.patch("/buracos/dimensoes/:docId", async (req, res) => {
    try {
        const { docId } = req.params;
        const { dimensoes } = req.body;
        if (!docId || !dimensoes) return res.status(400).json({ error: "ID do documento e dimensões são obrigatórios." });
        const buracoRef = firestore.collection('buracos').doc(docId);
        const doc = await buracoRef.get();
        if (!doc.exists) return res.status(404).json({ error: "Registro não encontrado." });
        await buracoRef.update({ dimensoes });
        res.status(200).json({ message: `Dimensões do registro ${docId} atualizadas.` });
    } catch (error) {
        res.status(500).json({ error: "Não foi possível atualizar as dimensões." });
    }
});

// Rota para deletar visita completa (sem restrições)
router.delete("/buracos/submission/:submissionId", async (req, res) => {
    try {
        const { submissionId } = req.params;
        if (!submissionId) return res.status(400).json({ error: "ID da submissão é obrigatório." });
        const snapshot = await firestore.collection('buracos').where('submissionId', '==', submissionId).limit(1).get();
        if (snapshot.empty) return res.status(404).json({ error: "Visita não encontrada." });
        const todosDocsDaVisita = await firestore.collection('buracos').where('submissionId', '==', submissionId).get();
        const batch = firestore.batch();
        todosDocsDaVisita.docs.forEach(doc => batch.delete(doc.ref));
        await batch.commit();
        res.status(200).json({ message: `Visita ${submissionId} e todos os seus registros foram deletados.` });
    } catch (error) {
        res.status(500).json({ error: "Não foi possível deletar a visita." });
    }
});

// Rota para deletar fotos (sem alterações)
router.delete("/fotos/:submissionId/:fileId", async (req, res) => {
    try {
        const { submissionId, fileId } = req.params;
        if (!submissionId || !fileId) return res.status(400).json({ error: "IDs são obrigatórios." });
        const drive = await getDriveClient();
        try {
            await drive.files.delete({ fileId });
        } catch (err) {
            if (err.code !== 404) throw err;
        }
        const visitaSnapshot = await firestore.collection('buracos').where('submissionId', '==', submissionId).get();
        if (visitaSnapshot.empty) return res.status(200).json({ message: "Referência da foto deletada." });
        const batch = firestore.batch();
        visitaSnapshot.docs.forEach(doc => {
            const fotosAtuais = doc.data().fotos || [];
            const objetoParaRemover = fotosAtuais.find(foto => foto.id === fileId);
            if (objetoParaRemover) batch.update(doc.ref, { fotos: admin.firestore.FieldValue.arrayRemove(objetoParaRemover) });
        });
        await batch.commit();
        res.status(200).json({ message: "Foto deletada com sucesso." });
    } catch (error) {
        res.status(500).json({ error: "Não foi possível deletar a foto." });
    }
});

// Rotas de efetivo (sem alterações)
router.post("/efetivo", async (req, res) => {
    try {
        const { registradoPor, itensPresentes, observacao, dataLancamento } = req.body;
        if (!registradoPor || !itensPresentes) return res.status(400).json({ error: "Usuário e lista de presentes são obrigatórios." });

        const targetDate = dataLancamento ? new Date(dataLancamento + 'T12:00:00') : new Date();

        const inicioDoDia = new Date(targetDate);
        inicioDoDia.setHours(0, 0, 0, 0);
        const fimDoDia = new Date(targetDate);
        fimDoDia.setHours(23, 59, 59, 999);

        const snapshot = await firestore.collection('efetivo')
            .where('registradoPor', '==', registradoPor)
            .where('registradoEm', '>=', inicioDoDia)
            .where('registradoEm', '<=', fimDoDia)
            .limit(1)
            .get();

        if (!snapshot.empty) {
            const docId = snapshot.docs[0].id;
            await firestore.collection('efetivo').doc(docId).update({
                itensPresentes,
                observacao: observacao || ""
            });
            res.status(200).json({ message: "Efetivo para esta data foi atualizado com sucesso!" });
        } else {
            const novoEfetivo = { 
                registradoPor, 
                registradoEm: targetDate, 
                itensPresentes, 
                observacao: observacao || "" 
            };
            await firestore.collection('efetivo').add(novoEfetivo);
            res.status(201).json({ message: "Efetivo salvo com sucesso!" });
        }
    } catch (error) {
        console.error("Erro ao salvar efetivo:", error);
        res.status(500).json({ error: "Erro interno no servidor ao salvar o efetivo." });
    }
});

router.get("/efetivo", async (req, res) => {
    try {
        const { usuario } = req.query;
        if (!usuario) return res.status(400).json({ error: "Nome de usuário é obrigatório." });
        const snapshot = await firestore.collection('efetivo').where('registradoPor', '==', usuario).orderBy('registradoEm', 'desc').get();
        const historico = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(historico);
    } catch (error) {
        res.status(500).json({ error: "Erro ao buscar histórico de efetivo." });
    }
});

router.patch("/efetivo/:id", async (req, res) => {
    try {
        const { id } = req.params;
        const { itensPresentes, observacao } = req.body;
        const docRef = firestore.collection('efetivo').doc(id);
        const doc = await docRef.get();
        if (!doc.exists) return res.status(404).json({ error: "Registro não encontrado." });
        await docRef.update({ itensPresentes, observacao });
        res.status(200).json({ message: "Efetivo atualizado com sucesso!" });
    } catch (error) {
        console.error("Erro ao atualizar efetivo:", error);
        res.status(500).json({ error: "Erro ao atualizar o efetivo." });
    }
});

// Rotas de imagem e busca por data (sem alterações)
router.get("/imagem/:fileId", async (req, res) => {
    try {
        const { fileId } = req.params;
        if (!fileId) return res.status(400).send("ID do arquivo é obrigatório.");
        const drive = await getDriveClient();
        const fileResponse = await drive.files.get({ fileId: fileId, alt: 'media' }, { responseType: 'stream' });
        res.setHeader('Content-Type', fileResponse.headers['content-type']);
        fileResponse.data.pipe(res);
    } catch (error) {
        if (error.code === 404) return res.status(404).send("Imagem não encontrada.");
        res.status(500).send("Erro ao carregar a imagem.");
    }
});
router.get("/buracos/por-data", async (req, res) => {
    try {
        const { data, usuario } = req.query;

        if (!data || !usuario) {
            return res.status(400).json({ error: "Data e nome de usuário são obrigatórios." });
        }

        const startDate = new Date(`${data}T00:00:00.000-03:00`);
        const endDate = new Date(`${data}T23:59:59.999-03:00`);

        const buracosQuery = firestore.collection('buracos')
            .where('registradoPor', '==', usuario)
            .where('registradoEm', '>=', startDate)
            .where('registradoEm', '<=', endDate);

        const snapshot = await buracosQuery.get();

        if (snapshot.empty) {
            return res.status(200).json({ message: "Nenhum registro encontrado para esta data.", data: [] });
        }

        const buracosDoDia = snapshot.docs.map(doc => {
            const docData = doc.data();
            return {
                ...docData,
                registradoEm: {
                    _seconds: docData.registradoEm.seconds,
                    _nanoseconds: docData.registradoEm.nanoseconds
                }
            };
        });

        res.status(200).json({ data: buracosDoDia });

    } catch (error) {
        console.error("Erro ao buscar registros por data:", error);
        res.status(500).json({ error: "Erro interno ao buscar dados para o relatório." });
    }
});

module.exports = router;
