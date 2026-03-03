import i18n from 'i18next';
import { AnyAction } from 'redux';

// @ts-ignore
import { MIN_ASSUMED_BANDWIDTH_BPS } from '../../../../modules/API/constants';
import {
    ACTION_PINNED,
    ACTION_UNPINNED,
    createNotAllowedErrorEvent,
    createOfferAnswerFailedEvent,
    createPinnedEvent
} from '../../analytics/AnalyticsEvents';
import { sendAnalytics } from '../../analytics/functions';
import { reloadNow } from '../../app/actions';
import { IStore } from '../../app/types';
import { removeLobbyChatParticipant } from '../../chat/actions.any';
import { openDisplayNamePrompt } from '../../display-name/actions';
import { isVpaasMeeting } from '../../jaas/functions';
import { showErrorNotification } from '../../notifications/actions';
import { NOTIFICATION_TIMEOUT_TYPE } from '../../notifications/constants';
import { hasDisplayName } from '../../prejoin/utils';
import { stopLocalVideoRecording } from '../../recording/actions.any';
import LocalRecordingManager from '../../recording/components/Recording/LocalRecordingManager';
import { iAmVisitor } from '../../visitors/functions';
import { overwriteConfig } from '../config/actions';
import { CONNECTION_ESTABLISHED, CONNECTION_FAILED } from '../connection/actionTypes';
import { connectionDisconnected, disconnect } from '../connection/actions';
import { validateJwt } from '../jwt/functions';
import { JitsiConferenceErrors, JitsiConferenceEvents, JitsiConnectionErrors } from '../lib-jitsi-meet';
import { PARTICIPANT_UPDATED, PIN_PARTICIPANT } from '../participants/actionTypes';
import { PARTICIPANT_ROLE } from '../participants/constants';
import {
    getLocalParticipant,
    getParticipantById,
    getPinnedParticipant
} from '../participants/functions';
import MiddlewareRegistry from '../redux/MiddlewareRegistry';
import StateListenerRegistry from '../redux/StateListenerRegistry';
import { SET_NETWORK_INFO } from '../net-info/actionTypes';
import { STORE_NAME as NET_INFO_STORE } from '../net-info/constants';
import { TRACK_ADDED, TRACK_REMOVED } from '../tracks/actionTypes';

import {
    CONFERENCE_FAILED,
    CONFERENCE_JOINED,
    CONFERENCE_SUBJECT_CHANGED,
    CONFERENCE_WILL_LEAVE,
    P2P_STATUS_CHANGED,
    SEND_TONES,
    SET_ASSUMED_BANDWIDTH_BPS,
    SET_PENDING_SUBJECT_CHANGE,
    SET_ROOM
} from './actionTypes';
import {
    authStatusChanged,
    conferenceFailed,
    conferenceWillLeave,
    createConference,
    setLocalSubject,
    setSubject,
    updateConferenceMetadata
} from './actions';
import { CONFERENCE_LEAVE_REASONS } from './constants';
import {
    _addLocalTracksToConference,
    _removeLocalTracksFromConference,
    forEachConference,
    getCurrentConference,
    restoreConferenceOptions
} from './functions';
import logger from './logger';
import { IConferenceMetadata } from './reducer';

/**
 * Handler for before unload event.
 */
let beforeUnloadHandler: ((e?: any) => void) | undefined;

/**
 * Implements the middleware of the feature base/conference.
 *
 * @param {Store} store - The redux store.
 * @returns {Function}
 */
MiddlewareRegistry.register(store => next => action => {
    switch (action.type) {
    case CONFERENCE_FAILED:
        return _conferenceFailed(store, next, action);

    case CONFERENCE_JOINED:
        _activeConference = action.conference;

        return _conferenceJoined(store, next, action);

    case CONNECTION_ESTABLISHED:
        return _connectionEstablished(store, next, action);

    case CONNECTION_FAILED:
        return _connectionFailed(store, next, action);

    case CONFERENCE_SUBJECT_CHANGED:
        return _conferenceSubjectChanged(store, next, action);

    case CONFERENCE_WILL_LEAVE:
        _activeConference = null;
        _lastOnlineNetworkType = null;
        if (_networkRestartTimer) {
            clearTimeout(_networkRestartTimer);
            _networkRestartTimer = null;
        }
        _conferenceWillLeave(store);
        break;

    case P2P_STATUS_CHANGED:
        return _p2pStatusChanged(next, action);

    case PARTICIPANT_UPDATED:
        return _updateLocalParticipantInConference(store, next, action);

    case PIN_PARTICIPANT:
        return _pinParticipant(store, next, action);

    case SEND_TONES:
        return _sendTones(store, next, action);

    case SET_ROOM:
        return _setRoom(store, next, action);

    case TRACK_ADDED:
    case TRACK_REMOVED:
        return _trackAddedOrRemoved(store, next, action);

    case SET_ASSUMED_BANDWIDTH_BPS:
        return _setAssumedBandwidthBps(store, next, action);

    case SET_NETWORK_INFO:
        return _oNetworkTypeChanged(store, next, action);
    }

    return next(action);
});

