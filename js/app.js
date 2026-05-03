// ─── Constants ────────────────────────────────────────────────────────────────
const GRID    = 10;
const TOTAL   = GRID * GRID;
const BUCKET  = 'mission-images';

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
const canvas      = document.getElementById('savings-canvas');
const ctx         = canvas.getContext('2d', { willReadFrequently: true });
const canvasWrap  = document.getElementById('canvas-wrap');
const gaugeWrap   = document.getElementById('gauge-wrap');
const stripBar    = document.getElementById('strip-bar');
const overlay     = document.getElementById('completion-overlay');
const logoutBtn   = document.getElementById('logout-btn');
const resetBtn    = document.getElementById('reset-btn');

// ─── Screen management ────────────────────────────────────────────────────────
function showScreen(name) {
  ['loading', 'auth', 'setup', 'main'].forEach(s =>
    document.getElementById(`${s}-screen`).classList.add('hidden')
  );
  document.getElementById(`${name}-screen`).classList.remove('hidden');
  logoutBtn.classList.toggle('hidden', name === 'loading' || name === 'auth');
  resetBtn.classList.toggle('hidden',  name !== 'main');
}

// ─── Session ──────────────────────────────────────────────────────────────────
sb.auth.onAuthStateChange(async (_event, session) => {
  if (session) {
    currentUserId = session.user.id;
    await loadMission();
  } else {
    currentUserId = null;
    showScreen('auth');
  }
});

logoutBtn.addEventListener('click', () => sb.auth.signOut());

// ─── Load active mission from DB ──────────────────────────────────────────────
async function loadMission() {
  showScreen('loading');

  const { data, error } = await sb
    .from('missions')
    .select('*')
    .eq('user_id',  currentUserId)
    .eq('completed', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) {
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

// ─── Setup: start a new mission ───────────────────────────────────────────────
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

  startBtn.disabled    = true;
  startBtn.textContent = '準備中…';

  try {
    const shuffled = Array.from({ length: TOTAL }, (_, i) => i).sort(() => Math.random() - 0.5);
    let imagePath = null;

    if (file) {
      const ext  = file.name.split('.').pop().toLowerCase();
      const path = `${currentUserId}/${Date.now()}.${ext}`;
      const { error: uploadError } = await sb.storage
        .from(BUCKET)
        .upload(path, file, { contentType: file.type });
      if (uploadError) throw uploadError;
      imagePath = path;
    }

    const { data, error } = await sb.from('missions').insert({
      user_id:          currentUserId,
      goal_name:        goalName || '貯金ミッション',
      target_amount:    targetAmount,
      current_amount:   0,
      image_path:       imagePath,
      unrevealed_blocks: shuffled,
      completed:        false,
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
    errorEl.textContent = 'エラーが発生しました: ' + e.message;
    errorEl.classList.remove('hidden');
  } finally {
    startBtn.disabled    = false;
    startBtn.textContent = '貯金スタート！';
  }
});

// ─── Canvas: draw grayscale base (new mission) ────────────────────────────────
async function drawGrayscale() {
  return new Promise(async (resolve, reject) => {
    const url = await getSignedUrl(state.imagePath);
    imgObj = new Image();
    imgObj.crossOrigin = 'anonymous';
    imgObj.onload = () => {
      resizeCanvas();
      applyGrayscale();
      resolve();
    };
    imgObj.onerror = reject;
    imgObj.src = url;
  });
}

// ─── Canvas: restore state (existing mission reload) ─────────────────────────
async function loadAndRestoreCanvas() {
  canvasWrap.classList.remove('hidden');
  gaugeWrap.classList.add('hidden');

  try {
    const url = await getSignedUrl(state.imagePath);
    imgObj = new Image();
    imgObj.crossOrigin = 'anonymous';
    imgObj.onload = () => {
      resizeCanvas();
      applyGrayscale();

      // Re-reveal already-revealed blocks (those not in unrevealedBlocks)
      const unrevealedSet = new Set(unrevealedBlocks);
      for (let idx = 0; idx < TOTAL; idx++) {
        if (!unrevealedSet.has(idx)) drawColorBlock(idx);
      }

      updateStripBar(state.currentAmount / state.targetAmount);
    };
    imgObj.src = url;
  } catch (e) {
    // 画像読み込み失敗時はゲージモードにフォールバック
    console.error('Image load failed:', e);
    state.isImageMode = false;
    canvasWrap.classList.add('hidden');
    gaugeWrap.classList.remove('hidden');
    updateGaugeUI();
  }
}

function resizeCanvas() {
  canvas.width  = 400;
  canvas.height = Math.round(canvas.width * (imgObj.naturalHeight / imgObj.naturalWidth));
}

function applyGrayscale() {
  ctx.drawImage(imgObj, 0, 0, canvas.width, canvas.height);
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = imageData.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray  = d[i] * 0.299 + d[i+1] * 0.587 + d[i+2] * 0.114;
    const light = Math.round(gray * 0.5 + 255 * 0.5); // 白と50%ブレンドして淡く
    d[i] = d[i+1] = d[i+2] = light;
  }
  ctx.putImageData(imageData, 0, 0);
}

function drawColorBlock(idx) {
  const col = idx % GRID;
  const row = Math.floor(idx / GRID);
  const bW  = canvas.width  / GRID;
  const bH  = canvas.height / GRID;
  const sW  = imgObj.naturalWidth  / GRID;
  const sH  = imgObj.naturalHeight / GRID;
  ctx.drawImage(imgObj, col * sW, row * sH, sW, sH, col * bW, row * bH, bW, bH);
}

// ─── Savings addition ─────────────────────────────────────────────────────────
async function addSavings(amount) {
  if (!Number.isFinite(amount) || amount <= 0) {
    alert('正しい金額を入力してください。');
    return;
  }

  const prev = state.currentAmount;
  state.currentAmount = Math.min(state.currentAmount + amount, state.targetAmount);
  updateStatsUI();

  if (state.isImageMode) {
    revealBlocks(prev, state.currentAmount);
  } else {
    updateGaugeUI();
  }

  // Persist to Supabase
  const updates = {
    current_amount:    state.currentAmount,
    unrevealed_blocks: unrevealedBlocks,
    updated_at:        new Date().toISOString(),
  };
  const isComplete = state.currentAmount >= state.targetAmount;
  if (isComplete) updates.completed = true;

  const { error } = await sb.from('missions').update(updates).eq('id', state.missionId);
  if (error) console.error('Save failed:', error);

  if (!celebrationFired && isComplete) {
    celebrationFired = true;
    celebrate();
  }
}

function revealBlocks(prevAmount, newAmount) {
  const prevCount = Math.floor((prevAmount / state.targetAmount) * TOTAL);
  const nextCount = Math.floor((newAmount  / state.targetAmount) * TOTAL);
  const toReveal  = nextCount - prevCount;

  for (let i = 0; i < toReveal; i++) {
    if (unrevealedBlocks.length === 0) break;
    drawColorBlock(unrevealedBlocks.pop());
  }
  updateStripBar(newAmount / state.targetAmount);
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
function updateStatsUI() {
  document.getElementById('current-display').textContent = state.currentAmount.toLocaleString();
  document.getElementById('target-display').textContent  = state.targetAmount.toLocaleString();
}

function updateGaugeUI() {
  const pct = Math.min((state.currentAmount / state.targetAmount) * 100, 100);
  document.getElementById('gauge-bar').style.width    = `${pct}%`;
  document.getElementById('gauge-percent').textContent = `${Math.floor(pct)}%`;
}

function updateStripBar(ratio) {
  stripBar.style.width = `${Math.min(ratio * 100, 100)}%`;
}

// ─── Celebration ──────────────────────────────────────────────────────────────
function celebrate() {
  const fire = (r, opts) =>
    confetti(Object.assign({ particleCount: Math.floor(200 * r), spread: 70, origin: { y: 0.6 } }, opts));
  fire(0.25, { spread: 26, startVelocity: 55 });
  fire(0.2,  { spread: 60 });
  fire(0.35, { spread: 100, decay: 0.91, scalar: 0.8 });
  fire(0.1,  { spread: 120, startVelocity: 25, decay: 0.92, scalar: 1.2 });
  fire(0.1,  { spread: 120, startVelocity: 45 });

  document.getElementById('completion-msg').innerHTML =
    `「${state.goalName}」達成！<br>コツコツ続けた成果ですね！`;
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
  addSavings(v);
  el.value = '';
});

document.getElementById('add-amount').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('add-btn').click();
});

