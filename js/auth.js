import { langControl } from './lang.js';
import { sb } from './supa.js';
import { h, clear, toast, errText } from './dom.js';
import { t } from './i18n.js';

function shell(root, title, ...children) {
  clear(root);
  root.append(h('main', { class: 'auth-card' }, h('h1', { class: 'brand' }, t('app.name')), h('h2', null, title), ...children, h('div', { class: 'list-simple section' }, langControl())));
}

export function showLogin(root) {
  return new Promise((resolve) => {
    let mode = 'login';
    const render = () => {
      const email = h('input', { type: 'email', name: 'email', required: true, autocomplete: 'username', dir: 'ltr' });
      const pass = h('input', { type: 'password', name: 'password', required: true, minlength: 10, autocomplete: mode === 'login' ? 'current-password' : 'new-password', dir: 'ltr' });
      const msg = h('div', { class: 'form-error', role: 'alert' });
      const submit = h('button', { class: 'btn primary block', type: 'submit' }, mode === 'login' ? t('auth.login') : t('auth.signup'));
      const form = h('form', { class: 'form' },
        h('label', { class: 'field' }, h('span', null, t('auth.email')), email),
        h('label', { class: 'field' }, h('span', null, t('auth.password')), pass),
        mode === 'signup' ? h('small', { class: 'muted' }, t('auth.passwordHint')) : null,
        msg, submit);
      form.addEventListener('submit', async (ev) => {
        ev.preventDefault();
        msg.textContent = '';
        if (pass.value.length < 10) { msg.textContent = t('auth.passwordHint'); return; }
        submit.disabled = true;
        try {
          if (mode === 'login') {
            const { error } = await sb.auth.signInWithPassword({ email: email.value.trim(), password: pass.value });
            if (error) throw error;
            resolve();
          } else {
            const { data, error } = await sb.auth.signUp({ email: email.value.trim(), password: pass.value });
            if (error) throw error;
            if (data.session) resolve(); else { msg.textContent = ''; toast(t('auth.checkEmail')); mode = 'login'; render(); }
          }
        } catch (e) {
          msg.textContent = errText(e);
          submit.disabled = false;
        }
      });
      const toggle = h('button', { type: 'button', class: 'link' }, mode === 'login' ? t('auth.signup') : t('auth.login'));
      toggle.addEventListener('click', () => { mode = mode === 'login' ? 'signup' : 'login'; render(); });
      const forgot = mode === 'login' ? h('button', { type: 'button', class: 'link' }, t('auth.forgot')) : null;
      if (forgot) forgot.addEventListener('click', async () => {
        msg.textContent = '';
        if (!email.value.trim()) { msg.textContent = t('auth.forgotEmail'); email.focus(); return; }
        const { error } = await sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: `${location.origin}${location.pathname}` });
        if (error) { msg.textContent = errText(error); return; }
        toast(t('auth.forgotSent'), 'ok');
      });
      shell(root, mode === 'login' ? t('auth.login') : t('auth.signup'), form, forgot, toggle);
    };
    render();
  });
}

async function showMfaChallenge(root, factorId) {
  return new Promise((resolve) => {
    const code = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, pattern: '[0-9]{6}', required: true, dir: 'ltr', class: 'code-input' });
    const msg = h('div', { class: 'form-error', role: 'alert' });
    const submit = h('button', { class: 'btn primary block', type: 'submit' }, t('auth.mfaVerify'));
    const out = h('button', { type: 'button', class: 'link' }, t('auth.signout'));
    out.addEventListener('click', async () => { await sb.auth.signOut(); location.reload(); });
    const form = h('form', { class: 'form' }, h('label', { class: 'field' }, h('span', null, t('auth.mfaCode')), code), msg, submit);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      msg.textContent = '';
      submit.disabled = true;
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code: code.value.trim() });
      if (error) { msg.textContent = errText(error); submit.disabled = false; code.select(); return; }
      resolve();
    });
    shell(root, t('auth.mfaTitle'), form, out);
    code.focus();
  });
}

