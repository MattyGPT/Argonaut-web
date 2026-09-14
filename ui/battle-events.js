export const isTerminalEvent = (event) => event?.kind === 'destruction' || event?.kind === 'surrender';

export const ordinaryBattleEvents = (events) => (events ?? []).filter((event) => !isTerminalEvent(event));

export const playTerminalEvents = async (events, show, wait) => {
  for (const event of (events ?? []).filter(isTerminalEvent)) {
    show(event);
    await wait(event);
  }
  show(null);
};

export const playReplayEvents = async (events, playEffect, presentTerminalEvent, wait) => {
  for (const event of events ?? []) {
    if (isTerminalEvent(event)) {
      await presentTerminalEvent(event);
      continue;
    }
    const duration = playEffect(event);
    if (duration > 0) await wait(duration);
  }
};

export const withPlaybackLock = async (setLocked, play) => {
  setLocked(true);
  try {
    return await play();
  } finally {
    setLocked(false);
  }
};

export const whenPlaybackUnlocked = (isLocked, action) => (...args) => {
  if (isLocked()) return undefined;
  return action(...args);
};
