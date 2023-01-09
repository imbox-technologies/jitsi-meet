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

import android.app.Activity;
import android.app.Application;
import android.content.Context;
import android.content.MutableContextWrapper;
import android.content.res.Configuration;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Bundle;
import android.util.AttributeSet;
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
import com.rnimmersive.RNImmersiveModule;

import org.jitsi.meet.sdk.log.JitsiMeetLogger;


public class JitsiMeetView extends FrameLayout {

    /**
     * Background color used by {@code BaseReactView} and the React Native root
     * view.
     */
    private static final int BACKGROUND_COLOR = 0xFF111111;

    /**
     * React Native root view.
     */
    private ReactRootView reactRootView;

    /**
     * Mutable context for the React Native root view.
     */
    private MutableContextWrapper reactRootViewContext;

    /**
     * Helper method to recursively merge 2 {@link Bundle} objects representing React Native props.
     *
     * @param a - The first {@link Bundle}.
     * @param b - The second {@link Bundle}.
     * @return The merged {@link Bundle} object.
     */
    private static Bundle mergeProps(@Nullable Bundle a, @Nullable Bundle b) {
        Bundle result = new Bundle();

        if (a == null) {
            if (b != null) {
                result.putAll(b);
            }

            return result;
        }

        if (b == null) {
            result.putAll(a);

            return result;
        }

        // Start by putting all of a in the result.
        result.putAll(a);

        // Iterate over each key in b and override if appropriate.
        for (String key : b.keySet()) {
            Object bValue = b.get(key);
            Object aValue = a.get(key);
            String valueType = bValue.getClass().getSimpleName();

            if (valueType.contentEquals("Boolean")) {
                result.putBoolean(key, (Boolean)bValue);
            } else if (valueType.contentEquals("String")) {
                result.putString(key, (String)bValue);
            } else if (valueType.contentEquals("Bundle")) {
                result.putBundle(key, mergeProps((Bundle)aValue, (Bundle)bValue));
            } else {
                throw new RuntimeException("Unsupported type: " + valueType);
            }
        }

        return result;
    }

    public JitsiMeetView(@NonNull Context context) {
        super(context);
        initialize(context);
    }

    public JitsiMeetView(Context context, AttributeSet attrs) {
        super(context, attrs);
        initialize(context);
    }

    public JitsiMeetView(Context context, AttributeSet attrs, int defStyle) {
        super(context, attrs, defStyle);
        initialize(context);
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
     * Enters Picture-In-Picture mode, if possible. This method is designed to
     * be called from the {@code Activity.onUserLeaveHint} method.
     *
     * This is currently not mandatory, but if used will provide automatic
     * handling of the picture in picture mode when user minimizes the app. It
     * will be probably the most useful in case the app is using the welcome
     * page.
     */
    public void enterPictureInPicture() {
        PictureInPictureModule pipModule
            = ReactInstanceManagerHolder.getNativeModule(
                PictureInPictureModule.class);
        if (pipModule != null
                && pipModule.isPictureInPictureSupported()
                && !JitsiMeetActivityDelegate.arePermissionsBeingRequested()) {
            try {
                pipModule.enterPictureInPicture();
            } catch (RuntimeException re) {
                JitsiMeetLogger.e(re, "Failed to enter PiP mode");
            }
        }
    }

    /**
     * Joins the conference specified by the given {@link JitsiMeetConferenceOptions}. If there is
     * already an active conference, it will be left and the new one will be joined.
     * @param options - Description of what conference must be joined and what options will be used
     *                when doing so.
     */
    public void join(@Nullable JitsiMeetConferenceOptions options) {
        setProps(options != null ? options.asProps() : new Bundle());
    }

    /**
     * Leaves the currently active conference.
     */
    public void leave() {
        setProps(new Bundle());
    }

    /**
     * Sets a new context for the {@link ReactRootView}
     * @param context
     */
    public void setReactRootViewContext(Context context) {
        reactRootViewContext.setBaseContext(context);
    }

    /**
     * Creates the {@code ReactRootView} for the given app name with the given
     * props. Once created it's set as the view of this {@code FrameLayout}.
     *
     * @param appName - The name of the "app" (in React Native terms) to load.
     * @param props - The React Component props to pass to the app.
     */
    private void createReactRootView(String appName, @Nullable Bundle props) {
        if (props == null) {
            props = new Bundle();
        }

        if (reactRootView == null) {
            reactRootViewContext = new MutableContextWrapper(getContext());
            reactRootView = new ReactRootView(reactRootViewContext);
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

    private void initialize(@NonNull Context context) {
        // Check if the parent Activity implements JitsiMeetActivityInterface,
        // otherwise things may go wrong.
        if (!(context instanceof JitsiMeetActivityInterface)) {
            throw new RuntimeException("Enclosing Activity must implement JitsiMeetActivityInterface");
        }

        setBackgroundColor(BACKGROUND_COLOR);

        if (context instanceof Activity) {
            ReactInstanceManagerHolder.initReactInstanceManager((Activity) context, ((Activity) context).getApplication());
        } else if (context instanceof Application) {
            ReactInstanceManagerHolder.initReactInstanceManager(createDummyFragmentActivity(context), (Application) context);
        } else {
            throw new RuntimeException("Context must be of type Activity or Application");
        }
    }

    /**
     * Helper method to set the React Native props.
     * @param newProps - New props to be set on the React Native view.
     */
    private void setProps(@NonNull Bundle newProps) {
        // Merge the default options with the newly provided ones.
        Bundle props = mergeProps(JitsiMeet.getDefaultProps(), newProps);

        // XXX The setProps() method is supposed to be imperative i.e.
        // a second invocation with one and the same URL is expected to join
        // the respective conference again if the first invocation was followed
        // by leaving the conference. However, React and, respectively,
        // appProperties/initialProperties are declarative expressions i.e. one
        // and the same URL will not trigger an automatic re-render in the
        // JavaScript source code. The workaround implemented below introduces
        // "imperativeness" in React Component props by defining a unique value
        // per setProps() invocation.
        props.putLong("timestamp", System.currentTimeMillis());

        createReactRootView("App", props);
    }

    @Override
    protected void onDetachedFromWindow() {
        dispose();
        super.onDetachedFromWindow();
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
                        return new ViewGroup(context) {
                            @Override
                            protected void onLayout(boolean b, int i, int i1, int i2, int i3) {

                            }
                        };
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
