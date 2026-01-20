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

// --- CONEXÃO MONGODB ROBUSTA ---
const connectDB = async () => {
    try {
        if (!process.env.MONGO_URI) {
            console.error("❌ ERRO FATAL: MONGO_URI não está nas variáveis do Render!");
            return;
        }

        // Opções para evitar timeout silencioso
        await mongoose.connect(process.env.MONGO_URI, {
            serverSelectionTimeoutMS: 5000, // Desiste após 5s se não achar servidor
            socketTimeoutMS: 45000,
        });
        
        console.log("✅ MongoDB: CONECTADO COM SUCESSO!");
        
    } catch (err) {
        console.error("❌ MongoDB: ERRO DE CONEXÃO:");
        console.error(err.message); // Mostra o motivo exato (senha errada, IP bloqueado, etc)
    }
};

// Listeners para monitorar a conexão em tempo real
mongoose.connection.on('connected', () => console.log('Mongoose conectado ao DB'));
mongoose.connection.on('error', (err) => console.error('Mongoose erro:', err));
mongoose.connection.on('disconnected', () => console.warn('Mongoose desconectado'));

connectDB();

// --- MODELOS ---
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

// --- CONFIGURAÇÃO ---
const CONFIG = {
    ADMIN_SECRET: process.env.ADMIN_SECRET, 
    BASE_URL: process.env.BASE_URL, 
    WORKINK_API_KEY: process.env.WORKINK_API_KEY, 
    DISCORD_WEBHOOK: process.env.DISCORD_WEBHOOK,
    LINKVERTISE_ID: process.env.LINKVERTISE_ID,
    MIN_SECONDS: 10
};

// --- LINKS DO LOOTLABS ---
const LOOTLABS_LINKS = [
    "https://loot-link.com/s?jiG288HG", 
    "https://lootdest.org/s?FhMcLnzN",
    "https://loot-link.com/s?bdOhltpA",
    "https://lootdest.org/s?RU9Ge3Nt",
    "https://loot-link.com/s?IaoMNEEr"
];

let sessions = {}; 

app.get('/', (req, res) => res.send("✅ API MultiHub v31.0 (MongoDB Connection Fix)"));

// --- LOG DISCORD ---
app.post('/log-discord', async (req, res) => {
    const { username, accountAge, hwid, gameId, key } = req.body;
    if (!username || !key) return res.status(400).send("Dados incompletos");
    if (!CONFIG.DISCORD_WEBHOOK) return res.status(500).send("Webhook off");

    const embed = {
        title: "🚨 Key Resgatada",
        color: 15158332,
        fields: [
            { name: "👤 User", value: username, inline: true },
            { name: "🔑 Key", value: `\`${key}\``, inline: false },
            { name: "💻 HWID", value: `\`${hwid}\``, inline: false }
        ]
    };
    try { await axios.post(CONFIG.DISCORD_WEBHOOK, { embeds: [embed] }); res.json({ success: true }); } 
    catch (e) { res.status(500).json({ error: "Erro Discord" }); }
});

// --- ADMIN API (DB) ---
app.post('/admin/list-keys', async (req, res) => {
    if (req.body.adminSecret !== CONFIG.ADMIN_SECRET) return res.status(403).json({ error: "Senha errada" });
    try {
        const keys = await KeyModel.find().sort({ createdAt: -1 });
        const list = keys.map(k => ({
            key: k.key, hwids: k.hwids || [], maxHwids: k.maxHwids, expires: new Date(k.expiresAt).toLocaleString(), isExpired: Date.now() > k.expiresAt
        }));
        // Busca bans
        const bans = await BanModel.find();
        const bannedList = bans.map(b => b.hwid);
        res.json({ keys: list, bannedHWIDs: bannedList });
    } catch (e) { res.status(500).json({ error: "Erro DB: " + e.message }); }
});