async function showMfaEnroll(root) {
  // Remove abandoned, never-verified factors so the new enrollment cannot collide with them.
  const { data: list } = await sb.auth.mfa.listFactors();
  for (const f of (list && list.all) || []) {
    if (f.factor_type === 'totp' && f.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: `club-${Date.now()}` });
  if (error) throw error;
  return new Promise((resolve) => {
    const qr = h('img', { class: 'qr', alt: 'QR', width: 200, height: 200 });
    qr.src = data.totp.qr_code; // data: URI generated by Supabase Auth
    const code = h('input', { type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', maxlength: 6, pattern: '[0-9]{6}', required: true, dir: 'ltr', class: 'code-input' });
    const msg = h('div', { class: 'form-error', role: 'alert' });
    const submit = h('button', { class: 'btn primary block', type: 'submit' }, t('auth.mfaVerify'));
    const form = h('form', { class: 'form' },
      h('p', { class: 'muted' }, t('auth.mfaEnrollHelp')),
      h('div', { class: 'center' }, qr),
      h('details', null, h('summary', null, t('auth.mfaSecret')), h('code', { class: 'secret', dir: 'ltr' }, data.totp.secret)),
      h('label', { class: 'field' }, h('span', null, t('auth.mfaCode')), code), msg, submit);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      msg.textContent = '';
      submit.disabled = true;
      const { error: vErr } = await sb.auth.mfa.challengeAndVerify({ factorId: data.id, code: code.value.trim() });
      if (vErr) { msg.textContent = errText(vErr); submit.disabled = false; code.select(); return; }
      resolve();
    });
    shell(root, t('auth.mfaEnrollTitle'), h('p', { class: 'muted' }, t('auth.mfaRequired')), form);
    code.focus();
  });
}

// Resolves with the session once the user is signed in AND has passed MFA (aal2).
export async function gate(root) {
  for (;;) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) { await showLogin(root); continue; }
    const { data: aal, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
    if (error) { await sb.auth.signOut(); continue; }
    if (aal.currentLevel === 'aal2') return session;
    if (aal.nextLevel === 'aal2') {
      const { data: factors } = await sb.auth.mfa.listFactors();
      const totp = (factors && factors.totp && factors.totp[0]) || null;
      if (totp) { await showMfaChallenge(root, totp.id); continue; }
    }
    await showMfaEnroll(root);
  }
}

// Password-recovery link: the URL hash carries a short-lived recovery session. Returns true if handled.
export async function handleRecovery(root) {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''));
  if (params.get('type') !== 'recovery' || !params.get('access_token') || !params.get('refresh_token')) return false;
  const { error } = await sb.auth.setSession({ access_token: params.get('access_token'), refresh_token: params.get('refresh_token') });
  history.replaceState(null, '', location.pathname + location.search); // never leave tokens in the address bar
  if (error) { toast(errText(error), 'error'); return false; }
  await new Promise((resolve) => {
    const pw = h('input', { type: 'password', required: true, minlength: 10, autocomplete: 'new-password', dir: 'ltr' });
    const msg = h('div', { class: 'form-error', role: 'alert' });
    const go = h('button', { class: 'btn primary block', type: 'submit' }, t('common.save'));
    const form = h('form', { class: 'form' }, h('label', { class: 'field' }, h('span', null, t('set.newPassword')), pw), msg, go);
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault(); msg.textContent = ''; go.disabled = true;
      if (pw.value.length < 10) { msg.textContent = t('auth.passwordHint'); go.disabled = false; return; }
      const { error: e } = await sb.auth.updateUser({ password: pw.value });
      if (e) { msg.textContent = errText(e); go.disabled = false; return; }
      toast(t('set.passwordChanged'), 'ok'); resolve();
    });
    shell(root, t('auth.resetTitle'), form);
    pw.focus();
  });
  return true;
}
