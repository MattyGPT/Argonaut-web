import { PRACTICE_EXERCISES, practiceProgress } from '../game/practice.js';

const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

export const practiceChooserMarkup = () => PRACTICE_EXERCISES.map((exercise) => `
  <button type="button" data-practice-start="${escape(exercise.id)}"><strong>${escape(exercise.title)}</strong><span>${escape(exercise.objective)}</span></button>
`).join('');

/** Entire contents of #practice-panel; listeners and persistence belong to the app. */
export const practicePanelMarkup = (game) => {
  const progress = practiceProgress(game);
  if (!progress) return '';
  const terminal = progress.status !== 'active';
  const outcome = progress.status === 'success' ? 'Exercise complete' : progress.status === 'failure' ? 'Exercise failed' : 'Practice';
  const relay = progress.relayBenefit ? `<p>Consecutive boundaries: <strong>${progress.relayBoundaries} / 3</strong>. ${progress.relayBenefit.held ? `Federation relay support: +${progress.relayBenefit.bonus} power; command reactor budget ${progress.relayBenefit.output}.` : 'Beacon is not held by the Federation.'}</p>` : '';
  return `<h2>${escape(outcome)}: ${escape(progress.title)}</h2>
    <p class="practice-objective"><strong>Objective:</strong> ${escape(progress.objective)}</p>
    ${relay}
    ${progress.message ? `<p role="status">${escape(progress.message)}</p>` : ''}
    <details><summary>Briefing and staged setup</summary><p>${escape(progress.briefing)}</p><p>${escape(progress.setupDisclosure)}</p></details>
    ${progress.hint && !terminal ? `<p class="practice-hint"><strong>Hint:</strong> ${escape(progress.hint)}</p>` : ''}
    <div class="practice-actions">
      <button type="button" data-practice-action="hints">${progress.hintsDismissed ? 'Show hints' : 'Dismiss hints'}</button>
      <button type="button" data-practice-action="retry">Retry exercise</button>
      ${progress.status === 'success' && progress.nextId ? '<button type="button" data-practice-action="next">Next exercise</button>' : ''}
      <button type="button" data-practice-action="return">Return to previous game</button>
    </div>`;
};
