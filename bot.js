const { 
    Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, 
    ButtonStyle, REST, Routes, SlashCommandBuilder, ModalBuilder, TextInputBuilder, TextInputStyle 
} = require('discord.js');
const axios = require('axios');

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
const API_URL = "https://multihub-api-ljf7.onrender.com"; // Sua API no Render
const ROLE_REQUIRED = "</> Lord";

// Sistema simples de cache para manter a senha salva enquanto você usa os botões
const activeSessions = new Map();

const commands = [
    new SlashCommandBuilder()
        .setName('multihub-admin')
        .setDescription('Painel de administração completo do MultiHub')
        .addStringOption(option => 
            option.setName('senha')
                .setDescription('Senha Mestra de Autenticação')
                .setRequired(true))
];

client.once('ready', async () => {
    console.log(`Bot logado como ${client.user.tag}`);
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), { body: commands });
});

client.on('interactionCreate', async interaction => {
    // 1. VERIFICAÇÃO DE CARGO GLOBAL PARA TODAS AS AÇÕES
    if (interaction.member) {
        const hasRole = interaction.member.roles.cache.some(role => role.name === ROLE_REQUIRED);
        if (!hasRole) {
            if (interaction.isRepliable()) {
                return interaction.reply({ content: `🚫 Acesso negado. Requer cargo \`${ROLE_REQUIRED}\`.`, ephemeral: true });
            }
            return;
        }
    }

    // ==========================================
    // SLASH COMMAND: /multihub-admin
    // ==========================================
    if (interaction.isChatInputCommand() && interaction.commandName === 'multihub-admin') {
        const senha = interaction.options.getString('senha');
        
        await interaction.deferReply({ ephemeral: true });

        try {
            // Testa a senha listando as keys
            const res = await axios.post(`${API_URL}/admin/list-keys`, { adminSecret: senha });
            if (res.data.error) return interaction.editReply({ content: '❌ Senha Mestra incorreta!' });

            // Salva a sessão do usuário
            activeSessions.set(interaction.user.id, senha);

            const keys = res.data.keys;
            const keysAtivas = keys.filter(k => !k.isExpired).length;[cite: 1]

            const embed = new EmbedBuilder()
                .setTitle('🛡️ MULTIHUB MANAGER - CONSOLE')
                .setDescription('Autenticado com sucesso. Sessão ativa.\nUse os botões abaixo para gerenciar o sistema.')
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
        const senha = activeSessions.get(interaction.user.id);
        if (!senha) return interaction.reply({ content: '⚠️ Sua sessão expirou. Digite `/multihub-admin` novamente.', ephemeral: true });

        // AÇÃO: Limpar Expiradas
        if (interaction.customId === 'limpar_expiradas') {
            await interaction.deferReply({ ephemeral: true });
            try {
                await axios.post(`${API_URL}/admin/delete-expired`, { adminSecret: senha });
                await interaction.editReply({ content: '✅ Todas as keys expiradas foram limpas com sucesso!' });
            } catch (e) { await interaction.editReply({ content: '❌ Erro ao limpar chaves.' }); }
        }

        // MODAL: Gerar Key
        if (interaction.customId === 'abrir_gerar_key') {
            const modal = new ModalBuilder().setCustomId('modal_gerar_key').setTitle('Gerar Nova Key');
            const horasInput = new TextInputBuilder().setCustomId('horas').setLabel('Duração (Horas) - Ex: 24 ou 999999').setStyle(TextInputStyle.Short).setValue('24').setRequired(true);
            const hwidInput = new TextInputBuilder().setCustomId('max_hwid').setLabel('Max HWIDs').setStyle(TextInputStyle.Short).setValue('1').setRequired(true);
            
            modal.addComponents(new ActionRowBuilder().addComponents(horasInput), new ActionRowBuilder().addComponents(hwidInput));
            await interaction.showModal(modal);
        }

        // MODAL: Buscar Key para Gerenciar
        if (interaction.customId === 'abrir_gerenciar_key') {
            const modal = new ModalBuilder().setCustomId('modal_buscar_key').setTitle('Gerenciar Key');
            const keyInput = new TextInputBuilder().setCustomId('key_string').setLabel('Digite a Key').setStyle(TextInputStyle.Short).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(keyInput));
            await interaction.showModal(modal);
        }

        // MODAL: Banir HWID Globalmente[cite: 1]
        if (interaction.customId === 'abrir_banir_hwid') {
            const modal = new ModalBuilder().setCustomId('modal_banir_hwid').setTitle('Banir HWID');
            const hwidInput = new TextInputBuilder().setCustomId('hwid_string').setLabel('Identificador do HWID').setStyle(TextInputStyle.Short).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(hwidInput));
            await interaction.showModal(modal);
        }

        // AÇÃO DIRETA: Resetar HWID de uma Key[cite: 1]
        if (interaction.customId.startsWith('reset_hwid_')) {
            const targetKey = interaction.customId.replace('reset_hwid_', '');
            await interaction.deferReply({ ephemeral: true });
            try {
                await axios.post(`${API_URL}/admin/reset-hwid`, { adminSecret: senha, key: targetKey });
                await interaction.editReply({ content: `✅ HWIDs resetados para a key \`${targetKey}\`.` });
            } catch (e) { await interaction.editReply({ content: '❌ Erro ao resetar HWID.' }); }
        }

        // AÇÃO DIRETA: Deletar uma Key[cite: 1]
        if (interaction.customId.startsWith('del_key_')) {
            const targetKey = interaction.customId.replace('del_key_', '');
            await interaction.deferReply({ ephemeral: true });
            try {
                await axios.post(`${API_URL}/admin/delete-key`, { adminSecret: senha, key: targetKey });
                await interaction.editReply({ content: `✅ Key \`${targetKey}\` deletada com sucesso.` });
            } catch (e) { await interaction.editReply({ content: '❌ Erro ao deletar Key.' }); }
        }
    }

    // ==========================================
    // PROCESSAMENTO DE MODAIS (FORMULÁRIOS)
    // ==========================================
    if (interaction.isModalSubmit()) {
        const senha = activeSessions.get(interaction.user.id);
        if (!senha) return interaction.reply({ content: '⚠️ Sua sessão expirou.', ephemeral: true });

        // SUBMIT: Gerar Key[cite: 1]
        if (interaction.customId === 'modal_gerar_key') {
            await interaction.deferReply({ ephemeral: true });
            const horas = parseInt(interaction.fields.getTextInputValue('horas'));
            const maxHwids = parseInt(interaction.fields.getTextInputValue('max_hwid'));

            try {
                const res = await axios.post(`${API_URL}/admin/generate`, { adminSecret: senha, hours: horas, maxHwids: maxHwids });
                if (res.data.key) {
                    await interaction.editReply({ content: `✅ **Key Gerada com Sucesso!**\n\`\`\`\n${res.data.key}\n\`\`\`` });
                } else {
                    await interaction.editReply({ content: '❌ Falha ao gerar key.' });
                }
            } catch (e) { await interaction.editReply({ content: '❌ Erro na API.' }); }
        }

        // SUBMIT: Buscar Key e Mostrar Opções de Gerenciamento[cite: 1]
        if (interaction.customId === 'modal_buscar_key') {
            await interaction.deferReply({ ephemeral: true });
            const keyString = interaction.fields.getTextInputValue('key_string');

            try {
                const res = await axios.post(`${API_URL}/admin/list-keys`, { adminSecret: senha });
                const keyInfo = res.data.keys.find(k => k.key === keyString);

                if (!keyInfo) return interaction.editReply({ content: '❌ Key não encontrada no banco de dados.' });

                const embed = new EmbedBuilder()
                    .setTitle('⚙️ Gerenciamento de Key')
                    .setColor('#dc2626')
                    .addFields(
                        { name: 'Identificação', value: `\`${keyInfo.key}\`` },
                        { name: 'Expiração', value: keyInfo.expires, inline: true },
                        { name: 'HWIDs', value: `${keyInfo.hwids.length} / ${keyInfo.maxHwids}`, inline: true }
                    );

                const row = new ActionRowBuilder().addComponents(
                    new ButtonBuilder().setCustomId(`reset_hwid_${keyInfo.key}`).setLabel('Resetar Todos HWIDs').setStyle(ButtonStyle.Secondary).setEmoji('🔌'),
                    new ButtonBuilder().setCustomId(`del_key_${keyInfo.key}`).setLabel('Deletar Key').setStyle(ButtonStyle.Danger).setEmoji('🗑️')
                );

                await interaction.editReply({ embeds: [embed], components: [row] });
            } catch (e) { await interaction.editReply({ content: '❌ Erro ao buscar dados da key.' }); }
        }

        // SUBMIT: Banir HWID[cite: 1]
        if (interaction.customId === 'modal_banir_hwid') {
            await interaction.deferReply({ ephemeral: true });
            const hwidString = interaction.fields.getTextInputValue('hwid_string');
            try {
                await axios.post(`${API_URL}/admin/ban-hwid`, { adminSecret: senha, hwid: hwidString });
                await interaction.editReply({ content: `🔨 HWID \`${hwidString}\` banido com sucesso.` });
            } catch (e) { await interaction.editReply({ content: '❌ Erro ao banir HWID.' }); }
        }
    }
});

client.login(process.env.DISCORD_TOKEN);