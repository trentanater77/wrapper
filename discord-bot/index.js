import 'dotenv/config';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  PermissionsBitField,
  REST,
  Routes,
} from 'discord.js';

import { ConfigStore } from './src/config-store.js';
import { buildTivoqLinks, TivoqApi } from './src/tivoq-api.js';
import { buildTivoqCommand } from './src/tivoq-command.js';

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function isUuid(value) {
  const v = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function extractRoomIdFromInput(raw) {
  const value = String(raw || '').trim();
  if (!value) return '';

  // If the user pasted only a room id, accept it.
  if (!value.includes('http://') && !value.includes('https://') && !value.includes('?')) {
    return value;
  }

  try {
    const url = new URL(value);
    const roomId = url.searchParams.get('room') || url.searchParams.get('roomId') || url.searchParams.get('room_id');
    return String(roomId || '').trim();
  } catch {
    const match = value.match(/[?&]room=([^&#]+)/i) || value.match(/[?&]roomId=([^&#]+)/i) || value.match(/[?&]room_id=([^&#]+)/i);
    if (match && match[1]) {
      try {
        return decodeURIComponent(match[1]).trim();
      } catch {
        return String(match[1] || '').trim();
      }
    }
    return '';
  }
}

function hasManageGuild(interaction) {
  return interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild) ||
    interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator);
}

async function getBotMember(guild) {
  return guild.members.me || guild.members.fetchMe();
}

async function resolvePostChannel({ guild, preferredChannelId, fallbackChannelId, needsEmbed }) {
  const targetChannelId = preferredChannelId || fallbackChannelId;
  const channel = await guild.channels.fetch(targetChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    return { channel: null, error: 'Configured channel is not a text channel (or could not be found).' };
  }

  const me = await getBotMember(guild).catch(() => null);
  if (!me) {
    return { channel: null, error: 'Could not resolve bot guild member (permission check failed).' };
  }

  const perms = channel.permissionsFor(me);
  if (!perms) {
    return { channel: null, error: 'Could not determine bot permissions for the target channel.' };
  }

  const required = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
  ];
  if (needsEmbed) required.push(PermissionsBitField.Flags.EmbedLinks);

  const missing = required.filter((flag) => !perms.has(flag));
  if (missing.length) {
    return { channel: null, error: 'Bot lacks permission to post in the target channel (need View Channel, Send Messages, and Embed Links).' };
  }

  return { channel, error: null };
}

function buildBotInviteUrl({ clientId }) {
  const base = 'https://discord.com/api/oauth2/authorize';
  const perms = new PermissionsBitField([
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.EmbedLinks,
  ]).bitfield.toString();
  const scope = encodeURIComponent('bot applications.commands');
  return `${base}?client_id=${encodeURIComponent(clientId)}&permissions=${encodeURIComponent(perms)}&scope=${scope}`;
}

const guildActionCooldowns = new Map();
function isOnCooldown(guildId, action, ms) {
  const key = `${guildId}:${action}`;
  const now = Date.now();
  const until = guildActionCooldowns.get(key) || 0;
  if (until > now) return { onCooldown: true, seconds: Math.ceil((until - now) / 1000) };
  guildActionCooldowns.set(key, now + ms);
  return { onCooldown: false, seconds: 0 };
}

const token = requiredEnv('DISCORD_TOKEN');
const store = new ConfigStore({ filePath: process.env.BOT_DATA_PATH || 'data.json' });
const tivoq = new TivoqApi({ baseUrl: process.env.TIVOQ_BASE_URL || 'https://tivoq.com' });
const championRoleName = String(process.env.CHAMPION_ROLE_NAME || 'Tivoq Champion');
const autoRegisterEnabled = String(process.env.DISCORD_AUTO_REGISTER || '').trim() === '1';

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

async function maybeAutoRegisterCommands() {
  if (!autoRegisterEnabled) return;

  const clientId = requiredEnv('DISCORD_CLIENT_ID');
  const guildId = String(process.env.DISCORD_GUILD_ID || '').trim();

  const rest = new REST({ version: '10' }).setToken(token);
  const commands = [buildTivoqCommand().toJSON()];

  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log(`✅ Auto-registered guild commands for ${guildId}`);
    return;
  }

  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  console.log('✅ Auto-registered global commands');
}

