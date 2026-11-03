const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, REST, Routes, SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle 
} = require('discord.js');
const axios = require('axios');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
const API_URL = "https://multihub-api-ljf7.onrender.com"; 
const ROLE_REQUIRED = "</> Lord";
const ADMIN_SECRET = process.env.ADMIN_SECRET;

const commands = [
    new SlashCommandBuilder()
        .setName('multihub-admin')
        .setDescription('Painel de administração completo do MultiHub'),
    new SlashCommandBuilder()
        .setName('multihub')
        .setDescription('Painel do Cliente / Client Panel (Status da Key)')
];

client.once('ready', async () => {
    console.log(`Bot logado como ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    try {
        await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
        console.log('Comandos registrados com sucesso.');
    } catch (e) {
        console.error("Erro ao registrar comandos:", e);
    }
});

client.on('interactionCreate', async interaction => {
    // ==========================================
    // SLASH COMMAND: /multihub (PAINEL DO CLIENTE)
    // ==========================================
    if (interaction.isChatInputCommand() && interaction.commandName === 'multihub') {
        const embed = new EmbedBuilder()
            .setTitle('🌍 MultiHub - Idioma / Language')
            .setDescription('Por favor, escolha o seu idioma abaixo.\n*Please select your language below.*')
            .setColor('#dc2626');

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('client_lang_pt').setLabel('Português').setStyle(ButtonStyle.Secondary).setEmoji('🇧🇷'),
            new ButtonBuilder().setCustomId('client_lang_en').setLabel('English').setStyle(ButtonStyle.Secondary).setEmoji('🇺🇸')
        );

        await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
        return;
    }

    // ==========================================
    // SLASH COMMAND: /multihub-admin (ADMIN)
    // ==========================================
    if (interaction.isChatInputCommand() && interaction.commandName === 'multihub-admin') {
        if (interaction.member && !interaction.member.roles.cache.some(role => role.name === ROLE_REQUIRED)) {
            return interaction.reply({ content: `🚫 Acesso negado. Requer cargo \`${ROLE_REQUIRED}\`.`, ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true });
        try {
            const res = await axios.post(`${API_URL}/admin/list-keys`, { adminSecret: ADMIN_SECRET });
            if (res.data.error) return interaction.editReply({ content: '❌ Erro de Autenticação da API.' });

            const keys = res.data.keys;
            const keysAtivas = keys.filter(k => !k.isExpired).length;

            const embed = new EmbedBuilder()
                .setTitle('🛡️ MULTIHUB MANAGER - CONSOLE')
                .setDescription('Autenticado via Integração Segura.\nUse os botões abaixo para gerenciar o sistema.')
                .setColor('#dc2626')
                .addFields(
                    { name: '📊 Status', value: `Total de Keys: **${keys.length}**\nKeys Ativas: **${keysAtivas}**`, inline: false }
                );

            const row1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('abrir_gerar_key').setLabel('Gerar Nova Key').setStyle(ButtonStyle.Success).setEmoji('🔑'),
                new ButtonBuilder().setCustomId('abrir_gerenciar_key').setLabel('Gerenciar uma Key').setStyle(ButtonStyle.Primary).setEmoji('⚙️'),
                new ButtonBuilder().setCustomId('limpar_expiradas').setLabel('Limpar Expiradas').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
            );
            const row2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('abrir_banir_hwid').setLabel('Banir HWID').setStyle(ButtonStyle.Danger).setEmoji('🔨')
            );

            await interaction.editReply({ embeds: [embed], components: [row1, row2] });
        } catch (error) {
            await interaction.editReply({ content: '⚠️ Erro ao conectar com a API do Render.' });
        }
    }

    // ==========================================
    // INTERAÇÕES COM BOTÕES
    // ==========================================
    if (interaction.isButton()) {
        
        // BOTÕES DO CLIENTE: Escolha de Idioma
        if (interaction.customId.startsWith('client_lang_')) {
            const lang = interaction.customId.split('_')[2]; // 'pt' ou 'en'
            
            const modal = new ModalBuilder()
                .setCustomId(`modal_client_${lang}`)
                .setTitle(lang === 'pt' ? 'Painel do Cliente' : 'Client Panel');
                
            const keyInput = new TextInputBuilder()
                .setCustomId('client_key')
                .setLabel(lang === 'pt' ? 'Insira a sua Key' : 'Enter your Key')
                .setStyle(TextInputStyle.Short)
                .setRequired(true);
                
            modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
            await interaction.showModal(modal);
            return;
        }

        // VERIFICAÇÃO DE SEGURANÇA PARA BOTÕES DE ADMIN
        if (['limpar_expiradas', 'abrir_gerar_key', 'abrir_gerenciar_key', 'abrir_banir_hwid'].includes(interaction.customId) || interaction.customId.startsWith('reset_hwid_') || interaction.customId.startsWith('del_key_')) {
            if (interaction.member && !interaction.member.roles.cache.some(role => role.name === ROLE_REQUIRED)) {
                return interaction.reply({ content: `🚫 Acesso negado.`, ephemeral: true });
            }
        }

        if (interaction.customId === 'limpar_expiradas') {
            await interaction.deferReply({ ephemeral: true });
            try {
                await axios.post(`${API_URL}/admin/delete-expired`, { adminSecret: ADMIN_SECRET });
                await interaction.editReply({ content: '✅ Todas as keys expiradas foram limpas com sucesso!' });
            } catch (e) { await interaction.editReply({ content: '❌ Erro ao limpar chaves.' }); }
        }

        if (interaction.customId === 'abrir_gerar_key') {
            const modal = new ModalBuilder().setCustomId('modal_gerar_key').setTitle('Gerar Nova Key');
            const horasInput = new TextInputBuilder().setCustomId('horas').setLabel('Duração (Horas) - Ex: 24 ou 999999').setStyle(TextInputStyle.Short).setValue('24').setRequired(true);
            const hwidInput = new TextInputBuilder().setCustomId('max_hwid').setLabel('Max HWIDs').setStyle(TextInputStyle.Short).setValue('1').setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(horasInput), new ActionRowBuilder().addComponents(hwidInput));
            await interaction.showModal(modal);
        }

        if (interaction.customId === 'abrir_gerenciar_key') {
            const modal = new ModalBuilder().setCustomId('modal_buscar_key').setTitle('Gerenciar Key');
            const keyInput = new TextInputBuilder().setCustomId('key_string').setLabel('Digite a Key').setStyle(TextInputStyle.Short).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
            await interaction.showModal(modal);
        }

        if (interaction.customId === 'abrir_banir_hwid') {
            const modal = new ModalBuilder().setCustomId('modal_banir_hwid').setTitle('Banir HWID');
            const hwidInput = new TextInputBuilder().setCustomId('hwid_string').setLabel('Identificador do HWID').setStyle(TextInputStyle.Short).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(hwidInput));
            await interaction.showModal(modal);
        }

        if (interaction.customId.startsWith('reset_hwid_')) {
            const targetKey = interaction.customId.replace('reset_hwid_', '');
            await interaction.deferReply({ ephemeral: true });
            try {
                await axios.post(`${API_URL}/admin/reset-hwid`, { adminSecret: ADMIN_SECRET, key: targetKey });
                await interaction.editReply({ content: `✅ HWIDs resetados para a key \`${targetKey}\`.` });
            } catch (e) { await interaction.editReply({ content: '❌ Erro ao resetar HWID.' }); }
        }

        if (interaction.customId.startsWith('del_key_')) {
            const targetKey = interaction.customId.replace('del_key_', '');
            await interaction.deferReply({ ephemeral: true });
            try {
                await axios.post(`${API_URL}/admin/delete-key`, { adminSecret: ADMIN_SECRET, key: targetKey });
                await interaction.editReply({ content: `✅ Key \`${targetKey}\` deletada com sucesso.` });
            } catch (e) { await interaction.editReply({ content: '❌ Erro ao deletar Key.' }); }
        }
    }

    // ==========================================
    // PROCESSAMENTO DE MODAIS (FORMULÁRIOS)
    // ==========================================
    if (interaction.isModalSubmit()) {

        // SUBMIT DO CLIENTE: Pesquisar a Key
        if (interaction.customId.startsWith('modal_client_')) {
            await interaction.deferReply({ ephemeral: true });
            const lang = interaction.customId.split('_')[2];
            const userKey = interaction.fields.getTextInputValue('client_key');

            // Dicionário Bilingue
            const t = {
                pt: {
                    notFound: '❌ Key não encontrada no banco de dados.',
                    title: '👤 Painel do Cliente | MultiHub',
                    keyId: '🔑 Identificação',
                    status: '📊 Status',
                    type: '⭐ Tipo de Key',
                    expires: '⏱️ Expiração',
                    hwids: '💻 HWIDs (Uso)',
                    active: '🟢 Ativa',
                    expired: '🔴 Expirada',
                    lifetime: '♾️ Lifetime (Vitalícia)',
                    monthly: '📅 Mensal',
                    daily: '⏳ Diária (ou Curta)',
                    buyBtn: '🛒 Comprar Chave',
                    newBtn: '🔄 Gerar Nova Key',
                    error: '❌ Erro ao buscar os dados da API.'
                },
                en: {
                    notFound: '❌ Key not found in the database.',
                    title: '👤 Client Panel | MultiHub',
                    keyId: '🔑 Key ID',
                    status: '📊 Status',
                    type: '⭐ Key Type',
                    expires: '⏱️ Expiration Date',
                    hwids: '💻 HWIDs (Usage)',
                    active: '🟢 Active',
                    expired: '🔴 Expired',
                    lifetime: '♾️ Lifetime',
                    monthly: '📅 Monthly',
                    daily: '⏳ Daily (or Short)',
                    buyBtn: '🛒 Buy Key',
                    newBtn: '🔄 Generate New Key',
                    error: '❌ Error fetching API data.'
                }
            }[lang];

            try {
                // Como o bot atua no backend, ele pode usar o ADMIN_SECRET para buscar a key específica em segurança
                const res = await axios.post(`${API_URL}/admin/list-keys`, { adminSecret: ADMIN_SECRET });
                const keyInfo = res.data.keys.find(k => k.key === userKey);

                if (!keyInfo) return interaction.editReply({ content: t.notFound });

                // Calcular Tipo de Key (Lifetime, Mensal, Diária)
                let keyType = t.daily;
                const expDate = new Date(keyInfo.expires);
                if (!isNaN(expDate.getTime())) {
                    const now = new Date();
                    const diffHours = (expDate - now) / (1000 * 60 * 60);
                    if (diffHours > 8000) keyType = t.lifetime; // Mais de ~330 dias
                    else if (diffHours > 400) keyType = t.monthly; // Mais de ~16 dias
                } else if (String(keyInfo.expires).includes('999') || String(keyInfo.expires).includes('203')) {
                    keyType = t.lifetime; // Fallback textual
                }

                const embed = new EmbedBuilder()
                    .setTitle(t.title)
                    .setColor(keyInfo.isExpired ? '#ef4444' : '#10b981') // Vermelho se expirada, Verde se ativa
                    .addFields(
                        { name: t.keyId, value: `\`${keyInfo.key}\``, inline: false },
                        { name: t.status, value: keyInfo.isExpired ? t.expired : t.active, inline: true },
                        { name: t.type, value: keyType, inline: true },
                        { name: t.hwids, value: `${keyInfo.hwids.length} / ${keyInfo.maxHwids}`, inline: true },
                        { name: t.expires, value: `**${keyInfo.expires}**`, inline: false }
                    )
                    .setFooter({ text: 'MultiHub Security System' })
                    .setTimestamp();

                // Construir Botões com Links
                const row = new ActionRowBuilder();
                
                if (keyInfo.isExpired) {
                    row.addComponents(
                        new ButtonBuilder()
                            .setLabel(t.newBtn)
                            .setStyle(ButtonStyle.Link)
                            .setURL('https://keymultihubpro.vercel.app')
                    );
                }
                
                row.addComponents(
                    new ButtonBuilder()
                        .setLabel(t.buyBtn)
                        .setStyle(ButtonStyle.Link)
                        .setURL('https://multihubpro.vercel.app/premium.html')
                );

                await interaction.editReply({ embeds: [embed], components: [row] });
            } catch (e) {
                await interaction.editReply({ content: t.error });
            }
            return;
        }

        // ==========================================
        // SUBMITS DO ADMIN
        // ==========================================
        // (O código de gerar key, banir hwid, buscar key do admin continua igual abaixo)
        
        if (interaction.customId === 'modal_gerar_key') {
            await interaction.deferReply({ ephemeral: true });
            const horas = parseInt(interaction.fields.getTextInputValue('horas'));
            const maxHwids = parseInt(interaction.fields.getTextInputValue('max_hwid'));
            try {
                const res = await axios.post(`${API_URL}/admin/generate`, { adminSecret: ADMIN_SECRET, hours: horas, maxHwids: maxHwids });
                if (res.data.key) {
                    await interaction.editReply({ content: `✅ **Key Gerada com Sucesso!**\n\`\`\`\n${res.data.key}\n\`\`\`` });
                } else {
                    await interaction.editReply({ content: '❌ Falha ao gerar key.' });
                }
            } catch (e) { await interaction.editReply({ content: '❌ Erro na API.' }); }
        }

        if (interaction.customId === 'modal_buscar_key') {
            await interaction.deferReply({ ephemeral: true });
            const keyString = interaction.fields.getTextInputValue('key_string');
            try {
                const res = await axios.post(`${API_URL}/admin/list-keys`, { adminSecret: ADMIN_SECRET });
                const keyInfo = res.data.keys.find(k => k.key === keyString);
                if (!keyInfo) return interaction.editReply({ content: '❌ Key não encontrada no banco de dados.' });

                const listaHwids = keyInfo.hwids && keyInfo.hwids.length > 0 
                    ? keyInfo.hwids.map(h => `\`${h}\``).join('\n') 
                    : 'Nenhum HWID vinculado';

                const embed = new EmbedBuilder()
                    .setTitle('⚙️ Gerenciamento de Key')
                    .setColor('#dc2626')
                    .addFields(
                        { name: '🔑 Identificação', value: `\`${keyInfo.key}\``, inline: false },
                        { name: '⏱️ Expiração', value: keyInfo.expires, inline: true },
                        { name: '📊 HWIDs (Qtd)', value: `${keyInfo.hwids.length} / ${keyInfo.maxHwids}`, inline: true },
                        { name: '💻 Lista de HWIDs', value: listaHwids, inline: false }
                    );

                if (keyInfo.robloxUsername) {
                    embed.addFields(
                        { name: '👤 Usuário', value: keyInfo.robloxUsername || 'Desconhecido', inline: true },
                        { name: '⏳ Idade da Conta', value: `${keyInfo.accountAge || 0} dias`, inline: true },
                        { name: '🎮 Place ID', value: keyInfo.placeId ? `\`${keyInfo.placeId}\`` : 'N/A', inline: true }
                    );
                    if (keyInfo.robloxUserId) {
                        embed.setThumbnail(`https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=${keyInfo.robloxUserId}&size=150x150&format=Png&isCircular=false`);
                    }
                }

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`reset_hwid_${keyInfo.key}`).setLabel('Resetar Todos HWIDs').setStyle(ButtonStyle.Secondary).setEmoji('🔌'),
                    new ButtonBuilder().setCustomId(`del_key_${keyInfo.key}`).setLabel('Deletar Key').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
                );

                await interaction.editReply({ embeds: [embed], components: [row] });
            } catch (e) { await interaction.editReply({ content: '❌ Erro ao buscar dados da key.' }); }
        }

        if (interaction.customId === 'modal_banir_hwid') {
            await interaction.deferReply({ ephemeral: true });
            const hwidString = interaction.fields.getTextInputValue('hwid_string');
            try {
                await axios.post(`${API_URL}/admin/ban-hwid`, { adminSecret: ADMIN_SECRET, hwid: hwidString });
                await interaction.editReply({ content: `🔨 HWID \`${hwidString}\` banido com sucesso.` });
            } catch (e) { await interaction.editReply({ content: '❌ Erro ao banir HWID.' }); }
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
