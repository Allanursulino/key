const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(bodyParser.json());

app.get('/', (req, res) => res.send("✅ API MultiHub Security v3.0 Online"));

// ----------------------------------------------------------------------
// CONFIGURAÇÃO DOS LINKS (ATENÇÃO AQUI)
// ----------------------------------------------------------------------
// DICA PARA LINKVERTISE/WORK.INK:
// Eles não aceitam o mesmo link de destino repetido.
// Para burlar isso, adicione "?v=1", "?v=2" no final do link do seu site.
//
// Exemplo de como configurar os DESTINOS lá no painel deles:
// Link 1 Destino: https://seu-site.netlify.app/?v=1
// Link 2 Destino: https://seu-site.netlify.app/?v=2
// (Isso engana o sistema deles, mas carrega seu site igual)
// ----------------------------------------------------------------------

const LINKS_CONFIG = {
    workink: [
        "https://work.ink/28yN/checkpoint-1-multihub", 
        "https://work.ink/28yN/checkpoint-2-multihub", 
        "https://work.ink/28yN/checkpoint-3-multihub", 
        "https://work.ink/28yN/checkpoint-4-multihub", 
        "https://work.ink/28yN/checkpoint-5-multihub"  
    ],
    linkvertise: [
        "https://link-target.net/1447099/8DDgstCnZENU",
        "https://link-center.net/1447099/CytW8OAWdGW6",
        "https://direct-link.net/1447099/3tviY1ZdNi8U",
        "https://link-center.net/1447099/b0UQDhbVX43z",
        "https://link-center.net/1447099/fokKbQQgZUij"
    ]
};
const CONFIG = {
    ADMIN_SECRET: "@Agosto1979", 
    MIN_SECONDS_BETWEEN_CHECKS: 15 // TEMPO MÍNIMO (Anti-Bypass de tempo)
};

// Armazenamento
let sessions = {}; 
let validKeys = {};

// 1. PROCESSAR CHECKPOINTS (Lógica Blindada)
app.post('/process-step', (req, res) => {
    // Agora exigimos um security_token do frontend
    const { session_id, security_token, provider, hours, target_checks } = req.body;
    
    let currentSession = sessions[session_id];

    // --- CENÁRIO 1: USUÁRIO NOVO (INÍCIO) ---
    if (!currentSession) {
        // Se o usuário mandou um ID que não existe na memória, resetamos ele
        const newID = crypto.randomBytes(16).toString('hex');
        const firstToken = crypto.randomBytes(8).toString('hex'); // Token para validar o passo 1
        
        sessions[newID] = {
            provider: provider || 'linkvertise',
            hours: hours || 24,
            target_checks: target_checks || 3,
            current_step: 0,
            last_check_time: Date.now(),
            expected_token: firstToken // O servidor espera esse token na próxima volta
        };
        
        return res.json({
            session_id: newID,
            security_token: firstToken, // Enviamos o token para o frontend guardar
            status: "progress",
            step: 1,
            total: sessions[newID].target_checks,
            url: getLink(sessions[newID].provider, 0)
        });
    }

    // --- CENÁRIO 2: USUÁRIO TENTANDO BURLAR (TOKEN INVÁLIDO) ---
    // Se o token que veio não é o que o servidor gerou no passo anterior:
    if (security_token !== currentSession.expected_token) {
        return res.json({
            status: "error",
            message: "Sessão inválida ou tentativa de bypass detectada. Reinicie."
        });
    }

    // --- CENÁRIO 3: BYPASS DE TEMPO (SPEEDRUN) ---
    const timeDiff = Date.now() - currentSession.last_check_time;
    if (timeDiff < (CONFIG.MIN_SECONDS_BETWEEN_CHECKS * 1000)) { 
        const waitTime = Math.ceil(CONFIG.MIN_SECONDS_BETWEEN_CHECKS - (timeDiff/1000));
        return res.json({ 
            session_id: session_id,
            security_token: security_token, // Mantém o mesmo token
            status: "wait",
            message: `Aguarde ${waitTime} segundos para verificar... (Anti-Spam)` 
        });
    }

    // --- SUCESSO: AVANÇAR PASSO ---
    currentSession.current_step++;
    currentSession.last_check_time = Date.now();
    
    // GERA NOVO TOKEN (Rotação)
    // Isso impede que o usuário "re-use" a validação anterior
    const nextToken = crypto.randomBytes(8).toString('hex');
    currentSession.expected_token = nextToken;

    // VERIFICA SE TERMINOU
    if (currentSession.current_step >= currentSession.target_checks) {
        const prefix = currentSession.provider === 'workink' ? 'WK' : 'LV';
        const key = `MULTI-${prefix}-${currentSession.hours}H-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
        
        saveKey(key, currentSession.hours);
        delete sessions[session_id]; // Destrói a sessão para não ser usada de novo

        return res.json({
            status: "completed",
            key: key
        });
    }

    // MANDA PRÓXIMO LINK E NOVO TOKEN
    return res.json({
        session_id: session_id,
        security_token: nextToken, // Token novo para o próximo passo
        status: "progress",
        step: currentSession.current_step + 1,
        total: currentSession.target_checks,
        url: getLink(currentSession.provider, currentSession.current_step)
    });
});

// 2. VALIDAÇÃO ROBLOX (Padrão)
app.get('/verify', (req, res) => {
    const { key, hwid } = req.query;
    if(!key || !validKeys[key]) return res.json({ valid: false, message: "Key inválida." });
    
    const data = validKeys[key];
    if(Date.now() > data.expiresAt) {
        delete validKeys[key];
        return res.json({ valid: false, message: "Key expirada." });
    }
    if(data.hwid && data.hwid !== hwid) return res.json({ valid: false, message: "HWID incompatível." });
    if(!data.hwid && hwid) data.hwid = hwid;

    return res.json({ valid: true, message: "Acesso Permitido" });
});

app.post('/admin/generate', (req, res) => {
    const { hours, adminSecret } = req.body;
    if(adminSecret !== CONFIG.ADMIN_SECRET) return res.status(403).json({ error: "Senha incorreta" });
    const key = `MULTI-ADMIN-${hours}H-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    saveKey(key, hours);
    res.json({ success: true, key: key });
});

function getLink(provider, index) {
    const links = LINKS_CONFIG[provider] || LINKS_CONFIG['linkvertise'];
    return links[index] || links[links.length - 1];
}

function saveKey(key, hours) {
    validKeys[key] = {
        createdAt: Date.now(),
        expiresAt: Date.now() + (hours * 60 * 60 * 1000),
        hwid: null
    };
}

app.listen(PORT, () => console.log(`Security Server running on port ${PORT}`));