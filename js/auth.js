(function () {
  let isSignUp = false;

  const el = {
    title:      document.getElementById('auth-title'),
    sub:        document.getElementById('auth-sub'),
    email:      document.getElementById('auth-email'),
    password:   document.getElementById('auth-password'),
    submitBtn:  document.getElementById('auth-submit-btn'),
    toggleLink: document.getElementById('auth-toggle-link'),
    toggleLabel:document.querySelector('.toggle-label'),
    error:      document.getElementById('auth-error'),
    success:    document.getElementById('auth-success'),
  };

  // ─── toggle sign-in / sign-up ─────────────────────────────
  el.toggleLink.addEventListener('click', (e) => {
    e.preventDefault();
    isSignUp = !isSignUp;
    syncUI();
  });

  function syncUI() {
    hideMessages();
    if (isSignUp) {
      el.title.textContent       = '新規登録';
      el.sub.textContent         = 'メールアドレスとパスワードを設定';
      el.submitBtn.textContent   = '登録する';
      el.toggleLabel.textContent = 'すでにアカウントをお持ちの方は';
      el.toggleLink.textContent  = 'ログイン';
    } else {
      el.title.textContent       = 'ログイン';
      el.sub.textContent         = 'メールアドレスとパスワードでログイン';
      el.submitBtn.textContent   = 'ログイン';
      el.toggleLabel.textContent = 'アカウントをお持ちでない方は';
      el.toggleLink.textContent  = '新規登録';
    }
  }

  // ─── submit ───────────────────────────────────────────────
  el.submitBtn.addEventListener('click', handleSubmit);
  [el.email, el.password].forEach(input =>
    input.addEventListener('keydown', e => { if (e.key === 'Enter') handleSubmit(); })
  );

  async function handleSubmit() {
    const email    = el.email.value.trim();
    const password = el.password.value;

    if (!email || !password) {
      showError('メールアドレスとパスワードを入力してください。');
      return;
    }

    el.submitBtn.disabled     = true;
    el.submitBtn.textContent  = '処理中…';
    hideMessages();

    try {
      if (isSignUp) {
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) { showError(translate(error.message)); return; }
        if (!data.session) {
          showSuccess('確認メールを送信しました。メール内のリンクをクリックしてからログインしてください。');
        }
        // session あり → onAuthStateChange が app.js 側で拾う
      } else {
        const { error } = await sb.auth.signInWithPassword({ email, password });
        if (error) showError(translate(error.message));
        // 成功 → onAuthStateChange が画面遷移を処理
      }
    } catch {
      showError('ネットワークエラーが発生しました。');
    } finally {
      el.submitBtn.disabled    = false;
      el.submitBtn.textContent = isSignUp ? '登録する' : 'ログイン';
    }
  }

  // ─── helpers ──────────────────────────────────────────────
  function showError(msg)   { el.error.textContent = msg;   el.error.classList.remove('hidden'); }
  function showSuccess(msg) { el.success.textContent = msg; el.success.classList.remove('hidden'); }
  function hideMessages()   { el.error.classList.add('hidden'); el.success.classList.add('hidden'); }

  const ERROR_MAP = {
    'Invalid login credentials':        'メールアドレスまたはパスワードが違います。',
    'Email not confirmed':               'メールアドレスの確認が完了していません。',
    'User already registered':           'このメールアドレスは既に登録されています。',
    'Password should be at least 6':     'パスワードは6文字以上で入力してください。',
    'Unable to validate email address':  '正しいメールアドレスを入力してください。',
  };

  function translate(msg) {
    for (const [key, val] of Object.entries(ERROR_MAP)) {
      if (msg.includes(key)) return val;
    }
    return msg;
  }
})();
