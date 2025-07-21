// src/google-services.js
const { google } = require("googleapis");
const fs = require("fs");
const path = require("path");
const config = require("./config");

let authClient = null;

async function getAuthClient() {
    if (authClient) return authClient;
    try {
        let credentials;
        if (process.env.GOOGLE_TOKEN_JSON) {
            credentials = JSON.parse(process.env.GOOGLE_TOKEN_JSON);
        } else {
            const tokenContent = fs.readFileSync('token.json');
            credentials = JSON.parse(tokenContent);
        }
        const { client_secret, client_id, refresh_token } = credentials;
        const oAuth2Client = new google.auth.OAuth2(client_id, client_secret);
        oAuth2Client.setCredentials({ refresh_token: refresh_token });
        authClient = oAuth2Client;
        return authClient;
    } catch (error) {
        console.error("Falha na autenticação com o Google.", error);
        throw new Error("Falha na autenticação com o Google Drive.");
    }
}

async function getDriveClient() {
    const auth = await getAuthClient();
    return google.drive({ version: "v3", auth });
}

async function getOrCreateFolder(name, parentId) {
    const drive = await getDriveClient();
    if (!parentId) throw new Error("ID da pasta pai não fornecido.");
    const sanitizedName = name.trim().replace(/[\\/?%*:|"<>]/g, "_");
    const res = await drive.files.list({
        q: `'${parentId}' in parents and name='${sanitizedName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: "files(id, name)",
    });
    if (res.data.files.length > 0) return res.data.files[0].id;
    const fileMetadata = { name: sanitizedName, mimeType: "application/vnd.google-apps.folder", parents: [parentId] };
    const file = await drive.files.create({ resource: fileMetadata, fields: "id" });
    return file.data.id;
}

async function uploadWithRetry(drive, fileMetadata, media, retries = 4, delay = 1500) {
    for (let i = 0; i < retries; i++) {
        try {
            const uploadedFile = await drive.files.create({
                resource: fileMetadata,
                media,
                fields: "id, webViewLink, thumbnailLink, name"
            });
            return uploadedFile;
        } catch (error) {
            if (i === retries - 1) {
                console.error(`Última tentativa de upload (${i + 1}/${retries}) falhou. Desistindo.`, error.message);
                throw error;
            }
            console.warn(`Tentativa de upload ${i + 1} falhou. Tentando novamente em ${delay}ms...`, error.message);
            await new Promise(resolve => setTimeout(resolve, delay));
            delay *= 2;
        }
    }
}

async function uploadFiles(files, rua, dataHoje, username = 'desconhecido') {
    const drive = await getDriveClient();
    if (!files || files.length === 0) return [];
    if (!config.FOLDER_ID) throw new Error("Configuração FOLDER_ID ausente no servidor.");
    
    const uploadedFileDetails = [];
    const nomesArquivosSalvosNaPasta = new Set();
    
    // ==================================================================
    // ALTERAÇÃO APLICADA AQUI
    // A pasta da rua agora é criada diretamente dentro da pasta principal (FOLDER_ID).
    const pastaRuaId = await getOrCreateFolder(rua, config.FOLDER_ID);
    // ==================================================================

    const nomePastaData = dataHoje.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }).replace(/\//g, ".");
    const pastaDataId = await getOrCreateFolder(nomePastaData, pastaRuaId);

    for (const file of files) {
        let nomeArquivoFinal = file.originalname.replace(/[^\w\s\.\-]/gi, "_");
        let contador = 1;
        while (nomesArquivosSalvosNaPasta.has(nomeArquivoFinal)) {
            const nomeBase = path.parse(file.originalname).name;
            const extensao = path.parse(file.originalname).ext;
            nomeArquivoFinal = `${nomeBase}_${contador++}${extensao}`;
        }
        const fileMetadata = { name: nomeArquivoFinal, parents: [pastaDataId] };
        const media = { mimeType: file.mimetype, body: fs.createReadStream(file.path) };
        
        const uploadedFile = await uploadWithRetry(drive, fileMetadata, media);
        
        uploadedFileDetails.push({
            id: uploadedFile.data.id,
            webViewLink: uploadedFile.data.webViewLink,
            thumbnailLink: uploadedFile.data.thumbnailLink,
        });

        nomesArquivosSalvosNaPasta.add(uploadedFile.data.name);
    }
    
    if (uploadedFileDetails.length > 0) {
        console.log(`${username}: ${uploadedFileDetails.length} fotos salvas com sucesso.`);
    }

    return uploadedFileDetails;
}

// --- SEÇÃO DE LEITURA DE DADOS (LOCAL) ---
let cacheRuas = null;
let cacheBairros = null;

async function getRuasComCache() {
    if (cacheRuas) return cacheRuas;
    try {
        const filePath = path.join(__dirname, '..', 'data', 'Ruas.tsv');
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const lines = fileContent.split('\n');
        const header = lines[0].split('\t').map(h => h.trim());
        const idxRua = header.indexOf("Rua");
        const idxMunicipio = header.indexOf("Municipio");
        if (idxRua === -1 || idxMunicipio === -1) return [];
        
        const ruasFiltradas = lines.slice(1).map(line => {
            const columns = line.split('\t');
            if (columns[idxMunicipio]?.trim() === config.MUNICIPIO_FILTRO_DADOS_RUAS) {
                return columns[idxRua]?.trim() || null;
            }
            return null;
        }).filter(rua => rua);

        cacheRuas = [...new Set(ruasFiltradas)];
        return cacheRuas;
    } catch (error) {
        console.error("Erro ao ler ou processar o arquivo Ruas.tsv:", error);
        return [];
    }
}

async function getBairrosComCache() {
    if (cacheBairros) return cacheBairros;
    try {
        const filePath = path.join(__dirname, '..', 'data', 'Bairros.tsv');
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const lines = fileContent.split('\n');
        const header = lines[0].split('\t').map(h => h.trim());
        const idxBairro = header.indexOf("Bairro");
        if (idxBairro === -1) return [];
        const todosBairros = lines.slice(1).map(line => line.split('\t')[idxBairro]?.trim() || null).filter(bairro => bairro);
        cacheBairros = [...new Set(todosBairros)].sort();
        return cacheBairros;
    } catch (error) {
        console.error("Erro ao ler ou processar o arquivo Bairros.tsv:", error);
        return [];
    }
}

module.exports = {
  getDriveClient,
  uploadFiles,
  getRuasComCache,
  getBairrosComCache,
};
