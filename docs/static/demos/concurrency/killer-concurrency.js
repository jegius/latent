// killer-concurrency.js — goroutines & channels, executed for real by engine #1.
//
// The interpreter is synchronous and cooperative, so the page does not fake
// concurrency: it records a trace of the genuine execution (spawn/send/recv/
// select/yield/step/print events), then replays that trace at 60 fps. Every
// number in the metrics panel comes from the real run; the animation is a
// faithful replay of the recorded trace, not a simulation of one.

import {
  $, $$, clamp, lerp, fmtInt, fmtMs, esc, initEmbed, initNav, prefersReducedMotion,
  CodeViewer, setupCanvas, rafLoop, roundRect, glowDot, bezier, setStatus,
  showTooltip, hideTooltip,
} from '../assets/killer.js';
import { LATENT, JAVASCRIPT } from './killer-programs.js';
import { tokenize, Parser, Interpreter } from '../vendor/compiler/index.js';
import { buildBuiltins } from '../vendor/compiler/interpreter-builtins.js';

initEmbed();
initNav();

const SCENARIOS = [
  {
    id: 'fanin', file: 'channels.lat', name: 'Producer / consumer', badge: 'channels.lat',
    desc: 'Каналы + fan-in: 5 сообщений и три воркера',
    channels: [
      {label: 'squares', color: '#5eead4'},
      {label: 'results', color: '#a78bfa'},
    ],
    note: 'Это точный `channels.lat` из web-ide/examples: producer/consumer и fan-in на двух каналах.',
  },
  {
    id: 'parallel', file: 'parallel_sum.lat', name: 'Map-reduce', badge: '4 воркера',
    desc: 'Сумма квадратов 1..400 по четырём кускам',
    channels: [{label: 'partial sums', color: '#a78bfa'}],
    note: 'Каждый воркер считает свой кусок и отправляет частичную сумму в канал.',
  },
  {
    id: 'pool', file: 'worker_pool.lat', name: 'Worker pool', badge: 'N × jobs',
    desc: '4 воркера тянут задачи из общего канала',
    channels: [
      {label: 'jobs', color: '#60a5fa'},
      {label: 'results', color: '#f472b6'},
    ],
    note: 'Fan-out: задачи распределяются через канал, результаты собираются обратно.',
  },
  {
    id: 'select', file: 'select_yield.lat', name: 'Select-гонка', badge: 'select',
    desc: 'Один потребитель ждёт два канала сразу',
    channels: [
      {label: 'channel A', color: '#5eead4'},
      {label: 'channel B', color: '#a78bfa'},
    ],
    note: '`select` опрашивает ветки по порядку — порядок веток виден в счётчиках.',
  },
  {
    id: 'hello', file: 'hello_1000.lat', name: '1000 горутин', badge: '1000',
    desc: '1000 spawn, 1000 сообщений, один канал',
    channels: [{label: 'ids', color: '#fbbf24'}],
    note: 'Живых горутин 1000, но кооперативный планировщик выполняет одну за раз.',
  },
  {
    id: 'deadlock', file: 'deadlock.lat', name: 'Дедлок', badge: 'runtime',
    desc: 'Потребитель ждёт сообщение, которого нет',
    channels: [{label: 'empty', color: '#fb7185'}],
    note: 'Рантайм сам обнаруживает дедлок: recv на пустом канале без готовых задач.',
  },
  {
    id: 'yield', file: 'yield.lat', name: 'Yield', badge: 'coop',
    desc: 'Кооперативная передача управления',
    channels: [],
    note: '`yield` отдаёт одну задачу планировщику; вложенность видна в порядке вывода.',
  },
];

const COLORS = ['#5eead4', '#a78bfa', '#f472b6', '#fbbf24', '#60a5fa', '#34d399'];

/* ------------------------------------------------------------------ tracing */

class TracedInterpreter extends Interpreter {
  constructor(program, output) {
    super(program, output);
    this.events = [];
    this.outputs = [];
    this.currentG = 'main';
    this.channelList = [];
    this.channelIds = new Map();
    this.names = new Map();
    this._spawnEvent = new Map();
    this.counters = {send: 0, recv: 0, wait: 0, spawn: 0, step: 0, select: 0, print: 0};
    this.output = (text) => {
      this.outputs.push({text, index: this.events.length});
      this.events.push({t: 'print', text, index: this.events.length});
      this.counters.print += 1;
      output(text);
    };
  }

  get builtins() {
    const builtins = buildBuiltins(this);
    const originalChannel = builtins.channel;
    builtins.channel = (args) => {
      const ch = originalChannel(args);
      const id = `ch${this.channelList.length + 1}`;
      this.channelList.push(ch);
      this.channelIds.set(ch, id);
      const send = ch.send.bind(ch);
      const recv = ch.recv.bind(ch);
      const tryRecv = ch.tryRecv.bind(ch);
      ch.send = (value) => {
        this.counters.send += 1;
        this.events.push({t: 'send', ch: id, g: this.currentG, v: value});
        const result = send(value);
        this.events.push({t: 'q', ch: id, n: ch.queue.length});
        return result;
      };
      ch.recv = () => {
        this.counters.recv += 1;
        this.events.push({t: 'recv', ch: id, g: this.currentG});
        ch.scheduler = () => {
          this.counters.wait += 1;
          this.events.push({t: 'wait', ch: id, g: this.currentG});
          return this.stepScheduler();
        };
        const value = recv();
        this.events.push({t: 'got', ch: id, g: this.currentG, v: value});
        return value;
      };
      ch.tryRecv = () => {
        const value = tryRecv();
        if (value !== undefined) {
          this.counters.select += 1;
          this.events.push({t: 'sel', ch: id, g: this.currentG, v: value});
        }
        return value;
      };
      return ch;
    };
    return builtins;
  }

  spawnTask(run) {
    const id = `g${this.counters.spawn + 1}`;
    this.counters.spawn += 1;
    const event = {t: 'spawn', g: id, name: null};
    this._spawnEvent.set(id, event);
    this.events.push(event);
    super.spawnTask(() => {
      const previous = this.currentG;
      this.currentG = id;
      this.events.push({t: 'start', g: id});
      try {
        run();
      } finally {
        this.events.push({t: 'end', g: id});
        this.currentG = previous;
      }
    });
  }