/**
 * Set up state change listener to perform maintenance tasks when the conference
 * is left or failed.
 */
StateListenerRegistry.register(
    state => getCurrentConference(state),
    (conference, { dispatch }, previousConference): void => {
        if (conference && !previousConference) {
            conference.on(JitsiConferenceEvents.METADATA_UPDATED, (metadata: IConferenceMetadata) => {
                dispatch(updateConferenceMetadata(metadata));
            });
        }

        if (conference !== previousConference) {
            dispatch(updateConferenceMetadata(null));
        }
    });

/**
 * Makes sure to leave a failed conference in order to release any allocated
 * resources like peer connections, emit participant left events, etc.
 *
 * @param {Store} store - The redux store in which the specified {@code action}
 * is being dispatched.
 * @param {Dispatch} next - The redux {@code dispatch} function to dispatch the
 * specified {@code action} to the specified {@code store}.
 * @param {Action} action - The redux action {@code CONFERENCE_FAILED} which is
 * being dispatched in the specified {@code store}.
 * @private
 * @returns {Object} The value returned by {@code next(action)}.
 */
function _conferenceFailed({ dispatch, getState }: IStore, next: Function, action: AnyAction) {
    const { conference, error } = action;

    const result = next(action);
    const { enableForcedReload } = getState()['features/base/config'];

    if (LocalRecordingManager.isRecordingLocally()) {
        dispatch(stopLocalVideoRecording());
    }

    // Handle specific failure reasons.
    switch (error.name) {
    case JitsiConferenceErrors.CONFERENCE_RESTARTED: {
        if (enableForcedReload) {
            dispatch(showErrorNotification({
                description: 'Restart initiated because of a bridge failure',
                titleKey: 'dialog.sessionRestarted'
            }, NOTIFICATION_TIMEOUT_TYPE.LONG));
        }

        break;
    }
    case JitsiConferenceErrors.CONNECTION_ERROR: {
        const [ msg ] = error.params;

        dispatch(connectionDisconnected(getState()['features/base/connection'].connection));
        dispatch(showErrorNotification({
            descriptionArguments: { msg },
            descriptionKey: msg ? 'dialog.connectErrorWithMsg' : 'dialog.connectError',
            titleKey: 'connection.CONNFAIL'
        }, NOTIFICATION_TIMEOUT_TYPE.LONG));

        break;
    }
    case JitsiConferenceErrors.CONFERENCE_MAX_USERS: {
        dispatch(showErrorNotification({
            hideErrorSupportLink: true,
            descriptionKey: 'dialog.maxUsersLimitReached',
            titleKey: 'dialog.maxUsersLimitReachedTitle'
        }, NOTIFICATION_TIMEOUT_TYPE.LONG));

        // In case of max users(it can be from a visitor node), let's restore
        // oldConfig if any as we will be back to the main prosody.
        const newConfig = restoreConferenceOptions(getState);

        if (newConfig) {
            dispatch(overwriteConfig(newConfig));
            dispatch(conferenceWillLeave(conference));

            conference.leave()
                .then(() => dispatch(disconnect()));
        }

        break;
    }
    case JitsiConferenceErrors.NOT_ALLOWED_ERROR: {
        const [ type, msg ] = error.params;

        let descriptionKey;
        let titleKey = 'dialog.tokenAuthFailed';

        if (type === JitsiConferenceErrors.AUTH_ERROR_TYPES.NO_MAIN_PARTICIPANTS) {
            descriptionKey = 'visitors.notification.noMainParticipantsDescription';
            titleKey = 'visitors.notification.noMainParticipantsTitle';
        } else if (type === JitsiConferenceErrors.AUTH_ERROR_TYPES.NO_VISITORS_LOBBY) {
            descriptionKey = 'visitors.notification.noVisitorLobby';
        } else if (type === JitsiConferenceErrors.AUTH_ERROR_TYPES.PROMOTION_NOT_ALLOWED) {
            descriptionKey = 'visitors.notification.notAllowedPromotion';
        } else if (type === JitsiConferenceErrors.AUTH_ERROR_TYPES.ROOM_CREATION_RESTRICTION) {
            descriptionKey = 'dialog.errorRoomCreationRestriction';
        }

        dispatch(showErrorNotification({
            descriptionKey,
            hideErrorSupportLink: true,
            titleKey
        }, NOTIFICATION_TIMEOUT_TYPE.STICKY));

        sendAnalytics(createNotAllowedErrorEvent(type, msg));

        break;
    }
    case JitsiConferenceErrors.OFFER_ANSWER_FAILED:
        sendAnalytics(createOfferAnswerFailedEvent());
        break;
    }

    !error.recoverable
    && conference
    && conference.leave(CONFERENCE_LEAVE_REASONS.UNRECOVERABLE_ERROR).catch((reason: Error) => {
        // Even though we don't care too much about the failure, it may be
        // good to know that it happen, so log it (on the info level).
        logger.info('JitsiConference.leave() rejected with:', reason);
    });

    // FIXME: Workaround for the web version. Currently, the creation of the
    // conference is handled by /conference.js and appropriate failure handlers
    // are set there.
    if (typeof APP !== 'undefined') {
        _removeUnloadHandler(getState);
    }

    if (enableForcedReload && error?.name === JitsiConferenceErrors.CONFERENCE_RESTARTED) {
        dispatch(conferenceWillLeave(conference));
        dispatch(reloadNow());
    }

    return result;
}

