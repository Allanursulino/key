const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const axios = require('axios'); 
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// ==================================================================
// 1. CONEXÃO COM BANCO DE DADOS (MONGODB)
// ==================================================================
const connectDB = async () => {
    try {
        if (!process.env.MONGO_URI) {
            console.error("❌ ERRO FATAL: Variável MONGO_URI não configurada no Render!");
            return;
        }
        await mongoose.connect(process.env.MONGO_URI, {
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
        });
        console.log("✅ MongoDB: CONECTADO COM SUCESSO!");
    } catch (err) {
        console.error("❌ MongoDB Erro:", err.message);
    }
};

mongoose.connection.on('connected', () => console.log('Mongoose online'));
mongoose.connection.on('error', (err) => console.error('Mongoose erro:', err));
connectDB();

// MODELOS
const KeySchema = new mongoose.Schema({
    key: { type: String, required: true, unique: true },
    hwids: { type: [String], default: [] },
    maxHwids: { type: Number, default: 1 },
    createdAt: { type: Number, default: Date.now },
    expiresAt: { type: Number, required: true }
});
const KeyModel = mongoose.model('Key', KeySchema);

const BanSchema = new mongoose.Schema({
    hwid: { type: String, required: true, unique: true },
    reason: String,
    bannedAt: { type: Number, default: Date.now }
});
const BanModel = mongoose.model('Ban', BanSchema);

// ==================================================================
// 2. CONFIGURAÇÕES GERAIS
// ==================================================================
const CONFIG = {
    ADMIN_SECRET: process.env.ADMIN_SECRET, 
    BASE_URL: process.env.BASE_URL, 
    WORKINK_API_KEY: process.env.WORKINK_API_KEY, 
    DISCORD_WEBHOOK: process.env.DISCORD_WEBHOOK,
    LINKVERTISE_ID: process.env.LINKVERTISE_ID,
    MIN_SECONDS: 10
};

let sessions = {}; 

app.get('/', (req, res) => res.send("✅ API MultiHub v35.0 (Discord Queue System Anti-RateLimit)"));

// ==================================================================
// 3. SISTEMA DE LOGS (DISCORD COM FILA)
// ==================================================================

// Fila na memória
const discordQueue = [];
let isProcessingQueue = false;

// Processador da Fila
const processDiscordQueue = async () => {
    if (isProcessingQueue || discordQueue.length === 0) return;
    isProcessingQueue = true;

    while (discordQueue.length > 0) {
        const embedData = discordQueue[0]; // Pega o primeiro item
        
        try {
            if (!CONFIG.DISCORD_WEBHOOK) {
                discordQueue.shift(); // Remove se não tiver config
                continue;
            }

            await axios.post(CONFIG.DISCORD_WEBHOOK, { embeds: [embedData] });
            console.log("✅ Webhook enviado (Queue Size: " + (discordQueue.length - 1) + ")");
            
            discordQueue.shift(); // Sucesso: Remove da fila
            
            // DELAY OBRIGATÓRIO DE 2 SEGUNDOS ENTRE ENVIOS
            await new Promise(resolve => setTimeout(resolve, 2000));

        } catch (e) {
            const status = e.response ? e.response.status : 0;
            
            if (status === 429) {
                // Discord mandou parar (Rate Limit)
                const retryAfter = e.response.data.retry_after ? (e.response.data.retry_after * 1000) : 10000;
                console.warn(`⚠️ Discord Rate Limit! Pausando fila por ${retryAfter}ms...`);
                // Espera o tempo que o Discord pediu + 1 segundo de segurança
                await new Promise(resolve => setTimeout(resolve, retryAfter + 1000));
                // NÃO remove da fila, tenta de novo na próxima volta do while
            } else {
                console.error(`❌ Erro Webhook (${status}):`, e.message);
                discordQueue.shift(); // Erro fatal, remove para não travar a fila
            }
        }
    }

    isProcessingQueue = false;
};

app.post('/log-discord', (req, res) => {
    const { username, accountAge, hwid, gameId, key } = req.body;

    if (!username || !key) return res.status(400).json({ error: "Dados incompletos" });
    
    // Monta o Embed
    const embed = {
        title: "🚨 Key Resgatada com Sucesso",
        color: 3066993, // Verde
        fields: [
            { name: "👤 Usuário", value: `${username}`, inline: true },
            { name: "⏳ Idade da Conta", value: `${accountAge} dias`, inline: true },
            { name: "🎮 Place ID", value: `${gameId}`, inline: true },
            { name: "🔑 Key Utilizada", value: `\`${key}\``, inline: false },
            { name: "💻 HWID", value: `\`${hwid}\``, inline: false }
        ],
        footer: { text: "MultiHub Security System" },
        timestamp: new Date().toISOString()
    };

    // Adiciona na fila em vez de enviar direto
    discordQueue.push(embed);
    
    // Aciona o processador (se já não estiver rodando)
    processDiscordQueue();

    // Responde sucesso imediato para o Roblox não ficar esperando
    res.json({ success: true, message: "Log enfileirado" });
});

