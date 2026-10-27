const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const supabase = require('../db');
const config = require('../config');
const points = require('../points');

const P = config.points;

module.exports = {
  data: new SlashCommandBuilder().setName('points').setDescription('Check your point balance'),
  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const uid = interaction.user.id;
    const { data: u } = await supabase.from('users').select('points').eq('user_id', uid).maybeSingle();
    const { data: d } = await supabase
      .from('daily_stats')
      .select('*')
      .eq('user_id', uid)
      .eq('day', points.today())
      .maybeSingle();

    const earned = d ? d.msg_pts + d.react_pts + d.quality_pts : 0;
    const lines = [
      `💰 Balance: **${u?.points ?? 0}** points`,
      `📅 Earned today: **${earned}/${P.dailyCap}** (message ${d?.msg_pts || 0}/${P.messageCap}, reaction ${d?.react_pts || 0}/${P.reactionCap}, quality ${d?.quality_pts || 0}/${P.qualityCap})`,
      `💬 Valid messages today: ${d?.msg_count || 0}`,
      `_Quality bonus is awarded at night. The top 1 earns +${P.topBonus} extra._`,
    ];
    await interaction.editReply(lines.join('\n'));
  },
};
