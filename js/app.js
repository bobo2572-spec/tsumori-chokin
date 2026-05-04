// ─── Constants ────────────────────────────────────────────────────────────────
const GRID   = 10;
const TOTAL  = GRID * GRID;
const BUCKET = 'mission-images';

// ─── State ────────────────────────────────────────────────────────────────────
let state = {
  missionId:    null,
  goalName:     '',
  targetAmount: 0,
  currentAmount:0,
  isImageMode:  false,
  imagePath:    null,
};

let unrevealedBlocks = [];
let imgObj           = new Image();
let celebrationFired = false;
let currentUserId    = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const canvas     = document.getElementById('savings-canvas');
const ctx        = canvas.getContext('2d', { willReadFrequently: true });
const canvasWrap = document.getElementById('canvas-wrap');
const gaugeWrap  = document.getElementById('gauge-wrap');
const stripBar   = document.getElementById('strip-bar');
const overlay    = document.getElementById('completion-overlay');
const resetBtn   = document.getElementById('reset-btn');
const historyBtn = document.getElementById('history-btn');
const backBtn    = document.getElementById('back-btn');

// ─── Screen management ────────────────────────────────────────────────────────
function showScreen(name) {
  ['loading', 'setup', 'main', 'history'].forEach(s =>
    document.getElementById(`${s}-screen`).classList.add('hidden')
  );
  document.getElementById(`${name}-screen`).classList.remove('hidden');

  resetBtn?.classList.toggle('hidden',   name !== 'main');
  historyBtn?.classList.toggle('hidden', name !== 'main' && name !== 'setup');
  backBtn?.classList.toggle('hidden',    name !== 'history');
}

// ─── 起動時の認証 (getSession → 匿名サインイン) ──────────────────────────────
(async function init() {
  showScreen('loading');
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (session) {
      currentUserId = session.user.id;
    } else {
      const { data, error } = await sb.auth.signInAnonymously();
      if (error) throw error;
      currentUserId = data.session.user.id;
    }
    await loadMission();
  } catch (e) {
    console.error('起動エラー:', e);
    showScreen('setup');
  }
})();

// セッション期限切れ時の再サインイン
sb.auth.onAuthStateChange(async (event) => {
  if (event === 'SIGNED_OUT') {
    try {
      const { data } = await sb.auth.signInAnonymously();
      if (data?.session) {
        currentUserId = data.session.user.id;
        await loadMission();
      }
    } catch {}
  }
});

// ─── Load active mission ──────────────────────────────────────────────────────
async function loadMission() {
  try {
    const { data, error } = await sb
      .from('missions')
      .select('*')
      .eq('user_id',   currentUserId)
      .eq('completed', false)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (!data) {
      resetSetupForm();
      showScreen('setup');
      return;
    }

    applyMissionToState(data);
    updateStatsUI();
    document.getElementById('display-goal-name').textContent = '🎯 ' + state.goalName;
    showScreen('main');

    if (state.isImageMode) {
      await loadAndRestoreCanvas();
    } else {
      canvasWrap.classList.add('hidden');
      gaugeWrap.classList.remove('hidden');
      updateGaugeUI();
    }
  } catch (e) {
    console.error('ミッション読み込みエラー:', e);
    resetSetupForm();
    showScreen('setup');
  }
}

function applyMissionToState(data) {
  state.missionId     = data.id;
  state.goalName      = data.goal_name;
  state.targetAmount  = data.target_amount;
  state.currentAmount = data.current_amount;
  state.isImageMode   = !!data.image_path;
  state.imagePath     = data.image_path;
  unrevealedBlocks    = data.unrevealed_blocks || [];
  celebrationFired    = data.completed;
}