/**
 * Does extra sync up on properties that may need to be updated after the
 * conference was joined.
 *
 * @param {Store} store - The redux store in which the specified {@code action}
 * is being dispatched.
 * @param {Dispatch} next - The redux {@code dispatch} function to dispatch the
 * specified {@code action} to the specified {@code store}.
 * @param {Action} action - The redux action {@code CONFERENCE_JOINED} which is
 * being dispatched in the specified {@code store}.
 * @private
 * @returns {Object} The value returned by {@code next(action)}.
 */
function _conferenceJoined({ dispatch, getState }: IStore, next: Function, action: AnyAction) {
    const result = next(action);
    const { conference } = action;
    const { pendingSubjectChange } = getState()['features/base/conference'];
    const {
        disableBeforeUnloadHandlers = false,
        requireDisplayName
    } = getState()['features/base/config'];

    dispatch(removeLobbyChatParticipant(true));

    pendingSubjectChange && dispatch(setSubject(pendingSubjectChange));

    // FIXME: Very dirty solution. This will work on web only.
    // When the user closes the window or quits the browser, lib-jitsi-meet
    // handles the process of leaving the conference. This is temporary solution
    // that should cover the described use case as part of the effort to
    // implement the conferenceWillLeave action for web.
    beforeUnloadHandler = (e?: any) => {
        if (LocalRecordingManager.isRecordingLocally()) {
            dispatch(stopLocalVideoRecording());
            if (e) {
                e.preventDefault();
                e.returnValue = null;
            }
        }
        dispatch(conferenceWillLeave(conference));
    };

    if (!iAmVisitor(getState())) {
        // if a visitor is promoted back to main room and want to join an empty breakout room
        // we need to send iq to jicofo, so it can join/create the breakout room
        dispatch(overwriteConfig({ disableFocus: false }));
    }

    window.addEventListener(disableBeforeUnloadHandlers ? 'unload' : 'beforeunload', beforeUnloadHandler);

    if (requireDisplayName
        && !getLocalParticipant(getState)?.name
        && !conference.isHidden()) {
        dispatch(openDisplayNamePrompt({
            validateInput: hasDisplayName
        }));
    }

    return result;
}

/**
 * Notifies the feature base/conference that the action
 * {@code CONNECTION_ESTABLISHED} is being dispatched within a specific redux
 * store.
 *
 * @param {Store} store - The redux store in which the specified {@code action}
 * is being dispatched.
 * @param {Dispatch} next - The redux {@code dispatch} function to dispatch the
 * specified {@code action} to the specified {@code store}.
 * @param {Action} action - The redux action {@code CONNECTION_ESTABLISHED}
 * which is being dispatched in the specified {@code store}.
 * @private
 * @returns {Object} The value returned by {@code next(action)}.
 */
