const express = require('express');
const https = require('https'); 
const cors = require('cors');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const axios = require('axios'); 

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.get('/', (req, res) => res.send("✅ API MultiHub v11.0 (Secure Production Mode)"));

// --- CONFIGURAÇÃO ESTRITAMENTE SEGURA ---
// Removemos todos os valores padrão ("fallback").
// Agora tudo DEVE vir do Render (Environment Variables).
const CONFIG = {
    ADMIN_SECRET: process.env.ADMIN_SECRET, 
    BASE_URL: process.env.BASE_URL, 
    WORKINK_API_KEY: process.env.WORKINK_API_KEY, 
    DISCORD_WEBHOOK: process.env.DISCORD_WEBHOOK,
    MIN_SECONDS: 10
};

// --- VALIDAÇÃO DE SEGURANÇA NA INICIALIZAÇÃO ---
// Verifica se as variáveis existem. Se não, avisa o erro e pode até parar o servidor.
const missingVars = [];
if (!CONFIG.ADMIN_SECRET) missingVars.push("ADMIN_SECRET");
if (!CONFIG.BASE_URL) missingVars.push("BASE_URL");
if (!CONFIG.WORKINK_API_KEY) missingVars.push("WORKINK_API_KEY");
if (!CONFIG.DISCORD_WEBHOOK) missingVars.push("DISCORD_WEBHOOK");

if (missingVars.length > 0) {
    console.error("🚨 ERRO CRÍTICO: Faltam Variáveis de Ambiente no Render!");
    console.error("As seguintes chaves não foram configuradas:", missingVars.join(", "));
    console.error("O servidor pode não funcionar corretamente.");
} else {
    console.log("🔒 Configuração de segurança carregada com sucesso.");
}

const LOOTLABS_LINKS = [
    "https://loot-link.com/s?k=code1", "https://loot-link.com/s?k=code2", "https://loot-link.com/s?k=code3", "https://loot-link.com/s?k=code4", "https://loot-link.com/s?k=code5"
];

let sessions = {}; 
let validKeys = {};
let blacklistedHWIDs = []; 

// --- LOG DISCORD ---
app.post('/log-discord', async (req, res) => {
    const { username, accountAge, hwid, gameId, key } = req.body;

    if (!username || !key) return res.status(400).send("Dados incompletos");
    if (!CONFIG.DISCORD_WEBHOOK) return res.status(500).send("Webhook não configurado");

    const embed = {
        title: "🚨 Key Resgatada / Login Efetuado",
        color: 15158332, // Vermelho
        fields: [
            { name: "👤 Usuário", value: username, inline: true },
            { name: "⏳ Idade", value: `${accountAge} dias`, inline: true },
            { name: "🎮 Game ID", value: `${gameId}`, inline: true },
            { name: "🔑 Key", value: `\`${key}\``, inline: false },
            { name: "💻 HWID", value: `\`${hwid}\``, inline: false }
        ],
        footer: { text: "MultiHub Security System" },
        timestamp: new Date().toISOString()
    };

    try {
        await axios.post(CONFIG.DISCORD_WEBHOOK, { embeds: [embed] });
        res.json({ success: true });
    } catch (e) {
        console.error("Erro Webhook:", e.message);
        res.status(500).json({ error: "Falha no envio" });
    }
});

// --- ADMIN PANEL API ---

app.post('/admin/list-keys', (req, res) => {
    if (!CONFIG.ADMIN_SECRET || req.body.adminSecret !== CONFIG.ADMIN_SECRET) return res.status(403).json({ error: "Senha errada ou não configurada" });
    const list = Object.entries(validKeys).map(([k, v]) => ({
        key: k, hwid: v.hwid || "Não usado", expires: new Date(v.expiresAt).toLocaleString(), isExpired: Date.now() > v.expiresAt
    }));
    res.json({ keys: list, bannedHWIDs: blacklistedHWIDs });
});

app.post('/admin/reset-hwid', (req, res) => {
    const { adminSecret, key } = req.body;
    if (!CONFIG.ADMIN_SECRET || adminSecret !== CONFIG.ADMIN_SECRET) return res.status(403).json({ error: "Acesso negado" });
    if (validKeys[key]) { validKeys[key].hwid = null; res.json({ success: true }); } 
    else { res.json({ success: false }); }
});

app.post('/admin/ban-hwid', (req, res) => {
    const { adminSecret, hwid } = req.body;
    if (!CONFIG.ADMIN_SECRET || adminSecret !== CONFIG.ADMIN_SECRET) return res.status(403).json({ error: "Acesso negado" });
    if (!blacklistedHWIDs.includes(hwid)) blacklistedHWIDs.push(hwid);
    for (const [key, val] of Object.entries(validKeys)) { if (val.hwid === hwid) delete validKeys[key]; }
    res.json({ success: true });
});

