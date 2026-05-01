// ─── состояние и localStorage ────────────────────────────────────────────────

const LS = {
  bought:   'kitchen.shopping.bought',     // массив id купленных
  servings: 'kitchen.recipes.servings',    // {recipeId: n}
  notes:    'kitchen.recipes.notes',       // {recipeId: {text, updatedAt}}
};

const state = {
  data: null,
  bought: {},      // {itemId: true}
  servings: {},
  notes: {},
};

function lsGet(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : JSON.parse(v);
  } catch {
    return fallback;
  }
}
function lsSet(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (e) { console.warn('localStorage failed:', e); }
}

function setToObj(arr) {
  const o = {};
  for (const id of arr) o[id] = true;
  return o;
}
function objToSet(o) {
  return Object.keys(o).filter(k => o[k]);
}

// ─── утилиты ─────────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
  }[c]));
}

// инлайн markdown: **bold**, *italic*. Сначала экранируем, потом подставляем теги.
function inlineMd(s) {
  let r = escapeHtml(s);
  r = r.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  r = r.replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  return r;
}

// многострочный markdown с поддержкой **bold**, переносы строк сохраняются
function blockMd(s) {
  return inlineMd(s);
}

// форматирование количества с дробями
function fmtQty(qty) {
  if (qty == null) return '';
  const r = Math.round(qty * 100) / 100;
  if (Math.abs(r - Math.round(r)) < 0.01) return String(Math.round(r));

  const fracs = [
    [0.5, '½'], [0.25, '¼'], [0.75, '¾'],
    [0.333, '⅓'], [0.667, '⅔'], [0.125, '⅛'],
  ];
  const whole = Math.floor(r);
  const frac = r - whole;
  for (const [v, glyph] of fracs) {
    if (Math.abs(frac - v) < 0.05) return whole > 0 ? whole + glyph : glyph;
  }
  return r.toFixed(1).replace(/\.0$/, '');
}