app.post('/admin/generate', async (req, res) => {
    const { hours, adminSecret, maxHwids } = req.body;
    if (adminSecret !== CONFIG.ADMIN_SECRET) return res.status(403).json({ error: "Senha errada" });
    
    const keyString = `MULTI-ADMIN-${hours > 800000 ? 'LIFE' : hours + 'H'}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    try {
        await KeyModel.create({
            key: keyString,
            expiresAt: Date.now() + (hours * 3600000),
            maxHwids: maxHwids || 1,
            hwids: []
        });
        res.json({ success: true, key: keyString });
    } catch (e) { res.status(500).json({ error: "Erro ao salvar Key" }); }
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
    try {
        await BanModel.create({ hwid: hwid });
        await KeyModel.updateMany({}, { $pull: { hwids: hwid } });
        res.json({ success: true });
    } catch (e) { res.json({ success: true, message: "Já banido" }); }
});

app.post('/admin/delete-key', async (req, res) => {
    const { adminSecret, key } = req.body;
    if (adminSecret !== CONFIG.ADMIN_SECRET) return res.status(403).json({ error: "Acesso negado" });
    await KeyModel.deleteOne({ key: key });
    res.json({ success: true });
});

// --- PROCESSO USUÁRIO ---

app.get('/webhook/lootlabs', (req, res) => {
    const session_id = req.query.custom || req.query.subid || req.query.s1;
    if (session_id && sessions[session_id]) {
        sessions[session_id].verified_by_webhook = true;
        res.status(200).send("OK");
    } else { res.status(400).send("ID Inválido"); }
});

app.post('/process-step', async (req, res) => {
    try {
        const { session_id, security_token, received_secret, provider, hours, target_checks } = req.body;
        
        if (!session_id || !sessions[session_id]) {
            const newID = crypto.randomBytes(16).toString('hex');
            const firstToken = crypto.randomBytes(8).toString('hex');
            const selectedProvider = (provider === 'workink' || provider === 'linkvertise') ? provider : 'lootlabs';

            sessions[newID] = {
                provider: selectedProvider, hours: hours || 24, target_checks: target_checks || 3,
                current_step: 0, last_check_time: Date.now(), expected_token: firstToken,
                verified_by_webhook: false, dynamic_secret: null
            };
            
            const linkResult = await generateLink(sessions[newID], newID);
            if (!linkResult.success) return res.json({ status: "error", message: linkResult.error });
            return res.json({ session_id: newID, security_token: firstToken, status: "progress", step: 1, total: sessions[newID].target_checks, url: linkResult.url });
        }

        let currentSession = sessions[session_id];
        if (security_token !== currentSession.expected_token) return res.json({ status: "error", message: "Sessão expirada." });

        if (currentSession.provider === 'lootlabs') {
            if (currentSession.verified_by_webhook !== true) {
                const timeDiff = Date.now() - currentSession.last_check_time;
                if (timeDiff < 5000) return res.json({ status: "wait", message: "Aguardando confirmação..." });
                return res.json({ status: "denied", message: "Ainda não confirmado." });
            }
        } else {
            if (!received_secret || received_secret !== currentSession.dynamic_secret) return res.json({ status: "denied", message: "Link inválido!" });
            const timeDiff = Date.now() - currentSession.last_check_time;
            if (timeDiff < (CONFIG.MIN_SECONDS * 1000)) return res.json({ status: "wait", message: `Aguarde...` });
        }

        currentSession.current_step++;
        currentSession.last_check_time = Date.now();
        currentSession.verified_by_webhook = false;
        currentSession.dynamic_secret = null;
        
        const nextToken = crypto.randomBytes(8).toString('hex');
        currentSession.expected_token = nextToken;

        if (currentSession.current_step >= currentSession.target_checks) {
            const prefix = currentSession.provider === 'workink' ? 'WK' : (currentSession.provider === 'linkvertise' ? 'LV' : 'LL');
            const key = `MULTI-${prefix}-${currentSession.hours}H-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
            
            // SALVA NO BANCO
            try {
                await KeyModel.create({
                    key: key,
                    expiresAt: Date.now() + (currentSession.hours * 3600000),
                    maxHwids: 1,
                    hwids: []
                });
                delete sessions[session_id];
                return res.json({ status: "completed", key: key });
            } catch(e) {
                return res.json({ status: "error", message: "Erro ao salvar key no DB" });
            }
        }

        const linkResult = await generateLink(currentSession, session_id);
        if (!linkResult.success) return res.json({ status: "error", message: linkResult.error });
        return res.json({ session_id: session_id, security_token: nextToken, status: "progress", step: currentSession.current_step + 1, total: currentSession.target_checks, url: linkResult.url });
        
    } catch (err) { console.error("Erro CRÍTICO:", err); return res.status(500).json({ status: "error", message: "Erro interno." }); }
});

