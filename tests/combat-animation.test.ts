import test from 'node:test';
import assert from 'node:assert/strict';
import { attackAnimationPhase } from '../src/game/combat-animation.ts';
import { COMBAT_CONFIG as C } from '../src/game/combat-config.ts';
import actions from '../studies/characters/combat-actions.json' with {type:'json'};

test('shared attack contact/release coincides with friendly and enemy damage clocks', () => {
  for (const [role, stats, phase] of [
    ['infantry', C.infantry, actions.SwordSlash.releasePhase],
    ['infantry', C.enemyMelee, actions.SwordSlash.releasePhase],
    ['infantry', C.enemyHeavy, actions.SwordSlash.releasePhase],
    ['archer', C.archer, actions.BowShot.releasePhase],
    ['archer', C.enemyArcher, actions.BowShot.releasePhase],
    ['cavalry', C.cavalry, actions.LanceThrust.releasePhase],
  ] as const) {
    assert.equal(attackAnimationPhase(role, 0, stats.windup, stats.recovery), 0);
    assert.equal(attackAnimationPhase(role, stats.windup, stats.windup, stats.recovery), phase);
    assert(attackAnimationPhase(role, stats.windup - .001, stats.windup, stats.recovery) < phase);
    assert(attackAnimationPhase(role, stats.windup + .001, stats.windup, stats.recovery) > phase);
    assert(Math.abs(attackAnimationPhase(role, stats.windup + stats.recovery, stats.windup, stats.recovery) - 1) < 1e-12);
    const savedElapsed = JSON.parse(JSON.stringify({elapsed: stats.windup * .7})).elapsed;
    assert(Math.abs(attackAnimationPhase(role, savedElapsed, stats.windup, stats.recovery) - phase * .7) < 1e-12);
  }
});
