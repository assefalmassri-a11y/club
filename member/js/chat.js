import { sb } from '../../js/supa.js';
import { state } from '../../js/state.js';
import { render as renderChat } from '../../js/views/chat.js';
import { me } from './ctx.js';

// Members reuse the staff chat view, opened on their own support conversation.
export async function render(box) {
  const { data, error } = await sb.rpc('open_support_conversation', { p_member: me.member.id });
  if (error) throw error;
  state.openConversation = data;
  return renderChat(box);
}