// дата → "1 мая"
const MONTHS_GEN = ['янв','фев','мар','апр','мая','июня','июля','авг','сен','окт','ноя','дек'];
function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${parseInt(d, 10)} ${MONTHS_GEN[parseInt(m, 10) - 1] || ''}`;
}
function todayLocalISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// ─── роутинг ────────────────────────────────────────────────────────────────

function parseHash() {
  const h = location.hash || '#/plan';
  const parts = h.replace(/^#\/?/, '').split('/').filter(Boolean);
  return { route: parts[0] || 'plan', args: parts.slice(1) };
}

function setActiveNav(route) {
  document.querySelectorAll('[data-route]').forEach(el => {
    el.classList.toggle('active', el.dataset.route === route);
  });
}

function render() {
  if (!state.data) return;
  const { route, args } = parseHash();
  setActiveNav(route);

  const app = document.getElementById('app');
  switch (route) {
    case 'plan':     app.innerHTML = viewPlan();           break;
    case 'recipes':  app.innerHTML = viewRecipes();        break;
    case 'recipe':   app.innerHTML = viewRecipe(args[0]);  bindRecipe(args[0]); break;
    case 'shopping': app.innerHTML = viewShopping();       bindShopping();      break;
    case 'profile':  app.innerHTML = viewProfile();        bindProfile();       break;
    default:         app.innerHTML = viewPlan();
  }
  window.scrollTo(0, 0);
}

window.goBack = function () {
  // если в истории есть куда — назад. Иначе — к рецептам.
  if (history.length > 1) history.back();
  else location.hash = '#/recipes';
};

// ─── ВЬЮ: ПЛАН ──────────────────────────────────────────────────────────────

function viewPlan() {
  const today = todayLocalISO();
  const days = state.data.plan.map(day => {
    const isToday = day.date === today;
    const meals = [
      { key: 'breakfast', label: 'Завтрак', emoji: '🍳' },
      { key: 'lunch',     label: 'Обед',    emoji: '🥪' },
      { key: 'dinner',    label: 'Ужин',    emoji: '🍲' },
    ].map(({ key, label, emoji }) => {
      const m = day.meals[key];
      const inner = `
        <div class="day__meal-emoji">${emoji}</div>
        <div class="day__meal-content">
          <div class="day__meal-label">${label}</div>
          <div class="day__meal-title">${escapeHtml(m?.title || '—')}</div>
        </div>
      `;
      if (m && m.recipeId) {
        return `<a class="day__meal day__meal--link" href="#/recipe/${m.recipeId}">${inner}<div class="day__meal-arrow">›</div></a>`;
      }
      return `<div class="day__meal">${inner}</div>`;
    }).join('');

    return `
      <div class="card day ${isToday ? 'day--today' : ''}">
        <div class="day__date">
          <span class="day__date-num">${fmtDate(day.date)}</span>
          <span class="day__date-wday">${escapeHtml(day.weekday || '')}</span>
        </div>
        ${meals}
      </div>
    `;
  }).join('');

  return `
    <h1 class="page-title">${escapeHtml(state.data.meta.planTitle)}</h1>
    ${days}
  `;
}

// ─── ВЬЮ: РЕЦЕПТЫ (список) ──────────────────────────────────────────────────

function viewRecipes() {
  const sections = state.data.categories.map(cat => {
    const list = state.data.recipes.filter(r => r.categoryId === cat.id);
    if (!list.length) return '';
    const cards = list.map(r => {
      const hasNote = !!(state.notes[r.id] && state.notes[r.id].text);
      return `
        <a class="recipe-card" href="#/recipe/${r.id}">
          <div class="recipe-card__emoji">${r.emoji || '🍽'}</div>
          <div class="recipe-card__title">${escapeHtml(r.title)}</div>
          <div class="recipe-card__meta">
            <span class="recipe-card__time">${r.totalMinutes ? '⏱ ' + r.totalMinutes + ' мин' : ''}</span>
            ${hasNote ? '<span class="recipe-card__note-mark" title="есть заметка">💬</span>' : ''}
          </div>
        </a>
      `;
    }).join('');
    return `
      <section class="cat">
        <h2 class="cat__title"><span class="cat__title-emoji">${cat.emoji}</span> ${escapeHtml(cat.title)}</h2>
        <div class="recipe-grid">${cards}</div>
      </section>
    `;
  }).join('');

  return `<h1 class="page-title">Рецепты</h1>${sections}`;
}

// ─── ВЬЮ: РЕЦЕПТ (детальный) ────────────────────────────────────────────────

function viewRecipe(id) {
  const recipe = state.data.recipes.find(r => r.id === id);
  if (!recipe) {
    return `
      <button class="detail__back" onclick="goBack()">← Назад</button>
      <div class="empty">Рецепт не найден.<br><a href="#/recipes">Перейти ко всем рецептам</a></div>
    `;
  }

  const cat = state.data.categories.find(c => c.id === recipe.categoryId);
  const userServings = state.servings[id] || recipe.baseServings;
  const ratio = userServings / recipe.baseServings;

  // ингредиенты с пересчётом
  const hasNumeric = recipe.ingredientGroups.some(g => g.items.some(it => it.qty != null));
  const ingHtml = recipe.ingredientGroups.map(group => {
    const items = group.items.map(it => {
      const qty = it.qty != null ? fmtQty(it.qty * ratio) : '';
      const unit = it.unit || '';
      const showQty = (qty || unit);
      return `
        <div class="ing">
          <span class="ing__name">${escapeHtml(it.name)}</span>
          ${showQty ? `<span class="ing__qty">${qty}${qty && unit ? ' ' : ''}${escapeHtml(unit)}</span>` : ''}
          ${it.note ? `<span class="ing__note">${escapeHtml(it.note)}</span>` : ''}
        </div>
      `;
    }).join('');
    const showGroupTitle = recipe.ingredientGroups.length > 1
      || (group.title && group.title !== 'Ингредиенты');
    return `
      <div class="ing-group">
        ${showGroupTitle ? `<div class="ing-group__title">${escapeHtml(group.title)}</div>` : ''}
        ${items}
      </div>
    `;
  }).join('');

  // шаги
  const stepsHtml = recipe.steps.map((s, i) => `
    <div class="step">
      <div class="step__num">${i + 1}</div>
      <div class="step__content">
        <div class="step__head">
          <span class="step__title">${escapeHtml(s.title)}</span>
          ${s.minutes ? `<span class="step__minutes">${s.minutes} мин</span>` : ''}
        </div>
        ${s.body ? `<div class="step__body">${blockMd(s.body)}</div>` : ''}
      </div>
    </div>
  `).join('');

  const hacksHtml = recipe.lifehacks.length ? `
    <div class="detail__section">
      <div class="detail__section-title">💡 Лайфхаки</div>
      <div class="hacks">
        <ul>${recipe.lifehacks.map(h => `<li>${inlineMd(h)}</li>`).join('')}</ul>
      </div>
    </div>
  ` : '';

  const storageHtml = recipe.storage ? `
    <div class="detail__section">
      <div class="detail__section-title">📦 Хранение</div>
      <div class="storage">${blockMd(recipe.storage)}</div>
    </div>
  ` : '';

  const note = state.notes[id] || { text: '', updatedAt: null };
  const updatedStr = note.updatedAt
    ? 'обновлено ' + new Date(note.updatedAt).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit'
      })
    : 'ещё не сохранено';

  const servingsHtml = hasNumeric ? `
    <div class="servings">
      <span class="servings__label">Порций</span>
      <div class="servings__controls">
        <button class="servings__btn" id="srv-dec" ${userServings <= 1 ? 'disabled' : ''} aria-label="Убавить">−</button>
        <span class="servings__count">${userServings}</span>
        <button class="servings__btn" id="srv-inc" aria-label="Прибавить">+</button>
      </div>
    </div>
  ` : '';

  const servingDish = recipe.serving ? `
    <div class="detail__section">
      <div class="detail__section-title">🍽 С чем подавать</div>
      <div class="detail__plain">${escapeHtml(recipe.serving)}</div>
    </div>
  ` : '';

  return `
    <button class="detail__back" onclick="goBack()">← Назад</button>
    <h1 class="detail__title">${recipe.emoji ? recipe.emoji + ' ' : ''}${escapeHtml(recipe.title)}</h1>
    <div class="detail__meta">
      ${cat ? cat.emoji + ' ' + escapeHtml(cat.title) : ''}
      ${recipe.totalMinutes ? ' · ⏱ ' + recipe.totalMinutes + ' мин' : ''}
      ${recipe.baseServings ? ' · базово ' + recipe.baseServings + ' порц.' : ''}
    </div>

    ${servingsHtml}
    ${servingDish}

    ${recipe.ingredientGroups.length ? `
      <div class="detail__section">
        <div class="detail__section-title">🛒 Ингредиенты
          ${hasNumeric ? `<span class="detail__section-title-note">на ${userServings} порц.</span>` : ''}
        </div>
        ${ingHtml}
      </div>
    ` : ''}

    ${recipe.steps.length ? `
      <div class="detail__section">
        <div class="detail__section-title">👨‍🍳 Шаги</div>
        ${stepsHtml}
      </div>
    ` : ''}

    ${hacksHtml}
    ${storageHtml}

    <div class="detail__section notes">
      <div class="detail__section-title">💬 Мои заметки</div>
      <textarea id="note-area" placeholder="Что получилось / что подкорректировать в следующий раз...">${escapeHtml(note.text || '')}</textarea>
      <div class="notes__row">
        <span class="notes__updated">${updatedStr}</span>
        <button class="btn btn--primary" id="note-save">Сохранить</button>
      </div>
    </div>
  `;
}

function bindRecipe(id) {
  const recipe = state.data.recipes.find(r => r.id === id);
  if (!recipe) return;

  // селектор порций — сохраняем черновик заметки перед перерендером
  function adjust(delta) {
    const ta = document.getElementById('note-area');
    const draft = ta ? ta.value : null;

    const cur = state.servings[id] || recipe.baseServings;
    const next = Math.max(1, cur + delta);
    if (next === cur) return;
    state.servings[id] = next;
    lsSet(LS.servings, state.servings);
    render();

    if (draft != null) {
      const newTa = document.getElementById('note-area');
      if (newTa) newTa.value = draft;
    }
  }

  const dec = document.getElementById('srv-dec');
  const inc = document.getElementById('srv-inc');
  if (dec) dec.addEventListener('click', () => adjust(-1));
  if (inc) inc.addEventListener('click', () => adjust(+1));

  const saveBtn = document.getElementById('note-save');
  if (saveBtn) saveBtn.addEventListener('click', () => {
    const ta = document.getElementById('note-area');
    const text = ta ? ta.value.trim() : '';
    if (text) {
      state.notes[id] = { text, updatedAt: new Date().toISOString() };
    } else {
      delete state.notes[id];
    }
    lsSet(LS.notes, state.notes);
    render();
  });
}

// ─── ВЬЮ: ПОКУПКИ ───────────────────────────────────────────────────────────

function viewShopping() {
  let total = 0, bought = 0;
  state.data.shopping.forEach(list => list.groups.forEach(g => g.items.forEach(it => {
    total++;
    if (state.bought[it.id]) bought++;
  })));
  const pct = total ? (bought / total) * 100 : 0;

  const lists = state.data.shopping.map(list => {
    const groups = list.groups.map(g => {
      const items = g.items.map(it => {
        const checked = !!state.bought[it.id];
        return `
          <div class="shop-item ${checked ? 'shop-item--checked' : ''}" data-id="${escapeHtml(it.id)}">
            <div class="shop-item__check"></div>
            <div class="shop-item__text">${escapeHtml(it.text)}${it.starred ? ' <span class="shop-item__star">⭐</span>' : ''}</div>
          </div>
        `;
      }).join('');
      return `
        <div class="shop-group">
          <div class="shop-group__title"><span class="shop-group__emoji">${g.emoji || '🛒'}</span> ${escapeHtml(g.title)}</div>
          ${items}
        </div>
      `;
    }).join('');
    return `
      <section class="shop-list">
        <h2 class="shop-list__title">${escapeHtml(list.title)}</h2>
        ${list.subtitle ? `<div class="shop-list__subtitle">${escapeHtml(list.subtitle)}</div>` : ''}
        ${groups}
      </section>
    `;
  }).join('');

  return `
    <h1 class="page-title">Покупки</h1>
    <div class="progress">
      <div class="progress__row">
        <div class="progress__count"><strong>${bought}</strong> из ${total} куплено</div>
        <button class="btn btn--secondary" id="shop-reset">Сбросить</button>
      </div>
      <div class="progress__bar"><div class="progress__fill" style="width: ${pct}%"></div></div>
    </div>
    ${lists}
  `;
}

function bindShopping() {
  document.querySelectorAll('.shop-item').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      if (state.bought[id]) delete state.bought[id];
      else state.bought[id] = true;
      lsSet(LS.bought, objToSet(state.bought));
      render();
    });
  });
  const resetBtn = document.getElementById('shop-reset');
  if (resetBtn) resetBtn.addEventListener('click', () => {
    if (!confirm('Сбросить все галочки в списке покупок?')) return;
    state.bought = {};
    lsSet(LS.bought, []);
    render();
  });
}

// ─── ВЬЮ: ПРОФИЛЬ ───────────────────────────────────────────────────────────

function viewProfile() {
  const md = state.data.profile.rawMarkdown || '';
  return `
    <div class="profile">
      ${markdownToHtml(md)}
    </div>

    <div class="danger-zone">
      <div class="danger-zone__title">⚠ Опасная зона</div>
      <div class="danger-zone__hint">Удалит галочки в покупках, выбранные порции для рецептов и заметки. Сами рецепты и план не пострадают.</div>
      <button class="btn btn--danger" id="reset-all">Сбросить все данные приложения</button>
    </div>
  `;
}

function bindProfile() {
  const btn = document.getElementById('reset-all');
  if (btn) btn.addEventListener('click', () => {
    if (!confirm('Удалить все галочки, порции и заметки?')) return;
    if (!confirm('Точно? Это нельзя отменить.')) return;
    [LS.bought, LS.servings, LS.notes].forEach(k => localStorage.removeItem(k));
    state.bought = {};
    state.servings = {};
    state.notes = {};
    alert('Готово. Данные сброшены.');
    render();
  });
}

// ─── простой markdown-рендер для профиля ─────────────────────────────────────

function markdownToHtml(text) {
  const lines = text.split('\n');
  let html = '';
  let inList = false;
  let inBlockquote = false;

  const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
  const closeBq   = () => { if (inBlockquote) { html += '</blockquote>'; inBlockquote = false; } };

  for (let raw of lines) {
    const line = raw.replace(/\r$/, '');
    if (!line.trim()) { closeList(); closeBq(); continue; }

    const h = line.match(/^(#{1,6})\s+(.+)$/);
    if (h) {
      closeList(); closeBq();
      html += `<h${h[1].length}>${inlineMd(h[2])}</h${h[1].length}>`;
      continue;
    }

    if (line.startsWith('> ')) {
      closeList();
      if (!inBlockquote) { html += '<blockquote>'; inBlockquote = true; }
      html += `<p>${inlineMd(line.slice(2))}</p>`;
      continue;
    }
    closeBq();

    if (line.startsWith('- ')) {
      if (!inList) { html += '<ul>'; inList = true; }
      html += `<li>${inlineMd(line.slice(2))}</li>`;
      continue;
    }
    closeList();

    html += `<p>${inlineMd(line)}</p>`;
  }
  closeList(); closeBq();
  return html;
}

// ─── init ───────────────────────────────────────────────────────────────────

async function init() {
  try {
    const res = await fetch('data.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    state.data = await res.json();
  } catch (e) {
    document.getElementById('app').innerHTML = `
      <div class="empty">
        Не удалось загрузить data.json.<br>
        <small>${escapeHtml(e.message || e)}</small><br><br>
        Если открываешь файл напрямую (file://) в Chrome — fetch не сработает.
        Запусти локальный сервер: <code>python3 -m http.server</code> в папке проекта.
      </div>
    `;
    return;
  }

  state.bought   = setToObj(lsGet(LS.bought, []));
  state.servings = lsGet(LS.servings, {});
  state.notes    = lsGet(LS.notes, {});

  if (!location.hash) location.hash = '#/plan';
  window.addEventListener('hashchange', render);
  render();
}

init();
