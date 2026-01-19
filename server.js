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

app.get('/', (req, res) => res.send("✅ API MultiHub v19.0 (Secure Env Variables)"));

// --- CONFIGURAÇÃO ---
// Todas as chaves agora vêm do Render (Environment Variables)
const CONFIG = {
    ADMIN_SECRET: process.env.ADMIN_SECRET, 
    BASE_URL: process.env.BASE_URL, // Ex: https://seu-site.netlify.app
    WORKINK_API_KEY: process.env.WORKINK_API_KEY, 
    DISCORD_WEBHOOK: process.env.DISCORD_WEBHOOK,
    
    // ID DO LINKVERTISE (Configurado no Render)
    LINKVERTISE_ID: process.env.LINKVERTISE_ID, 
    
    MIN_SECONDS: 10
};

// Verificação de segurança no boot
if (!CONFIG.LINKVERTISE_ID) console.warn("⚠️ AVISO: LINKVERTISE_ID não configurado no Render!");
if (!CONFIG.WORKINK_API_KEY) console.warn("⚠️ AVISO: WORKINK_API_KEY não configurada no Render!");

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
    if (!CONFIG.ADMIN_SECRET || req.body.adminSecret !== CONFIG.ADMIN_SECRET) return res.status(403).json({ error: "Senha errada" });
    const list = Object.entries(validKeys).map(([k, v]) => ({ key: k, hwid: v.hwid || "Livre", expires: new Date(v.expiresAt).toLocaleString() }));
    res.json({ keys: list });
});

app.post('/admin/generate', (req, res) => {
    const { hours, adminSecret } = req.body;
    if (!CONFIG.ADMIN_SECRET || adminSecret !== CONFIG.ADMIN_SECRET) return res.status(403).json({ error: "Senha errada" });
    const key = `MULTI-ADMIN-${hours}H-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    saveKey(key, hours);
    res.json({ success: true, key: key });
});

// --- PROCESSO PRINCIPAL ---
app.post('/process-step', async (req, res) => {
    try {
        const { session_id, security_token, received_secret, provider, hours, target_checks } = req.body;
        
        // 1. INICIAR SESSÃO
        if (!session_id || !sessions[session_id]) {
            const newID = crypto.randomBytes(16).toString('hex');
            const firstToken = crypto.randomBytes(8).toString('hex');
            
            // Define provedor padrão se não vier
            const selectedProvider = (provider === 'linkvertise') ? 'linkvertise' : 'workink';

            sessions[newID] = {
                provider: selectedProvider, 
                hours: hours || 24, 
                target_checks: target_checks || 3,
                current_step: 0, 
                last_check_time: Date.now(), 
                expected_token: firstToken,
                dynamic_secret: null
            };
            
            const linkUrl = await generateLink(sessions[newID], newID);
            
            if (!linkUrl) {
                return res.json({ status: "error", message: "Erro ao criar link. Verifique as configurações do servidor." });
            }

            return res.json({ session_id: newID, security_token: firstToken, status: "progress", step: 1, total: sessions[newID].target_checks, url: linkUrl });
        }

        let currentSession = sessions[session_id];
        if (security_token !== currentSession.expected_token) return res.json({ status: "error", message: "Sessão expirada." });

        // 2. VALIDAÇÃO (SEGREDOS)
        if (!received_secret || received_secret !== currentSession.dynamic_secret) {
            return res.json({ status: "denied", message: "Link inválido! Você precisa completar o anúncio até o final." });
        }
        
        const timeDiff = Date.now() - currentSession.last_check_time;
        if (timeDiff < (CONFIG.MIN_SECONDS * 1000)) return res.json({ status: "wait", message: `Aguarde alguns segundos...` });

        // 3. AVANÇAR
        currentSession.current_step++;
        currentSession.last_check_time = Date.now();
        currentSession.dynamic_secret = null; 
        
        const nextToken = crypto.randomBytes(8).toString('hex');
        currentSession.expected_token = nextToken;

        // FIM?
        if (currentSession.current_step >= currentSession.target_checks) {
            const prefix = currentSession.provider === 'workink' ? 'WK' : 'LV';
            const key = `MULTI-${prefix}-${currentSession.hours}H-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
            saveKey(key, currentSession.hours);
            delete sessions[session_id];
            return res.json({ status: "completed", key: key });
        }

        const nextUrl = await generateLink(currentSession, session_id);
        if (!nextUrl) return res.json({ status: "error", message: "Erro ao gerar próximo link." });

        return res.json({ session_id: session_id, security_token: nextToken, status: "progress", step: currentSession.current_step + 1, total: currentSession.target_checks, url: nextUrl });
        
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
    if(data.hwid && data.hwid !== hwid) return res.json({ valid: false, message: "HWID Errado" });
    if(!data.hwid && hwid) data.hwid = hwid;
    return res.json({ valid: true, message: "Sucesso" });
});

// --- GERADOR DE LINKS ---
async function generateLink(session, id) {
    try {
        // --- 1. WORK.INK (API) ---
        if (session.provider === 'workink') {
            const secret = crypto.randomBytes(12).toString('hex');
            session.dynamic_secret = secret; 
            
            const destination = `${CONFIG.BASE_URL}/?secret=${secret}`;
            
            if (!CONFIG.WORKINK_API_KEY) {
                console.error("ERRO: WORKINK_API_KEY faltando nas variáveis de ambiente!");
                return null;
            }

            try {
                const response = await axios.post("https://dashboard.work.ink/_api/v1/link", {
                    title: `MultiHub Check ${session.current_step + 1}`,
                    destination: destination
                }, {
                    headers: { "X-Api-Key": CONFIG.WORKINK_API_KEY, "Content-Type": "application/json" }
                });

                if (response.data && response.data.response && response.data.response.url) {
                    return response.data.response.url;
                } else {
                    console.error("Work.ink API Falhou:", response.data);
                    return null;
                }
            } catch (e) {
                console.error("Axios Error:", e.message);
                return null;
            }
        }
        // --- 2. LINKVERTISE (DYNAMIC API) ---
        else if (session.provider === 'linkvertise') {
            if (!CONFIG.LINKVERTISE_ID) {
                console.error("ERRO: LINKVERTISE_ID não configurado nas variáveis de ambiente!");
                return null;
            }

            const secret = crypto.randomBytes(12).toString('hex');
            session.dynamic_secret = secret; 
            
            const destination = `${CONFIG.BASE_URL}/?secret=${secret}`;
            const base64Dest = Buffer.from(destination).toString('base64');
            
            const randomPath = Math.random().toString(36).substring(7);
            return `https://link-to.net/${CONFIG.LINKVERTISE_ID}/${randomPath}/dynamic?r=${base64Dest}`;
        }
    } catch (e) {
        console.error("Erro generateLink:", e.message);
        return null;
    }
}

function saveKey(key, hours) {
    validKeys[key] = { createdAt: Date.now(), expiresAt: Date.now() + (hours*3600000), hwid: null };
}

app.listen(PORT, () => console.log(`Rodando na porta ${PORT}`));