  callFunction(name, args) {
    const spawn = this._spawnEvent.get(this.currentG);
    if (spawn && !spawn.name) {
      spawn.name = name;
      this.names.set(this.currentG, name);
    }
    return super.callFunction(name, args);
  }

  stepScheduler() {
    this.counters.step += 1;
    this.events.push({t: 'step', g: this.currentG});
    return super.stepScheduler();
  }

  run() {
    try {
      return super.run();
    } catch (error) {
      this.events.push({t: 'error', g: this.currentG, message: String(error.message || error)});
      throw error;
    }
  }
}

/**
 * Executes one scenario and returns a complete trace plus real-run metrics.
 * @param {string} id
 */
export function executeScenario(id) {
  const source = LATENT[id];
  if (!source) throw new Error(`unknown scenario: ${id}`);
  const program = new Parser(tokenize(source)).parseProgram();
  const lines = [];
  const interp = new TracedInterpreter(program, (line) => lines.push(line));
  const t0 = performance.now();
  let result = null;
  let error = null;
  try {
    result = interp.run();
  } catch (e) {
    error = String(e.message || e);
  }
  const realMs = performance.now() - t0;

  const goroutines = new Map();
  const ensure = (gid) => {
    if (!goroutines.has(gid)) {
      goroutines.set(gid, {
        id: gid, send: 0, recv: 0, name: null,
        firstSend: null, firstRecv: null, recvChannels: new Set(),
      });
    }
    return goroutines.get(gid);
  };
  ensure('main');
  for (const event of interp.events) {
    if (!event.g) continue;
    const info = ensure(event.g);
    if (event.t === 'send') {
      info.send += 1;
      if (!info.firstSend) info.firstSend = event.ch;
    }
    if (event.t === 'recv' || event.t === 'sel') {
      info.recv += 1;
      if (!info.firstRecv) info.firstRecv = event.ch;
      if (event.ch) info.recvChannels.add(event.ch);
    }
  }
  for (const [gid, name] of interp.names) {
    const info = ensure(gid);
    info.name = name;
  }
  const spawnEventNames = interp.events.filter((e) => e.t === 'spawn' && e.name);
  for (const evt of spawnEventNames) ensure(evt.g).name = evt.name;

  let alive = 0;
  let peakAlive = 0;
  let running = 0;
  let peakRunning = 0;
  let queueMax = 0;
  for (const event of interp.events) {
    if (event.t === 'spawn') {
      alive += 1;
      peakAlive = Math.max(peakAlive, alive);
    } else if (event.t === 'end') {
      alive -= 1;
    } else if (event.t === 'start') {
      running += 1;
      peakRunning = Math.max(peakRunning, running);
    } else if (event.t === 'q') {
      queueMax = Math.max(queueMax, event.n);
    }
  }

  const baseCounts = {};
  for (const info of goroutines.values()) {
    if (info.id === 'main') continue;
    const base = info.name || 'goroutine';
    info.base = base;
    baseCounts[base] = (baseCounts[base] || 0) + 1;
  }
  const seen = {};
  for (const info of goroutines.values()) {
    if (info.id === 'main') {
      info.label = 'main';
      continue;
    }
    const base = info.base || 'goroutine';
    seen[base] = (seen[base] || 0) + 1;
    info.label = baseCounts[base] > 1 ? `${base} #${seen[base]}` : base;
  }

  return {
    id,
    source,
    events: interp.events,
    outputs: interp.outputs,
    lines,
    result,
    error,
    errorIndex: interp.events.findIndex((e) => e.t === 'error'),
    realMs,
    counters: {...interp.counters},
    goroutines: [...goroutines.values()],
    channelIds: [...interp.channelIds.values()],
    queueMax,
    peakAlive,
    peakRunning,
    totalEvents: interp.events.length,
    messages: interp.counters.select + interp.counters.send,
  };
}

/* -------------------------------------------------------------------- stage */

const EVENT_COLORS = {
  spawn: '#a78bfa', start: '#60a5fa', gstart: '#60a5fa', end: '#52627f',
  send: '#5eead4', q: '#2dd4bf', recv: '#fbbf24', got: '#34d399',
  wait: '#fb7185', step: '#3b4a66', sel: '#60a5fa', print: '#f472b6',
  error: '#fb7185',
};

