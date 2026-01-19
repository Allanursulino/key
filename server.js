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

app.get('/', (req, res) => res.send("✅ API MultiHub v12.0 (Links Reais + Work.ink POST Fix)"));

// --- CONFIGURAÇÃO ---
const CONFIG = {
    ADMIN_SECRET: process.env.ADMIN_SECRET, 
    BASE_URL: process.env.BASE_URL, 
    WORKINK_API_KEY: process.env.WORKINK_API_KEY, 
    DISCORD_WEBHOOK: process.env.DISCORD_WEBHOOK,
    MIN_SECONDS: 10
};

// --- LINKS DO LOOTLABS (REAIS) ---
// O sistema vai adicionar &custom={id} automaticamente no final
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
    const list = Object.entries(validKeys).map(([k, v]) => ({ key: k, hwid: v.hwid || "Livre", expires: new Date(v.expiresAt).toLocaleString() }));
    res.json({ keys: list });
});

app.post('/admin/generate', (req, res) => {
    const { hours, adminSecret } = req.body;
    if (adminSecret !== CONFIG.ADMIN_SECRET) return res.status(403).json({ error: "Senha errada" });
    const key = `MULTI-ADMIN-${hours}H-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    saveKey(key, hours);
    res.json({ success: true, key: key });
});

// --- WEBHOOKS ---
app.get('/webhook/lootlabs', (req, res) => {
    const session_id = req.query.custom;
    if (session_id && sessions[session_id]) {
        sessions[session_id].verified_by_webhook = true;
        res.status(200).send("OK");
    } else { res.status(400).send("ID Inválido"); }
});

// --- PROCESSO ---
app.post('/process-step', async (req, res) => {
    const { session_id, security_token, received_secret, provider, hours, target_checks } = req.body;
    
    // 1. INICIAR SESSÃO
    if (!session_id || !sessions[session_id]) {
        const newID = crypto.randomBytes(16).toString('hex');
        const firstToken = crypto.randomBytes(8).toString('hex');
        sessions[newID] = {
            provider: provider || 'lootlabs', hours: hours || 24, target_checks: target_checks || 3,
            current_step: 0, last_check_time: Date.now(), expected_token: firstToken,
            verified_by_webhook: false, dynamic_secret: null
        };
        
        const linkUrl = await generateLink(sessions[newID], newID);
        
        // Se falhar ao gerar link (ex: erro na api work.ink), retorna erro
        if (!linkUrl) {
            return res.json({ status: "error", message: "Erro ao criar link com o provedor. Tente novamente." });
        }

        return res.json({ session_id: newID, security_token: firstToken, status: "progress", step: 1, total: sessions[newID].target_checks, url: linkUrl });
    }

    let currentSession = sessions[session_id];
    if (security_token !== currentSession.expected_token) return res.json({ status: "error", message: "Sessão expirada." });

    // 2. VALIDAÇÃO
    if (currentSession.provider === 'lootlabs') {
        if (currentSession.verified_by_webhook !== true) {
             const timeDiff = Date.now() - currentSession.last_check_time;
             if (timeDiff < 5000) return res.json({ status: "wait", message: "Aguardando confirmação..." });
             return res.json({ status: "denied", message: "Ainda não confirmado pelo LootLabs." });
        }
    } else {
        // Work.ink API (Valida pelo segredo que mandamos criar)
        if (!received_secret || received_secret !== currentSession.dynamic_secret) {
            return res.json({ status: "denied", message: "Link inválido! Complete o anúncio." });
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
        const prefix = currentSession.provider === 'lootlabs' ? 'LL' : 'WK';
        const key = `MULTI-${prefix}-${currentSession.hours}H-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        saveKey(key, currentSession.hours);
        delete sessions[session_id];
        return res.json({ status: "completed", key: key });
    }

    const nextUrl = await generateLink(currentSession, session_id);
    if (!nextUrl) return res.json({ status: "error", message: "Erro ao gerar próximo link." });

    return res.json({ session_id: session_id, security_token: nextToken, status: "progress", step: currentSession.current_step + 1, total: currentSession.target_checks, url: nextUrl });
});

app.get('/verify', (req, res) => {
    const { key, hwid } = req.query;
    if(!key || !validKeys[key]) return res.json({ valid: false, message: "Inválida" });
    if (blacklistedHWIDs.includes(hwid)) return res.json({ valid: false, message: "HWID Banido" });
    const data = validKeys[key];
    if(Date.now() > data.expiresAt) { delete validKeys[key]; return res.json({ valid: false, message: "Expirada" }); }
    if(data.hwid && data.hwid !== hwid) return res.json({ valid: false, message: "HWID Errado" });
    if(!data.hwid && hwid) data.hwid = hwid;
    return res.json({ valid: true, message: "Sucesso" });
});

// --- GERADOR DE LINKS ---
async function generateLink(session, id) {
    if (session.provider === 'lootlabs') {
        const index = session.current_step;
        // Pega um dos seus 5 links reais
        let baseLink = LOOTLABS_LINKS[index] || LOOTLABS_LINKS[LOOTLABS_LINKS.length - 1];
        // Adiciona &custom=ID (Seus links já têm ?, então usamos &)
        return `${baseLink}&custom=${id}`;
    } 
    else if (session.provider === 'workink') {
        const secret = crypto.randomBytes(12).toString('hex');
        session.dynamic_secret = secret; 
        
        // Destino final: seu site com o segredo
        const destination = `${CONFIG.BASE_URL}/?secret=${secret}`;
        
        if (!CONFIG.WORKINK_API_KEY) {
            console.error("ERRO: API Key do Work.ink não configurada!");
            return null; // Retorna nulo para dar erro no front, não bypass
        }

        try {
            // Chamada POST correta para v1
            const response = await axios.post("https://api.work.ink/v1/link", {
                title: `Check ${session.current_step + 1} - MultiHub`,
                destination: destination,
                custom: `check-${session.current_step}-${id.substring(0,5)}` // Slug opcional
            }, {
                headers: {
                    "X-Api-Key": CONFIG.WORKINK_API_KEY,
                    "Content-Type": "application/json"
                }
            });

            if (response.data && response.data.url) {
                return response.data.url;
            } else {
                console.error("Work.ink não retornou URL:", response.data);
                return null;
            }
        } catch (e) {
            console.error("Erro Axios Work.ink:", e.response ? e.response.data : e.message);
            return null; 
        }
    }
}

function saveKey(key, hours) {
    validKeys[key] = { createdAt: Date.now(), expiresAt: Date.now() + (hours*3600000), hwid: null };
}

app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));