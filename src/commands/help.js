// /help: what Vexo can do in this server (locked features are marked).
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, EmbedBuilder } = require('discord.js');
const config = require('../config');
const plans = require('../plans');
const guilds = require('../guilds');
const scam = require('../scam');

module.exports = {
  data: new SlashCommandBuilder().setName('help').setDescription('What Vexo can do in this server'),
  async execute(interaction) {
    const has = (f) => plans.hasFeature(interaction, f);
    const mark = (f) => (has(f) ? '' : ' 🔒');
    const isAdmin = !!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
    const xChannel = guilds.settings(interaction).channels.xDrop;
    const gwChannel = guilds.settings(interaction).channels.giveaway;
    const rfChannel = guilds.getFeatureChannel(interaction, 'raffle');
    const scamOn = scam.settings(interaction).enabled && has('automod');
    const embed = new EmbedBuilder()
      .setTitle('Vexo help')
      .setColor(0x5865f2)
      .setDescription(`I'm Vexo, created by ${config.creatorName}. 🔒 = premium feature that is locked in this server right now.`)
      .addFields(
        { name: 'For everyone', value: [`\`/ask\` ask about this community${mark('knowledgeQa')}`, `\`/points\` your balance · \`/leaderboard\` top 10${mark('points')}`, `Marketplace channel: **Purchase** and **My Points** buttons${mark('marketplace')}`, ...(xChannel ? [`X posts channel <#${xChannel}>: drop your X post link, get ${config.xDrop.points} points${mark('points')}`] : []), ...(scamOn ? ['See a scam? Reply to that message with the word "scam" and I will check it'] : []), `Talk to me: mention me or say "vexo"${mark('aiChat')}`, 'Games: press **Join** on a Rumble Royale, type numbers in a Number Guess Game', `Giveaways${gwChannel ? ` in <#${gwChannel}>` : ''}: press **Join** on a giveaway, one entry per member${mark('giveaway')}`, `Raffles${rfChannel ? ` in <#${rfChannel}>` : ''}: press **Join** / **Buy more tickets** to buy tickets with your points${mark('raffle')}`].join('\n') }
      );
    if (isAdmin) {
      embed.addFields(
        { name: 'Admins: setup', value: '`/setup` channels (incl. the X posts, giveaway, raffle, NFT Radar and SOL Radar channels), game ping role, knowledge source channels, boss, ticket text\n`/status` plan, days left, features, channels' },
        { name: 'Admins: games and giveaways (free)', value: `\`/rumble start|cancel|status\` Rumble Royale\n\`/guess start|cancel|status\` Number Guess Game\n\`/giveaway start|end|reroll|cancel|list\` giveaways with a Join button, optional picture, required role and points prize${mark('giveaway')}` },
        { name: 'Admins: points raffles', value: `\`/raffle create\` title, prize, picture, entry cost in points per ticket (0 = free), winners, duration, max tickets per member, total ticket cap\n\`/raffle end\` draw now · \`/raffle cancel\` cancel and refund everyone · \`/raffle list\`${mark('raffle')}` },
        { name: 'Admins: radar', value: `\`/solradar status|on|off|times|now|preview\` SOL Radar: 4 to 5 SOL market updates a day in the SOL Radar channel${mark('solRadar')}\n\`/nftradar status|pending|preview|run|add|on|off\` NFT Radar: upcoming Solana mints, posted only after an admin presses Approve in the logs channel${mark('nftRadar')}` },
        { name: 'Admins: premium', value: [`\`/knowledge view|refresh|clear\`${mark('knowledgeQa')}`, `\`/automod\` rules on/off, blocked words, allowed links${mark('automod')}`, `\`/automod scam\` scam protection on/off, auto or alert-only · \`/automod scamphrase\` · \`/automod trustrole\` · \`/automod test\` dry run${mark('automod')}`, `\`/additem\` \`/edititem\` \`/removeitem\` \`/listitems\` \`/pending\` \`/refund\` \`/setupmarketplace\`${mark('marketplace')}`, `\`/addpoints\` \`/removepoints\`${mark('points')}`, `Control channel: write orders in plain language ("host a rumble at 8 pm, prize 100 points", "remember: mint is on March 3")${mark('aiChat')}`, `Control channel: "host a giveaway for 1 NFT, 24 hours, 2 winners" (attach a picture if you like)${mark('giveaway_orders')}`].join('\n') }
      );
    }
    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },
};