class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctrl = setupCanvas(canvas);
    this.ctrl.onResize(() => this.layout());
    this.trace = null;
    this.idx = 0;
    this.playing = false;
    this.finished = false;
    this.speed = 1;
    this.actors = new Map();
    this.channels = new Map();
    this.flights = [];
    this.ripples = [];
    this.beams = [];
    this.console = $('#console');
    this.consoleLines = [];
    this.visibleOutputs = 0;
    this.processed = {sends: 0, recvs: 0, selects: 0, steps: 0};
    this.peakLive = 0;
    this.time = 0;
    this.scenario = SCENARIOS[0];
    this.levels = new Map();
    this.elapsed = 0;
    this.eps = 20;
    this.live = $('#stage-live');
    this.loop = rafLoop((dt) => this.tick(dt));
  }

  setScenario(meta) { this.scenario = meta; }

  setTrace(trace) {
    this.trace = trace;
    this.idx = 0;
    this.playing = false;
    this.finished = false;
    this.time = 0;
    this.actors.clear();
    this.channels.clear();
    this.flights = [];
    this.ripples = [];
    this.beams = [];
    this.levels.clear();
    this.processed = {sends: 0, recvs: 0, selects: 0, steps: 0};
    this.peakLive = 0;
    this.visibleOutputs = 0;
    this.liveCount = 0;
    this.error = trace.error || null;
    this.errorIndex = trace.errorIndex ?? -1;
    this.consoleLines = [];
    this.console.innerHTML = '';
    this.console.append(this.consoleRow('sys', 'engine #1 · JS-интерпретатор · трасса реального исполнения'));
    for (const id of trace.channelIds) this.ensureChannel(id);
    this.ensureActor('main');
    for (const info of trace.goroutines) this.ensureActor(info.id);
    this.eps = trace.totalEvents / clamp(trace.totalEvents / 260, 4, 13);
    this.layout();
    this.seek(0);
    this.updateMetrics();
  }

  getScale() { return this.ctrl.state; }

  ensureChannel(id) {
    if (this.channels.has(id)) return this.channels.get(id);
    const index = this.channels.size;
    const meta = (this.scenario.channels || [])[index] || {};
    const ch = {
      id,
      label: meta.label || `channel ${index + 1}`,
      color: meta.color || COLORS[index % COLORS.length],
      queue: [],
      len: 0,
      max: 0,
      x1: 0, x2: 0, y: 0,
    };
    this.channels.set(id, ch);
    return ch;
  }

  ensureActor(id) {
    if (this.actors.has(id)) return this.actors.get(id);
    const info = this.trace?.goroutines.find((g) => g.id === id) || {id, label: id, send: 0, recv: 0};
    const actor = {
      id,
      info,
      label: info.label,
      x: 0, y: 0,
      state: 'idle',
      born: this.time,
      flash: 0,
      activeUntil: 0,
      sends: 0,
      recvs: 0,
      color: id === 'main' ? '#a78bfa' : COLORS[Math.abs(hashCode(id)) % COLORS.length],
    };
    this.actors.set(id, actor);
    return actor;
  }

  layout() {
    if (!this.trace) return;
    const {w, h} = this.ctrl.state;
    if (w < 40 || h < 40) return;
    const n = this.channels.size;
    const goroutines = [...this.actors.values()].filter((a) => a.id !== 'main');
    const swarm = goroutines.length > 60;
    this.swarm = swarm;

    const lanes = [];
    if (swarm) {
      const y = h * 0.56;
      let laneIndex = 0;
      this.channels.forEach((ch) => {
        ch.x1 = w * 0.24;
        ch.x2 = w * 0.76;
        ch.y = y + laneIndex * 34;
        laneIndex += 1;
        lanes.push(ch);
      });
    } else if (n > 0) {
      const top = 70;
      const bottom = h - 76;
      let laneIndex = 0;
      this.channels.forEach((ch) => {
        ch.x1 = w * 0.34;
        ch.x2 = w * 0.66;
        ch.y = top + ((laneIndex + 1) * (bottom - top)) / (n + 1);
        laneIndex += 1;
        lanes.push(ch);
      });
    }
    this.lanes = lanes;

    if (swarm) {
      const main = this.ensureActor('main');
      main.x = w * 0.87;
      main.y = lanes[0] ? lanes[0].y : h * 0.5;
      const cx = w * 0.3;
      const cy = h * 0.5;
      const maxR = Math.min(w * 0.22, h * 0.38);
      const total = goroutines.length || 1;
      goroutines.forEach((actor, i) => {
        const ring = i / total;
        const radius = 54 + maxR * Math.sqrt(ring);
        const angle = i * 2.399963 + 0.4;
        actor.x = cx + Math.cos(angle) * radius;
        actor.y = cy + Math.sin(angle) * radius * 0.86;
        actor.swarm = true;
      });
      return;
    }

    const main = this.ensureActor('main');
    const mainRole = roleOf(main.info);
    if (mainRole === 'recv' && lanes.length) {
      const recvLanes = lanes.filter((lane) => main.info.recvChannels?.has(lane.id));
      main.x = w * 0.87;
      main.y = recvLanes.length > 1
        ? recvLanes.reduce((sum, lane) => sum + lane.y, 0) / recvLanes.length
        : (recvLanes[0] || lanes[0]).y;
    } else {
      main.x = w * 0.075;
      main.y = h - 80;
    }

    // Assign each actor to the lane of its first send/receive channel.
    const groups = new Map();
    for (const actor of goroutines) {
      const role = roleOf(actor.info);
      actor.role = role;
      const lane = laneForActor(actor, lanes);
      actor.laneId = lane ? lane.id : null;
      const key = lane ? lane.id : 'none';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(actor);
    }

    const placeColumn = (actors, x, baseY, side) => {
      const count = actors.length;
      actors.forEach((actor, i) => {
        const offset = (i - (count - 1) / 2) * Math.min(46, 240 / Math.max(1, count));
        actor.x = x;
        actor.y = baseY + offset;
        if (actors.length > 1) actor.y = clamp(actor.y, 44, h - 64);
      });
    };

    for (const [laneId, actors] of groups) {
      const lane = lanes.find((c) => c.id === laneId);
      const senders = actors.filter((a) => a.role === 'send' || a.role === 'none');
      const receivers = actors.filter((a) => a.role === 'recv');
      const mixed = actors.filter((a) => a.role === 'both');
      if (senders.length) placeColumn(senders, w * 0.16, lane ? lane.y : h * 0.45, 'left');
      if (receivers.length) placeColumn(receivers, w * 0.84, lane ? lane.y : h * 0.55, 'right');
      if (mixed.length) {
        const startX = w * 0.28;
        const endX = w * 0.72;
        const step = mixed.length > 1 ? (endX - startX) / (mixed.length - 1) : 0;
        mixed.forEach((actor, i) => {
          actor.x = mixed.length === 1 ? w * 0.5 : startX + step * i;
          actor.y = h - 80;
        });
      }
    }
    // Safety net: never let a node fall back to (0,0)/NaN if a layout branch
    // did not cover it (new scenario shape), otherwise canvas gradients throw.
    const bad = [...this.actors.values()].filter(
      (a) => !Number.isFinite(a.x) || !Number.isFinite(a.y) || (a.x === 0 && a.y === 0),
    );
    if (bad.length) {
      window.__killerBadActors = bad.map((a) => a.id);
      bad.forEach((actor, i) => {
        actor.x = w * 0.5 + Math.cos(i * 1.7) * w * 0.2;
        actor.y = h * 0.5 + Math.sin(i * 1.7) * h * 0.2;
      });
    }
  }

  seek(fraction) {
    if (!this.trace) return;
    const target = Math.round(clamp(fraction, 0, 1) * this.trace.events.length);
    this.reset();
    for (let i = 0; i < target; i += 1) {
      this.apply(this.trace.events[i], false);
      this.idx = i + 1;
    }
    this.updateMetrics();
    this.renderConsole();
  }

  reset() {
    this.idx = 0;
    this.time = 0;
    this.flights = [];
    this.ripples = [];
    this.beams = [];
    this.visibleOutputs = 0;
    this.processed = {sends: 0, recvs: 0, selects: 0, steps: 0};
    this.peakLive = 0;
    this.liveCount = 0;
    this.error = null;
    this.finished = false;
    for (const actor of this.actors.values()) {
      actor.state = 'idle';
      actor.flash = 0;
      actor.activeUntil = 0;
      actor.sends = 0;
      actor.recvs = 0;
      actor.born = 0;
      actor.visible = true;
      actor.spawned = false;
      actor.ended = false;
    }
    for (const ch of this.channels.values()) {
      ch.queue = [];
      ch.len = 0;
      ch.max = 0;
    }
    this.console.innerHTML = '';
    this.console.append(this.consoleRow('sys', 'engine #1 · JS-интерпретатор · трасса реального исполнения'));
    this.renderConsole();
  }

  play() {
    if (!this.trace) return;
    if (this.finished) {
      this.seek(0);
      this.finished = false;
    }
    this.playing = true;
    this.setPlayLabel();
  }

  pause() {
    this.playing = false;
    this.setPlayLabel();
  }

  setPlayLabel() {
    const btn = $('#play');
    if (btn) btn.textContent = this.playing ? '⏸ Пауза' : '▶ Воспроизвести';
  }

  step() {
    if (!this.trace) return;
    this.playing = false;
    this.setPlayLabel();
    if (this.idx < this.trace.events.length) {
      this.apply(this.trace.events[this.idx], true);
      this.idx += 1;
      this.updateMetrics();
      this.renderConsole();
    }
  }

  tick(dt) {
    this.time += dt;
    if (this.trace && this.playing) {
      const events = this.trace.events;
      const budget = this.eps * this.speed * dt;
      this.carry = (this.carry || 0) + budget;
      let steps = Math.floor(this.carry);
      this.carry -= steps;
      steps = Math.min(steps, 3000);
      for (let i = 0; i < steps && this.idx < events.length; i += 1) {
        this.apply(events[this.idx], true);
        this.idx += 1;
      }
      if (this.idx >= events.length) {
        this.playing = false;
        this.finished = true;
        this.setPlayLabel();
        this.updateMetrics();
      }
      if (steps > 0) this.renderConsole();
    }
    // decay + flights
    for (const actor of this.actors.values()) {
      if (actor.flash > 0) actor.flash = Math.max(0, actor.flash - dt * 3.2);
      if (actor.state === 'running' && this.time > actor.activeUntil) actor.state = 'idle';
    }
    this.flights = this.flights.filter((f) => this.time - f.start < f.dur);
    this.ripples = this.ripples.filter((r) => this.time - r.start < 0.9);
    this.beams = this.beams.filter((b) => this.time - b.start < 0.7);
    if (this.trace) {
      this.draw();
      if (this.time - (this.lastMetrics || 0) > 0.12) {
        this.lastMetrics = this.time;
        this.updateMetrics();
      }
    }
  }

  apply(event, animate) {
    const gid = event.g;
    if (gid) this.ensureActor(gid);
    const actor = gid ? this.actors.get(gid) : null;
    const channel = event.ch ? this.ensureChannel(event.ch) : null;
    if (actor) {
      actor.flash = 1;
      actor.activeUntil = this.time + 0.32;
      if (actor.state !== 'done' || event.t === 'end') {
        if (event.t !== 'end') actor.state = 'running';
      }
    }
    switch (event.t) {
      case 'spawn': {
        if (actor) {
          actor.state = 'spawned';
          actor.born = this.time;
          actor.spawned = true;
        }
        this.liveCount += 1;
        this.peakLive = Math.max(this.peakLive, this.liveCount);
        this.ripples.push({x: actor?.x || 0, y: actor?.y || 0, start: this.time, color: '#a78bfa', max: 30});
        this.say(`spawn ${event.g}${event.name ? ` → ${event.name}(…)` : ''}`);
        break;
      }
      case 'start': {
        if (actor) actor.state = 'running';
        this.say(`${event.g} стартует`);
        break;
      }
      case 'end': {
        if (actor) {
          actor.state = 'done';
          actor.ended = true;
        }
        this.liveCount = Math.max(0, this.liveCount - 1);
        this.say(`${event.g} завершилась`);
        break;
      }
      case 'send': {
        if (channel) {
          channel.len += 1;
          channel.max = Math.max(channel.max, channel.len);
          const token = {
            value: event.v,
            ch: channel,
            state: 'queued',
            born: this.time,
            slot: channel.queue.length,
            color: channel.color,
            actor,
          };
          channel.queue.push(token);
          if (animate) this.launch(actor, channel, token, 'toPipe');
          this.processed.sends += 1;
          if (actor) actor.sends += 1;
          this.say(`${event.g} → ${channel.label}: ${formatValue(event.v)}`);
        }
        break;
      }
      case 'q': {
        if (channel) {
          channel.len = event.n;
          channel.max = Math.max(channel.max, event.n);
        }
        break;
      }
      case 'recv': {
        if (actor) actor.state = 'waiting';
        this.say(`${event.g} ← ${channel ? channel.label : '?'}: ждёт`);
        break;
      }
      case 'wait': {
        if (actor) actor.state = 'waiting';
        this.ripples.push({x: actor?.x || 0, y: actor?.y || 0, start: this.time, color: '#fbbf24', max: 44});
        this.processed.steps += 1;
        this.say(`${event.g} уступает планировщику (${channel ? channel.label : 'channel'} пуст)`);
        break;
      }
      case 'got':
      case 'sel': {
        if (channel) {
          const token = channel.queue.shift();
          channel.len = Math.max(0, channel.len - 1);
          if (animate && token) this.launchToActor(token, channel, actor);
          this.processed.recvs += 1;
          this.processed.selects += event.t === 'sel' ? 1 : 0;
          if (actor) actor.recvs += 1;
          if (event.t === 'sel' && actor) {
            this.beams.push({x1: actor.x, y1: actor.y, x2: channel.x1, y2: channel.y, start: this.time, color: channel.color});
          }
          this.say(event.t === 'sel'
            ? `select: ${channel.label} выиграл → ${formatValue(event.v)}`
            : `${event.g} ← ${channel.label}: ${formatValue(event.v)}`);
        }
        if (actor) actor.state = 'running';
        break;
      }
      case 'step': {
        this.processed.steps += 1;
        if (actor) {
          this.ripples.push({x: actor.x, y: actor.y, start: this.time, color: '#52627f', max: 26});
        }
        break;
      }
      case 'print': {
        this.say(`stdout: ${event.text}`);
        break;
      }
      case 'error': {
        this.error = event.message;
        this.appendConsole(event.message, 'err');
        this.say(`ошибка рантайма: ${event.message}`);
        break;
      }
      default:
        break;
    }
  }

  launch(actor, channel, token, phase) {
    if (!actor) return;
    if (this.flights.length > 90) return;
    const target = queuePoint(channel, token.slot);
    this.flights.push({
      p0: {x: actor.x, y: actor.y},
      p1: {x: (actor.x + target.x) / 2, y: actor.y + (channel.y - actor.y) * 0.15},
      p2: target,
      start: this.time,
      dur: 0.42 + Math.random() * 0.16,
      color: channel.color,
      value: token.value,
      token,
      phase,
    });
    token.state = 'toPipe';
  }

  launchToActor(token, channel, actor) {
    if (!actor) return;
    if (this.flights.length > 90) return;
    const from = queuePoint(channel, 0);
    this.flights.push({
      p0: from,
      p1: {x: (from.x + actor.x) / 2, y: channel.y + (actor.y - channel.y) * 0.2},
      p2: {x: actor.x, y: actor.y},
      start: this.time,
      dur: 0.38 + Math.random() * 0.14,
      color: channel.color,
      value: token.value,
      token,
      phase: 'toActor',
    });
    token.state = 'toActor';
  }

  say(text) {
    if (this.live) this.live.textContent = text;
  }

  appendConsole(text, kind = 'out') {
    this.consoleLines.push({text, kind});
    const row = this.consoleRow(kind, text);
    this.console.append(row);
    this.console.scrollTop = this.console.scrollHeight;
  }

  renderConsole() {
    const outputs = this.trace ? this.trace.outputs : [];
    while (this.visibleOutputs < outputs.length && outputs[this.visibleOutputs].index <= this.idx) {
      this.appendConsole(outputs[this.visibleOutputs].text);
      this.visibleOutputs += 1;
    }
  }

  consoleRow(kind, text) {
    const row = document.createElement('div');
    row.className = `k-console-line k-console-line--${kind}`;
    row.innerHTML = `<span class="k-t">${new Date().toLocaleTimeString('ru-RU', {hour12: false})}</span><span class="k-out">${esc(text)}</span>`;
    return row;
  }

  updateMetrics() {
    const trace = this.trace;
    if (!trace) return;
    setText('#m-goroutines', fmtInt(trace.counters.spawn + 1));
    setText('#m-alive', fmtInt(this.liveCount));
    setText('#m-messages', fmtInt(this.processed.recvs + this.processed.sends));
    setText('#m-sends', fmtInt(this.processed.sends));
    setText('#m-selects', fmtInt(this.processed.selects + this.processed.steps));
    setText('#m-time', fmtMs(trace.realMs));
    setText('#m-events', `${fmtInt(this.idx)} / ${fmtInt(trace.totalEvents)}`);
    setText('#m-peak', fmtInt(trace.peakAlive));
    const rate = trace.realMs > 0
      ? (trace.counters.send + trace.counters.select) / (trace.realMs / 1000)
      : 0;
    setText('#m-rate', `${fmtInt(rate)}/s`);
    const showError = this.error && this.errorIndex >= 0 && this.idx > this.errorIndex;
    const banner = $('#error-banner');
    if (banner) banner.classList.toggle('k-hide', !showError);
    if (showError) setText('#error-text', this.error);
    const progress = trace.totalEvents ? this.idx / trace.totalEvents : 0;
    const bar = $('#stage-progress');
    if (bar) bar.style.width = `${(progress * 100).toFixed(2)}%`;
    const clock = $('#stage-clock');
    if (clock) clock.textContent = `${Math.round(progress * 100)}%`;
    this.renderBalance();
    this.renderQueues();
  }

  renderBalance() {
    const host = $('#balance');
    if (!host) return;
    const actors = [...this.actors.values()].filter((a) => a.id !== 'main' && (a.info.send || a.info.recv));
    if (!actors.length || actors.length > 12) {
      host.innerHTML = `<p class="k-hint">${actors.length > 12
        ? `${actors.length} горутин — баланс агрегирован, детали смотрите в трассе.`
        : 'В этом сценарии нет обмена сообщениями.'}</p>`;
      return;
    }
    const values = actors.map((a) => Math.max(a.sends, a.recvs));
    const max = Math.max(1, ...values);
    host.innerHTML = actors.map((a, i) => {
      const value = Math.max(a.sends, a.recvs);
      const width = (value / max) * 100;
      const cls = ['', 'k-bar-row--violet', 'k-bar-row--green', 'k-bar-row--amber'][i % 4];
      return `<div class="k-bar-row ${cls}">
        <span class="k-bar-label" title="${esc(a.label)}">${esc(a.label)}</span>
        <span class="k-bar"><i style="width:${width.toFixed(1)}%"></i></span>
        <span class="k-bar-val">${fmtInt(value)}</span>
      </div>`;
    }).join('');
  }

  renderQueues() {
    const host = $('#queues');
    if (!host) return;
    if (!this.channels.size) {
      host.innerHTML = '<p class="k-hint">Каналов нет: сценарий показывает только yield/print.</p>';
      return;
    }
    host.innerHTML = [...this.channels.values()].map((ch) => {
      const pct = Math.min(100, (ch.len / Math.max(1, ch.max, 1)) * 100);
      return `<div class="k-bar-row">
        <span class="k-bar-label" title="${esc(ch.label)}">${esc(ch.label)}</span>
        <span class="k-bar"><i style="width:${pct.toFixed(0)}%;background:linear-gradient(90deg, ${ch.color}, ${ch.color}80)"></i></span>
        <span class="k-bar-val">${fmtInt(ch.len)}</span>
      </div>`;
    }).join('');
  }

  draw() {
    const {ctx, w, h} = this.ctrl.state;
    if (w < 20 || h < 20) return;
    ctx.clearRect(0, 0, w, h);
    // background
    const bg = ctx.createRadialGradient(w * 0.45, h * 0.45, 10, w * 0.45, h * 0.45, Math.max(w, h) * 0.75);
    bg.addColorStop(0, 'rgba(20, 32, 54, 0.55)');
    bg.addColorStop(0.55, 'rgba(7, 11, 20, 0.65)');
    bg.addColorStop(1, 'rgba(4, 6, 11, 0.95)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    ctx.strokeStyle = 'rgba(148, 178, 255, 0.055)';
    ctx.lineWidth = 1;
    for (let x = 0; x < w; x += 40) {
      ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, h); ctx.stroke();
    }
    for (let y = 0; y < h; y += 40) {
      ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(w, y + 0.5); ctx.stroke();
    }
    ctx.restore();

    // channel lanes
    for (const ch of this.channels.values()) this.drawPipe(ctx, ch, w, h);
    // beams (select scanning)
    for (const beam of this.beams) {
      const t = clamp((this.time - beam.start) / 0.7, 0, 1);
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.7;
      const grad = ctx.createLinearGradient(beam.x1, beam.y1, beam.x2, beam.y2);
      grad.addColorStop(0, beam.color);
      grad.addColorStop(1, 'transparent');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(beam.x1, beam.y1);
      ctx.lineTo(beam.x2, beam.y2);
      ctx.stroke();
      ctx.restore();
    }
    // flights
    for (const flight of this.flights) {
      const t = clamp((this.time - flight.start) / flight.dur, 0, 1);
      const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const point = bezier(flight.p0, flight.p1, flight.p2, eased);
      const trailPoint = bezier(flight.p0, flight.p1, flight.p2, Math.max(0, eased - 0.12));
      ctx.save();
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = flight.color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(trailPoint.x, trailPoint.y);
      ctx.lineTo(point.x, point.y);
      ctx.stroke();
      ctx.restore();
      glowDot(ctx, point.x, point.y, 3.2, flight.color, 0.95, 12);
      if (w > 560 && this.flights.length < 45) {
        ctx.save();
        ctx.globalAlpha = 0.8;
        ctx.fillStyle = flight.color;
        ctx.font = '10px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(String(formatValue(flight.value)), point.x, point.y - 8);
        ctx.restore();
      }
    }
    // actors
    for (const actor of this.actors.values()) this.drawActor(ctx, actor, w, h);
    // ripples
    for (const ripple of this.ripples) {
      const t = clamp((this.time - ripple.start) / 0.9, 0, 1);
      ctx.save();
      ctx.globalAlpha = (1 - t) * 0.5;
      ctx.strokeStyle = ripple.color;
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, 6 + t * (ripple.max || 30), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // error banner
    if (this.error && this.errorIndex >= 0 && this.idx > this.errorIndex) {
      ctx.save();
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(251, 113, 133, 0.92)';
      ctx.font = '600 13px ui-monospace, monospace';
      ctx.fillText('DEADLOCK · рантайм остановил программу', w / 2, h - 16);
      ctx.restore();
    }
    // HUD
    ctx.save();
    ctx.fillStyle = 'rgba(154, 169, 199, 0.75)';
    ctx.font = '10px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(`${this.scenario.name.toUpperCase()} · ${this.idx}/${this.trace.events.length} EVENTS`, 14, 20);
    ctx.restore();
  }

  drawPipe(ctx, ch, w, h) {
    const height = 26;
    ctx.save();
    const grad = ctx.createLinearGradient(ch.x1, 0, ch.x2, 0);
    grad.addColorStop(0, `${ch.color}18`);
    grad.addColorStop(0.5, `${ch.color}0d`);
    grad.addColorStop(1, `${ch.color}18`);
    roundRect(ctx, ch.x1, ch.y - height / 2, ch.x2 - ch.x1, height, 13);
    ctx.fillStyle = 'rgba(6, 10, 18, 0.82)';
    ctx.fill();
    ctx.strokeStyle = `${ch.color}77`;
    ctx.lineWidth = 1.2;
    ctx.stroke();

    // moving shine
    const shineX = ch.x1 + ((this.time * 90) % Math.max(1, ch.x2 - ch.x1));
    const shine = ctx.createLinearGradient(shineX - 50, 0, shineX + 50, 0);
    shine.addColorStop(0, 'transparent');
    shine.addColorStop(0.5, `${ch.color}22`);
    shine.addColorStop(1, 'transparent');
    ctx.fillStyle = shine;
    ctx.fill();

    // queue pills
    const slotWidth = 26;
    const visible = Math.min(ch.queue.length, Math.max(2, Math.floor((ch.x2 - ch.x1 - 26) / slotWidth)));
    for (let i = 0; i < visible; i += 1) {
      const token = ch.queue[i];
      if (!token) continue;
      const x = ch.x1 + 14 + i * slotWidth;
      const y = ch.y;
      ctx.save();
      ctx.globalAlpha = token.state === 'toActor' ? 0.35 : 1;
      roundRect(ctx, x - 9, y - 8, 18, 16, 5);
      ctx.fillStyle = `${ch.color}26`;
      ctx.fill();
      ctx.strokeStyle = `${ch.color}aa`;
      ctx.lineWidth = 1;
      ctx.stroke();
      if (w > 560) {
        ctx.fillStyle = ch.color;
        ctx.font = '9px ui-monospace, monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(formatValue(token.value)).slice(0, 4), x, y + 0.5);
      }
      ctx.restore();
    }
    if (ch.queue.length > visible) {
      ctx.save();
      ctx.fillStyle = 'rgba(232, 238, 251, 0.8)';
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(`+${ch.queue.length - visible}`, ch.x2 - 30, ch.y);
      ctx.restore();
    }
    // label + depth
    ctx.save();
    ctx.fillStyle = `${ch.color}dd`;
    ctx.font = '600 10px ui-monospace, monospace';
    ctx.textAlign = 'left';
    ctx.fillText(ch.label, ch.x1, ch.y - 20);
    ctx.fillStyle = 'rgba(154, 169, 199, 0.7)';
    ctx.textAlign = 'right';
    ctx.fillText(`q=${ch.len}`, ch.x2, ch.y - 20);
    ctx.restore();
    ctx.restore();
  }

  drawActor(ctx, actor, w, h) {
    if (!Number.isFinite(actor.x) || !Number.isFinite(actor.y)) return;
    if (!actor.x && !actor.y) return;
    if (actor.id === 'main') {
      // scheduler core
      const t = this.time;
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.strokeStyle = '#a78bfa';
      ctx.lineWidth = 1;
      for (let i = 0; i < 2; i += 1) {
        const angle = t * (0.6 + i * 0.4) + i * Math.PI;
        ctx.beginPath();
        ctx.arc(actor.x, actor.y, 20 + i * 7, angle, angle + Math.PI * 1.1);
        ctx.stroke();
      }
      ctx.restore();
      glowDot(ctx, actor.x, actor.y, 6, '#a78bfa', 0.9, 18);
      ctx.save();
      ctx.fillStyle = 'rgba(232, 238, 251, 0.9)';
      ctx.font = '9px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText('main · планировщик', actor.x, actor.y + 30);
      ctx.restore();
      return;
    }
    if (actor.swarm) {
      const hot = this.time - actor.flash < 0.3 || actor.state === 'running';
      const radius = hot ? 3 : 2;
      ctx.save();
      ctx.globalAlpha = actor.state === 'done' ? 0.28 : hot ? 0.95 : 0.5;
      ctx.fillStyle = actor.state === 'waiting' ? '#fbbf24' : hot ? '#5eead4' : actor.color;
      if (hot) {
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 8;
      }
      ctx.beginPath();
      ctx.arc(actor.x, actor.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      return;
    }
    const stateColor = actor.state === 'waiting' ? '#fbbf24'
      : actor.state === 'done' ? '#34d399'
        : actor.state === 'running' ? '#5eead4' : '#52627f';
    const pulse = actor.state === 'waiting' ? 1 + Math.sin(this.time * 6) * 0.18 : 1;
    // halo
    ctx.save();
    ctx.globalAlpha = actor.state === 'idle' ? 0.1 : 0.22;
    const halo = ctx.createRadialGradient(actor.x, actor.y, 2, actor.x, actor.y, 26 * pulse);
    halo.addColorStop(0, stateColor);
    halo.addColorStop(1, 'transparent');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(actor.x, actor.y, 26 * pulse, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    glowDot(ctx, actor.x, actor.y, 6.2, stateColor, actor.state === 'idle' ? 0.55 : 0.95, actor.flash > 0 ? 18 : 8);
    // ring
    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = stateColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(actor.x, actor.y, 11 + (actor.flash > 0 ? (1 - actor.flash) * 8 : 0), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // label
    if (w > 480) {
      ctx.save();
      ctx.fillStyle = 'rgba(214, 226, 248, 0.86)';
      ctx.font = '10px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.fillText(actor.label, actor.x, actor.y + 24);
      if (actor.sends || actor.recvs) {
        ctx.fillStyle = 'rgba(108, 124, 156, 0.8)';
        ctx.font = '9px ui-monospace, monospace';
        ctx.fillText(`↑${actor.sends} ↓${actor.recvs}`, actor.x, actor.y + 35);
      }
      ctx.restore();
    }
  }
}

function roleOf(info) {
  if (!info) return 'none';
  if (info.send > 0 && info.recv > 0) return 'both';
  if (info.send > 0) return 'send';
  if (info.recv > 0) return 'recv';
  return 'none';
}

function laneForActor(actor, lanes) {
  if (!lanes.length) return null;
  if (actor.id === 'main') {
    return lanes.find((lane) => lane.id === actor.info.firstRecv) || lanes[0];
  }
  return lanes.find((lane) => lane.id === actor.info.firstSend)
    || lanes.find((lane) => lane.id === actor.info.firstRecv)
    || lanes[0];
}

function queuePoint(channel, slot) {
  const index = Math.min(slot, 8);
  return {x: channel.x1 + 14 + index * 26, y: channel.y};
}

function hashCode(text) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0;
  return h;
}

function formatValue(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return `[${value.length}]`;
  if (value && typeof value === 'object') return '{…}';
  return String(value);
}

function setText(selector, text) {
  const el = $(selector);
  if (el) el.textContent = text;
}

/* --------------------------------------------------------------- page glue */

const stage = new Stage($('#stage-canvas'));
let current = SCENARIOS[0];

const latentViewer = new CodeViewer($('#code-latent'), {
  files: SCENARIOS.map((s) => ({name: s.file, code: LATENT[s.id]})),
  height: 'tall',
});
const jsViewer = new CodeViewer($('#code-js'), {
  files: SCENARIOS.map((s) => ({name: s.file.replace(/\.lat$/, '.js'), lang: 'js', code: JAVASCRIPT[s.id]})),
  height: 'tall',
  start: 0,
});

function buildScenarioList() {
  const host = $('#scenarios');
  host.innerHTML = SCENARIOS.map((scenario, i) => `
    <button class="k-scenario${i === 0 ? ' is-active' : ''}" type="button" data-scenario="${scenario.id}">
      <span class="k-scenario-num">${String(i + 1).padStart(2, '0')}</span>
      <span>
        <span class="k-scenario-name">${esc(scenario.name)}</span>
        <span class="k-scenario-desc">${esc(scenario.desc)}</span>
      </span>
      <span class="k-badge">${esc(scenario.badge)}</span>
    </button>
  `).join('');
  $$('[data-scenario]', host).forEach((btn) => {
    btn.addEventListener('click', () => selectScenario(btn.dataset.scenario));
  });
}

function markScenario(id) {
  $$('[data-scenario]').forEach((btn) => btn.classList.toggle('is-active', btn.dataset.scenario === id));
}

function updateCode(id) {
  const index = SCENARIOS.findIndex((s) => s.id === id);
  latentViewer.select(index);
  jsViewer.select(index);
  const lat = LATENT[id].split('\n').length;
  const js = JAVASCRIPT[id].split('\n').length;
  setText('#latent-lines', `${lat} строк`);
  setText('#js-lines', `${js} строк`);
  setText('#code-ratio', `Latent / JS ×${(lat / js).toFixed(1)}`);
  setText('#code-note', SCENARIOS[index].note);
  const nameEl = $('#latent-file');
  if (nameEl) nameEl.textContent = SCENARIOS[index].file;
  const jsNameEl = $('#js-file');
  if (jsNameEl) jsNameEl.textContent = SCENARIOS[index].file.replace(/\.lat$/, '.js');
}

async function runScenario(id, {announce = true} = {}) {
  const meta = SCENARIOS.find((s) => s.id === id) || SCENARIOS[0];
  current = meta;
  markScenario(id);
  updateCode(id);
  stage.setScenario(meta);
  if (announce) setStatus($('#run-status'), 'исполняем Latent-код в движке №1…');
  $('#run').disabled = true;
  await new Promise((resolve) => requestAnimationFrame(resolve));
  let trace;
  try {
    trace = executeScenario(id);
  } catch (error) {
    setStatus($('#run-status'), `ошибка: ${error.message}`, 'err');
    $('#run').disabled = false;
    return null;
  }
  stage.setTrace(trace);
  stage.play();
  $('#run').disabled = false;
  const status = `${meta.name}: ${fmtInt(trace.totalEvents)} событий · ${fmtMs(trace.realMs)} реального времени` +
    (trace.error ? ' · дедлок обнаружен' : '');
  setStatus($('#run-status'), status, trace.error ? 'warn' : 'ok');
  window.__killerLast = {
    scenario: id,
    result: trace.result,
    error: trace.error,
    realMs: trace.realMs,
    events: trace.totalEvents,
    outputs: trace.lines,
    counters: trace.counters,
  };
  if (prefersReducedMotion()) {
    stage.seek(1);
    stage.finished = true;
    stage.pause();
  }
  return trace;
}

function selectScenario(id) {
  runScenario(id);
}

function wireControls() {
  $('#run').addEventListener('click', () => runScenario(current.id));
  $('#play').addEventListener('click', () => {
    if (!stage.trace) return;
    if (stage.playing) stage.pause();
    else stage.play();
  });
  $('#restart').addEventListener('click', () => {
    if (!stage.trace) return;
    stage.seek(0);
    stage.play();
  });
  $('#step').addEventListener('click', () => stage.step());
  $$('[data-speed]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $$('[data-speed]').forEach((b) => b.classList.toggle('is-active', b === btn));
      stage.speed = Number(btn.dataset.speed);
    });
  });
  const timeline = $('#timeline');
  timeline.addEventListener('click', (event) => {
    if (!stage.trace) return;
    const rect = timeline.getBoundingClientRect();
    stage.seek((event.clientX - rect.left) / rect.width);
    stage.draw();
    stage.renderConsole();
  });
  window.addEventListener('resize', () => {
    stage.ctrl.resize();
    stage.layout();
    if (stage.trace) stage.draw();
  });
}