// ─── Setup: start new mission ─────────────────────────────────────────────────
document.getElementById('start-btn').addEventListener('click', async () => {
  const goalName     = document.getElementById('goal-name').value.trim();
  const targetAmount = parseInt(document.getElementById('target-amount').value);
  const file         = document.getElementById('image-file').files[0];
  const errorEl      = document.getElementById('setup-error');
  const startBtn     = document.getElementById('start-btn');

  if (!targetAmount || targetAmount <= 0) {
    errorEl.textContent = '目標金額を入力してください。';
    errorEl.classList.remove('hidden');
    return;
  }
  errorEl.classList.add('hidden');
  startBtn.disabled = true;
  startBtn.textContent = '準備中…';

  try {
    const shuffled = Array.from({ length: TOTAL }, (_, i) => i).sort(() => Math.random() - 0.5);
    let imagePath = null;

    if (file) {
      const ext  = file.name.split('.').pop().toLowerCase();
      const path = `${currentUserId}/${Date.now()}.${ext}`;
      const { error: uploadErr } = await sb.storage
        .from(BUCKET).upload(path, file, { contentType: file.type });
      if (uploadErr) throw uploadErr;
      imagePath = path;
    }

    const { data, error } = await sb.from('missions').insert({
      user_id:           currentUserId,
      goal_name:         goalName || '貯金ミッション',
      target_amount:     targetAmount,
      current_amount:    0,
      image_path:        imagePath,
      unrevealed_blocks: shuffled,
      completed:         false,
    }).select().single();
    if (error) throw error;

    applyMissionToState(data);
    unrevealedBlocks = shuffled;
    celebrationFired = false;

    document.getElementById('display-goal-name').textContent = '🎯 ' + state.goalName;
    updateStatsUI();
    showScreen('main');

    if (state.isImageMode) {
      canvasWrap.classList.remove('hidden');
      gaugeWrap.classList.add('hidden');
      await drawGrayscale();
      updateStripBar(0);
    } else {
      canvasWrap.classList.add('hidden');
      gaugeWrap.classList.remove('hidden');
      updateGaugeUI();
    }
  } catch (e) {
    errorEl.textContent = 'エラー: ' + e.message;
    errorEl.classList.remove('hidden');
  } finally {
    startBtn.disabled    = false;
    startBtn.textContent = '貯金スタート！';
  }
});

// ─── Canvas helpers ───────────────────────────────────────────────────────────
async function drawGrayscale() {
  return new Promise(async (resolve, reject) => {
    imgObj = new Image();
    imgObj.crossOrigin = 'anonymous';
    imgObj.onload = () => { resizeCanvas(); applyGrayscale(); resolve(); };
    imgObj.onerror = reject;
    imgObj.src = await getSignedUrl(state.imagePath);
  });
}

async function loadAndRestoreCanvas() {
  canvasWrap.classList.remove('hidden');
  gaugeWrap.classList.add('hidden');
  try {
    imgObj = new Image();
    imgObj.crossOrigin = 'anonymous';
    imgObj.onload = () => {
      resizeCanvas();
      applyGrayscale();
      const unrevSet = new Set(unrevealedBlocks);
      for (let i = 0; i < TOTAL; i++) { if (!unrevSet.has(i)) drawColorBlock(i); }
      updateStripBar(state.currentAmount / state.targetAmount);
    };
    imgObj.src = await getSignedUrl(state.imagePath);
  } catch {
    state.isImageMode = false;
    canvasWrap.classList.add('hidden');
    gaugeWrap.classList.remove('hidden');
    updateGaugeUI();
  }
}

function resizeCanvas() {
  canvas.width  = 400;
  canvas.height = Math.round(400 * (imgObj.naturalHeight / imgObj.naturalWidth));
}

function applyGrayscale() {
  ctx.drawImage(imgObj, 0, 0, canvas.width, canvas.height);
  const d = ctx.getImageData(0, 0, canvas.width, canvas.height);
  for (let i = 0; i < d.data.length; i += 4) {
    const gray  = d.data[i] * 0.299 + d.data[i+1] * 0.587 + d.data[i+2] * 0.114;
    const light = Math.round(gray * 0.5 + 255 * 0.5);
    d.data[i] = d.data[i+1] = d.data[i+2] = light;
  }
  ctx.putImageData(d, 0, 0);
}

function drawColorBlock(idx) {
  const col = idx % GRID, row = Math.floor(idx / GRID);
  const bW = canvas.width / GRID,  bH = canvas.height / GRID;
  const sW = imgObj.naturalWidth / GRID, sH = imgObj.naturalHeight / GRID;
  ctx.drawImage(imgObj, col*sW, row*sH, sW, sH, col*bW, row*bH, bW, bH);
}

async function getSignedUrl(path) {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}

