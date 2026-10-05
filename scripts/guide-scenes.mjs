/** Reproducible guide illustrations. Staging is explicit; all captured UI is production UI. */
const options = { reimagined: true, precision: true, realtime: false, regional: false, sound: false, scenario: 'annihilation' };
const scene = (file, caption, extra = {}) => ({ file, caption, fixture: 'tactical', seed: 'guide-v2-map', options: extra.fixture?.startsWith('campaign') ? { ...options, precision: false } : options, theme: 'modern', art: 'sprites', pause: 'turn-based', viewport: { width: 820, height: 1100 }, scale: 1, selector: '.map-panel', ...extra });
export const GUIDE_SCENES = [
  scene('overview.png', 'The tactical screen brings the map, command console, mission report, and battle journal together.', { viewport: { width: 1366, height: 900 }, selector: null, insertion: 'guide-first-orders' }),
  scene('console.png', 'Movement and weapons stay visible; Systems and commands expands to show the additional actions.', { selector: '#console', interaction: 'console', expected: 'Systems and commands', insertion: 'guide-commands' }),
  scene('new-game.png', 'The native new-game chooser includes the ruleset, timing, scenario, and optional force setup.', { selector: '#new-game-dialog', interaction: 'chooser', expected: 'Ruleset', insertion: 'guide-start' }),
  scene('map-sprites.png', 'Sprite hulls carry alliance badges. The legend identifies selection, command, and disabled status.', { insertion: 'guide-map' }),
  scene('map.png', 'The same positions with glyph art: initials identify named hulls while badges identify alliances.', { art: 'letters', insertion: 'guide-map' }),
  scene('ship-menu.png', 'Selecting a visible enemy shows its range, exposed shield arc, and available target commands.', { interaction: 'enemy-menu', expected: 'Direct tow', insertion: 'guide-map' }),
  scene('fleet-orders.png', 'A friendly ship menu offers standing orders and explains contact requirements.', { selector: '#ship-menu', interaction: 'friendly-menu', expected: 'Standing orders', insertion: 'guide-fleet' }),
  scene('combat.png', 'A real accepted phaser order and its confirmed result appear together in the command journal card.', { fixture: 'journal', seed: 'guide-v2-causal-result', selector: '#command-log > li:first-child', interaction: 'journal', expected: 'phasers', insertion: 'guide-combat' }),
  scene('precision.png', 'The native phaser prompt targets Engines at 50% power. Shields can absorb the hit before it reaches a system.', { selector: '#target-dialog', interaction: 'precision', expected: 'Called system', insertion: 'guide-precision' }),
  scene('realtime.png', 'Real time is paused at the start: Resume and the speed buttons remain above the map. The command hull faces its newly plotted course.', { fixture: 'realtime', seed: 'guide-v2-realtime', options: { ...options, realtime: true }, pause: 'native pause at initial render, before the first animation frame', expected: 'Resume', insertion: 'guide-realtime' }),
  scene('realtime-console.png', 'After a real phaser order, the shared action cooldown appears in the console; Hold position and Automatic conn remain available as movement controls.', { fixture: 'realtime', seed: 'guide-v2-realtime', options: { ...options, realtime: true }, selector: '#console', pause: 'native pause at initial render, before the first animation frame', expected: 'Automatic conn', insertion: 'guide-realtime' }),
  scene('relay-power.png', 'An uncontested Federation relay adds five reactor points to the command ship’s power budget.', { fixture: 'relay', selector: '#console', interaction: 'power', expected: 'Reactor power', insertion: 'guide-reimagined' }),
  scene('campaign-route.png', 'The sector chart shows the fleet at Xanadu and the linked routes ahead.', { fixture: 'campaign-route', seed: 'guide-v2-sector', selector: '.sector-map-panel', insertion: 'guide-campaign' }),
  scene('campaign-debrief.png', 'The engagement debrief records the captured prize, returning conditions, and credit reward.', { fixture: 'campaign-history', seed: 'nb-1', selector: '.engagement-debrief', interaction: 'debrief', expected: 'Newly carried prizes', insertion: 'guide-campaign' }),
  scene('campaign-veteran.png', 'An expanded veteran record retains its fleet entry and the paid systems overhaul after the engagement.', { fixture: 'campaign-repaired', seed: 'nb-1', selector: 'veteran', interaction: 'veteran', expected: 'service', insertion: 'guide-campaign' }),
  scene('campaign-dockyard.png', 'The dockyard lists current repair and refit offers with their actual credit costs.', { fixture: 'campaign-history', seed: 'nb-1', selector: '#sector-dockyard', interaction: 'dockyard', expected: 'Overhaul', insertion: 'guide-campaign' }),
  scene('practice.png', 'The isolated tow exercise explains its staged setup and shows the marked destination on the live tactical map.', { fixture: 'practice', seed: 'practice-v1:tow-position', options: { ...options, realtime: true }, viewport: { width: 820, height: 1300 }, selector: null, crop: ['#practice-panel', '.map-panel'], interaction: 'practice', pause: 'practice starts paused', expected: 'Tow into position', insertion: 'guide-practice' }),
  scene('practice-complete.png', 'Two real directed tractor commands bring Mercy into the marked zone. The completed exercise offers retry, the next exercise, or return to the previous game.', { fixture: 'practice-complete', seed: 'practice-v1:tow-position', selector: '#practice-panel', pause: 'practice starts paused; completed exercise stops the controller', expected: 'exercise is complete', insertion: 'guide-practice' }),
  scene('classic.png', 'Phosphor theme and glyph art change the presentation while this scene keeps Reimagined rules.', { theme: 'classic', art: 'letters', insertion: 'guide-comfort' }),
  scene('report.png', 'Roll call reports the actual hull roster and ship conditions.', { selector: '#report', interaction: 'report', expected: 'Roll call', insertion: 'guide-commands' }),
];