function drawTimeline() {
  const canvas = $('#timeline');
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(1, Math.round(rect.width));
  const h = Math.max(1, Math.round(rect.height));
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = 'rgba(4,7,13,0.55)';
  ctx.fillRect(0, 0, w, h);
  if (!stage.trace) {
    ctx.fillStyle = 'rgba(108,124,156,0.6)';
    ctx.font = '11px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillText('запустите сценарий, чтобы увидеть трассу', w / 2, h / 2 + 4);
    return;
  }
  const events = stage.trace.events;
  for (let i = 0; i < events.length; i += 1) {
    const x = (i / events.length) * w;
    ctx.globalAlpha = 0.32;
    ctx.fillStyle = EVENT_COLORS[events[i].t] || '#52627f';
    ctx.fillRect(x, 8, 1, h - 16);
  }
  ctx.globalAlpha = 1;
  // progress fill
  const playhead = (stage.idx / events.length) * w;
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, 'rgba(94,234,212,0.07)');
  grad.addColorStop(1, 'rgba(167,139,250,0.07)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, playhead, h);
  ctx.fillStyle = 'rgba(232,238,251,0.9)';
  ctx.fillRect(playhead - 1, 0, 2, h);
  ctx.save();
  ctx.fillStyle = 'rgba(108,124,156,0.85)';
  ctx.font = '9px ui-monospace, monospace';
  ctx.fillText('spawn', 4, 12);
  ctx.fillStyle = 'rgba(94,234,212,0.9)';
  ctx.fillText('send', Math.max(4, w * 0.2), 12);
  ctx.fillStyle = 'rgba(52,211,153,0.9)';
  ctx.fillText('recv', Math.max(4, w * 0.4), 12);
  ctx.fillStyle = 'rgba(251,113,133,0.9)';
  ctx.fillText('wait', Math.max(4, w * 0.6), 12);
  ctx.fillStyle = 'rgba(244,114,182,0.9)';
  ctx.fillText('print', Math.max(4, w * 0.8), 12);
  ctx.restore();
}