// ─── Add savings ──────────────────────────────────────────────────────────────
async function addSavings(amount) {
  if (!Number.isFinite(amount) || amount <= 0) { alert('正しい金額を入力してください。'); return; }

  const prev = state.currentAmount;
  state.currentAmount = Math.min(state.currentAmount + amount, state.targetAmount);
  updateStatsUI();

  if (state.isImageMode) { revealBlocks(prev, state.currentAmount); }
  else { updateGaugeUI(); }

  const isComplete = state.currentAmount >= state.targetAmount;
  await sb.from('missions').update({
    current_amount:    state.currentAmount,
    unrevealed_blocks: unrevealedBlocks,
    completed:         isComplete,
    updated_at:        new Date().toISOString(),
  }).eq('id', state.missionId);

  if (!celebrationFired && isComplete) {
    celebrationFired = true;
    celebrate();
  }
}

function revealBlocks(prev, next) {
  const prevN = Math.floor((prev / state.targetAmount) * TOTAL);
  const nextN = Math.floor((next / state.targetAmount) * TOTAL);
  for (let i = 0; i < nextN - prevN; i++) {
    if (!unrevealedBlocks.length) break;
    drawColorBlock(unrevealedBlocks.pop());
  }
  updateStripBar(next / state.targetAmount);
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function updateStatsUI() {
  document.getElementById('current-display').textContent = state.currentAmount.toLocaleString();
  document.getElementById('target-display').textContent  = state.targetAmount.toLocaleString();
}
function updateGaugeUI() {
  const pct = Math.min((state.currentAmount / state.targetAmount) * 100, 100);
  document.getElementById('gauge-bar').style.width     = `${pct}%`;
  document.getElementById('gauge-percent').textContent = `${Math.floor(pct)}%`;
}
function updateStripBar(r) { stripBar.style.width = `${Math.min(r*100,100)}%`; }

// ─── Celebration ──────────────────────────────────────────────────────────────
function celebrate() {
  const fire = (r, o) => confetti(Object.assign({ particleCount: Math.floor(200*r), spread: 70, origin: {y:0.6} }, o));
  fire(0.25, {spread:26,startVelocity:55}); fire(0.2,{spread:60});
  fire(0.35, {spread:100,decay:.91,scalar:.8}); fire(0.1,{spread:120,startVelocity:25,decay:.92,scalar:1.2});
  fire(0.1,  {spread:120,startVelocity:45});
  document.getElementById('completion-msg').innerHTML = `「${state.goalName}」達成！<br>コツコツ続けた成果ですね！`;
  overlay.classList.remove('hidden');
}

document.getElementById('completion-close-btn').addEventListener('click', () => {
  overlay.classList.add('hidden');
  resetSetupForm();
  showScreen('setup');
});

// ─── Manual input ─────────────────────────────────────────────────────────────
document.getElementById('add-btn').addEventListener('click', () => {
  const el = document.getElementById('add-amount');
  const v  = parseInt(el.value);
  if (!v) { alert('金額を入力してください。'); return; }
  addSavings(v); el.value = '';
});
document.getElementById('add-amount').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('add-btn').click();
});

// ─── Voice input ──────────────────────────────────────────────────────────────
const voiceBtn = document.getElementById('voice-btn');
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SR) {
  const rec = new SR();
  rec.lang = 'ja-JP'; rec.interimResults = false; rec.maxAlternatives = 1;
  voiceBtn.addEventListener('click', () => { rec.start(); voiceBtn.classList.add('recording'); });
  rec.addEventListener('result', e => {
    const m = e.results[0][0].transcript.match(/\d[\d,]*/);
    if (m) addSavings(parseInt(m[0].replace(/,/g,'')));
    else alert(`「${e.results[0][0].transcript}」から数値を読み取れませんでした。`);
  });
  rec.addEventListener('end',   () => voiceBtn.classList.remove('recording'));
  rec.addEventListener('error', e => { voiceBtn.classList.remove('recording'); if (e.error!=='no-speech') alert('音声認識エラー: '+e.error); });
} else { voiceBtn.style.display = 'none'; }

// ─── Reset ────────────────────────────────────────────────────────────────────
resetBtn?.addEventListener('click', async () => {
  if (!confirm('現在のミッションを終了して新しいミッションを設定しますか？')) return;
  if (state.missionId) {
    await sb.from('missions').update({ completed: true, updated_at: new Date().toISOString() }).eq('id', state.missionId);
  }
  resetSetupForm(); showScreen('setup');
});

