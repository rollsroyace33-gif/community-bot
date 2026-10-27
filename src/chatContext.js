// Short-term chat context: the last ~12 messages per channel, so Q&A replies understand
// follow-ups ("and when is that?"). Memory only: never saved anywhere, gone on restart,
// and never treated as facts (members' claims are untrusted).
const MAX_PER_CHANNEL = 12;
const channels = new Map(); // channelId -> ["name: text", ...]

function add(channelId, name, text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!clean) return;
  const list = channels.get(channelId) || [];
  list.push(`${String(name).slice(0, 32)}: ${clean}`);
  if (list.length > MAX_PER_CHANNEL) list.shift();
  channels.set(channelId, list);
}

// a member's message
function record(message) {
  add(message.channelId, message.member?.displayName || message.author.username, message.content);
}

// one of Vexo's own replies
const recordBot = (channelId, text) => add(channelId, 'Vexo', text);

const get = (channelId) => [...(channels.get(channelId) || [])];

module.exports = { record, recordBot, get };
