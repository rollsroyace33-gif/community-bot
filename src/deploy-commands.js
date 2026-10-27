// Run once (and again whenever you change a command):  npm run deploy
const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
const config = require('./config');

const dir = path.join(__dirname, 'commands');
const body = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith('.js'))
  .map((f) => require(path.join(dir, f)).data.toJSON());

const rest = new REST({ version: '10' }).setToken(config.token);
rest
  .put(Routes.applicationGuildCommands(config.clientId, config.guildId), { body })
  .then(() => console.log(`Registered ${body.length} commands.`))
  .catch(console.error);
