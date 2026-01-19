const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// Configuração de CORS (Permite que o Netlify e o Roblox conversem com o servidor)
app.use(cors({
    origin: '*', // Em produção, mude isso para o link do seu site no Netlify
    methods: ['GET', 'POST']
}));
app.use(bodyParser.json());

// --- CONFIGURAÇÕES ---
const CONFIG = {
    // Mude para false quando for usar as APIs reais do Work.ink/Linkvertise
    SIMULATION_MODE: false, 
    
    // Senha para você gerar keys lifetime no painel admin
    ADMIN_SECRET: "@Agosto1979", 
    
    // SUAS CHAVES DE API (Preencha quando SIMULATION_MODE = false)
    WORKINK_API_KEY: "11d4311c-fc04-4537-b2ca-db86514b3a99",
    LINKVERTISE_USER_ID: "1447099"
};

// Banco de dados em memória (Reseta se o servidor reiniciar no plano grátis)
// Para salvar permanente, precisaria integrar com MongoDB
let validKeys = {}; 

// --- ROTAS DO SITE (FRONTEND) ---

// 1. Rota para iniciar o processo de Checkpoints
app.post('/create-checkpoint', (req, res) => {
    const { provider, hours, checks } = req.body;
    
    // Gera um ID único para essa transação
    const transactionId = crypto.randomBytes(8).toString('hex');

    if (CONFIG.SIMULATION_MODE) {
        // MODO SIMULAÇÃO: Gera a key direto (útil para testar o site)
        const mockKey = generateKey(provider === 'workink' ? 'WK' : 'LV', hours);
        saveKey(mockKey, hours);
        
        // Simula delay de 2 segundos como se fosse o usuário passando pelo link
        setTimeout(() => {
            console.log(`[SIMULAÇÃO] Key gerada para ${hours}h: ${mockKey}`);
        }, 1000);

        return res.json({ 
            key: mockKey,
            message: "Modo Simulação Ativado" 
        });
    } 

    // MODO REAL (Lógica para integrar APIs)
    if (provider === 'workink') {
        // Exemplo: Retorna o link do seu perfil no Work.ink
        // Você deve configurar o Work.ink para redirecionar de volta com a key
        return res.json({ 
            url: `https://work.ink/seu-perfil?custom_id=${transactionId}` 
        });
    } 
    
    if (provider === 'linkvertise') {
        // Exemplo Linkvertise
        return res.json({ 
            url: `https://link-to.net/seu-id/${Math.random() * 1000}` 
        });
    }
});

// 2. Rota do Painel Admin (Gera keys sem passar por links)
app.post('/admin/generate', (req, res) => {
    const { hours, adminSecret } = req.body;

    if(adminSecret !== CONFIG.ADMIN_SECRET) {
        return res.status(403).json({ error: "Senha incorreta!" });
    }

    // Se hours for > 10000, consideramos Lifetime
    const prefix = hours > 10000 ? "LIFETIME" : "ADMIN";
    const key = generateKey(prefix, hours);
    saveKey(key, hours);

    console.log(`[ADMIN] Nova key gerada: ${key}`);
    res.json({ success: true, key: key });
});

// --- ROTAS DO ROBLOX (LUA SCRIPT) ---

// 3. O script Lua chama isso para ver se pode entrar
app.get('/verify', (req, res) => {
    const { key, hwid } = req.query;

    if(!key || !validKeys[key]) {
        return res.json({ valid: false, message: "Key inválida ou inexistente." });
    }

    const keyData = validKeys[key];

    // Verifica Expiração
    if(Date.now() > keyData.expiresAt) {
        delete validKeys[key]; // Remove key velha
        return res.json({ valid: false, message: "Esta key expirou. Gere uma nova." });
    }

    // Verifica HWID (Bloqueia compartilhamento de key)
    if(keyData.hwid && keyData.hwid !== hwid) {
        return res.json({ valid: false, message: "Key já vinculada a outro PC (HWID)." });
    }

    // Se for o primeiro uso, vincula o HWID
    if(!keyData.hwid && hwid) {
        keyData.hwid = hwid;
    }

    // Calcula tempo restante
    const hoursLeft = Math.floor((keyData.expiresAt - Date.now()) / 1000 / 60 / 60);

    return res.json({ 
        valid: true, 
        message: "Acesso Autorizado", 
        timeLeft: `${hoursLeft} horas`
    });
});

// --- FUNÇÕES AUXILIARES ---

function generateKey(prefix, hours) {
    const random = crypto.randomBytes(4).toString('hex').toUpperCase();
    return `MULTI-${prefix}-${hours}H-${random}`; // Formato: MULTI-WK-24H-A1B2C3D4
}

function saveKey(key, hours) {
    const expirationTime = Date.now() + (hours * 60 * 60 * 1000);
    validKeys[key] = {
        createdAt: Date.now(),
        expiresAt: expirationTime,
        hwid: null 
    };
}

// Inicia o servidor
app.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});