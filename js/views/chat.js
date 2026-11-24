import { sb } from '../supa.js';
import { state, canManage } from '../state.js';
import { h, clear, button, openForm, toast, guard, fmtDateTime } from '../dom.js';
import { t } from '../i18n.js';
import { MAX_IMAGE_BYTES, CHAT_RETENTION_DAYS } from '../config.js';

const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

export async function render(box) {
  const listEl = h('div', { class: 'conv-list' });
  const threadEl = h('div', { class: 'thread' });
  const head = h('div', { class: 'row between wrap' }, h('h2', null, t('chat.title')),
    canManage() ? h('div', { class: 'row gap' },
      button(t('chat.newStaff'), () => newChannel('create_staff_channel'), 'btn small'),
      button(t('chat.newAnnounce'), () => newChannel('open_announcement_channel'), 'btn small')) : null);
  box.append(head, h('p', { class: 'muted small' }, t('chat.retention', { days: CHAT_RETENTION_DAYS })), h('div', { class: 'chat-layout' }, listEl, threadEl));

  let channel = null;
  let current = null;
  let convs = [];
  const urlCache = new Map();

  async function newChannel(fn) {
    const ok = await openForm({
      title: t('chat.channelTitle'),
      fields: [{ name: 'title', label: t('chat.channelTitle'), required: true, maxlength: 80 }],
      onSubmit: async (v) => {
        const { error } = await sb.rpc(fn, { p_club: state.club.id, p_branch: state.branchId || null, p_title: v.title });
        if (error) throw error;
      },
    });
    if (ok === true) { toast(t('chat.created'), 'ok'); await guard(loadList); }
  }

  async function loadList() {
    const { data, error } = await sb.from('conversations').select('id, kind, title, member_id, created_at').order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    convs = data || [];
    const { data: un } = await sb.from('conversation_unread').select('conversation_id, unread');
    const unread = new Map((un || []).map((u) => [u.conversation_id, u.unread]));
    const ids = convs.filter((c) => c.member_id).map((c) => c.member_id);
    const names = new Map();
    if (ids.length) {
      const { data: ms } = await sb.from('members').select('id, full_name').in('id', ids);
      for (const m of ms || []) names.set(m.id, m.full_name);
    }
    clear(listEl);
    if (!convs.length) { listEl.append(h('p', { class: 'muted' }, t('chat.noConv'))); return; }
    for (const c of convs) {
      const title = c.title || names.get(c.member_id) || t(`chat.kind.${c.kind}`);
      const n = unread.get(c.id) || 0;
      listEl.append(h('button', { type: 'button', class: `conv${current === c.id ? ' active' : ''}`, onclick: () => guard(() => open(c.id, c)) },
        h('strong', null, title), h('span', { class: 'muted small' }, t(`chat.kind.${c.kind}`)), n ? h('span', { class: 'badge bad' }, String(n)) : null));
    }
  }

  async function signed(path) {
    if (urlCache.has(path)) return urlCache.get(path);
    const { data, error } = await sb.storage.from('chat-images').createSignedUrl(path, 600);
    if (error) return null;
    urlCache.set(path, data.signedUrl);
    return data.signedUrl;
  }

  async function bubble(m) {
    const mine = m.sender_user_id === state.session.user.id;
    const img = m.image_path ? h('img', { class: 'chat-img', alt: '', loading: 'lazy' }) : null;
    if (img) signed(m.image_path).then((u) => { if (u) img.src = u; });
    return h('div', { class: `msg${mine ? ' mine' : ''}`, 'data-id': m.id },
      h('div', { class: 'muted small' }, `${m.sender_name || ''} · ${fmtDateTime(m.created_at)}`),
      m.body ? h('div', { class: 'body' }, m.body) : null, img);
  }

  async function open(id, conv) {
    current = id;
    state.openConversation = null;
    if (channel) { await sb.removeChannel(channel); channel = null; }
    clear(threadEl);
    const log = h('div', { class: 'log' });
    const { data, error } = await sb.from('messages').select('id, sender_user_id, sender_name, body, image_path, created_at').eq('conversation_id', id).order('created_at', { ascending: false }).limit(100);
    if (error) throw error;
    for (const m of (data || []).reverse()) log.append(await bubble(m));

    const readOnly = conv && conv.kind === 'announcement' && !canManage();
    const text = h('textarea', { rows: 2, maxlength: 2000, placeholder: t('chat.placeholder'), 'aria-label': t('chat.placeholder') });
    const file = h('input', { type: 'file', accept: Object.keys(IMAGE_TYPES).join(','), class: 'hidden' });
    const send = button(t('chat.send'), () => guard(doSend), 'btn primary');
    async function doSend() {
      const body = text.value.trim();
      const f = file.files[0];
      if (!body && !f) return;
      send.disabled = true;
      try {
        let path = null;
        if (f) {
          if (!IMAGE_TYPES[f.type]) throw new Error(t('chat.imageType'));
          if (f.size > MAX_IMAGE_BYTES) throw new Error(t('chat.imageTooBig'));
          path = `${state.club.id}/${id}/${crypto.randomUUID()}.${IMAGE_TYPES[f.type]}`;
          const { error: ue } = await sb.storage.from('chat-images').upload(path, f, { contentType: f.type, upsert: false });
          if (ue) throw ue;
        }
        const { error: e } = await sb.rpc('send_message', { p_conversation: id, p_body: body || null, p_image_path: path });
        if (e) throw e;
        text.value = ''; file.value = '';
      } finally { send.disabled = false; }
    }
    const composer = readOnly ? h('p', { class: 'muted' }, t('chat.readOnly'))
      : h('div', { class: 'composer' }, text, h('div', { class: 'row gap' }, button(t('chat.attach'), () => file.click(), 'btn small'), file, send));
    threadEl.append(log, composer);
    log.scrollTop = log.scrollHeight;

    channel = sb.channel(`msgs-${id}`).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${id}` }, async (p) => {
      log.append(await bubble(p.new));
      log.scrollTop = log.scrollHeight;
      sb.rpc('mark_read', { p_conversation: id });
    }).subscribe();

    await sb.rpc('mark_read', { p_conversation: id });
    await loadList();
  }

  await loadList();
  if (state.openConversation) await guard(() => open(state.openConversation, convs.find((c) => c.id === state.openConversation)));
  return () => { if (channel) sb.removeChannel(channel); };
}