async function _connectionEstablished({ dispatch, getState }: IStore, next: Function, action: AnyAction) {
    const result = next(action);

    const { tokenAuthUrl = false } = getState()['features/base/config'];

    // if there is token auth URL defined and local participant is using jwt
    // this means it is logged in when connection is established, so we can change the state
    if (tokenAuthUrl && !isVpaasMeeting(getState())) {
        let email;

        if (getState()['features/base/jwt'].jwt) {
            email = getLocalParticipant(getState())?.email;
        }

        dispatch(authStatusChanged(true, email || ''));
    }

    // FIXME: Workaround for the web version. Currently, the creation of the
    // conference is handled by /conference.js.
    if (typeof APP === 'undefined') {
        dispatch(createConference());

        return result;
    }

    return result;
}

/**
 * Logs jwt validation errors from xmpp and from the client-side validator.
 *
 * @param {string} message - The error message from xmpp.
 * @param {string} errors - The detailed errors.
 * @returns {void}
 */
function _logJwtErrors(message: string, errors: string) {
    message && logger.error(`JWT error: ${message}`);
    errors && logger.error('JWT parsing errors:', errors);
}

/**
 * Notifies the feature base/conference that the action
 * {@code CONNECTION_FAILED} is being dispatched within a specific redux
 * store.
 *
 * @param {Store} store - The redux store in which the specified {@code action}
 * is being dispatched.
 * @param {Dispatch} next - The redux {@code dispatch} function to dispatch the
 * specified {@code action} to the specified {@code store}.
 * @param {Action} action - The redux action {@code CONNECTION_FAILED} which is
 * being dispatched in the specified {@code store}.
 * @private
 * @returns {Object} The value returned by {@code next(action)}.
 */
function _connectionFailed({ dispatch, getState }: IStore, next: Function, action: AnyAction) {
    const { connection, error } = action;
    const { jwt } = getState()['features/base/jwt'];

    if (jwt) {
        const errors: string = validateJwt(jwt).map((err: any) =>
            i18n.t(`dialog.tokenAuthFailedReason.${err.key}`, err.args))
        .join(' ');

        _logJwtErrors(error.message, errors);

        // do not show the notification when we will prompt the user
        // for username and password
        if (error.name === JitsiConnectionErrors.PASSWORD_REQUIRED) {
            dispatch(showErrorNotification({
                descriptionKey: errors ? 'dialog.tokenAuthFailedWithReasons' : 'dialog.tokenAuthFailed',
                descriptionArguments: { reason: errors },
                titleKey: 'dialog.tokenAuthFailedTitle'
            }, NOTIFICATION_TIMEOUT_TYPE.STICKY));
        }
    }

    const result = next(action);

    _removeUnloadHandler(getState);

    forEachConference(getState, conference => {
        // TODO: revisit this
        // It feels that it would make things easier if JitsiConference
        // in lib-jitsi-meet would monitor it's connection and emit
        // CONFERENCE_FAILED when it's dropped. It has more knowledge on
        // whether it can recover or not. But because the reload screen
        // and the retry logic is implemented in the app maybe it can be
        // left this way for now.
        if (conference.getConnection() === connection) {
            // XXX Note that on mobile the error type passed to
            // connectionFailed is always an object with .name property.
            // This fact needs to be checked prior to enabling this logic on
            // web.
            const conferenceAction = conferenceFailed(conference, error.name);

            // Copy the recoverable flag if set on the CONNECTION_FAILED
            // action to not emit recoverable action caused by
            // a non-recoverable one.
            if (typeof error.recoverable !== 'undefined') {
                conferenceAction.error.recoverable = error.recoverable;
            }

            dispatch(conferenceAction);
        }

        return true;
    });

    return result;
}

/**
 * Notifies the feature base/conference that the action
 * {@code CONFERENCE_SUBJECT_CHANGED} is being dispatched within a specific
 *  redux store.
 *
 * @param {Store} store - The redux store in which the specified {@code action}
 * is being dispatched.
 * @param {Dispatch} next - The redux {@code dispatch} function to dispatch the
 * specified {@code action} to the specified {@code store}.
 * @param {Action} action - The redux action {@code CONFERENCE_SUBJECT_CHANGED}
 * which is being dispatched in the specified {@code store}.
 * @private
 * @returns {Object} The value returned by {@code next(action)}.
 */