// --- VERIFY (DB) ---
app.get('/verify', async (req, res) => {
    const { key, hwid } = req.query;
    if(!key) return res.json({ valid: false, message: "Key Inválida" });

    try {
        const isBanned = await BanModel.findOne({ hwid: hwid });
        if (isBanned) return res.json({ valid: false, message: "HWID Banido" });

        const keyData = await KeyModel.findOne({ key: key });
        if (!keyData) return res.json({ valid: false, message: "Key Inexistente" });

        if (Date.now() > keyData.expiresAt) return res.json({ valid: false, message: "Key Expirada" });

        if (keyData.hwids.includes(hwid)) return res.json({ valid: true, message: "Sucesso" });

        if (keyData.hwids.length < keyData.maxHwids) {
            keyData.hwids.push(hwid);
            await keyData.save();
            return res.json({ valid: true, message: "Sucesso (Novo)" });
        } else {
            return res.json({ valid: false, message: "Limite HWID Atingido" });
        }
    } catch (e) {
        console.error(e);
        return res.json({ valid: false, message: "Erro DB" });
    }
});

// --- GERADOR LINKS ---
async function generateLink(session, id) {
    try {
        if (session.provider === 'lootlabs') {
            const index = session.current_step;
            let baseLink = LOOTLABS_LINKS[index] || LOOTLABS_LINKS[LOOTLABS_LINKS.length - 1];
            baseLink = baseLink.trim();
            try {
                const urlObj = new URL(baseLink);
                const params = new URLSearchParams(urlObj.search);
                const keys = Array.from(params.keys());
                if (keys.length === 1 && params.get(keys[0]) === '' && keys[0] !== 'k') {
                    const code = keys[0]; urlObj.search = `?k=${code}&custom=${id}`; return { success: true, url: urlObj.toString() };
                }
                if (!urlObj.searchParams.has('custom')) urlObj.searchParams.append('custom', id);
                return { success: true, url: urlObj.toString() };
            } catch(e) {
                const sep = baseLink.includes('?') ? '&' : '?';
                return { success: true, url: `${baseLink}${sep}custom=${id}` };
            }
        } 
        else if (session.provider === 'workink') {
            const secret = crypto.randomBytes(12).toString('hex');
            session.dynamic_secret = secret; 
            const destination = `${CONFIG.BASE_URL}/?secret=${secret}`;
            
            if (!CONFIG.WORKINK_API_KEY) return { success: false, error: "API Key Work.ink Off" };

            const response = await axios.post("https://dashboard.work.ink/_api/v1/link", {
                title: `MultiHub Check ${session.current_step + 1} - ${Date.now()}`,
                destination: destination
            }, { headers: { "X-Api-Key": CONFIG.WORKINK_API_KEY, "Content-Type": "application/json" } });

            let finalUrl = response.data.response?.url || response.data.url;
            if (finalUrl) return { success: true, url: finalUrl };
            else return { success: false, error: "Work.ink falhou" };
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