app.post('/admin/delete-key', (req, res) => {
    const { adminSecret, key } = req.body;
    if (!CONFIG.ADMIN_SECRET || adminSecret !== CONFIG.ADMIN_SECRET) return res.status(403).json({ error: "Acesso negado" });
    if (validKeys[key]) { delete validKeys[key]; res.json({ success: true }); }
    else { res.json({ success: false }); }
});

app.post('/admin/generate', (req, res) => {
    const { hours, adminSecret } = req.body;
    if (!CONFIG.ADMIN_SECRET || adminSecret !== CONFIG.ADMIN_SECRET) return res.status(403).json({ error: "Senha incorreta" });
    const key = `MULTI-ADMIN-${hours}H-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    saveKey(key, hours);
    res.json({ success: true, key: key });
});

// --- CLIENTE API ---

app.get('/webhook/lootlabs', (req, res) => {
    const session_id = req.query.custom;
    if (session_id && sessions[session_id]) {
        sessions[session_id].verified_by_webhook = true;
        res.status(200).send("OK");
    } else {
        res.status(400).send("ID Inválido");
    }
});

app.post('/process-step', async (req, res) => {
    const { session_id, security_token, received_secret, provider, hours, target_checks } = req.body;
    
    if (!session_id || !sessions[session_id]) {
        const newID = crypto.randomBytes(16).toString('hex');
        const firstToken = crypto.randomBytes(8).toString('hex');
        sessions[newID] = {
            provider: provider || 'lootlabs', hours: hours || 24, target_checks: target_checks || 3,
            current_step: 0, last_check_time: Date.now(), expected_token: firstToken,
            verified_by_webhook: false, dynamic_secret: null
        };
        const linkUrl = await generateLink(sessions[newID], newID);
        return res.json({ session_id: newID, security_token: firstToken, status: "progress", step: 1, total: sessions[newID].target_checks, url: linkUrl });
    }

    let currentSession = sessions[session_id];
    if (security_token !== currentSession.expected_token) return res.json({ status: "error", message: "Sessão expirada." });

    if (currentSession.provider === 'lootlabs') {
        if (currentSession.verified_by_webhook !== true) {
             const timeDiff = Date.now() - currentSession.last_check_time;
             if (timeDiff < 5000) return res.json({ status: "wait", message: "Aguardando LootLabs..." });
             return res.json({ status: "denied", message: "LootLabs não confirmou ainda." });
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
        const prefix = currentSession.provider === 'lootlabs' ? 'LL' : 'WK';
        const key = `MULTI-${prefix}-${currentSession.hours}H-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        saveKey(key, currentSession.hours);
        delete sessions[session_id];
        return res.json({ status: "completed", key: key });
    }

    const nextUrl = await generateLink(currentSession, session_id);
    return res.json({ session_id: session_id, security_token: nextToken, status: "progress", step: currentSession.current_step + 1, total: currentSession.target_checks, url: nextUrl });
});

app.get('/verify', (req, res) => {
    const { key, hwid } = req.query;
    if(!key || !validKeys[key]) return res.json({ valid: false, message: "Key Inválida" });
    if (blacklistedHWIDs.includes(hwid)) return res.json({ valid: false, message: "HWID Banido" });
    const data = validKeys[key];
    if(Date.now() > data.expiresAt) { delete validKeys[key]; return res.json({ valid: false, message: "Key Expirada" }); }
    if(data.hwid && data.hwid !== hwid) return res.json({ valid: false, message: "HWID Incompatível" });
    if(!data.hwid && hwid) data.hwid = hwid;
    return res.json({ valid: true, message: "Sucesso" });
});

async function generateLink(session, id) {
    if (session.provider === 'lootlabs') {
        const index = session.current_step;
        let baseLink = LOOTLABS_LINKS[index] || LOOTLABS_LINKS[LOOTLABS_LINKS.length - 1];
        return `${baseLink}${baseLink.includes('?') ? '&' : '?'}custom=${id}`;
    } else if (session.provider === 'workink') {
        const secret = crypto.randomBytes(12).toString('hex');
        session.dynamic_secret = secret; 
        const destination = `${CONFIG.BASE_URL}/?secret=${secret}`;
        
        if (!CONFIG.WORKINK_API_KEY) {
            console.error("ERRO: WORKINK_API_KEY não configurada no Render!");
            return destination; 
        }

        const apiUrl = `https://api.work.ink/v1/link/add?api_key=${CONFIG.WORKINK_API_KEY}&destination=${encodeURIComponent(destination)}`;
        try {
            const result = await fetchJson(apiUrl);
            return result?.data?.url || destination;
        } catch (e) { return destination; }
    }
}

function fetchJson(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            let data = ''; res.on('data', c => data += c); res.on('end', () => resolve(JSON.parse(data)));
        }).on('error', reject);
    });
}

function saveKey(key, hours) {
    validKeys[key] = { createdAt: Date.now(), expiresAt: Date.now() + (hours*3600000), hwid: null };
}

app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));