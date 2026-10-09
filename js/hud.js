import { CONFIG, wrapAngle } from './config.js';

const CROWN_SVG =
  '<svg class="crown-ico" viewBox="0 0 64 48"><path d="M6 40 L2 12 L18 24 L32 4 L46 24 L62 12 L58 40 Z" fill="#ffe500" stroke="#b88a00" stroke-width="4" stroke-linejoin="round"/></svg>';

export function hex(color) {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function formatClock(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function formatHold(t) {
  return `${t.toFixed(1)}s`;
}

// ---------------------------------------------------------------------------
// Per-player HUD: speed, nitro, crown pointer and personal toasts. One per
// split-screen viewport, positioned over that viewport.
// ---------------------------------------------------------------------------

export class PlayerHUD {
  constructor(container) {
    this.el = document.createElement('div');
    this.el.className = 'phud';
    this.el.innerHTML = `
      <div class="phud-tag"></div>
      <div class="crown-pointer hidden"><div class="pointer-arrow"></div><div class="pointer-label"></div></div>
      <div class="toast"></div>
      <div class="speedo"><span class="speed-val">0</span><small>KM/H</small></div>
      <div class="nitro">
        <div class="nitro-label"><span class="nitro-name">NITRO</span><span class="nitro-key"></span></div>
        <div class="nitro-bar"><div class="nitro-fill"></div></div>
      </div>`;
    container.appendChild(this.el);
    const q = (s) => this.el.querySelector(s);
    this.tag = q('.phud-tag');
    this.pointer = q('.crown-pointer');
    this.pointerArrow = q('.pointer-arrow');
    this.pointerLabel = q('.pointer-label');
    this.toast = q('.toast');
    this.speedVal = q('.speed-val');
    this.nitro = q('.nitro');
    this.nitroFill = q('.nitro-fill');
    this.nitroKey = q('.nitro-key');
    this._c = { speed: -1, nitro: -1, nitroClass: '', pointerText: '', pointerHidden: true };
  }

  configure({ rect, compact, tagText, tagColor, nitroKey }) {
    const s = this.el.style;
    s.left = `${rect[0] * 100}%`;
    s.top = `${rect[1] * 100}%`;
    s.width = `${rect[2] * 100}%`;
    s.height = `${rect[3] * 100}%`;
    this.el.classList.toggle('compact', compact);
    this.tag.textContent = tagText || '';
    this.tag.style.background = tagColor || 'transparent';
    this.tag.classList.toggle('hidden', !tagText);
    this.nitroKey.textContent = nitroKey || '';
  }

  update(car, holder, cameraHeading) {
    const v = Math.round(car.speed * 3.6);
    if (v !== this._c.speed) {
      this.speedVal.textContent = String(v);
      this._c.speed = v;
    }

    const pct = Math.round((car.nitro / CONFIG.NITRO_MAX) * 100);
    if (pct !== this._c.nitro) {
      this.nitroFill.style.transform = `scaleX(${(pct / 100).toFixed(3)})`;
      this._c.nitro = pct;
    }
    const cls = `nitro${car.boosting ? ' boosting' : ''}${car.nitroLocked ? ' locked' : ''}${car.hasCrown ? ' frozen' : ''}`;
    if (cls !== this._c.nitroClass) {
      this.nitro.className = cls;
      this._c.nitroClass = cls;
    }

    // Rotating arrow pointing from the camera view toward the crown holder.
    const hide = !holder || holder === car;
    if (hide !== this._c.pointerHidden) {
      this.pointer.classList.toggle('hidden', hide);
      this._c.pointerHidden = hide;
    }
    if (hide) return;
    const dx = holder.pos.x - car.pos.x;
    const dz = holder.pos.z - car.pos.z;
    const rel = wrapAngle(Math.atan2(dx, dz) - cameraHeading); // +ve = target is to the left
    this.pointerArrow.style.transform = `rotate(${((-rel * 180) / Math.PI).toFixed(1)}deg)`;
    const text = `${holder.name} · ${Math.round(Math.hypot(dx, dz))}m`;
    if (text !== this._c.pointerText) {
      this.pointerLabel.textContent = text;
      this._c.pointerText = text;
    }
  }

  showToast(text, color = '#ffe500') {
    this.toast.textContent = text;
    this.toast.style.color = color;
    this.toast.classList.remove('show');
    void this.toast.offsetWidth; // restart the CSS animation
    this.toast.classList.add('show');
  }

  destroy() {
    this.el.remove();
  }
}

// ---------------------------------------------------------------------------
// Shared HUD + screens. Writes to the DOM only when a value actually changes.
// ---------------------------------------------------------------------------

export class HUD {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.root = $('hud');
    this.views = $('hud-views');
    this.scoreList = $('score-list');
    this.timer = $('timer');
    this.killfeed = $('killfeed');
    this.centerMsg = $('center-msg');

    this.results = $('results');
    this.resultsList = $('results-list');
    this.resultsTitle = $('results-title');
    this.resultsKicker = $('results-kicker');
    this.resultsNote = $('results-note');
    this.againBtn = $('again-btn');
    this.loading = $('loading');
    this.touch = $('touch');
    this.muteBtn = $('mute-btn');

    this.rows = new Map();
    this.playerHuds = [];
    this._cache = { timer: '', center: '' };
  }

  // ----- Screens ------------------------------------------------------------

  showLoading(show) {
    this.loading.classList.toggle('hidden', !show);
  }

  showHUD(show) {
    this.root.classList.toggle('hidden', !show);
    document.body.classList.toggle('playing', show);
  }

  showTouch(show) {
    this.touch.classList.toggle('hidden', !show);
    document.body.classList.toggle('touch', show);
  }

  setMuteIcon(muted) {
    this.muteBtn.classList.toggle('muted', muted);
    this.muteBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
  }

  /** Create one PlayerHUD per split-screen view. */
  buildPlayerHuds(views) {
    for (const h of this.playerHuds) h.destroy();
    this.playerHuds = views.map((view) => {
      const h = new PlayerHUD(this.views);
      h.configure(view.hudConfig);
      return h;
    });
    document.body.classList.toggle('split', views.length > 1);
    return this.playerHuds;
  }

  // ----- Scoreboard ---------------------------------------------------------

  buildScoreboard(cars, localCars) {
    this.scoreList.textContent = '';
    this.rows.clear();
    for (const car of cars) {
      const li = document.createElement('li');
      if (localCars.includes(car)) li.classList.add('is-player');
      li.innerHTML = `<span class="dot"></span><span class="name"></span><span class="time">0.0s</span>${CROWN_SVG}`;
      li.querySelector('.dot').style.background = hex(car.color);
      li.querySelector('.name').textContent = car.name;
      this.scoreList.appendChild(li);
      this.rows.set(car.id, { li, time: li.querySelector('.time'), lastText: '0.0s', lastCrown: false, lastOrder: -1 });
    }
  }

  updateScoreboard(cars) {
    const sorted = cars.slice().sort((a, b) => b.holdTime - a.holdTime);
    for (let i = 0; i < sorted.length; i++) {
      const car = sorted[i];
      const row = this.rows.get(car.id);
      if (!row) continue;
      const text = formatHold(car.holdTime);
      if (text !== row.lastText) {
        row.time.textContent = text;
        row.lastText = text;
      }
      if (row.lastCrown !== car.hasCrown) {
        row.li.classList.toggle('has-crown', car.hasCrown);
        row.lastCrown = car.hasCrown;
      }
      if (row.lastOrder !== i) {
        row.li.style.order = String(i);
        row.lastOrder = i;
      }
    }
  }

  // ----- Timer / messages ---------------------------------------------------

  setTimer(seconds) {
    const text = formatClock(seconds);
    if (text !== this._cache.timer) {
      this.timer.textContent = text;
      this._cache.timer = text;
    }
    this.timer.classList.toggle('urgent', seconds <= 10 && seconds > 0);
  }

  setCenter(text, animate = true) {
    if (text === this._cache.center) return;
    this._cache.center = text;
    this.centerMsg.textContent = text;
    this.centerMsg.classList.remove('pop');
    if (text && animate) {
      void this.centerMsg.offsetWidth;
      this.centerMsg.classList.add('pop');
    }
  }

  pushFeed(text, color) {
    const li = document.createElement('li');
    li.textContent = text;
    li.style.borderLeft = `5px solid ${color}`;
    this.killfeed.appendChild(li);
    while (this.killfeed.children.length > 4) this.killfeed.removeChild(this.killfeed.firstChild);
    setTimeout(() => li.remove(), 4500);
  }

  clearFeed() {
    this.killfeed.textContent = '';
    this.setCenter('', false);
  }

  // ----- Results ------------------------------------------------------------

  /**
   * @param {Array} sorted cars ranked by hold time
   * @param {Array} localCars cars driven on this device
   * @param {{canRestart: boolean, note: string}} opts
   */
  showResults(sorted, localCars, opts) {
    const best = Math.max(sorted[0].holdTime, 0.001);
    const winner = sorted[0];
    if (localCars.length === 1) {
      const rank = sorted.indexOf(localCars[0]) + 1;
      this.resultsKicker.textContent = rank === 1 ? 'Crown champion!' : "Time's up!";
      this.resultsTitle.textContent = rank === 1 ? 'YOU WIN!' : `You placed #${rank}`;
    } else {
      this.resultsKicker.textContent = "Time's up!";
      this.resultsTitle.textContent = `${winner.name} wins!`;
    }
    this.resultsList.textContent = '';
    sorted.forEach((car, i) => {
      const li = document.createElement('li');
      if (i === 0) li.classList.add('first');
      if (localCars.includes(car)) li.classList.add('you');
      li.innerHTML =
        '<span class="bar"></span><span class="rank"></span><span class="swatch"></span><span class="rname"></span><span class="rtime"></span>';
      li.querySelector('.bar').style.width = `${Math.round((car.holdTime / best) * 100)}%`;
      li.querySelector('.rank').textContent = `#${i + 1}`;
      li.querySelector('.swatch').style.background = hex(car.color);
      li.querySelector('.rname').textContent = car.isBot ? `${car.name} (bot)` : car.name;
      li.querySelector('.rtime').textContent = formatHold(car.holdTime);
      this.resultsList.appendChild(li);
    });
    this.againBtn.classList.toggle('hidden', !opts.canRestart);
    this.resultsNote.textContent = opts.note || '';
    this.resultsNote.classList.toggle('hidden', !opts.note);
    this.results.classList.remove('hidden');
  }

  hideResults() {
    this.results.classList.add('hidden');
  }
}