function _conferenceSubjectChanged({ dispatch, getState }: IStore, next: Function, action: AnyAction) {
    const result = next(action);
    const { subject } = getState()['features/base/conference'];

    if (subject) {
        dispatch({
            type: SET_PENDING_SUBJECT_CHANGE,
            subject: undefined
        });
    }

    typeof APP === 'object' && APP.API.notifySubjectChanged(subject);

    return result;
}

/**
 * Notifies the feature base/conference that the action
 * {@code CONFERENCE_WILL_LEAVE} is being dispatched within a specific redux
 * store.
 *
 * @private
 * @param {Object} store - The redux store.
 * @returns {void}
 */
function _conferenceWillLeave({ getState }: IStore) {
    _removeUnloadHandler(getState);
}

/**
 * Notifies the feature base/conference that the action {@code PIN_PARTICIPANT}
 * is being dispatched within a specific redux store. Pins the specified remote
 * participant in the associated conference, ignores the local participant.
 *
 * @param {Store} store - The redux store in which the specified {@code action}
 * is being dispatched.
 * @param {Dispatch} next - The redux {@code dispatch} function to dispatch the
 * specified {@code action} to the specified {@code store}.
 * @param {Action} action - The redux action {@code PIN_PARTICIPANT} which is
 * being dispatched in the specified {@code store}.
 * @private
 * @returns {Object} The value returned by {@code next(action)}.
 */
function _pinParticipant({ getState }: IStore, next: Function, action: AnyAction) {
    const state = getState();
    const { conference } = state['features/base/conference'];

    if (!conference) {
        return next(action);
    }

    const id = action.participant.id;
    const participantById = getParticipantById(state, id);
    const pinnedParticipant = getPinnedParticipant(state);
    const actionName = id ? ACTION_PINNED : ACTION_UNPINNED;
    const local
        = participantById?.local
            || (!id && pinnedParticipant && pinnedParticipant.local);
    let participantIdForEvent;

    if (local) {
        participantIdForEvent = local;
    } else {
        participantIdForEvent
            = actionName === ACTION_PINNED ? id : pinnedParticipant?.id;
    }

    sendAnalytics(createPinnedEvent(
        actionName,
        participantIdForEvent,
        {
            local,
            'participant_count': conference.getParticipantCount()
        }));

    return next(action);
}

/**
 * Removes the unload handler.
 *
 * @param {Function} getState - The redux getState function.
 * @returns {void}
 */
function _removeUnloadHandler(getState: IStore['getState']) {
    if (typeof beforeUnloadHandler !== 'undefined') {
        const { disableBeforeUnloadHandlers = false } = getState()['features/base/config'];

        window.removeEventListener(disableBeforeUnloadHandlers ? 'unload' : 'beforeunload', beforeUnloadHandler);
        beforeUnloadHandler = undefined;
    }
}

/**
 * Requests the specified tones to be played.
 *
 * @param {Store} store - The redux store in which the specified {@code action}
 * is being dispatched.
 * @param {Dispatch} next - The redux {@code dispatch} function to dispatch the
 * specified {@code action} to the specified {@code store}.
 * @param {Action} action - The redux action {@code SEND_TONES} which is
 * being dispatched in the specified {@code store}.
 * @private
 * @returns {Object} The value returned by {@code next(action)}.
 */
function _sendTones({ getState }: IStore, next: Function, action: AnyAction) {
    const state = getState();
    const { conference } = state['features/base/conference'];

    if (conference) {
        const { duration, tones, pause } = action;

        conference.sendTones(tones, duration, pause);
    }

    return next(action);
}

/**
 * Notifies the feature base/conference that the action
 * {@code SET_ROOM} is being dispatched within a specific
 *  redux store.
 *
 * @param {Store} store - The redux store in which the specified {@code action}
 * is being dispatched.
 * @param {Dispatch} next - The redux {@code dispatch} function to dispatch the
 * specified {@code action} to the specified {@code store}.
 * @param {Action} action - The redux action {@code SET_ROOM}
 * which is being dispatched in the specified {@code store}.
 * @private
 * @returns {Object} The value returned by {@code next(action)}.
 */
function _setRoom({ dispatch, getState }: IStore, next: Function, action: AnyAction) {
    const state = getState();
    const { localSubject, subject } = state['features/base/config'];
    const { room } = action;

    if (room) {
        // Set the stored subject.
        localSubject && dispatch(setLocalSubject(localSubject));
        subject && dispatch(setSubject(subject));
    }

    return next(action);
}