// ─── Voice input ──────────────────────────────────────────────────────────────
const voiceBtn = document.getElementById('voice-btn');
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;

if (SR) {
  const recognition = new SR();
  recognition.lang            = 'ja-JP';
  recognition.interimResults  = false;
  recognition.maxAlternatives = 1;

  voiceBtn.addEventListener('click', () => {
    recognition.start();
    voiceBtn.classList.add('recording');
    voiceBtn.title = '聞いています…';
  });

  recognition.addEventListener('result', e => {
    const transcript = e.results[0][0].transcript;
    const match = transcript.match(/\d[\d,]*/);
    if (match) {
      addSavings(parseInt(match[0].replace(/,/g, '')));
    } else {
      alert(`「${transcript}」から数値を読み取れませんでした。`);
    }
  });

  recognition.addEventListener('end',   () => { voiceBtn.classList.remove('recording'); voiceBtn.title = '音声入力'; });
  recognition.addEventListener('error', e  => { voiceBtn.classList.remove('recording'); if (e.error !== 'no-speech') alert('音声認識エラー: ' + e.error); });
} else {
  voiceBtn.style.display = 'none';
}

// ─── Reset ────────────────────────────────────────────────────────────────────
resetBtn.addEventListener('click', async () => {
  if (!confirm('現在のミッションを終了して新しいミッションを設定しますか？')) return;
  if (state.missionId) {
    await sb.from('missions').update({ completed: true }).eq('id', state.missionId);
  }
  resetSetupForm();
  showScreen('setup');
});

function resetSetupForm() {
  document.getElementById('goal-name').value        = '';
  document.getElementById('target-amount').value    = '';
  document.getElementById('image-file').value       = '';
  document.getElementById('file-label-text').textContent = '📁 画像を選択（WebP / PNG / JPEG）';
  document.getElementById('setup-error').classList.add('hidden');
}

// ─── File label update ────────────────────────────────────────────────────────
document.getElementById('image-file').addEventListener('change', e => {
  const name = e.target.files[0]?.name;
  document.getElementById('file-label-text').textContent = name ? '📷 ' + name : '📁 画像を選択（WebP / PNG / JPEG）';
});

// ─── Supabase Storage: signed URL ─────────────────────────────────────────────
async function getSignedUrl(path) {
  const { data, error } = await sb.storage.from(BUCKET).createSignedUrl(path, 3600);
  if (error) throw error;
  return data.signedUrl;
}
