import 'dotenv/config';
import { REST, Routes } from 'discord.js';

import { buildTivoqCommand } from './src/tivoq-command.js';

function requiredEnv(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

const token = requiredEnv('DISCORD_TOKEN');
const clientId = requiredEnv('DISCORD_CLIENT_ID');
const guildId = String(process.env.DISCORD_GUILD_ID || '').trim();

const commands = [buildTivoqCommand().toJSON()];

const rest = new REST({ version: '10' }).setToken(token);

async function main() {
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: commands });
    console.log(`✅ Registered guild commands for ${guildId}`);
    return;
  }

  await rest.put(Routes.applicationCommands(clientId), { body: commands });
  console.log('✅ Registered global commands');
}

main().catch((err) => {
  console.error('❌ Command registration failed:', err);
  process.exitCode = 1;
});