async function ensureChampionRole(guild, cachedRoleId) {
  if (cachedRoleId) {
    const existing = await guild.roles.fetch(cachedRoleId).catch(() => null);
    if (existing) return existing;
  }

  const byNameCached = guild.roles.cache.find((r) => r.name === championRoleName) || null;
  if (byNameCached) return byNameCached;
  const allRoles = await guild.roles.fetch().catch(() => null);
  const byNameFetched = allRoles?.find?.((r) => r.name === championRoleName) || null;
  if (byNameFetched) return byNameFetched;

  const created = await guild.roles.create({
    name: championRoleName,
    color: 0xF59E0B,
    mentionable: false,
    reason: 'Tivoq Debate League champion role',
  });
  return created;
}

function buildCallinEmbed({ topic, guildName, createdBy }) {
  return new EmbedBuilder()
    .setTitle('Live Call-In Debate')
    .setDescription(
      `${topic}\n\n` +
        `**Challengers:** click **Join as Challenger** to enter the queue.\n` +
        `**Viewers:** click **Watch** to spectate.\n` +
        `Only **one challenger is live at a time**.`
    )
    .setColor(0xE63946)
    .addFields(
      { name: 'Server', value: guildName || 'Unknown', inline: true },
      { name: 'Started by', value: createdBy || 'Unknown', inline: true },
    )
    .setFooter({ text: 'Tivoq Debate League' });
}

function buildDuelEmbed({ topic, guildName, aName, bName }) {
  return new EmbedBuilder()
    .setTitle('1v1 Main Event')
    .setDescription(
      `${topic}\n\n` +
        `This is a **1v1** format (max queue size 1).\n` +
        `Spectators should click **Watch**.`
    )
    .setColor(0x111827)
    .addFields(
      { name: 'Debater A', value: aName || 'Unknown', inline: true },
      { name: 'Debater B', value: bName || 'Unknown', inline: true },
      { name: 'Server', value: guildName || 'Unknown', inline: false },
    )
    .setFooter({ text: 'Tivoq Debate League' });
}

function buildLinkRow({ joinUrl, spectateUrl, hostUrl }) {
  const row = new ActionRowBuilder();
  if (joinUrl) {
    row.addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Join as Challenger')
        .setURL(joinUrl)
    );
  }
  if (spectateUrl) {
    row.addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Watch')
        .setURL(spectateUrl)
    );
  }
  if (hostUrl) {
    row.addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel('Host Controls')
        .setURL(hostUrl)
    );
  }
  return row;
}