// ==================================================================
// 4. PAINEL ADMIN (API)
// ==================================================================
app.post('/admin/list-keys', async (req, res) => {
    if (req.body.adminSecret !== CONFIG.ADMIN_SECRET) return res.status(403).json({ error: "Senha incorreta" });
    try {
        const keys = await KeyModel.find().sort({ createdAt: -1 });
        const list = keys.map(k => ({
            key: k.key, 
            hwids: k.hwids || [], 
            maxHwids: k.maxHwids, 
            expires: new Date(k.expiresAt).toLocaleString(), 
            isExpired: Date.now() > k.expiresAt
        }));
        const bans = await BanModel.find();
        const bannedList = bans.map(b => b.hwid);
        res.json({ keys: list, bannedHWIDs: bannedList });
    } catch (e) { res.status(500).json({ error: "Erro DB" }); }
});

app.post('/admin/generate', async (req, res) => {
    const { hours, adminSecret, maxHwids } = req.body;
    if (adminSecret !== CONFIG.ADMIN_SECRET) return res.status(403).json({ error: "Senha incorreta" });
    const keyString = `MULTI-ADMIN-${hours > 800000 ? 'LIFE' : hours + 'H'}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    try {
        await KeyModel.create({ key: keyString, expiresAt: Date.now() + (hours * 3600000), maxHwids: maxHwids || 1, hwids: [] });
        res.json({ success: true, key: keyString });
    } catch (e) { res.status(500).json({ error: "Erro DB" }); }
});

app.post('/admin/reset-hwid', async (req, res) => {
    const { adminSecret, key } = req.body;
    if (adminSecret !== CONFIG.ADMIN_SECRET) return res.status(403).json({ error: "Acesso negado" });
    await KeyModel.findOneAndUpdate({ key: key }, { hwids: [] });
    res.json({ success: true });
});

app.post('/admin/remove-single-hwid', async (req, res) => {
    const { adminSecret, key, hwidToRemove } = req.body;
    if (adminSecret !== CONFIG.ADMIN_SECRET) return res.status(403).json({ error: "Acesso negado" });
    await KeyModel.findOneAndUpdate({ key: key }, { $pull: { hwids: hwidToRemove } });
    res.json({ success: true });
});

app.post('/admin/ban-hwid', async (req, res) => {
    const { adminSecret, hwid } = req.body;
    if (adminSecret !== CONFIG.ADMIN_SECRET) return res.status(403).json({ error: "Acesso negado" });
    try { await BanModel.create({ hwid: hwid }); await KeyModel.updateMany({}, { $pull: { hwids: hwid } }); res.json({ success: true }); } 
    catch (e) { res.json({ success: true, message: "Já banido" }); }
});

app.post('/admin/delete-key', async (req, res) => {
    const { adminSecret, key } = req.body;
    if (adminSecret !== CONFIG.ADMIN_SECRET) return res.status(403).json({ error: "Acesso negado" });
    await KeyModel.deleteOne({ key: key });
    res.json({ success: true });
});

// ==================================================================
// 5. PROCESSO CHECKPOINT
// ==================================================================
app.post('/process-step', async (req, res) => {
    try {
        const { session_id, security_token, received_secret, provider, hours, target_checks } = req.body;
        
        if (!session_id || !sessions[session_id]) {
            const newID = crypto.randomBytes(16).toString('hex');
            const firstToken = crypto.randomBytes(8).toString('hex');
            const validProvider = (provider === 'linkvertise') ? 'linkvertise' : 'workink';

            sessions[newID] = {
                provider: validProvider, hours: hours || 24, target_checks: target_checks || 3,
                current_step: 0, last_check_time: Date.now(), expected_token: firstToken, dynamic_secret: null
            };
            
            const linkResult = await generateLink(sessions[newID], newID);
            if (!linkResult.success) return res.json({ status: "error", message: linkResult.error });
            return res.json({ session_id: newID, security_token: firstToken, status: "progress", step: 1, total: sessions[newID].target_checks, url: linkResult.url });
        }

        let currentSession = sessions[session_id];
        if (security_token !== currentSession.expected_token) return res.json({ status: "error", message: "Sessão inválida." });

        if (!received_secret || received_secret !== currentSession.dynamic_secret) return res.json({ status: "denied", message: "Link inválido!" });
        
        const timeDiff = Date.now() - currentSession.last_check_time;
        if (timeDiff < (CONFIG.MIN_SECONDS * 1000)) return res.json({ status: "wait", message: `Aguarde...` });

        currentSession.current_step++;
        currentSession.last_check_time = Date.now();
        currentSession.dynamic_secret = null;
        
        const nextToken = crypto.randomBytes(8).toString('hex');
        currentSession.expected_token = nextToken;

        if (currentSession.current_step >= currentSession.target_checks) {
            const prefix = currentSession.provider === 'workink' ? 'WK' : 'LV';
            const key = `MULTI-${prefix}-${currentSession.hours}H-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
            try {
                await KeyModel.create({ key: key, expiresAt: Date.now() + (currentSession.hours * 3600000), maxHwids: 1, hwids: [] });
                delete sessions[session_id];
                return res.json({ status: "completed", key: key });
            } catch(e) { return res.json({ status: "error", message: "Erro ao salvar key" }); }
        }

        const linkResult = await generateLink(currentSession, session_id);
        if (!linkResult.success) return res.json({ status: "error", message: linkResult.error });
        return res.json({ session_id: session_id, security_token: nextToken, status: "progress", step: currentSession.current_step + 1, total: currentSession.target_checks, url: linkResult.url });
        
    } catch (err) { return res.status(500).json({ status: "error", message: "Erro interno." }); }
});

