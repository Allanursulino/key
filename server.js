const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const axios = require('axios'); 

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/', (req, res) => res.send("✅ API MultiHub v22.0 (Linkvertise Debug Fix)"));

// --- CONFIGURAÇÃO ---
const CONFIG = {
    ADMIN_SECRET: process.env.ADMIN_SECRET, 
    BASE_URL: process.env.BASE_URL, 
    WORKINK_API_KEY: process.env.WORKINK_API_KEY, 
    DISCORD_WEBHOOK: process.env.DISCORD_WEBHOOK,
    LINKVERTISE_ID: process.env.LINKVERTISE_ID,
    MIN_SECONDS: 10
};

// Log de inicialização
console.log("--- STATUS CONFIGURAÇÃO ---");
console.log(`Work.ink: ${CONFIG.WORKINK_API_KEY ? "OK" : "FALTANDO"}`);
console.log(`Linkvertise ID: ${CONFIG.LINKVERTISE_ID ? CONFIG.LINKVERTISE_ID : "FALTANDO"}`);

const LOOTLABS_LINKS = [
    "https://loot-link.com/s?jiG288HG", 
    "https://lootdest.org/s?FhMcLnzN",
    "https://loot-link.com/s?bdOhltpA",
    "https://lootdest.org/s?RU9Ge3Nt",
    "https://loot-link.com/s?IaoMNEEr"
];

let sessions = {}; 
let validKeys = {};
let blacklistedHWIDs = []; 

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

// --- ADMIN ---
app.post('/admin/list-keys', (req, res) => {
    if (req.body.adminSecret !== CONFIG.ADMIN_SECRET) return res.status(403).json({ error: "Senha errada" });
    const list = Object.entries(validKeys).map(([k, v]) => ({
        key: k, hwids: v.hwids || [], maxHwids: v.maxHwids || 1, expires: new Date(v.expiresAt).toLocaleString(), isExpired: Date.now() > v.expiresAt
    }));
    res.json({ keys: list });
});

app.post('/admin/generate', (req, res) => {
    const { hours, adminSecret, maxHwids } = req.body;
    if (adminSecret !== CONFIG.ADMIN_SECRET) return res.status(403).json({ error: "Senha errada" });
    const key = `MULTI-ADMIN-${hours > 800000 ? 'LIFE' : hours + 'H'}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    saveKey(key, hours, maxHwids || 1);
    res.json({ success: true, key: key });
});

// --- WEBHOOKS ---
app.get('/webhook/lootlabs', (req, res) => {
    const session_id = req.query.custom || req.query.subid || req.query.s1;
    if (session_id && sessions[session_id]) {
        sessions[session_id].verified_by_webhook = true;
        res.status(200).send("OK");
    } else { 
        res.status(400).send("ID Inválido"); 
    }
});

// --- PROCESSO PRINCIPAL ---
app.post('/process-step', async (req, res) => {
    try {
        const { session_id, security_token, received_secret, provider, hours, target_checks } = req.body;
        
        // 1. INICIAR SESSÃO
        if (!session_id || !sessions[session_id]) {
            const newID = crypto.randomBytes(16).toString('hex');
            const firstToken = crypto.randomBytes(8).toString('hex');
            
            // Garante que o provedor é válido
            const selectedProvider = (provider === 'workink' || provider === 'linkvertise') ? provider : 'lootlabs';

            sessions[newID] = {
                provider: selectedProvider, hours: hours || 24, target_checks: target_checks || 3,
                current_step: 0, last_check_time: Date.now(), expected_token: firstToken,
                verified_by_webhook: false, dynamic_secret: null
            };
            
            const linkResult = await generateLink(sessions[newID], newID);
            
            if (!linkResult.success) {
                // Retorna erro detalhado para o frontend
                return res.json({ status: "error", message: linkResult.error });
            }

            return res.json({ session_id: newID, security_token: firstToken, status: "progress", step: 1, total: sessions[newID].target_checks, url: linkResult.url });
        }

        let currentSession = sessions[session_id];
        if (security_token !== currentSession.expected_token) return res.json({ status: "error", message: "Sessão expirada." });

        // 2. VALIDAÇÃO
        if (currentSession.provider === 'lootlabs') {
            if (currentSession.verified_by_webhook !== true) {
                const timeDiff = Date.now() - currentSession.last_check_time;
                if (timeDiff < 5000) return res.json({ status: "wait", message: "Aguardando LootLabs..." });
                return res.json({ status: "denied", message: "Ainda não confirmado pelo LootLabs." });
            }
        } else {
            // Linkvertise / Work.ink (Secret)
            if (!received_secret || received_secret !== currentSession.dynamic_secret) {
                return res.json({ status: "denied", message: "Link inválido! Segredo incorreto." });
            }
            const timeDiff = Date.now() - currentSession.last_check_time;
            if (timeDiff < (CONFIG.MIN_SECONDS * 1000)) return res.json({ status: "wait", message: `Aguarde...` });
        }

        // 3. AVANÇAR
        currentSession.current_step++;
        currentSession.last_check_time = Date.now();
        currentSession.verified_by_webhook = false;
        currentSession.dynamic_secret = null;
        
        const nextToken = crypto.randomBytes(8).toString('hex');
        currentSession.expected_token = nextToken;

        if (currentSession.current_step >= currentSession.target_checks) {
            const prefix = currentSession.provider === 'workink' ? 'WK' : (currentSession.provider === 'linkvertise' ? 'LV' : 'LL');
            const key = `MULTI-${prefix}-${currentSession.hours}H-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
            saveKey(key, currentSession.hours, 1);
            delete sessions[session_id];
            return res.json({ status: "completed", key: key });
        }

        const linkResult = await generateLink(currentSession, session_id);
        if (!linkResult.success) return res.json({ status: "error", message: "Erro ao gerar próximo link: " + linkResult.error });

        return res.json({ session_id: session_id, security_token: nextToken, status: "progress", step: currentSession.current_step + 1, total: currentSession.target_checks, url: linkResult.url });
        
    } catch (err) {
        console.error("Erro CRÍTICO:", err);
        return res.status(500).json({ status: "error", message: "Erro interno no servidor." });
    }
});

