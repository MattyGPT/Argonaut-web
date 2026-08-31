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
  r: 'rollcall',
  R: 'rollcall',
  s: 'shots',
  S: 'shots',
  l: 'statistics',
  L: 'statistics',
  Backspace: 'fullmap',
});

export const bindInput = (root, dispatch) => {
  root.addEventListener('click', (event) => {
    const command = event.target.closest('[data-command]')?.dataset.command;
    if (command) dispatch({ type: command });
    const ship = event.target.closest('[data-ship-id]')?.dataset.shipId;
    if (ship) dispatch({ type: 'map-select', targetId: ship });
  });

  document.addEventListener('keydown', (event) => {
    if (event.target.matches('input,select,textarea')) return;
    const command = keys[event.key];
    if (!command) return;
    event.preventDefault();
    dispatch({ type: command });
  });
};

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

  let resolved = false;
  const close = () => {
    if (!resolved && dialog.returnValue !== 'confirm') {
      resolved = true;
      resolve(null);
    }
  };
  form.onsubmit = () => {
    resolved = true;
    resolve({
      targetId: select.value,
      amount: Number(document.querySelector('#crew-amount').value),
      transferCommand: document.querySelector('#transfer-command').checked,
    });
  };
  dialog.onclose = close;
  dialog.showModal();
});

export const promptForCoordinates = (title, labels) => new Promise((resolve) => {
  const dialog = document.querySelector('#coordinate-dialog');
  const form = document.querySelector('#coordinate-form');
  document.querySelector('#coordinate-title').textContent = title;
  document.querySelector('#first-coordinate-label').childNodes[0].textContent = labels[0];
  document.querySelector('#second-coordinate-label').childNodes[0].textContent = labels[1];

  let resolved = false;
  form.onsubmit = () => {
    resolved = true;
    resolve([
      Number(document.querySelector('#first-coordinate').value),
      Number(document.querySelector('#second-coordinate').value),
    ]);
  };
  dialog.onclose = () => {
    if (!resolved && dialog.returnValue !== 'confirm') resolve(null);
  };
  dialog.showModal();
});
