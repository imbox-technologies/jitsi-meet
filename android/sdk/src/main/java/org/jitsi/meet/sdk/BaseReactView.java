/*
 * Copyright @ 2018-present 8x8, Inc.
 * Copyright @ 2018 Atlassian Pty Ltd
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

import android.app.Activity;
import android.app.Application;
import android.content.Context;
import android.content.res.Configuration;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Bundle;
import android.view.InputQueue;
import android.view.KeyEvent;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.SurfaceHolder;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.widget.FrameLayout;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.fragment.app.FragmentActivity;

import com.facebook.react.ReactRootView;
import com.facebook.react.bridge.ReadableMap;
import com.rnimmersive.RNImmersiveModule;

import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.WeakHashMap;

/**
 * Base class for all views which are backed by a React Native view.
 */
public abstract class BaseReactView<ListenerT>
    extends FrameLayout {

    /**
     * Background color used by {@code BaseReactView} and the React Native root
     * view.
     */
    protected static int BACKGROUND_COLOR = 0xFF111111;

    /**
     * The collection of all existing {@code BaseReactView}s. Used to find the
     * {@code BaseReactView} when delivering events coming from
     * {@link ExternalAPIModule}.
     */
    static final Set<BaseReactView> views
        = Collections.newSetFromMap(new WeakHashMap<BaseReactView, Boolean>());

    /**
     * Finds a {@code BaseReactView} which matches a specific external API
     * scope.
     *
     * @param externalAPIScope - The external API scope associated with the
     * {@code BaseReactView} to find.
     * @return The {@code BaseReactView}, if any, associated with the specified
     * {@code externalAPIScope}; otherwise, {@code null}.
     */
    public static BaseReactView findViewByExternalAPIScope(
            String externalAPIScope) {
        synchronized (views) {
            for (BaseReactView view : views) {
                if (view.externalAPIScope.equals(externalAPIScope)) {
                    return view;
                }
            }
        }

        return null;
    }

    /**
     * Gets all registered React views.
     *
     * @return An {@link ArrayList} containing all views currently held by React.
     */
    static ArrayList<BaseReactView> getViews() {
        return new ArrayList<>(views);
    }

    /**
     * The unique identifier of this {@code BaseReactView} within the process
     * for the purposes of {@link ExternalAPIModule}. The name scope was
     * inspired by postis which we use on Web for the similar purposes of the
     * iframe-based external API.
     */
    protected final String externalAPIScope;

    /**
     * The listener (e.g. {@link JitsiMeetViewListener}) instance for reporting
     * events occurring in Jitsi Meet.
     */
    @Deprecated
    private ListenerT listener;

    /**
     * React Native root view.
     */
    private ReactRootView reactRootView;

    public BaseReactView(@NonNull Context context) {
        super(context);

        setBackgroundColor(BACKGROUND_COLOR);

        if (context instanceof Activity) {
            ReactInstanceManagerHolder.initReactInstanceManager((Activity) context, ((Activity) context).getApplication());
        } else if (context instanceof Application) {
            ReactInstanceManagerHolder.initReactInstanceManager(createDummyFragmentActivity(context), (Application) context);
        } else {
            throw new RuntimeException("Context must be of type Activity or Application");
        }

        // Hook this BaseReactView into ExternalAPI.
        externalAPIScope = UUID.randomUUID().toString();
        synchronized (views) {
            views.add(this);
        }
    }

    /**
     * Creates the {@code ReactRootView} for the given app name with the given
     * props. Once created it's set as the view of this {@code FrameLayout}.
     *
     * @param appName - The name of the "app" (in React Native terms) to load.
     * @param props - The React Component props to pass to the app.
     */
    public void createReactRootView(String appName, @Nullable Bundle props) {
        if (props == null) {
            props = new Bundle();
        }

        props.putString("externalAPIScope", externalAPIScope);

        if (reactRootView == null) {
            reactRootView = new ReactRootView(getContext());
            reactRootView.startReactApplication(
                ReactInstanceManagerHolder.getReactInstanceManager(),
                appName,
                props);
            reactRootView.setBackgroundColor(BACKGROUND_COLOR);
            addView(reactRootView);
        } else {
            reactRootView.setAppProperties(props);
        }
    }

    /**
     * Releases the React resources (specifically the {@link ReactRootView})
     * associated with this view.
     *
     * MUST be called when the {@link Activity} holding this view is destroyed,
     * typically in the {@code onDestroy} method.
     */
    public void dispose() {
        if (reactRootView != null) {
            removeView(reactRootView);
            reactRootView.unmountReactApplication();
            reactRootView = null;
        }
    }

    /**
     * Gets the listener set on this {@code BaseReactView}.
     *
     * @return The listener set on this {@code BaseReactView}.
     */
    @Deprecated
    public ListenerT getListener() {
        return listener;
    }

    /**
     * Abstract method called by {@link ExternalAPIModule} when an event is
     * received for this view.
     *
     * @param name - The name of the event.
     * @param data - The details of the event associated with/specific to the
     * specified {@code name}.
     */
    @Deprecated
    protected abstract void onExternalAPIEvent(String name, ReadableMap data);

    @Deprecated
    protected void onExternalAPIEvent(
            Map<String, Method> listenerMethods,
            String name, ReadableMap data) {
        ListenerT listener = getListener();

        if (listener != null) {
            ListenerUtils.runListenerMethod(
                listener, listenerMethods, name, data);
        }
    }

    /**
     * Called when the window containing this view gains or loses focus.
     *
     * @param hasFocus If the window of this view now has focus, {@code true};
     * otherwise, {@code false}.
     */
    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);

        // https://github.com/mockingbot/react-native-immersive#restore-immersive-state
        RNImmersiveModule immersive = RNImmersiveModule.getInstance();

        if (hasFocus && immersive != null) {
            immersive.emitImmersiveStateChangeEvent();
        }
    }

    /**
     * Sets a specific listener on this {@code BaseReactView}.
     *
     * @param listener The listener to set on this {@code BaseReactView}.
     */
    @Deprecated
    public void setListener(ListenerT listener) {
        this.listener = listener;
    }

    private FragmentActivity createDummyFragmentActivity(final Context context) {
        return new FragmentActivity() {
            @Override
            public Window getWindow() {
                return new Window(context) {
                    @Override
                    public void takeSurface(SurfaceHolder.Callback2 callback) {

                    }

                    @Override
                    public void takeInputQueue(InputQueue.Callback callback) {

                    }

                    @Override
                    public boolean isFloating() {
                        return false;
                    }

                    @Override
                    public void setContentView(int layoutResID) {

                    }

                    @Override
                    public void setContentView(View view) {

                    }

                    @Override
                    public void setContentView(View view, ViewGroup.LayoutParams params) {

                    }

                    @Override
                    public void addContentView(View view, ViewGroup.LayoutParams params) {

                    }

                    @Nullable
                    @Override
                    public View getCurrentFocus() {
                        return null;
                    }

                    @NonNull
                    @Override
                    public LayoutInflater getLayoutInflater() {
                        return new LayoutInflater(context) {
                            @Override
                            public LayoutInflater cloneInContext(Context newContext) {
                                return null;
                            }
                        };
                    }

                    @Override
                    public void setTitle(CharSequence title) {

                    }

                    @Override
                    public void setTitleColor(int textColor) {

                    }

                    @Override
                    public void openPanel(int featureId, KeyEvent event) {

                    }

                    @Override
                    public void closePanel(int featureId) {

                    }

                    @Override
                    public void togglePanel(int featureId, KeyEvent event) {

                    }

                    @Override
                    public void invalidatePanelMenu(int featureId) {

                    }

                    @Override
                    public boolean performPanelShortcut(int featureId, int keyCode, KeyEvent event, int flags) {
                        return false;
                    }

                    @Override
                    public boolean performPanelIdentifierAction(int featureId, int id, int flags) {
                        return false;
                    }

                    @Override
                    public void closeAllPanels() {

                    }

                    @Override
                    public boolean performContextMenuIdentifierAction(int id, int flags) {
                        return false;
                    }

                    @Override
                    public void onConfigurationChanged(Configuration newConfig) {

                    }

                    @Override
                    public void setBackgroundDrawable(Drawable drawable) {

                    }

                    @Override
                    public void setFeatureDrawableResource(int featureId, int resId) {

                    }

                    @Override
                    public void setFeatureDrawableUri(int featureId, Uri uri) {

                    }

                    @Override
                    public void setFeatureDrawable(int featureId, Drawable drawable) {

                    }

                    @Override
                    public void setFeatureDrawableAlpha(int featureId, int alpha) {

                    }

                    @Override
                    public void setFeatureInt(int featureId, int value) {

                    }

                    @Override
                    public void takeKeyEvents(boolean get) {

                    }

                    @Override
                    public boolean superDispatchKeyEvent(KeyEvent event) {
                        return false;
                    }

                    @Override
                    public boolean superDispatchKeyShortcutEvent(KeyEvent event) {
                        return false;
                    }

                    @Override
                    public boolean superDispatchTouchEvent(MotionEvent event) {
                        return false;
                    }

                    @Override
                    public boolean superDispatchTrackballEvent(MotionEvent event) {
                        return false;
                    }

                    @Override
                    public boolean superDispatchGenericMotionEvent(MotionEvent event) {
                        return false;
                    }

                    @NonNull
                    @Override
                    public View getDecorView() {
                        return new View(context);
                    }

                    @Override
                    public View peekDecorView() {
                        return null;
                    }

                    @Override
                    public Bundle saveHierarchyState() {
                        return null;
                    }

                    @Override
                    public void restoreHierarchyState(Bundle savedInstanceState) {

                    }

                    @Override
                    protected void onActive() {

                    }

                    @Override
                    public void setChildDrawable(int featureId, Drawable drawable) {

                    }

                    @Override
                    public void setChildInt(int featureId, int value) {

                    }

                    @Override
                    public boolean isShortcutKey(int keyCode, KeyEvent event) {
                        return false;
                    }

                    @Override
                    public void setVolumeControlStream(int streamType) {

                    }

                    @Override
                    public int getVolumeControlStream() {
                        return 0;
                    }

                    @Override
                    public int getStatusBarColor() {
                        return 0;
                    }

                    @Override
                    public void setStatusBarColor(int color) {

                    }

                    @Override
                    public int getNavigationBarColor() {
                        return 0;
                    }

                    @Override
                    public void setNavigationBarColor(int color) {

                    }

                    @Override
                    public void setDecorCaptionShade(int decorCaptionShade) {

                    }

                    @Override
                    public void setResizingCaptionDrawable(Drawable drawable) {

                    }
                };
            }
        };
    }
}
