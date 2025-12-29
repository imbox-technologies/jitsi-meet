/*
 * Copyright @ 2017-present 8x8, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package org.jitsi.meet.sdk;

/**
 * Interface for handling audio routing through Telecom framework.
 * 
 * When the host app has its own ConnectionService integration with Android Telecom,
 * the standard AudioManager.setSpeakerphoneOn() calls are ignored because Telecom
 * controls the audio routing. This interface allows the host app to provide
 * a handler that routes audio changes through its Telecom Connection.
 *
 * Usage:
 * 1. Implement this interface in your app
 * 2. Register it via AudioModeModule.setTelecomAudioRouteHandler()
 * 3. Jitsi will use your handler when available, falling back to AudioManager otherwise
 */
public interface TelecomAudioRouteHandler {
    
    // Device type constants (matching AudioModeModule)
    String DEVICE_BLUETOOTH = "BLUETOOTH";
    String DEVICE_EARPIECE = "EARPIECE";
    String DEVICE_HEADPHONES = "HEADPHONES";
    String DEVICE_SPEAKER = "SPEAKER";
    
    /**
     * Checks if Telecom is currently controlling audio routing.
     * This should return true when there's an active Telecom Connection
     * that would override AudioManager calls.
     *
     * @return true if Telecom is controlling audio, false otherwise
     */
    boolean isTelecomControllingAudio();
    
    /**
     * Sets the audio route through Telecom.
     * This should call Connection.setAudioRoute() on the active connection.
     *
     * @param device the device type: DEVICE_SPEAKER, DEVICE_EARPIECE, DEVICE_BLUETOOTH, or DEVICE_HEADPHONES
     * @return true if the route was changed successfully, false otherwise
     */
    boolean setAudioRoute(String device);
}

