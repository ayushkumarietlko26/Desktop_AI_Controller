import { describe, expect, it } from 'vitest';
import { GestureState, resolvePresentationAction } from './gestureEngine';

describe('resolvePresentationAction', () => {
  it('previous slide on 1 finger (thumb ignored)', () => {
    const state = new GestureState();
    expect(resolvePresentationAction([1, 1, 0, 0, 0], state)).toEqual({
      action: 'SWIPE_LEFT',
    });
    expect(resolvePresentationAction([0, 1, 0, 0, 0], state)).toBeNull();
  });

  it('next slide on 2 fingers (thumb ignored)', () => {
    const state = new GestureState();
    resolvePresentationAction([0, 1, 0, 0, 0], state);
    expect(resolvePresentationAction([1, 1, 1, 0, 0], state)).toEqual({
      action: 'SWIPE_RIGHT',
    });
  });

  it('respects cooldown', () => {
    const state = new GestureState();
    resolvePresentationAction([0, 1, 0, 0, 0], state);
    expect(resolvePresentationAction([0, 1, 1, 0, 0], state)).toBeNull();
  });
});
