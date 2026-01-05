import { SlashCommandBuilder } from 'discord.js';

export function buildTivoqCommand() {
  return new SlashCommandBuilder()
    .setName('tivoq')
    .setDescription('Tivoq Debate League')
    .addSubcommand((sub) =>
      sub
        .setName('help')
        .setDescription('Show how this bot works and the recommended setup/testing flow.')
    )
    .addSubcommand((sub) =>
      sub
        .setName('invite')
        .setDescription('Get the bot invite link for installing in another server.')
    )
    .addSubcommand((sub) =>
      sub
        .setName('doctor')
        .setDescription('Self-test: check configuration and permissions for this server.')
    )
    .addSubcommand((sub) =>
      sub
        .setName('link_host')
        .setDescription('Link this Discord server to a Tivoq host account (UUID).')
        .addStringOption((opt) =>
          opt
            .setName('host_user_id')
            .setDescription('Tivoq host user UUID')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('link_host_from_link')
        .setDescription('Link host by pasting a Tivoq room link (auto-detects host UUID).')
        .addStringOption((opt) =>
          opt
            .setName('room_link')
            .setDescription('Tivoq room link (or room id) that belongs to the host')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('set_channel')
        .setDescription('Set the default channel for posts.')
        .addChannelOption((opt) =>
          opt
            .setName('channel')
            .setDescription('Channel to post debate links')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('callin')
        .setDescription('Start a host + challenger call-in debate room.')
        .addStringOption((opt) =>
          opt
            .setName('topic')
            .setDescription('Debate topic')
            .setRequired(true)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('duration')
            .setDescription('Room duration in minutes (60/120/180)')
            .setRequired(false)
            .addChoices(
              { name: '60', value: 60 },
              { name: '120', value: 120 },
              { name: '180', value: 180 }
            )
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('duel')
        .setDescription('Start a 1v1 main event (creator room with max queue size 1).')
        .addUserOption((opt) =>
          opt
            .setName('opponent')
            .setDescription('Opponent')
            .setRequired(true)
        )
        .addStringOption((opt) =>
          opt
            .setName('topic')
            .setDescription('Debate topic')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('end')
        .setDescription('End the active room started by the bot.')
        .addStringOption((opt) =>
          opt
            .setName('room_id')
            .setDescription('Override the roomId to end (if bot tracking is missing)')
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('next')
        .setDescription('Advance to the next challenger in the active Creator Room queue.')
        .addStringOption((opt) =>
          opt
            .setName('room_id')
            .setDescription('Override the roomId to advance (if bot tracking is missing)')
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('status')
        .setDescription("Show this server's current Tivoq bot configuration.")
    )
    .addSubcommand((sub) =>
      sub
        .setName('clear_room')
        .setDescription('Clear the tracked active room for this server (keeps host and channel settings).')
    )
    .addSubcommand((sub) =>
      sub
        .setName('allow_multi')
        .setDescription('Allow multiple concurrent rooms for this server (advanced).')
        .addBooleanOption((opt) =>
          opt
            .setName('enable')
            .setDescription('Enable (true) or disable (false) multiple rooms')
            .setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('reset')
        .setDescription("Reset this server's Tivoq bot configuration (host/channel/room tracking).")
    )
    .addSubcommand((sub) =>
      sub
        .setName('champion')
        .setDescription('Set the current champion (assigns Champion role).')
        .addUserOption((opt) =>
          opt
            .setName('user')
            .setDescription('Champion user')
            .setRequired(true)
        )
    );
}
