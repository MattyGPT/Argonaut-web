import { GRID_SIZE, SURGICAL_DAMAGE_FACTOR, WEAPONS } from '../game/constants.js';

const keys = Object.freeze({
  '0': 'computer',
  '1': 'shields',
  '2': 'move',
  '3': 'phasers',
  '4': 'photons',
  '5': 'tractor',
  '6': 'scan',
  '7': 'map',
  '8': 'transport',
  '9': 'radio',
  '-': 'hyperspace',
  '=': 'self-destruct',
  Tab: 'pass',
  '`': 'autopilot',
  Escape: 'resign',
  p: 'pass',
  P: 'pass',
  f: 'fleet',
  F: 'fleet',
  r: 'rollcall',
  R: 'rollcall',
  s: 'shots',
  S: 'shots',
  l: 'statistics',
  L: 'statistics',
  Backspace: 'fullmap',
});

/** Whether focus currently sits on something Tab is supposed to reach. */
const isFocusable = (element) => Boolean(element?.matches?.('button, input, select, textarea, a[href], [tabindex]'));

export const bindInput = (root, dispatch, getCamera = () => ({ minX: 0, minY: 0, size: GRID_SIZE })) => {
  root.addEventListener('click', (event) => {
    // Refit choices live beside the order picker and carry the hull they are for.
    const refitButton = event.target.closest('[data-refit]');
    if (refitButton) {
      dispatch({ type: 'refit', shipId: refitButton.dataset.refitShip, kind: refitButton.dataset.refit });
      return;
    }
    // Order buttons live in the ship menu and carry the ship they are for.
    const orderButton = event.target.closest('[data-order]');
    if (orderButton) {
      dispatch({ type: 'orders', shipId: orderButton.dataset.orderShip, order: { type: orderButton.dataset.order } });
      return;
    }
    // Ship-menu commands carry the hull they were opened for, so they skip the
    // target prompt the console buttons need.
    const menuCommand = event.target.closest('[data-ship-command]');
    if (menuCommand) {
      dispatch({ type: menuCommand.dataset.shipCommand, targetId: menuCommand.dataset.shipTarget });
      return;
    }
    // The menu body is not empty space: clicking it may never become a maneuver.
    if (event.target.closest('#ship-menu')) return;
    // Neither is the camera chrome (minimap, zoom buttons) that overlays the map.
    if (event.target.closest('#minimap') || event.target.closest('#camera-controls')) return;
    const command = event.target.closest('[data-command]')?.dataset.command;
    if (command) dispatch({ type: command });
    const ship = event.target.closest('[data-ship-id]')?.dataset.shipId;
    if (ship) dispatch({ type: 'map-select', targetId: ship });
    if (command || ship) return;

    // Clicking empty space on the tactical map is a maneuver order. The map is drawn
    // in grid percentages, so the click offset converts straight to coordinates.
    const map = event.target.closest('#map');
    if (!map?.getBoundingClientRect) return;
    // An open ship menu takes the next map click the way any popover does: it closes
    // instead of firing a maneuver at the point the player clicked to dismiss it.
    if (document.querySelector('#ship-menu[open]')) {
      dispatch({ type: 'menu-close' });
      return;
    }
    const rect = map.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const win = getCamera();
    dispatch({
      type: 'map-click',
      x: win.minX + ((event.clientX - rect.left) / rect.width) * win.size,
      y: win.minY + ((event.clientY - rect.top) / rect.height) * win.size,
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.target.matches('input,select,textarea')) return;
    // A modal prompt owns the keyboard. Without this guard Escape resigns command
    // instead of dismissing the dialog, and command keys fire behind the modal.
    if (document.querySelector('dialog[open]')) return;
    // An open ship menu takes Escape the same way: it closes, and the resign
    // confirmation stays out of a keystroke that meant "put the popover away".
    if (event.key === 'Escape' && document.querySelector('#ship-menu[open]')) {
      event.preventDefault();
      dispatch({ type: 'menu-close' });
      return;
    }
    // Tab is the original's "pass turn", but swallowing it traps keyboard users on
    // whichever control they reached first — the command panel is twenty buttons that
    // could not be tabbed through at all. Let Tab traverse whenever focus is already
    // on a control or the user is going backwards; `P` passes from anywhere.
    if (event.key === 'Tab' && (event.shiftKey || isFocusable(document.activeElement))) return;
    const command = keys[event.key];
    if (!command) return;
    event.preventDefault();
    dispatch({ type: command });
  });
};

/**
 * Whether the button that submitted a `method="dialog"` form was its Confirm.
 * Every button in these dialogs is a submit button — Cancel just carries
 * `value="cancel"` — so the form submits whichever is pressed, and the submitter
 * is what tells them apart. With no submitter at all the answer is no, which
 * fails closed: a prompt that cannot be read is a prompt that does nothing.
 */
const submittedConfirm = (event) => event?.submitter?.value === 'confirm';

export const promptForTarget = (title, ships, options = {}) => new Promise((resolve) => {
  const dialog = document.querySelector('#target-dialog');
  const form = document.querySelector('#target-form');
  const select = document.querySelector('#target-select');
  document.querySelector('#target-title').textContent = title;
  select.innerHTML = ships
    .map((ship) => `<option value="${ship.id}">${ship.name} — ${ship.faction} (${ship.status})</option>`)
    .join('');
  if (options.defaultId && [...select.options].some((option) => option.value === options.defaultId)) {
    select.value = options.defaultId;
  }
  document.querySelector('#amount-label').hidden = !options.amount;
  document.querySelector('#command-transfer-label').hidden = !options.transfer;

  // Precision fire adds two dials to a phaser prompt: the system the beam is
  // called to, and the power it is fired at. Both stay hidden unless the war
  // option is on and the prompt was opened for phasers.
  const precision = options.precision ?? null;
  const focusLabel = document.querySelector('#focus-label');
  const powerLabel = document.querySelector('#power-label');
  const readout = document.querySelector('#power-readout');
  const focusSelect = document.querySelector('#focus-select');
  const powerSlider = document.querySelector('#phaser-power');
  focusLabel.hidden = !precision;
  powerLabel.hidden = !precision;
  readout.hidden = !precision;
  if (precision) {
    focusSelect.innerHTML = ['standard', ...precision.systems]
      .map((name) => `<option value="${name}">${name === 'standard' ? 'Standard targeting' : name[0].toUpperCase() + name.slice(1)}</option>`)
      .join('');
    focusSelect.value = [...focusSelect.options].some((option) => option.value === precision.focus)
      ? precision.focus
      : 'standard';
    powerSlider.value = String(Number.isFinite(precision.power) ? precision.power : 100);
    const describe = () => {
      const power = Number(powerSlider.value);
      const scaled = precision.nominal * (power / 100);
      const { spread } = WEAPONS.phasers;
      readout.textContent = focusSelect.value === 'standard'
        ? `≈ ${Math.max(0, Math.round(scaled * (1 - spread)))}–${Math.round(scaled * (1 + spread))} damage, standard spread.`
        : `≈ up to ${Math.round(scaled * SURGICAL_DAMAGE_FACTOR)} damage to ${focusSelect.value}, no crew losses.`;
    };
    powerSlider.oninput = describe;
    focusSelect.onchange = describe;
    describe();
  }

  let resolved = false;
  const close = () => {
    if (!resolved) {
      resolved = true;
      resolve(null);
    }
  };
  form.onsubmit = (event) => {
    resolved = true;
    // The select always carries a value, so dismissing this prompt used to fire
    // the command at whichever target had been preselected for it.
    if (!submittedConfirm(event)) return resolve(null);
    resolve({
      targetId: select.value,
      amount: Number(document.querySelector('#crew-amount').value),
      transferCommand: document.querySelector('#transfer-command').checked,
      ...(precision ? {
        focus: focusSelect.value === 'standard' ? null : focusSelect.value,
        power: Number(powerSlider.value),
      } : {}),
    });
  };
  dialog.onclose = close;
  dialog.showModal();
});

/** A yes/no prompt for the irreversible commands. Resolves false on any dismissal. */
export const promptForConfirmation = (title, message) => new Promise((resolve) => {
  const dialog = document.querySelector('#confirm-dialog');
  const form = document.querySelector('#confirm-form');
  document.querySelector('#confirm-title').textContent = title;
  document.querySelector('#confirm-message').textContent = message;

  let resolved = false;
  form.onsubmit = (event) => {
    resolved = true;
    resolve(submittedConfirm(event));
  };
  dialog.onclose = () => {
    if (!resolved) {
      resolved = true;
      resolve(false);
    }
  };
  dialog.showModal();
});

export const promptForCoordinates = (title, labels) => new Promise((resolve) => {
  const dialog = document.querySelector('#coordinate-dialog');
  const form = document.querySelector('#coordinate-form');
  document.querySelector('#coordinate-title').textContent = title;
  document.querySelector('#first-coordinate-label').childNodes[0].textContent = labels[0];
  document.querySelector('#second-coordinate-label').childNodes[0].textContent = labels[1];

  let resolved = false;
  form.onsubmit = (event) => {
    resolved = true;
    // An empty number field reads as Number('') === 0, so dismissing this prompt
    // used to resolve [0, 0] — a legal zero-length move that passed the turn.
    if (!submittedConfirm(event)) return resolve(null);
    resolve([
      Number(document.querySelector('#first-coordinate').value),
      Number(document.querySelector('#second-coordinate').value),
    ]);
  };
  dialog.onclose = () => {
    if (!resolved) {
      resolved = true;
      resolve(null);
    }
  };
  dialog.showModal();
});

/**
 * A directed tractor tow's destination: a hull to slam the target into, or a
 * coordinate. Resolves null on any dismissal or an empty destination, so a tow is
 * never aimed somewhere by accident.
 */
export const promptForTowDestination = (ships, victimName) => new Promise((resolve) => {
  const dialog = document.querySelector('#tow-dialog');
  const form = document.querySelector('#tow-form');
  const hull = document.querySelector('#tow-hull');
  const xInput = document.querySelector('#tow-x');
  const yInput = document.querySelector('#tow-y');
  document.querySelector('#tow-title').textContent = `Direct the tow — ${victimName}`;
  hull.innerHTML = '<option value="">— use coordinates —</option>'
    + ships.map((ship) => `<option value="${ship.id}">${ship.name} (${ship.x}, ${ship.y})</option>`).join('');
  xInput.value = '';
  yInput.value = '';

  let resolved = false;
  form.onsubmit = (event) => {
    resolved = true;
    if (!submittedConfirm(event)) return resolve(null);
    if (hull.value) {
      const target = ships.find((ship) => ship.id === hull.value);
      return resolve(target ? { x: target.x, y: target.y } : null);
    }
    // An empty coordinate field reads as 0, so require both before aiming at a point.
    if (xInput.value === '' || yInput.value === '') return resolve(null);
    resolve({ x: Number(xInput.value), y: Number(yInput.value) });
  };
  dialog.onclose = () => {
    if (!resolved) {
      resolved = true;
      resolve(null);
    }
  };
  dialog.showModal();
});