function resetSetupForm() {
  document.getElementById('goal-name').value     = '';
  document.getElementById('target-amount').value = '';
  document.getElementById('image-file').value    = '';
  document.getElementById('file-label-text').textContent = '📁 画像を選択（WebP / PNG / JPEG）';
  document.getElementById('setup-error').classList.add('hidden');
}

document.getElementById('image-file').addEventListener('change', e => {
  const n = e.target.files[0]?.name;
  document.getElementById('file-label-text').textContent = n ? '📷 ' + n : '📁 画像を選択（WebP / PNG / JPEG）';
});

// ─── History ──────────────────────────────────────────────────────────────────
historyBtn?.addEventListener('click', () => loadHistory());
backBtn?.addEventListener('click', () => {
  if (state.missionId) showScreen('main'); else showScreen('setup');
});

async function loadHistory() {
  showScreen('history');

  const { data: all } = await sb
    .from('missions')
    .select('id, goal_name, target_amount, current_amount, completed, updated_at')
    .eq('user_id', currentUserId)
    .order('updated_at', { ascending: false });

  if (!all || all.length === 0) {
    document.getElementById('history-empty').classList.remove('hidden');
    document.getElementById('mission-list').innerHTML = '';
    document.getElementById('cumulative-amount').textContent = '0';
    document.getElementById('monthly-amount').textContent    = '0';
    document.getElementById('monthly-breakdown').innerHTML   = '';
    return;
  }

  // 累積総額（全ミッション）
  const cumulative = all.reduce((s, m) => s + m.current_amount, 0);
  document.getElementById('cumulative-amount').textContent = cumulative.toLocaleString();

  // 達成ミッションのみ
  const completed = all.filter(m => m.completed);

  // 今月の達成額
  const now = new Date();
  const thisMonth = completed
    .filter(m => {
      const d = new Date(m.updated_at);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((s, m) => s + m.current_amount, 0);
  document.getElementById('monthly-amount').textContent = thisMonth.toLocaleString();

  // 月別内訳
  const monthly = {};
  completed.forEach(m => {
    const d = new Date(m.updated_at);
    const key = `${d.getFullYear()}年${d.getMonth()+1}月`;
    monthly[key] = (monthly[key] || 0) + m.current_amount;
  });

  const breakdownEl = document.getElementById('monthly-breakdown');
  if (Object.keys(monthly).length > 0) {
    breakdownEl.innerHTML = `
      <div class="section-title">月別達成額</div>
      ${Object.entries(monthly).map(([k, v]) => `
        <div class="monthly-row">
          <span class="monthly-row-label">${k}</span>
          <span class="monthly-row-amount">¥${v.toLocaleString()}</span>
        </div>
      `).join('')}
    `;
  } else {
    breakdownEl.innerHTML = '';
  }

  // 達成ミッション一覧
  const listEl = document.getElementById('mission-list');
  const emptyEl = document.getElementById('history-empty');

  if (completed.length === 0) {
    emptyEl.classList.remove('hidden');
    listEl.innerHTML = '';
  } else {
    emptyEl.classList.add('hidden');
    listEl.innerHTML = completed.map(m => {
      const d = new Date(m.updated_at);
      const dateStr = `${d.getFullYear()}年${d.getMonth()+1}月${d.getDate()}日`;
      return `
        <div class="history-item" data-id="${m.id}">
          <div class="history-goal">🎯 ${m.goal_name}</div>
          <div class="history-meta">
            <span class="history-amount">¥${m.current_amount.toLocaleString()}</span>
            <span class="history-date">${dateStr}</span>
            <button class="delete-btn" data-id="${m.id}" title="削除">🗑</button>
          </div>
        </div>
      `;
    }).join('');

    // 削除ボタンのイベント
    listEl.querySelectorAll('.delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('この記録を削除しますか？')) return;
        const id = btn.dataset.id;
        const { error } = await sb.from('missions').delete().eq('id', id);
        if (error) { alert('削除に失敗しました。'); return; }
        // アイテムをDOMから除去して集計を再描画
        btn.closest('.history-item').remove();
        await loadHistory();
      });
    });
  }
}
