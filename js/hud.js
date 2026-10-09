import { CONFIG, wrapAngle } from './config.js';

const CROWN_SVG =
  '<svg class="crown-ico" viewBox="0 0 64 48"><path d="M6 40 L2 12 L18 24 L32 4 L46 24 L62 12 L58 40 Z" fill="#ffe500" stroke="#b88a00" stroke-width="4" stroke-linejoin="round"/></svg>';

function hex(color) {
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

/** Thin DOM layer: writes only when a value actually changes. */
export class HUD {
  constructor() {
    const $ = (id) => document.getElementById(id);
    this.root = $('hud');
    this.scoreList = $('score-list');
    this.timer = $('timer');
    this.pointer = $('crown-pointer');
    this.pointerArrow = $('pointer-arrow');
    this.pointerLabel = $('pointer-label');
    this.killfeed = $('killfeed');
    this.toast = $('toast');
    this.centerMsg = $('center-msg');
    this.speedVal = $('speed-val');
    this.nitro = $('nitro');
    this.nitroFill = $('nitro-fill');

    this.menu = $('menu');
    this.pause = $('pause');
    this.results = $('results');
    this.resultsList = $('results-list');
    this.resultsTitle = $('results-title');
    this.resultsKicker = $('results-kicker');
    this.loading = $('loading');
    this.touch = $('touch');
    this.muteBtn = $('mute-btn');

    this.rows = new Map();
    this._cache = { timer: '', speed: -1, nitro: -1, center: '', pointerText: '', nitroClass: '' };
    this._toastTimer = 0;
  }

  // ----- Screens ------------------------------------------------------------

  showLoading(show) {
    this.loading.classList.toggle('hidden', !show);
  }

  showMenu(show) {
    this.menu.classList.toggle('hidden', !show);
  }

  showPause(show) {
    this.pause.classList.toggle('hidden', !show);
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

  // ----- Scoreboard ---------------------------------------------------------

  buildScoreboard(cars) {
    this.scoreList.textContent = '';
    this.rows.clear();
    for (const car of cars) {
      const li = document.createElement('li');
      if (car.isPlayer) li.classList.add('is-player');
      li.innerHTML = `<span class="dot"></span><span class="name"></span><span class="time">0.0s</span>${CROWN_SVG}`;
      li.querySelector('.dot').style.background = hex(car.color);
      li.querySelector('.name').textContent = car.isPlayer ? 'YOU' : car.name;
      this.scoreList.appendChild(li);
      this.rows.set(car.id, {
        li,
        time: li.querySelector('.time'),
        lastText: '0.0s',
        lastCrown: false,
        lastOrder: -1,
      });
    }
  }

  updateScoreboard(cars) {
    // Rank by hold time (stable for ties: original order).
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

  // ----- Timer / meters -----------------------------------------------------

  setTimer(seconds) {
    const text = formatClock(seconds);
    if (text !== this._cache.timer) {
      this.timer.textContent = text;
      this._cache.timer = text;
    }
    this.timer.classList.toggle('urgent', seconds <= 10 && seconds > 0);
  }

  setSpeed(kmh) {
    const v = Math.round(kmh);
    if (v !== this._cache.speed) {
      this.speedVal.textContent = String(v);
      this._cache.speed = v;
    }
  }

  setNitro(car) {
    const pct = Math.round((car.nitro / CONFIG.NITRO_MAX) * 100);
    if (pct !== this._cache.nitro) {
      this.nitroFill.style.transform = `scaleX(${(pct / 100).toFixed(3)})`;
      this._cache.nitro = pct;
    }
    const cls = `${car.boosting ? 'boosting ' : ''}${car.nitroLocked ? 'locked ' : ''}${car.hasCrown ? 'frozen' : ''}`;
    if (cls !== this._cache.nitroClass) {
      this.nitro.className = cls;
      this._cache.nitroClass = cls;
    }
  }

  // ----- Messages -----------------------------------------------------------

  setCenter(text, animate = true) {
    if (text === this._cache.center) return;
    this._cache.center = text;
    this.centerMsg.textContent = text;
    this.centerMsg.classList.remove('pop');
    if (text && animate) {
      void this.centerMsg.offsetWidth; // restart the CSS animation
      this.centerMsg.classList.add('pop');
    }
  }

  showToast(text, color = '#ffe500') {
    this.toast.textContent = text;
    this.toast.style.color = color;
    this.toast.classList.remove('show');
    void this.toast.offsetWidth;
    this.toast.classList.add('show');
  }

  pushFeed(text, color) {
    const li = document.createElement('li');
    li.textContent = text;
    li.style.borderLeft = `5px solid ${color}`;
    this.killfeed.appendChild(li);
    while (this.killfeed.children.length > 4) this.killfeed.removeChild(this.killfeed.firstChild);
    setTimeout(() => {
      if (li.parentNode) li.parentNode.removeChild(li);
    }, 4500);
  }

  clearFeed() {
    this.killfeed.textContent = '';
    this.toast.classList.remove('show');
    this.setCenter('', false);
  }

  /**
   * Rotating arrow below the timer pointing from the camera view toward the crown holder.
   * Hidden while the player holds the crown.
   */
  updatePointer(player, holder, cameraHeading) {
    if (!holder || holder === player) {
      this.pointer.classList.add('hidden');
      return;
    }
    this.pointer.classList.remove('hidden');
    const dx = holder.pos.x - player.pos.x;
    const dz = holder.pos.z - player.pos.z;
    const rel = wrapAngle(Math.atan2(dx, dz) - cameraHeading); // +ve = target is to the left
    const deg = (-rel * 180) / Math.PI;
    this.pointerArrow.style.transform = `rotate(${deg.toFixed(1)}deg)`;
    const text = `${holder.name} - ${Math.round(Math.hypot(dx, dz))}m`;
    if (text !== this._cache.pointerText) {
      this.pointerLabel.textContent = text;
      this._cache.pointerText = text;
    }
  }

  // ----- Results ------------------------------------------------------------

  showResults(sorted, player) {
    const best = Math.max(sorted[0].holdTime, 0.001);
    const rank = sorted.indexOf(player) + 1;
    this.resultsKicker.textContent = rank === 1 ? 'Crown champion!' : "Time's up!";
    this.resultsTitle.textContent = rank === 1 ? 'YOU WIN!' : `You placed #${rank}`;
    this.resultsList.textContent = '';
    sorted.forEach((car, i) => {
      const li = document.createElement('li');
      if (i === 0) li.classList.add('first');
      if (car.isPlayer) li.classList.add('you');
      li.innerHTML =
        '<span class="bar"></span><span class="rank"></span><span class="swatch"></span><span class="rname"></span><span class="rtime"></span>';
      li.querySelector('.bar').style.width = `${Math.round((car.holdTime / best) * 100)}%`;
      li.querySelector('.rank').textContent = `#${i + 1}`;
      li.querySelector('.swatch').style.background = hex(car.color);
      li.querySelector('.rname').textContent = car.isPlayer ? 'YOU' : car.name;
      li.querySelector('.rtime').textContent = formatHold(car.holdTime);
      this.resultsList.appendChild(li);
    });
    this.results.classList.remove('hidden');
  }

  hideResults() {
    this.results.classList.add('hidden');
  }
}
