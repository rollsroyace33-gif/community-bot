const { SlashCommandBuilder } = require('discord.js');
const supabase = require('../db');

module.exports = {
  data: new SlashCommandBuilder().setName('leaderboard').setDescription('Top 10 point holders'),
  async execute(interaction) {
    await interaction.deferReply();
    const { data } = await supabase
      .from('users')
      .select('user_id,points')
      .gt('points', 0)
      .order('points', { ascending: false })
      .limit(10);
    if (!data || data.length === 0) return interaction.editReply('No one has any points yet.');
    const medals = ['🥇', '🥈', '🥉'];
    const lines = data.map((r, i) => `${medals[i] || `**${i + 1}.**`} <@${r.user_id}> — ${r.points}`);
    await interaction.editReply({ content: `🏆 **Leaderboard**\n${lines.join('\n')}`, allowedMentions: { parse: [] } });
  },
};