// ==================================================================
// 6. VALIDAR KEY
// ==================================================================
app.get('/verify', async (req, res) => {
    const { key, hwid } = req.query;
    if(!key) return res.json({ valid: false, message: "Key Inválida" });

    try {
        const isBanned = await BanModel.findOne({ hwid: hwid });
        if (isBanned) return res.json({ valid: false, message: "HWID BANIDO" });

        const keyData = await KeyModel.findOne({ key: key });
        if (!keyData) return res.json({ valid: false, message: "Key Inexistente" });

        if (Date.now() > keyData.expiresAt) return res.json({ valid: false, message: "Key Expirada" });

        if (keyData.hwids.includes(hwid)) return res.json({ valid: true, message: "Sucesso" });

        if (keyData.hwids.length < keyData.maxHwids) {
            keyData.hwids.push(hwid);
            await keyData.save();
            
            // LOG DE NOVO LOGIN COM QUEUE (Mesma função do log-discord, mas interno se precisar)
            // Aqui mantemos simples na resposta do verify
            
            return res.json({ valid: true, message: "Sucesso (Novo Device)" });
        } else {
            return res.json({ valid: false, message: "Limite de HWIDs" });
        }
    } catch (e) { return res.json({ valid: false, message: "Erro DB" }); }
});

// ==================================================================
// 7. LINKS
// ==================================================================
async function generateLink(session, id) {
    try {
        if (session.provider === 'workink') {
            const secret = crypto.randomBytes(12).toString('hex');
            session.dynamic_secret = secret; 
            const destination = `${CONFIG.BASE_URL}/?secret=${secret}`;
            if (!CONFIG.WORKINK_API_KEY) return { success: false, error: "API Key Work.ink Off" };
            
            try {
                const response = await axios.post("https://dashboard.work.ink/_api/v1/link", {
                    title: `Check ${session.current_step + 1} - ${Date.now()}`,
                    destination: destination
                }, { headers: { "X-Api-Key": CONFIG.WORKINK_API_KEY, "Content-Type": "application/json" } });
                let finalUrl = response.data.response?.url || response.data.url;
                if (finalUrl) return { success: true, url: finalUrl };
                else return { success: false, error: "Work.ink falhou" };
            } catch (err) { return { success: false, error: "Work.ink API Error" }; }
        }
        else if (session.provider === 'linkvertise') {
            if (!CONFIG.LINKVERTISE_ID) return { success: false, error: "Linkvertise ID Off" };
            const secret = crypto.randomBytes(12).toString('hex');
            session.dynamic_secret = secret; 
            const destination = `${CONFIG.BASE_URL}/?secret=${secret}`;
            const base64Dest = Buffer.from(destination).toString('base64');
            const randomPath = Math.random().toString(36).substring(7);
            return { success: true, url: `https://link-to.net/${CONFIG.LINKVERTISE_ID}/${randomPath}/dynamic?r=${base64Dest}` };
        }
    } catch (e) { return { success: false, error: e.message }; }
}

app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));