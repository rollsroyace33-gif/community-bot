const { PermissionFlagsBits } = require('discord.js');
const config = require('./config');

function isAdmin(interaction) {
  if (interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return true;
  if (config.adminRoleId && interaction.member?.roles?.cache?.has(config.adminRoleId)) return true;
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
