// /automod: switch each auto mod rule on or off for THIS server, choose the action, and manage the
// blocked words and allowed link lists. Admins only. Every rule is off until switched on.
// Scam protection (src/scam.js) has its own subcommands: scam, scamphrase, trustrole, and test (a dry run).
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const guilds = require('../guilds');
const automod = require('../automod');
const scam = require('../scam');

const ruleChoices = Object.entries(automod.RULES).map(([value, name]) => ({ name, value }));
const cleanDomain = (d) => String(d || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('[Admin] Auto moderation rules for this server')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('status').setDescription('Show which rules are on'))
    .addSubcommand((s) =>
      s
        .setName('rule')
        .setDescription('Switch one rule on or off')
        .addStringOption((o) => o.setName('name').setDescription('Rule').setRequired(true).addChoices(...ruleChoices))
        .addBooleanOption((o) => o.setName('on').setDescription('true = on, false = off').setRequired(true))
    )
    .addSubcommand((s) =>
      s
        .setName('action')
        .setDescription('What happens when a rule is broken')
        .addStringOption((o) =>
          o.setName('type').setDescription('Action').setRequired(true).addChoices({ name: 'Delete the message', value: 'delete' }, { name: 'Delete + warn', value: 'warn' }, { name: 'Delete + warn + timeout', value: 'timeout' })
        )
        .addIntegerOption((o) => o.setName('timeout_minutes').setDescription('Timeout length in minutes (default 10)').setMinValue(1).setMaxValue(40320))
    )
    .addSubcommand((s) => s.setName('blockword').setDescription('Add a word or phrase to the blocked list').addStringOption((o) => o.setName('word').setDescription('Word or phrase').setRequired(true).setMaxLength(60)))
    .addSubcommand((s) => s.setName('unblockword').setDescription('Remove a word from the blocked list').addStringOption((o) => o.setName('word').setDescription('Word or phrase').setRequired(true).setMaxLength(60)))
    .addSubcommand((s) => s.setName('allowlink').setDescription('Add a site to the allowed links list').addStringOption((o) => o.setName('domain').setDescription('e.g. x.com').setRequired(true).setMaxLength(100)))
    .addSubcommand((s) => s.setName('removelink').setDescription('Remove a site from the allowed links list').addStringOption((o) => o.setName('domain').setDescription('e.g. x.com').setRequired(true).setMaxLength(100)))
    .addSubcommand((s) =>
      s
        .setName('scam')
        .setDescription('Scam protection: on / off and what Vexo does with scammers')
        .addBooleanOption((o) => o.setName('on').setDescription('true = on, false = off'))
        .addStringOption((o) =>
          o.setName('mode').setDescription('What Vexo does').addChoices({ name: 'Auto: delete, kick or ban scammers', value: 'auto' }, { name: 'Alert only: never kick or ban, ask the admins', value: 'alert' })
        )
    )
    .addSubcommand((s) =>
      s
        .setName('scamphrase')
        .setDescription('Add or remove an extra phrase that always counts as a scam')
        .addStringOption((o) => o.setName('phrase').setDescription('Phrase (at least 4 characters)').setRequired(true).setMinLength(4).setMaxLength(80))
        .addBooleanOption((o) => o.setName('remove').setDescription('true = remove it from the list'))
    )
    .addSubcommand((s) =>
      s
        .setName('trustrole')
        .setDescription('Add or remove a trusted role (its members are never checked for scams)')
        .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true))
        .addBooleanOption((o) => o.setName('remove').setDescription('true = remove it from the list'))
    )
    .addSubcommand((s) =>
      s
        .setName('test')
        .setDescription('Dry run: show what scam protection WOULD do with a text. Nothing is deleted, nobody is touched')
        .addStringOption((o) => o.setName('text').setDescription('The message text to test').setRequired(true).setMaxLength(1500))
    ),
  async execute(interaction) {
    const eph = { flags: MessageFlags.Ephemeral };
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return interaction.reply({ content: 'Admins only.', ...eph });
    await interaction.deferReply(eph);
    const guildId = guilds.gid(interaction);
    if (!guilds.get(guildId)) return interaction.editReply('This server is not set up yet. Run /setup first.');
    const sub = interaction.options.getSubcommand();
    const cur = automod.rules(guildId);
    const save = (patch) => guilds.patchSettings(guildId, { automod: patch });

    const status = () => {
      const r = automod.rules(guildId);
      const lines = Object.entries(automod.RULES).map(([k, name]) => `${r[k] === true ? '✅ on ' : '⬜ off'}  ${name}`);
      return [
        '**Auto mod**',
        ...lines,
        `Action: **${r.action}**${r.action === 'timeout' ? ` (${r.timeoutMinutes} min)` : ''}`,
        `Blocked words (${r.blockedWords.length}): ${r.blockedWords.length ? `||${r.blockedWords.join(', ')}||` : 'none'}`,
        `Allowed link sites (${r.allowedDomains.length}): ${r.allowedDomains.join(', ') || 'none'} (Discord, Tenor and Giphy are always allowed)`,
        'Admins, moderators and the boss are never moderated. Actions are logged in the logs channel.',
        '',
        '**Scam protection**',
        ...scamLines(),
      ].join('\n');
    };
    const scamLines = () => {
      const c = scam.settings(guildId);
      return [
        `${c.enabled ? '✅ on ' : '⬜ off'}  mode: **${c.mode === 'alert' ? 'alert only (never kicks or bans, asks the admins)' : 'auto (deletes, kicks or bans scammers)'}**`,
        `Extra scam phrases (${c.blockedPhrases.length}): ${c.blockedPhrases.length ? `||${c.blockedPhrases.join(' · ')}||` : 'none'}`,
        `Trusted roles (never checked): ${c.trustedRoleIds.length ? c.trustedRoleIds.map((id) => `<@&${id}>`).join(', ') : 'none'}`,
        'Sites on the allowed links list above are never treated as scam links. Try a text safely with `/automod test`.',
        ...(c.enabled ? [scam.permissionWarning(interaction.guild), 'My **Vexo** role must be above the member roles (Server Settings > Roles), or I cannot kick or ban.'].filter(Boolean) : []),
      ];
    };

    if (sub === 'test') {
      const { res, would } = await scam.dryRun(interaction.options.getString('text'), guildId);
      const c = scam.settings(guildId);
      return interaction.editReply({
        content: [
          '**Dry run** (as if a normal member posted it; nothing was deleted and nobody was touched)',
          would,
          res.level === 'clean' && !res.rule ? '' : `Why: ${scam.RULE_NAMES[res.rule] || 'Scam check'}: ${res.reason}`,
          res.level === 'clean' && !res.rule ? '' : `Confidence: ${Math.round((res.confidence || 0) * 100)}% (${res.source === 'AI' ? 'AI check, counted as 1 AI call' : 'rules, no AI used'})`,
          c.enabled ? '' : 'ℹ️ Scam protection is **off** in this server right now, so in real chat nothing would happen. Turn it on with `/automod scam on:true`.',
        ].filter(Boolean).join('\n').slice(0, 1900),
        allowedMentions: { parse: [] },
      });
    }
    if (sub === 'scam') {
      const patch = {};
      const on = interaction.options.getBoolean('on');
      const mode = interaction.options.getString('mode');
      if (on !== null && on !== undefined) patch.enabled = on;
      if (mode) patch.mode = mode;
      if (Object.keys(patch).length) await guilds.patchSettings(guildId, { scam: patch });
    } else if (sub === 'scamphrase') {
      const phrase = interaction.options.getString('phrase').replace(/\s+/g, ' ').trim().toLowerCase();
      if (phrase.length < 4) return interaction.editReply('The phrase must be at least 4 characters, so normal words are not caught by accident.');
      const list = scam.settings(guildId).blockedPhrases.filter((p) => p !== phrase);
      if (!interaction.options.getBoolean('remove')) {
        if (list.length >= 100) return interaction.editReply('The scam phrases list is full (100).');
        list.push(phrase);
      }
      await guilds.patchSettings(guildId, { scam: { blockedPhrases: list } });
    } else if (sub === 'trustrole') {
      const role = interaction.options.getRole('role');
      const list = scam.settings(guildId).trustedRoleIds.filter((id) => id !== role.id);
      if (!interaction.options.getBoolean('remove')) {
        if (role.id === interaction.guildId) return interaction.editReply('@everyone cannot be a trusted role: that would switch scam protection off for everybody.');
        if (list.length >= 25) return interaction.editReply('The trusted roles list is full (25).');
        list.push(role.id);
      }
      await guilds.patchSettings(guildId, { scam: { trustedRoleIds: list } });
    }

    if (sub === 'rule') {
      await save({ [interaction.options.getString('name')]: interaction.options.getBoolean('on') });
    } else if (sub === 'action') {
      const patch = { action: interaction.options.getString('type') };
      const mins = interaction.options.getInteger('timeout_minutes');
      if (mins) patch.timeoutMinutes = mins;
      await save(patch);
    } else if (sub === 'blockword' || sub === 'unblockword') {
      const word = interaction.options.getString('word').trim().toLowerCase();
      const list = cur.blockedWords.filter((w) => w !== word);
      if (sub === 'blockword') {
        if (list.length >= 200) return interaction.editReply('The blocked words list is full (200).');
        list.push(word);
      }
      await save({ blockedWords: list });
    } else if (sub === 'allowlink' || sub === 'removelink') {
      const domain = cleanDomain(interaction.options.getString('domain'));
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) return interaction.editReply('That does not look like a site name. Example: `x.com`');
      const list = cur.allowedDomains.filter((d) => d !== domain);
      if (sub === 'allowlink') {
        if (list.length >= 100) return interaction.editReply('The allowed links list is full (100).');
        list.push(domain);
      }
      await save({ allowedDomains: list });
    }
    return interaction.editReply({ content: status().slice(0, 1900), allowedMentions: { parse: [] } });
  },
};
