/**
 * Pomodoro: a chronograph-style floating app for the DSH workspace.
 *
 * It is NOT a conversation view any more. The plugin contributes two
 * registrations:
 *   1. a compact pill in `conversation.session.header.utilities` that opens
 *      the app and mirrors the live countdown while it runs;
 *   2. the app window itself in `shell.overlay`, a draggable, standalone
 *      instrument panel that floats above every column.
 *
 * Aesthetic direction: fine watchmaking. Serif chronometer numerals, a
 * guilloché dial, hairline bezels, one restrained vermilion accent that
 * turns teal for short breaks and amber for long breaks. The timer lives in
 * a browser-side store, keeps counting across Sessions and Views, and its
 * state survives a reload through local storage. Nothing leaves the browser.
 */
window.__ModuleLoader__.load({
  id: 'dsh-pomodoro-view',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Dictionary namespace owned by this plugin. */
    const NS = 'pomodoro'
    /** Package name; also the module-loader factory id and the style owner. */
    const PLUGIN_ID = 'dsh-pomodoro-view'
    const STATE_KEY = 'dsh-pomodoro:state'
    const SETTINGS_KEY = 'dsh-pomodoro:settings'
    const WINDOW_KEY = '***'
    /** Window width in CSS pixels, shared by the clamp math and the CSS. */
    const PANEL_WIDTH = 340
    /** Conservative heights before the body has measured itself. */
    const PANEL_HEIGHT_CLOSED = 470
    const PANEL_HEIGHT_SETTINGS = 720
    /** Keep the window clear of the draggable chrome strip on macOS. */
    const CHROME_EDGE = 12
    /** Phase order shown on the mode rail. */
    const PHASES = ['focus', 'short', 'long']
    const MINUTE = 60000
    const DAY = 24 * 60 * MINUTE

    /** Simplified Chinese dictionary (the key-set source of truth). */
    const zh = {
      'view.pomodoro': '番茄钟',
      'app.title': '番茄钟',
      'app.subtitle': 'POMODORO TIMER',
      'phase.focus': '专注',
      'phase.short': '短休',
      'phase.long': '长休',
      'status.idle': '待命',
      'status.running': '计时中',
      'status.paused': '已暂停',
      'action.start': '开始',
      'action.pause': '暂停',
      'action.resume': '继续',
      'action.reset': '重置',
      'action.skip': '跳过',
      'action.close': '关闭',
      'action.settings': '设置',
      'today.stat': '今日 {count} 个专注 · {minutes} 分钟',
      'today.none': '今日暂无完成的专注',
      'cycle.aria': '本轮已完成 {done}/{total} 个专注',
      'modes.aria': '选择阶段',
      'settings.title': '时长与提醒',
      'settings.focus': '专注',
      'settings.short': '短休',
      'settings.long': '长休',
      'settings.interval': '长休间隔',
      'unit.minutes': '{count} 分',
      'unit.focusCount': '{count} 个',
      'step.decrease': '减少',
      'step.increase': '增加',
      'switch.autoBreak': '自动开始休息',
      'switch.autoFocus': '自动开始下一轮专注',
      'switch.sound': '阶段结束提示音',
      'note': '计时跨会话持续运行，数据仅存本机浏览器。',
      'open.aria': '打开番茄钟',
      'alert.aria': '有阶段刚刚结束',
    }

    /** English dictionary; every key of the Chinese dictionary is covered. */
    const en = {
      'view.pomodoro': 'Pomodoro',
      'app.title': 'Pomodoro',
      'app.subtitle': 'FOCUS TIMER',
      'phase.focus': 'Focus',
      'phase.short': 'Short break',
      'phase.long': 'Long break',
      'status.idle': 'Standby',
      'status.running': 'Running',
      'status.paused': 'Paused',
      'action.start': 'Start',
      'action.pause': 'Pause',
      'action.resume': 'Resume',
      'action.reset': 'Reset',
      'action.skip': 'Skip',
      'action.close': 'Close',
      'action.settings': 'Settings',
      'today.stat': '{count} focus sessions · {minutes} min today',
      'today.none': 'No focus session finished today',
      'cycle.aria': '{done} of {total} focus sessions in this cycle',
      'modes.aria': 'Choose a phase',
      'settings.title': 'Durations and alerts',
      'settings.focus': 'Focus',
      'settings.short': 'Short break',
      'settings.long': 'Long break',
      'settings.interval': 'Long break every',
      'unit.minutes': '{count} min',
      'unit.focusCount': '{count} sessions',
      'step.decrease': 'Decrease',
      'step.increase': 'Increase',
      'switch.autoBreak': 'Start breaks automatically',
      'switch.autoFocus': 'Start the next focus automatically',
      'switch.sound': 'Chime when a phase ends',
      'note': 'The timer keeps running across Sessions; its data stays in this browser.',
      'open.aria': 'Open the Pomodoro app',
      'alert.aria': 'A phase just ended',
    }

    /**
     * Read one JSON value from local storage.
     * @param key - storage key.
     * @param fallback - value used when storage is empty, blocked, or malformed.
     * @returns the stored value, or the fallback.
     */
    function readJson(key, fallback) {
      try {
        const raw = window.localStorage.getItem(key)
        if (raw === null || raw === '') return fallback
        const parsed = JSON.parse(raw)
        return parsed !== null && typeof parsed === 'object' ? parsed : fallback
      } catch {
        return fallback
      }
    }

    /**
     * Write one JSON value to local storage, ignoring quota and privacy-mode failures.
     * @param key - storage key.
     * @param value - value to serialize.
     */
    function writeJson(key, value) {
      try {
        window.localStorage.setItem(key, JSON.stringify(value))
      } catch {
        // A blocked or full store only costs reload persistence.
      }
    }

    /**
     * Clamp a stored number to an integer range.
     * @param value - candidate value.
     * @param min - lowest accepted value.
     * @param max - highest accepted value.
     * @param fallback - value used when the candidate is not a finite number.
     * @returns the clamped integer.
     */
    function clampInt(value, min, max, fallback) {
      if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
      return Math.min(max, Math.max(min, Math.round(value)))
    }

    /** Local calendar day key, so the daily counters roll over at midnight. */
    function todayKey() {
      const now = new Date()
      const pad = value => String(value).padStart(2, '0')
      return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
    }

    /** Editable durations and options, in the order the settings list shows them. */
    const FIELDS = [
      { key: 'focusMin', label: 'settings.focus', unit: 'unit.minutes', min: 1, max: 120, step: 5 },
      { key: 'shortMin', label: 'settings.short', unit: 'unit.minutes', min: 1, max: 60, step: 1 },
      { key: 'longMin', label: 'settings.long', unit: 'unit.minutes', min: 1, max: 90, step: 5 },
      { key: 'longEvery', label: 'settings.interval', unit: 'unit.focusCount', min: 2, max: 8, step: 1 },
    ]

    /** Boolean options shown under the durations. */
    const FLAGS = [
      { key: 'autoBreak', label: 'switch.autoBreak' },
      { key: 'autoFocus', label: 'switch.autoFocus' },
      { key: 'sound', label: 'switch.sound' },
    ]

    /** Default durations: the classic 25 / 5 / 15 with a long break every fourth focus. */
    function defaultSettings() {
      return { focusMin: 25, shortMin: 5, longMin: 15, longEvery: 4, autoBreak: true, autoFocus: false, sound: true }
    }

    /**
     * Coerce stored settings into the accepted ranges.
     * @param raw - untrusted stored object.
     * @returns a complete settings object.
     */
    function normalizeSettings(raw) {
      const base = defaultSettings()
      const source = raw !== null && typeof raw === 'object' ? raw : {}
      const out = { ...base }
      for (const field of FIELDS) out[field.key] = clampInt(source[field.key], field.min, field.max, base[field.key])
      for (const flag of FLAGS) {
        if (typeof source[flag.key] === 'boolean') out[flag.key] = source[flag.key]
      }
      return out
    }

    /**
     * Phase length in milliseconds.
     * @param settings - current settings.
     * @param phase - phase id.
     * @returns the duration that phase gets when it is staged.
     */
    function durationOf(settings, phase) {
      const minutes = phase === 'focus' ? settings.focusMin : phase === 'short' ? settings.shortMin : settings.longMin
      return minutes * MINUTE
    }

    /**
     * The phase that follows one phase, including the cycle bookkeeping.
     * @param phase - phase that just ended.
     * @param cycle - focus sessions completed in the current cycle.
     * @param settings - current settings.
     * @returns the next phase and the cycle counter it starts with.
     */
    function nextPhaseAfter(phase, cycle, settings) {
      if (phase === 'focus') {
        return cycle >= settings.longEvery ? { phase: 'long', cycle } : { phase: 'short', cycle }
      }
      return { phase: 'focus', cycle: phase === 'long' ? 0 : cycle }
    }

    /**
     * Format a remaining duration as MM:SS, rounding up so a running timer
     * shows 00:01 for the last partial second.
     * @param ms - remaining milliseconds.
     * @returns the clock text.
     */
    function formatClock(ms) {
      const total = Math.max(0, Math.ceil(ms / 1000))
      const minutes = Math.floor(total / 60)
      const seconds = total % 60
      return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    }

    /** Lazily created audio context, shared by every chime. */
    let audio = null

    /**
     * Create or resume the audio context inside a user gesture. Browsers keep a
     * context suspended until a gesture has unlocked it, and a phase can only
     * end later from a timer callback, so unlocking has to happen on a click.
     */
    function primeAudio() {
      try {
        const Ctor = window.AudioContext || window.webkitAudioContext
        if (typeof Ctor !== 'function') return
        if (audio === null) audio = new Ctor()
        if (audio.state === 'suspended') audio.resume().catch(() => {})
      } catch {
        // Audio unavailable: the window still works without a chime.
      }
    }

    /**
     * Play the three-note phase-end chime.
     * @param settings - current settings (the sound flag is checked first).
     */
    function chime(settings) {
      if (settings.sound !== true) return
      try {
        primeAudio()
        if (audio === null) return
        const start = audio.currentTime
        const notes = [[880, 0], [1174.66, 0.18], [1567.98, 0.36]]
        for (const [frequency, offset] of notes) {
          const osc = audio.createOscillator()
          const gain = audio.createGain()
          osc.type = 'sine'
          osc.frequency.value = frequency
          gain.gain.setValueAtTime(0.0001, start + offset)
          gain.gain.exponentialRampToValueAtTime(0.14, start + offset + 0.02)
          gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.32)
          osc.connect(gain)
          gain.connect(audio.destination)
          osc.start(start + offset)
          osc.stop(start + offset + 0.36)
        }
      } catch {
        // Audio unavailable: the visual phase change still reports completion.
      }
    }

    /**
     * Rebuild the timer state from storage. A phase that finished while the
     * page was closed is credited once and the next phase is staged idle.
     * @param raw - untrusted stored state.
     * @param settings - current settings.
     * @returns a complete timer state.
     */
    function restoreState(raw, settings) {
      const source = raw !== null && typeof raw === 'object' ? raw : {}
      const day = todayKey()
      let phase = PHASES.includes(source.phase) ? source.phase : 'focus'
      let cycle = clampInt(source.cycle, 0, settings.longEvery, 0)
      let count = source.day === day ? clampInt(source.count, 0, 9999, 0) : 0
      let minutes = source.day === day ? clampInt(source.minutes, 0, 999999, 0) : 0
      // The staged length is frozen so a settings edit cannot stretch or shrink
      // a phase that is already in progress.
      let phaseMs = clampInt(source.phaseMs, MINUTE, DAY, durationOf(settings, phase))
      let status = 'idle'
      let remainingMs = phaseMs
      let endsAt = null
      if (source.status === 'running' && typeof source.endsAt === 'number') {
        const left = source.endsAt - Date.now()
        if (left > 0) {
          status = 'running'
          endsAt = source.endsAt
          remainingMs = left
        } else if (phase === 'focus') {
          // The focus session ended while the page was closed: credit it.
          count += 1
          minutes += Math.round(phaseMs / MINUTE)
          cycle = Math.min(cycle + 1, settings.longEvery)
          const next = nextPhaseAfter(phase, cycle, settings)
          phase = next.phase
          cycle = next.cycle
          phaseMs = durationOf(settings, phase)
          remainingMs = phaseMs
        } else {
          const next = nextPhaseAfter(phase, cycle, settings)
          phase = next.phase
          cycle = next.cycle
          phaseMs = durationOf(settings, phase)
          remainingMs = phaseMs
        }
      } else if (source.status === 'paused') {
        status = 'paused'
        remainingMs = clampInt(source.remainingMs, 0, phaseMs, phaseMs)
      }
      return { phase, status, endsAt, remainingMs, phaseMs, cycle, count, minutes, day }
    }

    /**
     * Create the timer store. One instance serves the trigger pill and the
     * floating window; the React side reads it through useSyncExternalStore.
     * @returns the store face.
     */
    function createStore() {
      const settings = normalizeSettings(readJson(SETTINGS_KEY, null))
      let state = restoreState(readJson(STATE_KEY, null), settings)
      let cached = null
      const listeners = new Set()

      /** Remaining milliseconds of the current phase. */
      function remaining() {
        if (state.status !== 'running') return state.remainingMs
        return Math.max(0, state.endsAt - Date.now())
      }

      /** Reset the daily counters when the local calendar day changed. */
      function ensureDay() {
        const day = todayKey()
        if (state.day === day) return
        state = { ...state, day, count: 0, minutes: 0 }
      }

      /** Persist the durable subset of the state. */
      function persist() {
        writeJson(STATE_KEY, {
          phase: state.phase,
          status: state.status,
          endsAt: state.endsAt,
          remainingMs: remaining(),
          phaseMs: state.phaseMs,
          cycle: state.cycle,
          count: state.count,
          minutes: state.minutes,
          day: state.day,
        })
      }

      /** Publish a new snapshot to every mounted outlet. */
      function notify() {
        cached = null
        for (const listener of Array.from(listeners)) {
          try {
            listener()
          } catch (error) {
            console.error('pomodoro: subscriber failed', error)
          }
        }
      }

      /** Publish and persist after a transition. */
      function commit() {
        persist()
        notify()
      }

      return {
        getSnapshot() {
          if (cached !== null) return cached
          cached = {
            phase: state.phase,
            status: state.status,
            remainingMs: remaining(),
            durationMs: state.phaseMs,
            cycle: state.cycle,
            todayCount: state.count,
            todayMinutes: state.minutes,
            settings,
          }
          return cached
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        /** Advance a running countdown; called by the plugin's own interval. */
        tick() {
          if (state.status !== 'running') return
          ensureDay()
          if (Date.now() >= state.endsAt) {
            this.advance(true)
            return
          }
          notify()
        },
        /** Start or resume the current phase. */
        start() {
          if (state.status === 'running') return
          ensureDay()
          const left = state.remainingMs > 0 ? state.remainingMs : state.phaseMs
          state = { ...state, status: 'running', endsAt: Date.now() + left, remainingMs: left }
          commit()
        },
        /** Pause the current phase, keeping its remaining time. */
        pause() {
          if (state.status !== 'running') return
          state = { ...state, status: 'paused', remainingMs: remaining(), endsAt: null }
          commit()
        },
        /** Toggle between running and paused. */
        toggle() {
          if (state.status === 'running') this.pause()
          else this.start()
        },
        /** Restart the current phase at its staged length. */
        reset() {
          state = { ...state, status: 'idle', endsAt: null, remainingMs: state.phaseMs }
          commit()
        },
        /**
         * Switch to another phase at its configured length.
         * @param phase - phase id to stage.
         */
        selectPhase(phase) {
          if (!PHASES.includes(phase)) return
          const phaseMs = durationOf(settings, phase)
          if (phase === state.phase && state.status === 'idle' && state.remainingMs === phaseMs) return
          state = { ...state, phase, status: 'idle', endsAt: null, phaseMs, remainingMs: phaseMs }
          commit()
        },
        /**
         * End the current phase and stage the next one. A phase that is skipped
         * stages the next one idle: automatic starts belong to phases that ran
         * to completion.
         * @param completed - whether the phase ran to completion (credits a
         * focus session and plays the chime) instead of being skipped.
         */
        advance(completed) {
          ensureDay()
          const ended = state.phase
          let cycle = state.cycle
          let count = state.count
          let minutes = state.minutes
          if (ended === 'focus' && completed) {
            count += 1
            minutes += Math.round(state.phaseMs / MINUTE)
            cycle = Math.min(cycle + 1, settings.longEvery)
          }
          const next = nextPhaseAfter(ended, cycle, settings)
          const auto = completed && (ended === 'focus' ? settings.autoBreak : settings.autoFocus)
          const phaseMs = durationOf(settings, next.phase)
          state = {
            ...state,
            phase: next.phase,
            cycle: next.cycle,
            count,
            minutes,
            phaseMs,
            status: auto ? 'running' : 'idle',
            endsAt: auto ? Date.now() + phaseMs : null,
            remainingMs: phaseMs,
          }
          commit()
          if (completed) chime(settings)
        },
        /** Skip the current phase without crediting it. */
        skip() {
          this.advance(false)
        },
        /**
         * Update settings; an idle phase adopts its new length immediately,
         * while a staged or running phase keeps the length it started with.
         * @param patch - partial settings object.
         */
        patchSettings(patch) {
          const next = normalizeSettings({ ...settings, ...patch })
          Object.assign(settings, next)
          writeJson(SETTINGS_KEY, settings)
          if (state.status === 'idle') {
            const phaseMs = durationOf(settings, state.phase)
            state = { ...state, phaseMs, remainingMs: phaseMs }
          }
          if (state.cycle > settings.longEvery) state = { ...state, cycle: settings.longEvery }
          commit()
        },
      }
    }

    /**
     * Create the window/panel store: open flag, a "phase ended while closed"
     * alert, the settings-drawer flag, and the remembered window position.
     * @returns the panel face.
     */
    function createPanel() {
      const saved = readJson(WINDOW_KEY, {})
      let open = false
      let settingsOpen = false
      let alert = false
      let size = { height: PANEL_HEIGHT_CLOSED }
      let x = clampInt(saved.x, -9999, 99999, null)
      let y = clampInt(saved.y, -9999, 99999, null)
      let hasPosition = typeof saved.x === 'number' && typeof saved.y === 'number'
      // A position saved on a larger screen can sit fully off-screen now.
      if (hasPosition) {
        x = Math.min(Math.max(CHROME_EDGE, x), Math.max(CHROME_EDGE, window.innerWidth - PANEL_WIDTH - CHROME_EDGE))
        y = Math.min(Math.max(CHROME_EDGE, y), Math.max(CHROME_EDGE, window.innerHeight - size.height - CHROME_EDGE))
      }
      const listeners = new Set()
      let cached = null

      function notify() {
        cached = null
        for (const listener of Array.from(listeners)) {
          try {
            listener()
          } catch (error) {
            console.error('pomodoro: panel subscriber failed', error)
          }
        }
      }
      // Coalesce the burst of writes a drag produces into one settled save.
      let persistTimer = null
      function persistPosition() {
        if (persistTimer !== null) window.clearTimeout(persistTimer)
        persistTimer = window.setTimeout(() => {
          persistTimer = null
          writeJson(WINDOW_KEY, { x, y })
        }, 200)
      }

      return {
        getSnapshot() {
          if (cached !== null) return cached
          cached = { open, settingsOpen, alert, x: hasPosition ? x : null, y: hasPosition ? y : null, hasPosition }
          return cached
        },
        subscribe(listener) {
          listeners.add(listener)
          return () => {
            listeners.delete(listener)
          }
        },
        toggleOpen() {
          open = !open
          if (open) alert = false
          notify()
        },
        close() {
          if (!open) return
          open = false
          settingsOpen = false
          notify()
        },
        /** Flag the pill when a phase boundary passed with the window closed. */
        markEnded() {
          if (open) return
          alert = true
          notify()
        },
        toggleSettings() {
          settingsOpen = !settingsOpen
          notify()
        },
        /**
         * Move the window to a viewport-clamped position and remember it.
         * @param nextX - viewport x in CSS pixels.
         * @param nextY - viewport y in CSS pixels.
         */
        moveTo(nextX, nextY) {
          x = Math.min(Math.max(CHROME_EDGE, nextX), Math.max(CHROME_EDGE, window.innerWidth - PANEL_WIDTH - CHROME_EDGE))
          y = Math.min(Math.max(CHROME_EDGE, nextY), Math.max(CHROME_EDGE, window.innerHeight - size.height - CHROME_EDGE))
          hasPosition = true
          persistPosition()
          notify()
        },
        /** Publish the measured window height so later clamps use the truth. */
        measure(heightPx) {
          const next = clampInt(heightPx, 200, 1200, size.height)
          if (next === size.height) return
          size = { height: next }
          if (!hasPosition) {
            notify()
            return
          }
          const clampedX = Math.min(Math.max(CHROME_EDGE, x), Math.max(CHROME_EDGE, window.innerWidth - PANEL_WIDTH - CHROME_EDGE))
          const clampedY = Math.min(Math.max(CHROME_EDGE, y), Math.max(CHROME_EDGE, window.innerHeight - next - CHROME_EDGE))
          if (clampedX !== x || clampedY !== y) {
            x = clampedX
            y = clampedY
            persistPosition()
          }
          notify()
        },
      }
    }

    /** Component styles; the module loader tags and removes this element. */
    const CSS = `
/* ---------- shared surfaces ---------- */
.dsh-pomo {
  --pomo-accent: #d9573f;
  --pomo-accent-soft: color-mix(in srgb, #d9573f 14%, transparent);
  --pomo-serif: 'Didot', 'Bodoni MT', 'Playfair Display', Georgia, 'Times New Roman', 'Songti SC', serif;
  --pomo-sans: var(--dsw-font-family);
  --pomo-on-accent: #fff6f2;
}
.dsh-pomo[data-phase='short'] {
  --pomo-accent: #2e9e8f;
  --pomo-accent-soft: color-mix(in srgb, #2e9e8f 14%, transparent);
  --pomo-on-accent: #f2fbf9;
}
.dsh-pomo[data-phase='long'] {
  --pomo-accent: #d9932f;
  --pomo-accent-soft: color-mix(in srgb, #d9932f 16%, transparent);
  --pomo-on-accent: #241704;
}

/* visually-hidden text for assistive technology */
.dsh-pomo__sr {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

/* ---------- header utility pill ---------- */
.dsh-pomo__pill {
  appearance: none;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 28px;
  padding: 0 10px 0 8px;
  border: 0.5px solid var(--dsw-alias-border-l1);
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxs-12);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease;
}
@media (hover: hover) {
  .dsh-pomo__pill:hover {
    background: var(--dsw-alias-interactive-bg-hover);
    color: var(--dsw-alias-label-primary);
  }
}
.dsh-pomo__pill:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}
.dsh-pomo__pillMark { display: block; width: 14px; height: 14px; color: var(--pomo-accent); }
.dsh-pomo__pillTime { letter-spacing: 0.02em; }
.dsh-pomo__pillAlert {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--pomo-accent);
  box-shadow: 0 0 0 2px var(--pomo-accent-soft);
  animation: dsh-pomo-alert 1.6s ease-in-out infinite;
}
@keyframes dsh-pomo-alert {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.35; }
}

/* ---------- floating app window ---------- */
.dsh-pomo__window {
  position: fixed;
  z-index: 900;
  width: 340px;
  max-height: calc(100dvh - 24px);
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 22px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  box-shadow: var(--dsw-elevation-prominent, 0 24px 64px rgba(15, 17, 21, 0.28));
  font-family: var(--pomo-sans);
  user-select: none;
  animation: dsh-pomo-enter 220ms cubic-bezier(0.2, 0.9, 0.25, 1);
}
@keyframes dsh-pomo-enter {
  from { opacity: 0; transform: translateY(10px) scale(0.985); }
  to { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .dsh-pomo__window { animation: none; }
  .dsh-pomo__pillAlert,
  .dsh-pomo__dial[data-running='true'] .dsh-pomo__status::after { animation: none; }
}
.dsh-pomo__window[data-dragging='true'] { animation: none; transition: none; }

/* header strip: the drag handle */
.dsh-pomo__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 12px 4px 20px;
  cursor: grab;
  touch-action: none;
}
.dsh-pomo__window[data-dragging='true'] .dsh-pomo__head { cursor: grabbing; }
.dsh-pomo__mark { flex: none; width: 16px; height: 16px; color: var(--pomo-accent); }
.dsh-pomo__title {
  display: flex;
  flex-direction: column;
  min-width: 0;
  line-height: 1.15;
}
.dsh-pomo__titleName { font: var(--dsw-font-xs-strong-13); }
.dsh-pomo__titleSub {
  font-size: 9px;
  letter-spacing: 0.22em;
  color: var(--dsw-alias-label-tertiary);
  text-transform: uppercase;
}
.dsh-pomo__iconBtn {
  appearance: none;
  flex: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}
@media (hover: hover) {
  .dsh-pomo__iconBtn:hover {
    background: var(--dsw-alias-interactive-bg-hover);
    color: var(--dsw-alias-label-primary);
  }
}
.dsh-pomo__iconBtn:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}
.dsh-pomo__iconBtn[data-active='true'] { color: var(--pomo-accent); }
.dsh-pomo__glyph { width: 14px; height: 14px; display: block; }
.dsh-pomo__spacer { flex: 1; }

/* body */
.dsh-pomo__body {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 6px 20px 16px;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;
}

/* dial */
.dsh-pomo__dial {
  position: relative;
  width: 216px;
  height: 216px;
}
.dsh-pomo__face {
  position: absolute;
  inset: 10px;
  border-radius: 50%;
  background:
    radial-gradient(circle at 50% 38%, var(--dsw-alias-bg-layer-2), transparent 62%),
    repeating-radial-gradient(circle at 50% 50%, transparent 0 4px, color-mix(in srgb, var(--dsw-alias-label-tertiary) 6%, transparent) 4px 4.6px),
    var(--dsw-alias-bg-layer-1);
  border: 0.5px solid var(--dsw-alias-border-l1);
}
.dsh-pomo__svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.dsh-pomo__track { stroke: var(--dsw-alias-border-l2); }
.dsh-pomo__progress {
  stroke: var(--pomo-accent);
  transition: stroke-dashoffset 240ms linear, stroke 300ms ease;
  filter: drop-shadow(0 0 6px var(--pomo-accent-soft));
}
.dsh-pomo__tick { stroke: var(--dsw-alias-label-tertiary); opacity: 0.4; }
.dsh-pomo__tick--major { stroke: var(--dsw-alias-label-secondary); opacity: 0.65; }
@media (prefers-reduced-motion: reduce) {
  .dsh-pomo__progress { transition: none; }
}
.dsh-pomo__center {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
}
.dsh-pomo__time {
  font-family: var(--pomo-serif);
  font-size: 44px;
  line-height: 1;
  letter-spacing: 0.01em;
  font-variant-numeric: tabular-nums lining-nums;
}
.dsh-pomo__phase {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--pomo-accent) 72%, var(--dsw-alias-label-primary));
  padding-left: 0.32em;
}
.dsh-pomo__status {
  font: var(--dsw-font-xxxs-11);
  color: var(--dsw-alias-label-tertiary);
  letter-spacing: 0.06em;
}
.dsh-pomo__dial[data-running='true'] .dsh-pomo__status::after {
  content: '';
  display: inline-block;
  width: 5px;
  height: 5px;
  margin-left: 5px;
  border-radius: 50%;
  background: var(--pomo-accent);
  vertical-align: 1px;
  animation: dsh-pomo-alert 1.8s ease-in-out infinite;
}

/* mode rail + cycle */
.dsh-pomo__rail { display: flex; align-items: center; gap: 8px; }
.dsh-pomo__mode {
  appearance: none;
  padding: 4px 10px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  letter-spacing: 0.12em;
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease;
}
@media (hover: hover) {
  .dsh-pomo__mode:hover {
    background: var(--dsw-alias-interactive-bg-hover);
    color: var(--dsw-alias-label-primary);
  }
}
.dsh-pomo__mode:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}
.dsh-pomo__mode[data-active='true'] {
  background: var(--pomo-accent-soft);
  color: color-mix(in srgb, var(--pomo-accent) 72%, var(--dsw-alias-label-primary));
  font-weight: 600;
}
.dsh-pomo__dots { display: flex; gap: 5px; }
.dsh-pomo__dot {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--dsw-alias-border-l3);
  transition: background 200ms ease;
}
.dsh-pomo__dot[data-done='true'] { background: var(--pomo-accent); }

/* control row */
.dsh-pomo__controls { display: flex; align-items: center; gap: 16px; }
.dsh-pomo__ghost {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  padding: 0;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 50%;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  transition: background 140ms ease, color 140ms ease, border-color 140ms ease, opacity 140ms ease;
}
@media (hover: hover) {
  .dsh-pomo__ghost:hover:not(:disabled) {
    border-color: var(--dsw-alias-border-l3);
    background: var(--dsw-alias-interactive-bg-hover);
    color: var(--dsw-alias-label-primary);
  }
}
.dsh-pomo__ghost:disabled { opacity: 0.35; cursor: default; }
.dsh-pomo__ghost:focus-visible,
.dsh-pomo__go:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 2px;
}
.dsh-pomo__go {
  appearance: none;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 58px;
  height: 58px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: var(--pomo-accent);
  color: var(--pomo-on-accent);
  cursor: pointer;
  box-shadow: 0 6px 18px var(--pomo-accent-soft);
  transition: transform 140ms ease, filter 140ms ease;
}
@media (hover: hover) {
  .dsh-pomo__go:hover { filter: brightness(1.06); transform: translateY(-1px); }
}
.dsh-pomo__go:active { transform: scale(0.96); }
.dsh-pomo__go svg { width: 20px; height: 20px; }
.dsh-pomo__go[data-running='true'] { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); box-shadow: none; border: 0.5px solid var(--dsw-alias-border-l2); }

/* footer */
.dsh-pomo__foot {
  display: flex;
  width: 100%;
  flex-direction: column;
  gap: 4px;
  padding-top: 10px;
  border-top: 0.5px solid var(--dsw-alias-border-l1);
}
.dsh-pomo__today {
  text-align: center;
  font: var(--dsw-font-xxs-12);
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
}
.dsh-pomo__note {
  margin: 0;
  text-align: center;
  font-size: 10px;
  color: var(--dsw-alias-label-tertiary);
}

/* settings drawer */
.dsh-pomo__settings {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 260ms cubic-bezier(0.2, 0.9, 0.25, 1);
}
.dsh-pomo__settings[data-open='true'] { grid-template-rows: 1fr; }
.dsh-pomo__settingsInner {
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 20px;
}
.dsh-pomo__settings[data-open='true'] .dsh-pomo__settingsInner { padding: 4px 20px 16px; }
@media (prefers-reduced-motion: reduce) {
  .dsh-pomo__settings { transition: none; }
}
.dsh-pomo__settingsTitle {
  font-size: 9px;
  font-weight: 600;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--dsw-alias-label-tertiary);
}
.dsh-pomo__field { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dsh-pomo__fieldLabel { font: var(--dsw-font-xxs-12); color: var(--dsw-alias-label-secondary); }
.dsh-pomo__stepper {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 1px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 999px;
}
.dsh-pomo__step {
  appearance: none;
  display: flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}
@media (hover: hover) {
  .dsh-pomo__step:hover:not(:disabled) {
    background: var(--dsw-alias-interactive-bg-hover);
    color: var(--dsw-alias-label-primary);
  }
}
.dsh-pomo__step:disabled { opacity: 0.35; cursor: default; }
.dsh-pomo__step:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}
.dsh-pomo__value {
  min-width: 52px;
  text-align: center;
  font: var(--dsw-font-xxs-12);
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-primary);
}
.dsh-pomo__switchRow {
  appearance: none;
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 3px 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: var(--dsw-font-xxs-12);
  text-align: left;
  cursor: pointer;
}
@media (hover: hover) {
  .dsh-pomo__switchRow:hover { color: var(--dsw-alias-label-primary); }
}
.dsh-pomo__switchRow:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary);
  outline-offset: 1px;
}
.dsh-pomo__switchTrack {
  position: relative;
  flex: none;
  width: 30px;
  height: 18px;
  border-radius: 999px;
  background: var(--dsw-alias-border-l3);
  transition: background 140ms ease;
}
.dsh-pomo__switchRow[aria-checked='true'] .dsh-pomo__switchTrack { background: var(--pomo-accent); }
.dsh-pomo__switchThumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--dsw-alias-switch-thumb);
  transition: transform 140ms ease;
}
.dsh-pomo__switchRow[aria-checked='true'] .dsh-pomo__switchThumb { transform: translateX(12px); }
`

    const TAG_ID = `${PLUGIN_ID}/pomodoro.css`
    if (typeof document !== 'undefined' && document.querySelector(`style[data-plugin-css=${JSON.stringify(TAG_ID)}]`) === null) {
      const tag = document.createElement('style')
      tag.dataset.plugin = PLUGIN_ID
      tag.dataset.pluginCss = TAG_ID
      tag.textContent = CSS
      document.head.appendChild(tag)
    }

    /** Inline artwork: the tomato dial mark used on the pill and header. */
    function TomatoMark(props) {
      const { size, className } = props
      return h('svg', {
        viewBox: '0 0 20 20', width: size, height: size, 'aria-hidden': true,
        className: className === undefined ? 'dsh-pomo__mark' : className, fill: 'currentColor',
      },
      h('circle', { cx: 10, cy: 11.4, r: 7.2 }),
      h('path', { d: 'M10 5.6c-2 0-3.5-.6-4.4-1.6C7 2.9 8.7 3.2 10 4.2c1.3-1 3-1.3 4.4-.2-.9 1-2.4 1.6-4.4 1.6Z' }))
    }

    /** SVG glyph helper: draws a fixed path inside a 14 or 20 box. */
    function Glyph(props) {
      const { d, size, cls } = props
      return h('svg', {
        viewBox: '0 0 20 20', width: size, height: size, 'aria-hidden': true,
        className: cls, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      }, h('path', { d }))
    }
    const ICONS = {
      play: 'M7.5 4.8 15 10l-7.5 5.2Z',
      pause: 'M7 4.8v10.4M13 4.8v10.4',
      reset: 'M16 10a6 6 0 1 1-1.8-4.3M16 3.4V6h-2.6',
      skip: 'M5.5 5 12 10l-6.5 5ZM14.5 5v10',
      close: 'M5.5 5.5l9 9M14.5 5.5l-9 9',
      gear: 'M10 7.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8ZM10 3.2l.9 1.9 2.1-.5.4 2.1 2 .9-1.2 1.8 1.2 1.8-2 .9-.4 2.1-2.1-.5-.9 1.9-.9-1.9-2.1.5-.4-2.1-2-.9 1.2-1.8-1.2-1.8 2-.9.4-2.1 2.1.5Z',
    }

    /** Sixty dial ticks; every fifth is a major hairline. Static, so it is
    built once and reused by every render. */
    let ticksCache = null
    function dialTicks() {
      if (ticksCache !== null) return ticksCache
      const ticks = []
      for (let index = 0; index < 60; index += 1) {
        const major = index % 5 === 0
        const angle = (index / 60) * Math.PI * 2 - Math.PI / 2
        const outer = 94
        const inner = major ? 84 : 89
        ticks.push(h('line', {
          key: index,
          className: major ? 'dsh-pomo__tick dsh-pomo__tick--major' : 'dsh-pomo__tick',
          x1: 108 + Math.cos(angle) * inner,
          y1: 108 + Math.sin(angle) * inner,
          x2: 108 + Math.cos(angle) * outer,
          y2: 108 + Math.sin(angle) * outer,
          strokeWidth: major ? 1.4 : 0.8,
        }))
      }
      ticksCache = ticks
      return ticksCache
    }

    /**
     * One numeric settings row: label beside a two-button stepper.
     * @param props - field definition, current value, label texts, and handlers.
     * @returns the row element.
     */
    function StepperRow(props) {
      const { label, text, atMin, atMax, onDecrease, onIncrease, decreaseLabel, increaseLabel } = props
      return h('div', { className: 'dsh-pomo__field' },
        h('span', { className: 'dsh-pomo__fieldLabel' }, label),
        h('div', { className: 'dsh-pomo__stepper' },
          h('button', {
            type: 'button', className: 'dsh-pomo__step',
            'aria-label': decreaseLabel, disabled: atMin, onClick: onDecrease,
          }, '−'),
          h('span', { className: 'dsh-pomo__value' }, text),
          h('button', {
            type: 'button', className: 'dsh-pomo__step',
            'aria-label': increaseLabel, disabled: atMax, onClick: onIncrease,
          }, '+')))
    }

    /**
     * One boolean option as a switch row.
     * @param props - label, state, and change handler.
     * @returns the switch row element.
     */
    function SwitchRow(props) {
      const { label, checked, onChange } = props
      return h('button', {
        type: 'button', role: 'switch', 'aria-checked': checked,
        className: 'dsh-pomo__switchRow',
        onClick: () => { onChange(!checked) },
      },
      h('span', null, label),
      h('span', { className: 'dsh-pomo__switchTrack', 'aria-hidden': true },
        h('span', { className: 'dsh-pomo__switchThumb' })))
    }

    /**
     * Build the header utility pill: the opener plus a live countdown mirror.
     * @param store - the timer store.
     * @param panel - the window store.
     * @returns a slot component.
     */
    function createPill(store, panel) {
      return function PomodoroPill(props) {
        const t = typeof props.t === 'function' ? props.t : key => key
        const snap = React.useSyncExternalStore(store.subscribe, store.getSnapshot)
        const win = React.useSyncExternalStore(panel.subscribe, panel.getSnapshot)
        const running = snap.status === 'running'
        return h('div', { className: 'dsh-pomo', 'data-phase': snap.phase },
          h('span', { className: 'dsh-pomo__sr', role: 'status', 'aria-live': 'polite' },
            win.alert ? t('alert.aria') : ''),
          h('button', {
            type: 'button',
            className: 'dsh-pomo__pill',
            'aria-label': t('open.aria'),
            'aria-expanded': win.open,
            onClick: () => {
              primeAudio()
              panel.toggleOpen()
            },
          },
          h(TomatoMark, { size: 14, className: 'dsh-pomo__pillMark' }),
          running || win.alert
            ? h('span', { className: 'dsh-pomo__pillTime' }, running ? formatClock(snap.remainingMs) : t(`phase.${snap.phase}`))
            : h('span', { className: 'dsh-pomo__pillTime' }, t('app.title')),
          win.alert ? h('span', { className: 'dsh-pomo__pillAlert', role: 'img', 'aria-label': t('alert.aria') }) : null))
      }
    }

    /**
     * Build the floating app window registered into the shell overlay.
     * @param store - the timer store.
     * @param panel - the window store.
     * @returns a slot component.
     */
    function createWindow(store, panel) {
      return function PomodoroWindow(props) {
        const t = typeof props.t === 'function' ? props.t : key => key
        const snap = React.useSyncExternalStore(store.subscribe, store.getSnapshot)
        const win = React.useSyncExternalStore(panel.subscribe, panel.getSnapshot)
        const rootRef = React.useRef(null)
        const drag = React.useRef(null)

        const settings = snap.settings
        const phase = snap.phase
        const running = snap.status === 'running'
        const duration = snap.durationMs > 0 ? snap.durationMs : MINUTE
        const remaining = Math.max(0, Math.min(snap.remainingMs, duration))
        const fraction = remaining / duration
        const radius = 92
        const circumference = 2 * Math.PI * radius
        const clock = formatClock(remaining)
        const phaseLabel = t(`phase.${phase}`)
        const statusLabel = t(running ? 'status.running' : snap.status === 'paused' ? 'status.paused' : 'status.idle')
        const idleAtFull = snap.status === 'idle' && remaining >= duration
        const todayText = snap.todayCount > 0
          ? t('today.stat', { count: snap.todayCount, minutes: snap.todayMinutes })
          : t('today.none')

        React.useEffect(() => {
          if (!win.open) return undefined
          const root = rootRef.current
          if (root !== null && typeof root.focus === 'function') root.focus({ preventScroll: true })
        }, [win.open])

        React.useEffect(() => {
          if (!win.open) return undefined
          const read = () => {
            const root = rootRef.current
            if (root !== null && typeof root.getBoundingClientRect === 'function') {
              panel.measure(root.getBoundingClientRect().height)
            }
          }
          read()
          // The drawer animates for ~260ms; measure again once it settles so
          // later clamps see the true height, not a mid-transition frame.
          const settle = window.setTimeout(read, 320)
          return () => { window.clearTimeout(settle) }
        }, [win.open, win.settingsOpen])

        // Dismissal belongs to the dialog itself: Escape closes the settings
        // drawer first and only then the window, and never intercepts a
        // composer Escape or a host menu dismissal outside this surface.
        const onKeyDown = event => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            if (win.settingsOpen) panel.toggleSettings()
            else panel.close()
            return
          }
          if (event.code === 'Space' && event.target === rootRef.current) {
            event.preventDefault()
            primeAudio()
            store.toggle()
          }
        }

        const onPointerDown = event => {
          if (event.button !== 0) return
          // Buttons inside the strip answer their own click; capturing the
          // pointer here would retarget the compatibility click to the dialog
          // root and the gear/close controls would never fire.
          if (typeof event.target.closest === 'function' && event.target.closest('button') !== null) return
          const root = rootRef.current
          if (root === null) return
          const rect = root.getBoundingClientRect()
          drag.current = { dx: event.clientX - rect.left, dy: event.clientY - rect.top }
          root.setPointerCapture(event.pointerId)
          root.setAttribute('data-dragging', 'true')
        }
        const onPointerMove = event => {
          if (drag.current === null) return
          panel.moveTo(event.clientX - drag.current.dx, event.clientY - drag.current.dy)
        }
        const onPointerUp = event => {
          const root = rootRef.current
          if (drag.current !== null) {
            drag.current = null
            if (root !== null) {
              root.setAttribute('data-dragging', 'false')
              try { root.releasePointerCapture(event.pointerId) } catch { /* pointer already gone */ }
            }
          }
        }

        if (!win.open) {
          // A phase boundary passed while closed still has to flag the pill.
          return null
        }

        const dots = []
        for (let index = 0; index < settings.longEvery; index += 1) {
          dots.push(h('span', {
            key: index, className: 'dsh-pomo__dot',
            'data-done': index < snap.cycle ? 'true' : 'false',
          }))
        }

        const style = win.x === null
          ? { right: 24, top: 72 }
          : { left: win.x, top: win.y }

        return h('div', { className: 'dsh-pomo', 'data-phase': phase },
          h('div', {
            ref: rootRef,
            className: 'dsh-pomo__window',
            role: 'dialog',
            'aria-label': t('app.title'),
            tabIndex: -1,
            onKeyDown,
            style,
            onPointerMove,
            onPointerUp,
            onPointerCancel: onPointerUp,
          },
          h('div', { className: 'dsh-pomo__head', onPointerDown },
            h(TomatoMark, { size: 16 }),
            h('div', { className: 'dsh-pomo__title' },
              h('span', { className: 'dsh-pomo__titleName' }, t('app.title')),
              h('span', { className: 'dsh-pomo__titleSub' }, t('app.subtitle'))),
            h('span', { className: 'dsh-pomo__spacer' }),
            h('button', {
              type: 'button',
              className: 'dsh-pomo__iconBtn',
              'data-active': win.settingsOpen ? 'true' : 'false',
              'aria-label': t('action.settings'),
              'aria-pressed': win.settingsOpen,
              onClick: () => { panel.toggleSettings() },
            }, h(Glyph, { d: ICONS.gear, size: 14, cls: 'dsh-pomo__glyph' })),
            h('button', {
              type: 'button', className: 'dsh-pomo__iconBtn',
              'aria-label': t('action.close'),
              onClick: () => { panel.close() },
            }, h(Glyph, { d: ICONS.close, size: 14, cls: 'dsh-pomo__glyph' }))),
          h('div', { className: 'dsh-pomo__body' },
            h('div', { className: 'dsh-pomo__dial', 'data-running': running ? 'true' : 'false' },
              h('div', { className: 'dsh-pomo__face', 'aria-hidden': true }),
              h('svg', { className: 'dsh-pomo__svg', viewBox: '0 0 216 216', 'aria-hidden': true },
                dialTicks(),
                h('circle', { cx: 108, cy: 108, r: radius, fill: 'none', strokeWidth: 5, className: 'dsh-pomo__track' }),
                h('circle', {
                  cx: 108, cy: 108, r: radius, fill: 'none', strokeWidth: 5,
                  strokeLinecap: 'round', className: 'dsh-pomo__progress',
                  strokeDasharray: `${circumference} ${circumference}`,
                  strokeDashoffset: circumference * (1 - fraction),
                  transform: 'rotate(-90 108 108)',
                })),
              h('div', { className: 'dsh-pomo__center' },
                h('div', { className: 'dsh-pomo__time', role: 'timer', 'aria-live': 'off', 'aria-label': `${phaseLabel} ${clock}` }, clock),
                h('div', { className: 'dsh-pomo__phase' }, phaseLabel),
                h('div', { className: 'dsh-pomo__status' }, statusLabel))),
            h('div', { className: 'dsh-pomo__rail', role: 'group', 'aria-label': t('modes.aria') },
              PHASES.map(candidate => h('button', {
                key: candidate,
                type: 'button',
                className: 'dsh-pomo__mode',
                'data-active': candidate === phase ? 'true' : 'false',
                'aria-pressed': candidate === phase,
                onClick: () => {
                  primeAudio()
                  store.selectPhase(candidate)
                },
              }, t(`phase.${candidate}`)))),
            h('div', { className: 'dsh-pomo__dots', role: 'img', 'aria-label': t('cycle.aria', { done: snap.cycle, total: settings.longEvery }) }, dots),
            h('div', { className: 'dsh-pomo__controls' },
              h('button', {
                type: 'button', className: 'dsh-pomo__ghost',
                'aria-label': t('action.reset'), disabled: idleAtFull,
                onClick: () => { store.reset() },
              }, h(Glyph, { d: ICONS.reset, size: 16, cls: 'dsh-pomo__glyph' })),
              h('button', {
                type: 'button', className: 'dsh-pomo__go',
                'data-running': running ? 'true' : 'false',
                'aria-label': running ? t('action.pause') : snap.status === 'paused' ? t('action.resume') : t('action.start'),
                onClick: () => {
                  primeAudio()
                  store.toggle()
                },
              }, h('svg', { viewBox: '0 0 20 20', 'aria-hidden': true, fill: 'currentColor' },
                h('path', { d: running ? ICONS.pause : ICONS.play, fill: running ? 'none' : 'currentColor', stroke: running ? 'currentColor' : 'none', strokeWidth: running ? 2.2 : 0, strokeLinecap: 'round', strokeLinejoin: 'round' }))),
              h('button', {
                type: 'button', className: 'dsh-pomo__ghost',
                'aria-label': t('action.skip'),
                onClick: () => { store.skip() },
              }, h(Glyph, { d: ICONS.skip, size: 16, cls: 'dsh-pomo__glyph' }))),
            h('div', { className: 'dsh-pomo__foot' },
              h('div', { className: 'dsh-pomo__today' }, todayText),
              h('p', { className: 'dsh-pomo__note' }, t('note')))),
          h('div', {
            className: 'dsh-pomo__settings',
            'data-open': win.settingsOpen ? 'true' : 'false',
            inert: win.settingsOpen ? undefined : '',
            'aria-hidden': win.settingsOpen ? undefined : 'true',
          },
            h('div', { className: 'dsh-pomo__settingsInner' },
              h('div', { className: 'dsh-pomo__settingsTitle' }, t('settings.title')),
              FIELDS.map(field => h(StepperRow, {
                key: field.key,
                label: t(field.label),
                text: t(field.unit, { count: settings[field.key] }),
                atMin: settings[field.key] <= field.min,
                atMax: settings[field.key] >= field.max,
                decreaseLabel: `${t(field.label)} ${t('step.decrease')} · ${t(field.unit, { count: settings[field.key] })}`,
                increaseLabel: `${t(field.label)} ${t('step.increase')} · ${t(field.unit, { count: settings[field.key] })}`,
                onDecrease: () => { store.patchSettings({ [field.key]: settings[field.key] - field.step }) },
                onIncrease: () => { store.patchSettings({ [field.key]: settings[field.key] + field.step }) },
              })),
              FLAGS.map(flag => h(SwitchRow, {
                key: flag.key,
                label: t(flag.label),
                checked: settings[flag.key] === true,
                onChange: next => {
                  primeAudio()
                  store.patchSettings({ [flag.key]: next })
                },
              }))))))
      }
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const store = createStore()
        const panel = createPanel()
        let lastPhase = store.getSnapshot().phase
        ctx.effect(() => ctx.locale.register(NS, 'zh', zh), 'pomodoro: zh dictionary')
        ctx.effect(() => ctx.locale.register(NS, 'en', en), 'pomodoro: en dictionary')
        const t = ctx.locale.bind(NS)
        ctx.effect(() => {
          const timer = window.setInterval(() => {
            store.tick()
            const phase = store.getSnapshot().phase
            if (phase !== lastPhase) {
              lastPhase = phase
              // The boundary fired; flag the pill when the window is closed.
              panel.markEnded()
            }
          }, 250)
          return () => { window.clearInterval(timer) }
        }, 'pomodoro: ticker')
        ctx.effect(() => {
          const flush = () => { store.getSnapshot() }
          const onVisibility = () => {
            if (document.visibilityState === 'hidden') flush()
          }
          window.addEventListener('pagehide', flush)
          document.addEventListener('visibilitychange', onVisibility)
          return () => {
            window.removeEventListener('pagehide', flush)
            document.removeEventListener('visibilitychange', onVisibility)
          }
        }, 'pomodoro: persistence flush')
        ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
          name: 'conversation.session.header.utilities',
          id: 'pomodoro',
          order: 8,
          locale: NS,
          label: () => t('open.aria'),
        }, createPill(store, panel)))
        ctx.slots.inject('shell.overlay', () => ctx.slots.register({
          name: 'shell.overlay',
          id: 'pomodoro-window',
          order: 10,
          locale: NS,
          label: () => t('app.title'),
        }, createWindow(store, panel)))
      },
    }
  },
})
