// @flow

import { PROXIMITY_DISABLED, getFeatureFlag } from '../../base/flags';
import { toState } from '../../base/redux';

/**
 * Checks if proximity sensor is disabled.
 *
 * @param {Function|Object} stateful - The redux store or {@code getState}
 * function.
 * @returns {string} - Default URL for the app.
 */
export function isProximitySensorDisabled(stateful: Function | Object) {
    const state = toState(stateful);
    const flag = getFeatureFlag(state, PROXIMITY_DISABLED, false);
    return flag;
}