client.once('ready', () => {
  console.log(`✅ Discord bot ready as ${client.user?.tag || 'unknown'}`);
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'tivoq') return;

  const sub = interaction.options.getSubcommand();
  const guildId = interaction.guildId;
  if (!guildId || !interaction.guild) {
    await interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
    return;
  }

  try {
    if (sub === 'help') {
      await interaction.reply({
        ephemeral: true,
        content:
          `**Tivoq Discord Bot — Quick Start**\n` +
          `1) /tivoq link_host_from_link (server admin)\n` +
          `2) /tivoq set_channel (choose where match cards post)\n` +
          `3) /tivoq callin topic:"..." (posts buttons)\n` +
          `4) /tivoq next (advance challenger)\n` +
          `5) /tivoq end (end the room)\n\n` +
          `**Buttons**\n` +
          `- Join as Challenger = enter the queue (participants)\n` +
          `- Watch = spectators\n` +
          `- Host Controls = shown privately to server admins when starting a room\n\n` +
          `Run /tivoq doctor to self-test your setup.`
      });
      return;
    }

    if (sub === 'invite') {
      const clientId = String(process.env.DISCORD_CLIENT_ID || '').trim();
      if (!clientId) {
        await interaction.reply({ content: 'Missing DISCORD_CLIENT_ID env var (needed to generate an invite link).', ephemeral: true });
        return;
      }
      const url = buildBotInviteUrl({ clientId });
      await interaction.reply({
        ephemeral: true,
        content:
          `**Invite Tivoq Debate League to another server:**\n${url}\n\n` +
          `During the invite, make sure the scope includes **applications.commands** and the bot has permission to post in your chosen channel.`
      });
      return;
    }

    if (sub === 'doctor') {
      const cfg = await store.getGuild(guildId);
      const guild = interaction.guild;
      const me = await getBotMember(guild).catch(() => null);
      const canManageRoles = me?.permissions?.has?.(PermissionsBitField.Flags.ManageRoles) ? 'yes' : 'no';

      const resolved = await resolvePostChannel({
        guild,
        preferredChannelId: cfg.channelId,
        fallbackChannelId: interaction.channelId,
        needsEmbed: true,
      });

      const channelStatus = resolved.channel
        ? `ok → <#${resolved.channel.id}>`
        : `not ok → ${resolved.error}`;

      const nextSteps = [
        !cfg.hostUserId ? 'Run `/tivoq link_host_from_link room_link:<tivoq room link>`' : null,
        !cfg.channelId ? 'Run `/tivoq set_channel channel:#your-channel`' : null,
      ].filter(Boolean);

      await interaction.reply({
        ephemeral: true,
        content:
          `**Tivoq bot doctor**\n` +
          `Host linked: ${cfg.hostUserId ? 'yes' : 'no'}\n` +
          `Default channel set: ${cfg.channelId ? 'yes' : 'no'}\n` +
          `Post permissions: ${channelStatus}\n` +
          `Manage Roles (for /tivoq champion): ${canManageRoles}\n` +
          `Active room tracked: ${cfg.lastRoomId ? 'yes' : 'no'}\n` +
          `TIVOQ_BASE_URL: ${String(process.env.TIVOQ_BASE_URL || 'https://tivoq.com')}\n` +
          (nextSteps.length ? `\n**Next steps**\n- ${nextSteps.join('\n- ')}` : '')
      });
      return;
    }

    if (sub === 'link_host') {
      if (!hasManageGuild(interaction)) {
        await interaction.reply({ content: 'You need Manage Server to do that.', ephemeral: true });
        return;
      }

      const hostUserId = interaction.options.getString('host_user_id', true).trim();
      if (!isUuid(hostUserId)) {
        await interaction.reply({ content: 'That does not look like a valid UUID.', ephemeral: true });
        return;
      }

      await store.setGuild(guildId, { hostUserId });
      await interaction.reply({ content: `✅ Linked host userId for this server.`, ephemeral: true });
      return;
    }

    if (sub === 'link_host_from_link') {
      if (!hasManageGuild(interaction)) {
        await interaction.reply({ content: 'You need Manage Server to do that.', ephemeral: true });
        return;
      }

      const raw = interaction.options.getString('room_link', true);
      const roomId = extractRoomIdFromInput(raw);
      if (!roomId) {
        await interaction.reply({
          ephemeral: true,
          content:
            'Could not extract a room id from that input. Paste a full Tivoq link like `https://tivoq.com/index.html?room=...` or just paste the room id itself.',
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      const lookup = await tivoq.getRoom(roomId);
      const room = lookup?.room || null;
      const hostUserId = String(room?.host_id || room?.hostId || '').trim();
      if (!isUuid(hostUserId)) {
        await interaction.editReply({
          content:
            `Could not find a valid host UUID for roomId: \`${roomId}\`.\n` +
            `Make sure the room is a Creator Room created by the host (not expired/ended), then try again.`,
        });
        return;
      }

      await store.setGuild(guildId, { hostUserId });
      await interaction.editReply({
        content:
          `✅ Linked host for this server.\n` +
          `Host UUID: \`${hostUserId.slice(0, 8)}…${hostUserId.slice(-6)}\`\n` +
          `Next: run \`/tivoq set_channel\` to choose where match cards post.`,
      });
      return;
    }

    if (sub === 'set_channel') {
      if (!hasManageGuild(interaction)) {
        await interaction.reply({ content: 'You need Manage Server to do that.', ephemeral: true });
        return;
      }
      const channel = interaction.options.getChannel('channel', true);
      await store.setGuild(guildId, { channelId: channel.id });
      await interaction.reply({ content: `✅ Set default channel to <#${channel.id}>`, ephemeral: true });
      return;
    }

    if (sub === 'callin') {
      if (!hasManageGuild(interaction)) {
        await interaction.reply({ content: 'You need Manage Server to start a debate.', ephemeral: true });
        return;
      }

      const cfg = await store.getGuild(guildId);
      if (!cfg.hostUserId) {
        await interaction.reply({ content: 'This server is not linked to a Tivoq host yet. Use `/tivoq link_host_from_link` (recommended) or `/tivoq link_host`.', ephemeral: true });
        return;
      }

      if (cfg.lastRoomId && !cfg.allowMultiRooms) {
        await interaction.reply({ content: 'A room is already active for this server. Use `/tivoq end` (or `/tivoq reset` if the room is gone) before starting a new one.', ephemeral: true });
        return;
      }

      const cd = isOnCooldown(guildId, 'callin', 30_000);
      if (cd.onCooldown) {
        await interaction.reply({ content: `Please wait ${cd.seconds}s before starting another call-in.`, ephemeral: true });
        return;
      }

      const topic = interaction.options.getString('topic', true).trim().slice(0, 240);
      const duration = interaction.options.getInteger('duration', false);

      await interaction.deferReply({ ephemeral: true });

      const roomId = `d-${guildId}-${Date.now().toString(36)}`;
      const payload = {
        action: 'create',
        roomId,
        hostId: cfg.hostUserId,
        hostName: interaction.user.username,
        roomType: 'creator',
        isCreatorRoom: true,
        topic,
        ...(duration ? { sessionDurationMinutes: duration } : {}),
      };

      const created = await tivoq.manageRoom(payload);
      const inviteLink = created?.inviteLink || '';
      if (!inviteLink) {
        throw new Error('Tivoq did not return an invite link for this room.');
      }
      const { hostLink, challengerLink, spectatorLink } = buildTivoqLinks({ inviteLink, roomType: 'creator', host: true });

      await store.setGuild(guildId, { lastRoomId: roomId, lastInviteLink: inviteLink, lastRoomType: 'creator', lastRoomCreatedAt: Date.now() });

      const embed = buildCallinEmbed({
        topic,
        guildName: interaction.guild.name,
        createdBy: interaction.user.tag,
      });

      const row = buildLinkRow({ joinUrl: challengerLink, spectateUrl: spectatorLink, hostUrl: null });

      const resolved = await resolvePostChannel({
        guild: interaction.guild,
        preferredChannelId: cfg.channelId,
        fallbackChannelId: interaction.channelId,
        needsEmbed: true,
      });

      if (!resolved.channel) {
        await interaction.editReply({
          content:
            `⚠️ Could not post in the configured channel. ${resolved.error}\n` +
            `Here are the links so you can paste them manually:\n` +
            `Host: ${hostLink}\n` +
            `Join as Challenger: ${challengerLink}\n` +
            `Watch: ${spectatorLink}`,
          ephemeral: true,
        });
        return;
      }

      await resolved.channel.send({ embeds: [embed], components: row.components.length ? [row] : [] });
      await interaction.editReply({
        content:
          `✅ Posted the debate links.\n` +
          `**Host Controls (admin only):** ${hostLink}`,
        ephemeral: true,
      });
      return;
    }

    if (sub === 'duel') {
      if (!hasManageGuild(interaction)) {
        await interaction.reply({ content: 'You need Manage Server to start a duel.', ephemeral: true });
        return;
      }

      const cfg = await store.getGuild(guildId);
      if (!cfg.hostUserId) {
        await interaction.reply({ content: 'This server is not linked to a Tivoq host yet. Use `/tivoq link_host` first.', ephemeral: true });
        return;
      }

      if (cfg.lastRoomId && !cfg.allowMultiRooms) {
        await interaction.reply({ content: 'A room is already active for this server. Use `/tivoq end` (or `/tivoq reset` if the room is gone) before starting a new one.', ephemeral: true });
        return;
      }

      const cd = isOnCooldown(guildId, 'duel', 30_000);
      if (cd.onCooldown) {
        await interaction.reply({ content: `Please wait ${cd.seconds}s before starting another duel.`, ephemeral: true });
        return;
      }

      const opponent = interaction.options.getUser('opponent', true);
      const topic = interaction.options.getString('topic', true).trim().slice(0, 240);

      await interaction.deferReply({ ephemeral: true });

      const roomId = `duel-${guildId}-${Date.now().toString(36)}`;
      const payload = {
        action: 'create',
        roomId,
        hostId: cfg.hostUserId,
        hostName: interaction.user.username,
        roomType: 'creator',
        isCreatorRoom: true,
        topic,
        maxQueueSize: 1,
      };

      const created = await tivoq.manageRoom(payload);
      const inviteLink = created?.inviteLink || '';
      if (!inviteLink) {
        throw new Error('Tivoq did not return an invite link for this room.');
      }
      const { hostLink, challengerLink, spectatorLink } = buildTivoqLinks({ inviteLink, roomType: 'creator', host: true });

      await store.setGuild(guildId, { lastRoomId: roomId, lastInviteLink: inviteLink, lastRoomType: 'creator', lastRoomCreatedAt: Date.now() });

      const embed = buildDuelEmbed({
        topic,
        guildName: interaction.guild.name,
        aName: interaction.user.tag,
        bName: opponent.tag,
      });

      const row = buildLinkRow({ joinUrl: challengerLink, spectateUrl: spectatorLink, hostUrl: null });

      const resolved = await resolvePostChannel({
        guild: interaction.guild,
        preferredChannelId: cfg.channelId,
        fallbackChannelId: interaction.channelId,
        needsEmbed: true,
      });

      if (!resolved.channel) {
        await interaction.editReply({
          content:
            `⚠️ Could not post in the configured channel. ${resolved.error}\n` +
            `Here are the links so you can paste them manually:\n` +
            `Host: ${hostLink}\n` +
            `Join as Challenger: ${challengerLink}\n` +
            `Watch: ${spectatorLink}`,
          ephemeral: true,
        });
        return;
      }

      await resolved.channel.send({
        content: `Main event: <@${interaction.user.id}> vs <@${opponent.id}>`,
        embeds: [embed],
        components: row.components.length ? [row] : [],
      });

      await interaction.editReply({
        content:
          `✅ Posted the duel links.\n` +
          `**Host Controls (admin only):** ${hostLink}`,
        ephemeral: true,
      });
      return;
    }

    if (sub === 'end') {
      if (!hasManageGuild(interaction)) {
        await interaction.reply({ content: 'You need Manage Server to end a debate.', ephemeral: true });
        return;
      }

      const cfg = await store.getGuild(guildId);
      if (!cfg.hostUserId) {
        await interaction.reply({ content: 'This server is not linked to a Tivoq host yet. Use `/tivoq link_host` first.', ephemeral: true });
        return;
      }

      const overrideRoomId = interaction.options.getString('room_id', false)?.trim();
      const roomIdToEnd = overrideRoomId || cfg.lastRoomId;
      if (!roomIdToEnd) {
        await interaction.reply({ content: 'No active room tracked. Provide `room_id` to end a specific room.', ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      await tivoq.manageRoom({
        action: 'end',
        roomId: roomIdToEnd,
        hostId: cfg.hostUserId,
        reason: 'discord_end',
      });

      if (!overrideRoomId || overrideRoomId === cfg.lastRoomId) {
        await store.setGuild(guildId, { lastRoomId: null, lastInviteLink: null, lastRoomType: null, lastRoomCreatedAt: null });
      }
      await interaction.editReply({ content: '✅ Room ended.', ephemeral: true });
      return;
    }

    if (sub === 'next') {
      if (!hasManageGuild(interaction)) {
        await interaction.reply({ content: 'You need Manage Server to advance the queue.', ephemeral: true });
        return;
      }

      const cfg = await store.getGuild(guildId);
      if (!cfg.hostUserId) {
        await interaction.reply({ content: 'This server is not linked to a Tivoq host yet. Use `/tivoq link_host` first.', ephemeral: true });
        return;
      }

      const overrideRoomId = interaction.options.getString('room_id', false)?.trim();
      const roomIdToAdvance = overrideRoomId || cfg.lastRoomId;
      if (!roomIdToAdvance) {
        await interaction.reply({ content: 'No active room tracked. Provide `room_id` to advance a specific room.', ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const result = await tivoq.manageQueue({
        action: 'next',
        roomId: roomIdToAdvance,
        hostId: cfg.hostUserId,
      });

      const next = result?.nextChallenger || null;
      const resolved = await resolvePostChannel({
        guild: interaction.guild,
        preferredChannelId: cfg.channelId,
        fallbackChannelId: interaction.channelId,
        needsEmbed: false,
      });

      if (resolved.channel) {
        if (!next) {
          await resolved.channel.send({ content: '⏭️ Host advanced the queue — it’s empty right now.' });
        } else {
          const label = next.name || 'Challenger';
          const mins = Math.max(1, Math.round((Number(next.timeLimit || 0) || 0) / 60));
          await resolved.channel.send({ content: `⏭️ Next challenger: ${label} (≈${mins} min)` });
        }
      }

      if (!resolved.channel) {
        await interaction.editReply({ content: `✅ Advanced the queue. (Could not announce in channel: ${resolved.error})`, ephemeral: true });
        return;
      }

      await interaction.editReply({ content: '✅ Advanced the queue.', ephemeral: true });
      return;
    }

    if (sub === 'status') {
      const cfg = await store.getGuild(guildId);
      const channelLine = cfg.channelId ? `<#${cfg.channelId}>` : '(not set)';
      const hostLine = cfg.hostUserId ? `${String(cfg.hostUserId).slice(0, 8)}…` : '(not linked)';
      const roomLine = cfg.lastRoomId ? cfg.lastRoomId : '(none)';
      const linkLine = cfg.lastInviteLink ? cfg.lastInviteLink : '(none)';
      const ageLine = cfg.lastRoomCreatedAt
        ? `${Math.max(0, Math.round((Date.now() - Number(cfg.lastRoomCreatedAt || 0)) / 60000))} min ago`
        : '(n/a)';

      await interaction.reply({
        ephemeral: true,
        content:
          `**Tivoq bot status**\n` +
          `Host: ${hostLine}\n` +
          `Default channel: ${channelLine}\n` +
          `Multi rooms: ${cfg.allowMultiRooms ? 'enabled' : 'disabled'}\n` +
          `Last roomId: ${roomLine}\n` +
          `Last room age: ${ageLine}\n` +
          `Last inviteLink: ${linkLine}\n` +
          `Champion role: ${cfg.championRoleId ? 'set' : '(not set)'}\n` +
          `Champion user: ${cfg.championUserId ? cfg.championUserId : '(none)'}`
      });
      return;
    }

    if (sub === 'clear_room') {
      if (!hasManageGuild(interaction)) {
        await interaction.reply({ content: 'You need Manage Server to do that.', ephemeral: true });
        return;
      }
      await store.setGuild(guildId, { lastRoomId: null, lastInviteLink: null, lastRoomType: null, lastRoomCreatedAt: null });
      await interaction.reply({ content: '✅ Cleared tracked active room for this server.', ephemeral: true });
      return;
    }

    if (sub === 'allow_multi') {
      if (!hasManageGuild(interaction)) {
        await interaction.reply({ content: 'You need Manage Server to do that.', ephemeral: true });
        return;
      }
      const enable = interaction.options.getBoolean('enable', true);
      await store.setGuild(guildId, { allowMultiRooms: !!enable });
      await interaction.reply({ content: enable ? '✅ Multiple rooms enabled. Use `room_id` with /tivoq end and /tivoq next to target a specific room.' : '✅ Multiple rooms disabled (single active room enforced).', ephemeral: true });
      return;
    }

    if (sub === 'reset') {
      if (!hasManageGuild(interaction)) {
        await interaction.reply({ content: 'You need Manage Server to reset the bot config.', ephemeral: true });
        return;
      }
      await store.resetGuild(guildId);
      await interaction.reply({ content: '✅ Reset this server\'s Tivoq bot configuration.', ephemeral: true });
      return;
    }

    if (sub === 'champion') {
      if (!hasManageGuild(interaction)) {
        await interaction.reply({ content: 'You need Manage Server to set the champion.', ephemeral: true });
        return;
      }

      const cfg = await store.getGuild(guildId);
      const target = interaction.options.getUser('user', true);

      await interaction.deferReply({ ephemeral: true });

      const guild = interaction.guild;
      const role = await ensureChampionRole(guild, cfg.championRoleId);
      await store.setGuild(guildId, { championRoleId: role.id });

      const member = await guild.members.fetch(target.id);

      if (cfg.championUserId && cfg.championUserId !== target.id) {
        const prev = await guild.members.fetch(cfg.championUserId).catch(() => null);
        if (prev) {
          await prev.roles.remove(role.id).catch(() => null);
        }
      }

      await member.roles.add(role.id);
      await store.setGuild(guildId, { championUserId: target.id });

      const targetChannelId = cfg.channelId || interaction.channelId;
      const resolved = await resolvePostChannel({
        guild,
        preferredChannelId: targetChannelId,
        fallbackChannelId: interaction.channelId,
        needsEmbed: false,
      });
      if (resolved.channel) {
        await resolved.channel.send({ content: `🏆 New ${championRoleName}: <@${target.id}>` });
      }

      await interaction.editReply({ content: `✅ Champion set to ${target.tag}`, ephemeral: true });
      return;
    }

    await interaction.reply({ content: 'Unknown subcommand.', ephemeral: true });
  } catch (err) {
    console.error('❌ Command failed:', err);
    const msg = err?.message ? String(err.message).slice(0, 1800) : 'Command failed.';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: `❌ ${msg}` }).catch(() => null);
    } else {
      await interaction.reply({ content: `❌ ${msg}`, ephemeral: true }).catch(() => null);
    }
  }
});

async function start() {
  try {
    await maybeAutoRegisterCommands();
  } catch (err) {
    console.error('❌ Auto-register failed (continuing to start bot):', err);
  }

  await client.login(token);
}

start().catch((err) => {
  console.error('❌ Discord login failed:', err);
  process.exitCode = 1;
});