/**
 * Synchronizes local tracks from state with local tracks in JitsiConference
 * instance.
 *
 * @param {Store} store - The redux store.
 * @param {Object} action - Action object.
 * @private
 * @returns {Promise}
 */
function _syncConferenceLocalTracksWithState({ getState }: IStore, action: AnyAction) {
    const state = getState();
    const conference = getCurrentConference(state);
    let promise;

    if (conference) {
        const track = action.track.jitsiTrack;

        if (action.type === TRACK_ADDED) {
            // If gUM is slow and tracks are created after the user has already joined the conference, avoid
            // adding the tracks to the conference if the user is a visitor.
            if (!iAmVisitor(state)) {
                promise = _addLocalTracksToConference(conference, [ track ]);
            }
        } else {
            promise = _removeLocalTracksFromConference(conference, [ track ]);
        }
    }

    return promise || Promise.resolve();
}

/**
 * Notifies the feature base/conference that the action {@code TRACK_ADDED}
 * or {@code TRACK_REMOVED} is being dispatched within a specific redux store.
 *
 * @param {Store} store - The redux store in which the specified {@code action}
 * is being dispatched.
 * @param {Dispatch} next - The redux {@code dispatch} function to dispatch the
 * specified {@code action} to the specified {@code store}.
 * @param {Action} action - The redux action {@code TRACK_ADDED} or
 * {@code TRACK_REMOVED} which is being dispatched in the specified
 * {@code store}.
 * @private
 * @returns {Object} The value returned by {@code next(action)}.
 */
function _trackAddedOrRemoved(store: IStore, next: Function, action: AnyAction) {
    const track = action.track;

    // TODO All track swapping should happen here instead of conference.js.
    if (track?.local) {
        return (
            _syncConferenceLocalTracksWithState(store, action)
                .then(() => next(action)));
    }

    return next(action);
}

/**
 * Updates the conference object when the local participant is updated.
 *
 * @param {Store} store - The redux store in which the specified {@code action}
 * is being dispatched.
 * @param {Dispatch} next - The redux {@code dispatch} function to dispatch the
 * specified {@code action} to the specified {@code store}.
 * @param {Action} action - The redux action which is being dispatched in the
 * specified {@code store}.
 * @private
 * @returns {Object} The value returned by {@code next(action)}.
 */
function _updateLocalParticipantInConference({ dispatch, getState }: IStore, next: Function, action: AnyAction) {
    const { conference } = getState()['features/base/conference'];
    const { participant } = action;
    const result = next(action);

    const localParticipant = getLocalParticipant(getState);

    if (conference && participant.id === localParticipant?.id) {
        if ('name' in participant) {
            conference.setDisplayName(participant.name);
        }

        if ('isSilent' in participant) {
            conference.setIsSilent(participant.isSilent);
        }

        if ('role' in participant && participant.role === PARTICIPANT_ROLE.MODERATOR) {
            const { pendingSubjectChange, subject } = getState()['features/base/conference'];

            // When the local user role is updated to moderator and we have a pending subject change
            // which was not reflected we need to set it (the first time we tried was before becoming moderator).
            if (typeof pendingSubjectChange !== 'undefined' && pendingSubjectChange !== subject) {
                dispatch(setSubject(pendingSubjectChange));
            }
        }
    }

    return result;
}

/**
 * Notifies the external API that the action {@code P2P_STATUS_CHANGED}
 * is being dispatched within a specific redux store.
 *
 * @param {Dispatch} next - The redux {@code dispatch} function to dispatch the
 * specified {@code action} to the specified {@code store}.
 * @param {Action} action - The redux action {@code P2P_STATUS_CHANGED}
 * which is being dispatched in the specified {@code store}.
 * @private
 * @returns {Object} The value returned by {@code next(action)}.
 */
function _p2pStatusChanged(next: Function, action: AnyAction) {
    const result = next(action);

    if (typeof APP !== 'undefined') {
        APP.API.notifyP2pStatusChanged(action.p2p);
    }

    return result;
}

/**
 * Notifies the feature base/conference that the action
 * {@code SET_ASSUMED_BANDWIDTH_BPS} is being dispatched within a specific
 *  redux store.
 *
 * @param {Store} store - The redux store in which the specified {@code action}
 * is being dispatched.
 * @param {Dispatch} next - The redux {@code dispatch} function to dispatch the
 * specified {@code action} to the specified {@code store}.
 * @param {Action} action - The redux action {@code SET_ASSUMED_BANDWIDTH_BPS}
 * which is being dispatched in the specified {@code store}.
 * @private
 * @returns {Object} The value returned by {@code next(action)}.
 */