function loopTimeline() {
  drawTimeline();
  requestAnimationFrame(loopTimeline);
}

buildScenarioList();
wireControls();
updateCode('fanin');
$$('[data-code-tab]', $('#code-latent')).forEach((tab) => {
  tab.addEventListener('click', () => {
    const index = Number(tab.dataset.codeTab);
    if (SCENARIOS[index]) selectScenario(SCENARIOS[index].id);
  });
});
window.addEventListener('load', () => {
  updateCode('fanin');
});

// Auto-run the flagship scenario once the module and DOM are ready.
runScenario('fanin', {announce: false}).then(() => {
  document.documentElement.dataset.killerReady = '1';
  const timelineCanvas = $('#timeline');
  const observer = new ResizeObserver(() => drawTimeline());
  observer.observe(timelineCanvas);
  loopTimeline();
});

// Test/inspection hook (used by headless CDP checks).
window.__killer = {
  runScenario,
  stage,
  scenarios: SCENARIOS.map((s) => s.id),
  state: () => ({
    scenario: current.id,
    idx: stage.idx,
    events: stage.trace ? stage.trace.totalEvents : 0,
    playing: stage.playing,
    finished: stage.finished,
    error: stage.trace?.error || null,
    outputs: stage.trace?.lines || [],
    realMs: stage.trace?.realMs || 0,
  }),
  seek: (fraction) => stage.seek(fraction),
};
