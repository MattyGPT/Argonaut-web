/** Help owns a presentation pause, never a replay lock or a gameplay action. */
export const createHelpState = ({ dialog, getBattle, isBlocked, pauseBattle, resetClock, sync, fallbackInvoker }) => {
  let active = false;
  let owner = null;
  let invoker = null;

  const open = ({ control = fallbackInvoker, anchor = null } = {}) => {
    if (isBlocked()) return false;
    if (!active) {
      const battle = getBattle();
      owner = battle?.realtime && !battle.outcome ? battle : null;
      invoker = control;
      active = true;
      resetClock();
      dialog.showModal();
      sync();
    }
    // Restrict contextual navigation to an existing section inside this guide.
    const id = anchor?.replace(/^#/, '');
    if (id && /^guide-[\w-]+$/.test(id)) {
      const section = dialog.querySelector(`[id="${id}"]`);
      if (section) {
        section.setAttribute('tabindex', '-1');
        section.scrollIntoView({ block: 'start' });
        section.focus({ preventScroll: true });
      }
    }
    return true;
  };

  const closed = () => {
    if (!active) return;
    active = false;
    // A replacement/completed battle must not inherit another battle's pause.
    if (owner && getBattle() === owner && !owner.outcome) pauseBattle(owner);
    owner = null;
    resetClock();
    sync();
    const control = invoker?.isConnected !== false && !invoker?.disabled ? invoker : fallbackInvoker;
    invoker = null;
    control?.focus({ preventScroll: true });
  };

  dialog.addEventListener('close', closed);
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    dialog.close();
  });
  return { open, get active() { return active; }, get pausesBattle() { return active && owner !== null; } };
};