function _setAssumedBandwidthBps({ getState }: IStore, next: Function, action: AnyAction) {
    const state = getState();
    const conference = getCurrentConference(state);
    const payload = Number(action.assumedBandwidthBps);

    const assumedBandwidthBps = isNaN(payload) || payload < MIN_ASSUMED_BANDWIDTH_BPS
        ? MIN_ASSUMED_BANDWIDTH_BPS
        : payload;

    if (conference) {
        conference.setAssumedBandwidthBps(assumedBandwidthBps);
    }

    return next(action);
}

/**
 * Triggers a proactive session restart when the network interface crosses
 * the WiFi/cellular boundary in either direction.
 *
 * Both directions need a restart because:
 * - WiFi->cellular: IP changes completely, NAT mapping dies, audio breaks.
 *   BOSH also accumulates errors during the offline gap and needs reset.
 * - cellular->WiFi: The session restarted on cellular uses cellular ICE
 *   candidates. Android drops the cellular interface ~8s after WiFi connects,
 *   making those candidates unreachable. A restart negotiates new WiFi candidates.
 *
 * Uses _lastOnlineNetworkType to track the effective network interface rather
 * than comparing with the immediate Redux state. This is necessary because
 * on Android, a WiFi->cellular switch fires rapid intermediate events:
 *   wifi(online) -> wifi(OFFLINE) -> none(OFFLINE) -> cellular(OFFLINE) -> cellular(online)
 * The Redux state sees wifi->none->cellular, never a direct wifi->cellular.
 * By remembering the last type seen while online, we correctly detect the
 * effective wifi->cellular transition on both iOS and Android.
 *
 * Uses session-terminate with requestRestart so Jicofo cleanly removes the
 * participant before re-inviting, avoiding endpoint conflicts on the bridge.
 */

// Cached reference to the active JitsiConference. We cannot rely on
// getCurrentConference(getState()) during network transitions because
// brief offline events on Android trigger CONFERENCE_WILL_LEAVE which
// moves the conference to the 'leaving' state, making getCurrentConference()
// return undefined even though the session is still alive.
let _activeConference: any = null;

// Debounce timer for network change restart
let _networkRestartTimer: ReturnType<typeof setTimeout> | null = null;
const RESTART_DEBOUNCE_MS = 1000;

// Last network type observed while the device was online. Used to detect
// effective interface changes across platforms (iOS fires a single event,
// Android fires a burst of intermediate offline events).
let _lastOnlineNetworkType: string | null = null;

/**
 * Resets the Strophe BOSH backoff state after a network change.
 *
 * When Android goes offline during WiFi→cellular, BOSH accumulates errors
 * and Strophe enters cubic backoff (sends^3 * 1000ms). This means the 2nd
 * retry waits 8 seconds, 3rd waits 27 seconds, etc. Nobody resets this
 * when the network comes back, so our session-terminate gets stuck behind
 * the backoff even though the network is already usable.
 *
 * This function resets the error counter, aborts in-flight XHRs bound to
 * the old network interface, and resets retry counts so that Strophe
 * immediately creates fresh HTTP connections over the new interface.
 */
function _resetBoshBackoff() {
    try {
        const bosh = _activeConference?.xmpp?.connection?._stropheConn?._proto;

        if (!bosh || typeof bosh.errors !== 'number') {
            return;
        }

        const oldErrors = bosh.errors;
        let requestsAborted = 0;

        // 1. Reset error counter to prevent premature disconnect (Strophe
        //    disconnects after 5 errors — bosh.js _hitError line 449)
        bosh.errors = 0;

        // 2. Abort in-flight XHRs and reset retry counts.
        //    After a network change, existing HTTP connections are bound to the
        //    old interface (WiFi) and their responses will never arrive. Strophe
        //    would wait SECONDARY_TIMEOUT (6s) before retrying. By aborting now,
        //    we force Strophe to immediately create new requests over the new
        //    interface (cellular).
        if (Array.isArray(bosh._requests)) {
            for (let i = 0; i < bosh._requests.length; i++) {
                const req = bosh._requests[i];

                if (req) {
                    // Abort the XHR to kill the stale TCP connection
                    if (req.xhr && typeof req.xhr.abort === 'function') {
                        req.xhr.abort();
                    }

                    // Reset retry count so the recreated request has no backoff
                    if (typeof req.sends === 'number') {
                        req.sends = 0;
                    }

                    requestsAborted++;
                }
            }
        }

        if (oldErrors > 0 || requestsAborted > 0) {
            logger.info(`Reset BOSH: errors ${oldErrors}→0, `
                + `requests aborted: ${requestsAborted}`);
        }

        // 3. Force immediate processing — Strophe will recreate the aborted
        //    requests with fresh TCP connections over the new network interface
        if (typeof bosh._throttledRequestHandler === 'function') {
            bosh._throttledRequestHandler();
        }
    } catch (e) {
        logger.warn('Failed to reset BOSH backoff:', e);
    }
}