app.get('/verify', (req, res) => {
    const { key, hwid } = req.query;
    if(!key || !validKeys[key]) return res.json({ valid: false, message: "Inválida" });
    if (blacklistedHWIDs.includes(hwid)) return res.json({ valid: false, message: "Banido" });
    
    const data = validKeys[key];
    if(Date.now() > data.expiresAt) { delete validKeys[key]; return res.json({ valid: false, message: "Expirada" }); }
    
    if (data.hwids.includes(hwid)) return res.json({ valid: true, message: "Sucesso" });
    if (data.hwids.length < data.maxHwids) {
        data.hwids.push(hwid);
        return res.json({ valid: true, message: "Sucesso (Novo)" });
    } else {
        return res.json({ valid: false, message: "Limite HWID Atingido" });
    }
});

// --- GERADOR DE LINKS ---
async function generateLink(session, id) {
    try {
        // --- 1. LINKVERTISE ---
        if (session.provider === 'linkvertise') {
            if (!CONFIG.LINKVERTISE_ID) {
                console.error("ERRO: LINKVERTISE_ID não configurado no Render!");
                return { success: false, error: "Linkvertise ID não configurado no servidor." };
            }

            const secret = crypto.randomBytes(12).toString('hex');
            session.dynamic_secret = secret; 
            
            // Link de destino (seu site + segredo)
            const destination = `${CONFIG.BASE_URL}/?secret=${secret}`;
            
            // Codificação Base64 para o Linkvertise
            const base64Dest = Buffer.from(destination).toString('base64');
            
            // Estrutura dinâmica oficial: https://link-to.net/[USER-ID]/[RANDOM]/dynamic/?r=[BASE64-URL]
            const randomPath = Math.random().toString(36).substring(7);
            const link = `https://link-to.net/${CONFIG.LINKVERTISE_ID}/${randomPath}/dynamic/?r=${base64Dest}`;
            
            console.log(`[LINKVERTISE] Link Gerado: ${link}`);
            return { success: true, url: link };
        }
        
        // --- 2. WORK.INK ---
        else if (session.provider === 'workink') {
            const secret = crypto.randomBytes(12).toString('hex');
            session.dynamic_secret = secret; 
            const destination = `${CONFIG.BASE_URL}/?secret=${secret}`;
            
            if (!CONFIG.WORKINK_API_KEY) return { success: false, error: "Work.ink API Key não configurada" };

            try {
                const response = await axios.post("https://dashboard.work.ink/_api/v1/link", {
                    title: `Check ${session.current_step + 1} - ${Date.now()}`,
                    destination: destination
                }, { headers: { "X-Api-Key": CONFIG.WORKINK_API_KEY, "Content-Type": "application/json" } });

                let finalUrl = response.data.response?.url || response.data.url;
                if (finalUrl) return { success: true, url: finalUrl };
                else return { success: false, error: "Work.ink falhou (sem URL)" };
            } catch (e) {
                return { success: false, error: "Work.ink API Error" };
            }
        }
        
        // --- 3. LOOTLABS ---
        else if (session.provider === 'lootlabs') {
            const index = session.current_step;
            let baseLink = LOOTLABS_LINKS[index] || LOOTLABS_LINKS[LOOTLABS_LINKS.length - 1];
            baseLink = baseLink.trim();
            const sep = baseLink.includes('?') ? '&' : '?';
            return { success: true, url: `${baseLink}${sep}custom=${id}` };
        }
    } catch (e) {
        console.error("Erro interno generateLink:", e);
        return { success: false, error: "Erro interno: " + e.message };
    }
}

function saveKey(key, hours, maxHwids) {
    validKeys[key] = { createdAt: Date.now(), expiresAt: Date.now() + (hours*3600000), hwids: [], maxHwids: maxHwids || 1 };
}

app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));