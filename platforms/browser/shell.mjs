
// SPDX-License-Identifier: GPL-3.0-or-later
// Browser host page with keyboard remapping and persistent settings.

import { createDiscCache } from './disc-cache.mjs';

const $ = (id) => document.getElementById(id);
const lines = [];

function log(text) {
  lines.push(String(text));
  $('log').textContent = lines.slice(-80).join('\n');
  console.log(text);
}

const status = (text) => {
  $('status').textContent = text;
};

const frames = { count: 0, last: 0, samples: [] };
window.meleeFrames = frames;

function onFrame() {
  const now = performance.now();

  if (frames.last) {
    frames.samples.push(now - frames.last);
    if (frames.samples.length > 7200) frames.samples.shift();
  }

  frames.last = now;

  if (++frames.count % 30 === 0 && frames.samples.length > 60) {
    const recent = frames.samples.slice(-120);
    const sorted = [...recent].sort((a, b) => a - b);
    const fps = 1000 * recent.length /
      recent.reduce((a, b) => a + b, 0);

    $('stats').textContent =
      `${fps.toFixed(1)} fps · p99 ${sorted[Math.floor(sorted.length * 0.99)].toFixed(1)} ms`;
  }
}

function syncfs(populate) {
  return new Promise((resolve, reject) =>
    Module.FS.syncfs(populate, (error) =>
      error ? reject(error) : resolve()
    )
  );
}

// Keyboard scancodes used by SDL3.
const keyCodes = {};

for (let i = 0; i < 26; i++) {
  keyCodes['Key' + String.fromCharCode(65 + i)] = 4 + i;
}

for (let i = 0; i < 9; i++) {
  keyCodes['Digit' + (i + 1)] = 30 + i;
}

keyCodes.Digit0 = 39;

Object.assign(keyCodes, {
  Enter: 40,
  Escape: 41,
  Backspace: 42,
  Tab: 43,
  Space: 44,
  Minus: 45,
  Equal: 46,
  BracketLeft: 47,
  BracketRight: 48,
  Backslash: 49,
  Semicolon: 51,
  Quote: 52,
  Backquote: 53,
  Comma: 54,
  Period: 55,
  Slash: 56,
  CapsLock: 57,
  F1: 58,
  F2: 59,
  F3: 60,
  F4: 61,
  F5: 62,
  F6: 63,
  F7: 64,
  F8: 65,
  F9: 66,
  F10: 67,
  F11: 68,
  F12: 69,
  Insert: 73,
  Home: 74,
  PageUp: 75,
  Delete: 76,
  End: 77,
  PageDown: 78,
  ArrowRight: 79,
  ArrowLeft: 80,
  ArrowDown: 81,
  ArrowUp: 82,
  ShiftLeft: 225,
  ControlLeft: 224,
  AltLeft: 226,
  MetaLeft: 227,
  ControlRight: 228,
  AltRight: 230,
  ShiftRight: 229,
  MetaRight: 231
});

const defaultBindings = [
  27,  // A = X
  29,  // B = Z
  6,   // X = C
  25,  // Y = V
  40,  // Start = Enter
  43,  // Z = Tab
  20,  // L = Q
  8,   // R = E
  23,  // D-pad Up = T
  10,  // D-pad Down = G
  9,   // D-pad Left = F
  11,  // D-pad Right = H
  79,  // Main stick Right
  80,  // Main stick Left
  82,  // Main stick Up
  81,  // Main stick Down
  15,  // C-stick Right = L
  13,  // C-stick Left = J
  12,  // C-stick Up = I
  14   // C-stick Down = K
];

const bindingNames = [
  'Botón A',
  'Botón B',
  'Botón X',
  'Botón Y',
  'Start',
  'Botón Z',
  'Botón L',
  'Botón R',
  'Cruceta arriba',
  'Cruceta abajo',
  'Cruceta izquierda',
  'Cruceta derecha',
  'Stick principal derecha',
  'Stick principal izquierda',
  'Stick principal arriba',
  'Stick principal abajo',
  'C-stick derecha',
  'C-stick izquierda',
  'C-stick arriba',
  'C-stick abajo'
];