function _oNetworkTypeChanged(_store: IStore, next: Function, action: AnyAction) {
    const result = next(action);

    const { networkType: newNetworkType, isOnline } = action;

    // If offline, cancel any pending restart (can't restart without network)
    if (!isOnline || !newNetworkType || newNetworkType === 'none') {
        if (_networkRestartTimer) {
            logger.info('Device went offline, cancelling pending network restart.');
            clearTimeout(_networkRestartTimer);
            _networkRestartTimer = null;
        }

        return result;
    }

    const previousOnlineType = _lastOnlineNetworkType;

    // Skip duplicate events — Android fires multiple identical netinfo events
    // within milliseconds. Without this guard, the second event cancels the
    // restart timer set by the first.
    if (previousOnlineType === newNetworkType) {
        return result;
    }

    _lastOnlineNetworkType = newNetworkType;

    // If returning to WiFi while a wifi→cellular restart is still PENDING
    // (within debounce window), cancel it — the user switched back before the
    // restart fired, so the original WiFi ICE session is probably still alive.
    if (newNetworkType === 'wifi' && _networkRestartTimer) {
        logger.info(`Network changed: ${previousOnlineType} -> wifi. Cancelling pending restart.`);
        clearTimeout(_networkRestartTimer);
        _networkRestartTimer = null;

        return result;
    }

    // Restart when crossing the wifi/cellular boundary in either direction:
    // - wifi→cellular: Android goes offline during the switch. BOSH accumulates
    //   errors and enters cubic backoff. Reset BOSH and restart the session.
    // - cellular→wifi: The JVB session (re-established on cellular after the
    //   previous restart) uses cellular ICE candidates. When Android drops the
    //   cellular interface (~8s after WiFi connects), those candidates become
    //   unreachable and ICE fails. Restart the session so new ICE candidates
    //   are negotiated on WiFi.
    const needsRestart = previousOnlineType === 'wifi'
        || (previousOnlineType !== null && newNetworkType === 'wifi');

    if (needsRestart) {
        // Only reset BOSH on wifi→non-wifi. During that transition, BOSH
        // accumulates errors in the offline gap and enters cubic backoff.
        // On cellular→wifi, BOSH is healthy — do NOT touch it.
        if (previousOnlineType === 'wifi') {
            _resetBoshBackoff();
        }

        const jvbSession = _activeConference?.jvbJingleSession;

        logger.info(`Network type changed: ${previousOnlineType} -> ${newNetworkType}. `
            + `activeConference=${!!_activeConference}, jvbSession=${!!jvbSession}`);

        if (jvbSession) {
            logger.info('Scheduling proactive session restart.');

            // Cancel any previous timer before setting a new one
            if (_networkRestartTimer) {
                clearTimeout(_networkRestartTimer);
            }

            _networkRestartTimer = setTimeout(() => {
                _networkRestartTimer = null;
                const currentSession = _activeConference?.jvbJingleSession;

                if (currentSession) {
                    logger.info('Terminating JVB session with requestRestart due to network change.');
                    currentSession.terminate(
                        () => {
                            logger.info('Session-terminate for network change restart sent successfully.');
                        },
                        (error: any) => {
                            logger.error('Session-terminate for network change restart failed:', error);
                        },
                        {
                            reason: 'connectivity-error',
                            reasonDescription: 'Network interface changed',
                            requestRestart: true,
                            sendSessionTerminate: true
                        }
                    );
                } else {
                    logger.warn('JVB session no longer available when restart timer fired.');
                }
            }, RESTART_DEBOUNCE_MS);
        }
    } else if (previousOnlineType) {
        logger.info(`Network changed: ${previousOnlineType} -> ${newNetworkType} (no restart needed).`);
    }

    return result;
}
