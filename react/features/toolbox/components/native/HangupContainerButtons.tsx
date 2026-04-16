import React from 'react';
import { useSelector } from 'react-redux';

import { IReduxState } from '../../../app/types';
import { END_CONFERENCE_ENABLED } from '../../../base/flags/constants';
import { getFeatureFlag } from '../../../base/flags/functions';
import { IProps as AbstractButtonProps } from '../../../base/toolbox/components/AbstractButton';
import HangupButton from '../HangupButton';

import HangupMenuButton from './HangupMenuButton';

const HangupContainerButtons = (props: AbstractButtonProps) => {
    const { conference } = useSelector((state: IReduxState) => state['features/base/conference']);
    const endConferenceSupported = conference?.isEndConferenceSupported();
    const endConferenceEnabled = useSelector((state: IReduxState) => getFeatureFlag(state, END_CONFERENCE_ENABLED, true));

    return endConferenceSupported && endConferenceEnabled

        // @ts-ignore
        ? <HangupMenuButton { ...props } />
        : <HangupButton { ...props } />;
};

export default HangupContainerButtons;