function keyName(scancode) {
  for (const [code, value] of Object.entries(keyCodes)) {
    if (value === scancode) {
      if (code.startsWith('Key')) return code.slice(3);
      if (code.startsWith('Digit')) return code.slice(5);
      if (code === 'ArrowUp') return '↑';
      if (code === 'ArrowDown') return '↓';
      if (code === 'ArrowLeft') return '←';
      if (code === 'ArrowRight') return '→';
      if (code === 'Space') return 'Espacio';
      if (code === 'Enter') return 'Enter';
      return code;
    }
  }

  return 'Tecla ' + scancode;
}

let bindings = [...defaultBindings];
let capturingSlot = null;

try {
  const saved = JSON.parse(
    localStorage.getItem('melee-key-bindings-v1')
  );

  if (Array.isArray(saved) && saved.length === 20 &&
      saved.every(Number.isInteger)) {
    bindings = saved;
  }
} catch (error) {
  console.warn('No se pudieron cargar los controles guardados.', error);
}

function applyBindings() {
  if (typeof Module._pc_set_key_binding !== 'function') {
    return false;
  }

  for (let i = 0; i < bindings.length; i++) {
    Module._pc_set_key_binding(i, bindings[i]);
  }

  return true;
}

function saveBindings() {
  try {
    localStorage.setItem(
      'melee-key-bindings-v1',
      JSON.stringify(bindings)
    );
  } catch (error) {
    console.warn('No se pudieron guardar los controles.', error);
  }
}

