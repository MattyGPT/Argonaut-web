export const isTerminalEvent = (event) => event?.kind === 'destruction' || event?.kind === 'surrender';

export const playTerminalEvents = async (events, show, wait) => {
  for (const event of (events ?? []).filter(isTerminalEvent)) {
    show(event);
    await wait(event);
  }
  show(null);
};