// Serialized into the browser by Playwright. Keep imports and helpers inside this function.
export async function stageGuideScene(scene) {
  const { createGame, defaultLoadout, arcSplit, reactorOutput } = await import('/game/state.js');
  const { enableBattleRecords } = await import('/game/battle-records.js');
  const { createJournal, appendRecords } = await import('/ui/battle-journal.js');
  const { applyPlayerAction } = await import('/game/actions.js');
  const { resolveComputerTurns, resolveObjectives } = await import('/game/turns.js');
  localStorage.clear();
  localStorage.setItem('argonaut-web-theme', scene.theme);
  localStorage.setItem('argonaut-web-ship-art', scene.art);
  const facts = { staged: [], commands: [] };
  const saveWar = (game, journal = createJournal(game.battleRecordState.battleId)) => localStorage.setItem('argonaut-web-save-v1', JSON.stringify({ version: 1, game, journal }));
  if (scene.fixture.startsWith('campaign')) {
    const { createCampaign, startNodeBattle, resolveNodeBattle, dockyardOffers, buyDockyard } = await import('/game/campaign.js');
    const { ingestBattleServiceRecords } = await import('/game/service-records.js');
    let campaign = createCampaign({ seed: scene.seed });
    if (scene.fixture !== 'campaign-route') {
      const node = campaign.sector.nodes.find((entry) => entry.owner && entry.owner !== 'Federation');
      const started = startNodeBattle({ ...campaign, currentNode: node.id }, node.id, { battleId: 'guide-v2-service' });
      const actor = started.battle.game.ships.find((ship) => ship.id === started.battle.game.playerShipId);
      const prize = started.battle.game.ships.find((ship) => ship.faction !== 'Federation' && ship.className === 'Cruiser');
      if (!prize) throw new Error('Campaign fixture needs an enemy Cruiser');
      let game = { ...started.battle.game, terrain: [], ships: started.battle.game.ships.map((ship) => ship.id === actor.id ? { ...ship, x: 100, y: 100 } : ship.id === prize.id ? { ...ship, x: 101, y: 100, status: 'vacant', crew: 0, shields: 0, arcs: { fore: 0, aft: 0, port: 0, starboard: 0 } } : ship) };
      facts.staged.push('Fleet placed at an enemy node for a focused engagement; terrain removed; command hull at 100,100; vacant enemy Cruiser at 101,100 with zero crew and shields.');
      const action = applyPlayerAction(game, { type: 'transport', targetId: prize.id, amount: 10 });
      if (!action.records?.some((record) => record.kind === 'capture')) throw new Error('Missing authoritative capture record');
      facts.commands.push({ type: 'transport', targetId: prize.id, amount: 10 });
      facts.capture = action.records.find((record) => record.kind === 'capture');
      game = ingestBattleServiceRecords(action.game, action.records);
      game = { ...game, outcome: { kind: 'federation-win' }, ships: game.ships.map((ship) => ship.id === actor.id ? { ...ship, shields: 100, arcs: arcSplit(100), systems: { ...ship.systems, engines: 0 } } : ship) };
      facts.staged.push('Command hull engines set to zero and shields to 100; Federation-win terminal outcome staged to finalize the real capture without a long AI battle.');
      campaign = resolveNodeBattle({ ...started, battle: { ...started.battle, game } }, { strategy: false });
      facts.veteranId = actor.campaignShipId;
      facts.prizeId = prize.campaignShipId;
      if (scene.fixture === 'campaign-repaired') {
        campaign = { ...campaign, credits: 500 };
        facts.staged.push('Dockyard balance set to 500 credits to fund an actual systems overhaul.');
        const offer = dockyardOffers(campaign).find((entry) => entry.id === `systems:${actor.id}`);
        if (!offer) throw new Error('Missing systems overhaul offer');
        campaign = buyDockyard(campaign, offer.id);
        facts.commands.push({ type: 'buyDockyard', offerId: offer.id, cost: offer.cost });
        if (campaign.serviceRecords.roster[facts.veteranId].milestones.at(-1).kind !== 'repair') throw new Error('Missing paid repair milestone');
      }
    }
    localStorage.setItem('argonaut-web-save-campaign-v1', JSON.stringify({ version: 1, campaign }));
    return facts;
  }
  if (scene.fixture.startsWith('practice')) {
    const { createPracticeGame, updatePractice } = await import('/game/practice.js');
    let game = createPracticeGame('tow-position', { realtime: scene.options.realtime, battleId: `guide-v2-${scene.fixture}` });
    let journal = createJournal(game.battleRecordState.battleId);
    if (scene.fixture === 'practice-complete') {
      for (let commandIndex = 0; commandIndex < 2; commandIndex += 1) {
        const command = { type: 'tractor', targetId: 'practice-distress', towardX: 160, towardY: 120 };
        const action = applyPlayerAction(game, command);
        if (action.game === game) throw new Error('Practice completion command rejected');
        game = updatePractice(action.game);
        journal = appendRecords(journal, action.records);
        facts.commands.push(command);
        if (game.practice.status === 'active' && game.phase === 'computer') {
          game = updatePractice(resolveComputerTurns(game, { onRecords: (records) => { journal = appendRecords(journal, records); } }), { boundary: true });
        }
      }
      if (game.practice.status !== 'success') throw new Error('Real tow sequence did not complete the practice exercise');
      const target = game.ships.find((ship) => ship.id === game.practice.targetId);
      facts.completion = { status: game.practice.status, message: game.practice.message, turn: game.turn, target: { x: target.x, y: target.y, status: target.status }, zone: game.practice.zone };
    }
    const resume = enableBattleRecords(createGame({ seed: 'guide-v2-resume', reimagined: true }), { battleId: 'guide-v2-resume' });
    localStorage.setItem('argonaut-web-save-practice-v1', JSON.stringify({ version: 1, game, journal, resume: { game: resume, campaign: null, view: { entries: [], paused: true }, precisionSettings: { power: 100, focus: null }, sectorSelection: null } }));
    facts.staged.push('Uses the production tow-position fixture; all setup changes are disclosed in its briefing. ' + (scene.fixture === 'practice-complete' ? 'Completion comes from the real commands and controller checks recorded here.' : 'No practice commands issued.'));
    return facts;
  }
  let game = enableBattleRecords(createGame({ seed: scene.seed, ...scene.options, loadout: defaultLoadout() }), { battleId: `guide-v2-${scene.fixture}` });
  const positions = { 'fed-flagship': [100, 100], 'fed-cruiser-1': [105, 120], 'axis-flagship': [120, 100], 'axis-cruiser-1': [122, 125], 'bloc-flagship': [75, 105], 'cabal-flagship': [100, 75], xanadu: [130, 80] };
  game = { ...game, vendettaShipId: null, orders: { 'fed-cruiser-1': { type: 'hold', targetId: null } }, terrain: [{ id: 'guide-relay', type: 'relay', x: 75, y: 130, radius: 10 }], ships: game.ships.filter((ship) => positions[ship.id]).map((ship) => ({ ...ship, x: positions[ship.id][0], y: positions[ship.id][1], facing: ship.faction === 'Federation' ? 0 : 180 })) };
  facts.staged.push('Default loadout reduced to command hulls, one Federation and one Axis Cruiser, and Xanadu. Positions: ' + JSON.stringify(positions) + '; facings Federation 0°, others 180°; Federation Cruiser holds; vendetta cleared; one relay at 75,130 radius 10.');
  let journal = createJournal(game.battleRecordState.battleId);
  if (scene.fixture === 'journal' || scene.fixture === 'realtime') {
    const command = { type: 'phasers', targetId: 'axis-flagship', power: 50, focus: 'engines' };
    const action = applyPlayerAction(game, command);
    if (!action.records?.some((record) => record.kind === 'weapon-resolution')) throw new Error('Missing authoritative phaser result');
    game = action.game;
    journal = appendRecords(journal, action.records);
    facts.commands.push(command);
    facts.resultKinds = action.records.map((record) => record.kind);
    if (scene.fixture === 'journal') game = resolveComputerTurns(game, { onRecords: (records) => { journal = appendRecords(journal, records); } });
    else {
      const course = { type: 'move', dx: 25, dy: -15 };
      const plotted = applyPlayerAction(game, course);
      if (!plotted.records?.some((record) => record.kind === 'course-plotted')) throw new Error('Missing actual course plot');
      game = plotted.game;
      journal = appendRecords(journal, plotted.records);
      facts.commands.push(course);
    }
  }
  if (scene.fixture === 'relay') {
    game = { ...game, terrain: [{ id: 'guide-relay', type: 'relay', x: 100, y: 100, radius: 10 }] };
    const actor = game.ships.find((ship) => ship.id === game.playerShipId);
    facts.reactorBefore = reactorOutput(actor, game);
    game = resolveObjectives(game).game;
    facts.reactorAfter = reactorOutput(actor, game);
    facts.staged.push('Relay relocated to command ship at 100,100. Production resolveObjectives computes uncontested Federation ownership.');
  }
  saveWar(game, journal);
  facts.hulls = game.ships.map((ship) => ship.id);
  return facts;
}