function createKeyboardMenu() {
  const style = document.createElement('style');

  style.textContent = `
    #keyboard-settings {
      margin: 12px auto;
      padding: 14px;
      max-width: 850px;
      color: #eeeeee;
      background: #20242b;
      border: 1px solid #454c57;
      border-radius: 10px;
      font-family: Arial, sans-serif;
    }

    #keyboard-settings h2 {
      margin: 0 0 12px;
      font-size: 19px;
    }

    #keyboard-settings .key-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 7px 0;
      border-bottom: 1px solid #383e47;
    }

    #keyboard-settings button {
      padding: 7px 12px;
      color: white;
      background: #39495f;
      border: 1px solid #687b96;
      border-radius: 6px;
      cursor: pointer;
    }

    #keyboard-settings button:hover {
      background: #506987;
    }

    #keyboard-settings .key-value {
      min-width: 85px;
      font-weight: bold;
      text-align: center;
    }

    #keyboard-settings .menu-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
    }

    #keyboard-settings .hint {
      color: #b8c4d4;
      font-size: 13px;
    }
  `;

  document.head.appendChild(style);

  const panel = document.createElement('section');
  panel.id = 'keyboard-settings';

  const heading = document.createElement('h2');
  heading.textContent = '🎮 Controles del teclado';
  panel.appendChild(heading);

  const hint = document.createElement('p');
  hint.className = 'hint';
  hint.textContent =
    'Pulsa Cambiar y después presiona la tecla que quieras asignar.';
  panel.appendChild(hint);

  const rows = [];

  for (let i = 0; i < bindingNames.length; i++) {
    const row = document.createElement('div');
    row.className = 'key-row';

    const name = document.createElement('span');
    name.textContent = bindingNames[i];

    const value = document.createElement('span');
    value.className = 'key-value';
    value.textContent = keyName(bindings[i]);

    const button = document.createElement('button');
    button.textContent = 'Cambiar';

    button.addEventListener('click', () => {
      capturingSlot = i;
      button.textContent = 'Presiona una tecla...';
      hint.textContent = 'Ahora presiona la tecla que quieras usar.';
    });

    row.append(name, value, button);
    panel.appendChild(row);

    rows.push({ value, button });
  }

  const actions = document.createElement('div');
  actions.className = 'menu-actions';

  const reset = document.createElement('button');
  reset.textContent = 'Restaurar controles originales';

  reset.addEventListener('click', () => {
    bindings = [...defaultBindings];
    capturingSlot = null;
    applyBindings();
    saveBindings();
    updateRows();
    hint.textContent = 'Controles originales restaurados.';
  });

  actions.appendChild(reset);
  panel.appendChild(actions);

  function updateRows() {
    for (let i = 0; i < rows.length; i++) {
      rows[i].value.textContent = keyName(bindings[i]);
      rows[i].button.textContent =
        capturingSlot === i ? 'Presiona una tecla...' : 'Cambiar';
    }
  }

  window.addEventListener('keydown', (event) => {
    if (capturingSlot === null) return;

    const scancode = keyCodes[event.code];

    if (scancode === undefined) {
      hint.textContent = 'Esa tecla no es compatible. Prueba otra.';
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    bindings[capturingSlot] = scancode;

    const success = applyBindings();

    saveBindings();

    capturingSlot = null;
    updateRows();

    hint.textContent = success
      ? '¡Tecla cambiada y guardada!'
      : 'Tecla guardada. Se aplicará cuando el juego inicie.';
  }, true);

  document.body.insertBefore(panel, document.body.firstChild);
}

createKeyboardMenu();

const ENV = {};

for (const [key, value] of new URLSearchParams(location.search)) {
  if (/^MELEE_[A-Z0-9_]+$/.test(key)) {
    ENV[key] = value;
  }
}

let ready = false;

window.Module = {
  preRun: [
    () => Object.assign(Module.ENV, ENV)
  ],

  canvas: $('canvas'),
  print: log,
  printErr: log,
  onFrame,

  onAbort: (reason) => {
    status(`Engine stopped: ${reason}`);
  },

  onGraphicsPreparation: (done, total) => {
    status(
      done === total
        ? 'Starting…'
        : `Preparing graphics… ${Math.floor(done * 100 / total)}%`
    );
  },

  onRuntimeInitialized: () => {
    ready = true;
    applyBindings();
    status('Choose a GALE01 disc image (.iso or .gcm).');
    updateStart();
  }
};

function updateStart() {
  $('start').disabled = !(ready && $('disc').files.length);
}

$('disc').addEventListener('change', updateStart);

$('start').addEventListener('click', async () => {
  $('start').disabled = true;
  $('disc').disabled = true;

  try {
    if (!navigator.gpu) {
      throw Error('This browser has no WebGPU. Try a current Chrome or Edge.');
    }

    Module.discFile = $('disc').files[0];
    Module.readDisc = createDiscCache(Module.discFile).read;

    for (const dir of ['/saves', '/cache']) {
      Module.FS.mkdirTree(dir);
      Module.FS.mount(
        Module.FS.filesystems.IDBFS,
        { autoPersist: dir === '/saves' },
        dir
      );
    }

    await syncfs(true);

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        syncfs(false).catch(log);
      }
    });

    status('');
    $('canvas').focus();
    Module.callMain([]);
  } catch (error) {
    status(error.message);
    log(error.stack || error);
  }
});

if (crossOriginIsolated) {
  sessionStorage.removeItem('melee-coi-reload');

  const script = document.createElement('script');
  script.src = './melee_browser.js';

  script.onerror = () => {
    status('melee_browser.js is missing: run tools/browser/build.py first.');
  };

  document.head.append(script);
} else if (
  navigator.serviceWorker &&
  !sessionStorage.getItem('melee-coi-reload')
) {
  sessionStorage.setItem('melee-coi-reload', '1');

  navigator.serviceWorker.register('./coi-sw.js')
    .then(() => navigator.serviceWorker.ready)
    .then(() => location.reload())
    .catch((error) => {
      status(`Cannot enable threads: ${error.message}`);
    });
} else {
  status(
    'This page needs cross-origin isolation for its threads, and this browser did not allow it.'
  );
}
