const { PermissionFlagsBits } = require('discord.js');
const guilds = require('./guilds');

function isAdmin(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  const adminRoleId = guilds.settings(interaction).adminRoleId; // HΛVØCZ: ADMIN_ROLE_ID, other servers: none
  if (adminRoleId && interaction.member?.roles?.cache?.has(adminRoleId)) return true;
  return false;
}

async function getTextChannel(client, id) {
  if (!id) return null;
  try {
    const ch = await client.channels.fetch(id);
    return ch && ch.isTextBased() ? ch : null;
  } catch {
    return null;
  }
}

module.exports = { isAdmin, getTextChannel };
