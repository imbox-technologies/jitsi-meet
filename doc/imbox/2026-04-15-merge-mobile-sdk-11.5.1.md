# Merge upstream `mobile-sdk-11.5.1` → `imbox-android-mobile-sdk-11.5.1`

**Fecha**: 2026-04-15
**Autor del merge**: Alvaro Marcos
**Rama destino**: `imbox-android-mobile-sdk-11.5.1` (creada desde `imbox-mobile-24.5`)
**Tag upstream mergeado**: `mobile-sdk-11.5.1` (2025-09-16)
**Issue relacionado**: `imbox-technologies/AndroidClient#3902`

---

## 1. Contexto y motivación

### 1.1. El problema

Google Play emitió un aviso para la app `spotbrosClient`:

> **App must support 16 KB memory page sizes**
>
> From 31 May 2026, if your app updates do not support 16 KB memory page sizes, you won't be able to release these updates.

El requisito es mandatory para apps con targetSdk Android 15+. El aviso no viene de código propio de AndroidClient sino del **SDK de Jitsi** (librería nativa con código C/C++ que no cumplía 16 KB alignment).

### 1.2. Versión previa

La app consumía `org.jitsi.react:jitsi-meet-sdk:10.2.1`, build desde nuestro fork `imbox-technologies/jitsi-meet` branch `imbox-mobile-24.5` (heredero de upstream `mobile-24.5` ≡ mobile-sdk 10.2.1).

### 1.3. Estado en upstream Jitsi

- **11.5.1** (16-sep-2025): añade soporte 16 KB — reemplaza `duktape` por `react-native-worklets-core`. Fix del issue [jitsi/jitsi-meet#16190](https://github.com/jitsi/jitsi-meet/issues/16190).
- **11.6.0**: crash conocido ([jitsi/jitsi-meet#16527](https://github.com/jitsi/jitsi-meet/issues/16527)) — evitar.
- **11.6.3**: fixes de 11.6.
- **12.0.0** (23-ene-2026): última versión.

### 1.4. Estrategia — stepped merge

Se adopta un merge en dos pasos:

1. **Paso 1** (este documento): `10.2.1 → 11.5.1`. Es el salto crítico: cambia motor JS (`duktape` → `worklets-core`), sube React Native `0.73.8 → 0.77.2` (4 versiones mayores, nueva arquitectura bridgeless, Hermes por defecto). Con este paso ya se cumple el requisito de Play Store (31-may-2026).
2. **Paso 2** (futuro): `11.5.1 → 12.0.0`. Trivial en comparación: mismo RN 0.77.2, solo bump de webrtc `124.0.4 → 124.0.7`.

Ventaja: si el paso 2 se complica, con 11.5.1 (o 11.6.3 como fallback) ya quedamos en regla.

### 1.5. Convención de nombres de rama

Se renombra la convención histórica para ganar claridad de cara al futuro:

| Antes | Ahora |
|---|---|
| `imbox-mobile-24.5` (Android, versión app) | `imbox-android-mobile-sdk-11.5.1` (plataforma + SDK) |
| `imbox-mobile-23.5` (iOS, versión app) | `imbox-ios-mobile-sdk-X.X.X` (pendiente) |

Razones:
- Upstream Jitsi separa `mobile-app-*` (versión app oficial) de `mobile-sdk-*` (versión SDK embebible). Nosotros **solo consumimos el SDK**, así que anclar al tag `mobile-sdk-*` es más preciso.
- Añadir `android-`/`ios-` distingue la rama por plataforma consumidora aunque el código toque ambas (el fork es cross-platform).

---

## 2. Preparación del entorno

### 2.1. Remote upstream

El fork solo tenía `origin` apuntando a `imbox-technologies/jitsi-meet`. Se añadió:

```bash
git remote add upstream https://github.com/jitsi/jitsi-meet.git
git fetch upstream --tags
```

### 2.2. Análisis del alcance del fork vs upstream 10.2.1

- **48 ficheros modificados**, ~1.380 líneas añadidas respecto a upstream `aca89c2e4` (tag `mobile-sdk-10.2.1`).
- Solo **7 commits** tras el último merge upstream (`295537d917df`, nov-2024): audio recovery WiFi↔celular (#3871), Telecom compat, botón colapsar PiP + ajuste tamaño, "Other routes", removed permissions, fix iOS build.

### 2.3. Matriz de dependencias clave por versión

|  | `react-native` | `react-native-webrtc` | JS engine |
|---|---|---|---|
| **10.2.1** (actual fork) | `0.73.8` | `124.0.4` | duktape |
| **11.5.1** (target paso 1) | `0.77.2` ⚠️ | `124.0.4` ✅ | worklets-core |
| **11.6.3** (fallback) | `0.77.2` | `124.0.7` | worklets-core |
| **12.0.0** (target paso 2) | `0.77.2` | `124.0.7` | worklets-core |

Implicaciones clave:
- Salto duro de **RN 0.73.8 → 0.77.2** (bridgeless architecture, Hermes obligatorio).
- `react-native-webrtc` se mantiene en `124.0.4`: nuestro patch `patches/react-native-webrtc+124.0.4.patch` sigue válido sin tocar.

### 2.4. Churn en hot files (HEAD vs 11.5.1)

| Fichero | Líneas cambiadas upstream | Nuestras modificaciones |
|---|---|---|
| `external-api/middleware.ts` | 252 (245+/7−) | 174+/165− |
| `JitsiMeetView.java` | 8 (3+/5−) | +365 |
| `conference/middleware.any.ts` | 121 (75+/46−) | +223 |
| `AudioModeModule.java` | 46 (40+/6−) | +160 |
| `Toolbox.tsx` | 136 (58+/78−) | 34+/23− |
| `JitsiMeetActivity.java` | 91 | ~30 |

---

## 3. Directriz conservadora

Premisa absoluta del merge:

> Todos los cambios en el fork responden a necesidades muy concretas (adaptaciones, bug fixes, hacks necesarios para la integración de Jitsi en la app imbox). **Bajo ningún concepto** podemos descartar lógica propia en el merge salvo que esté perfectamente justificado tras analizar en profundidad cómo se usa Jitsi desde AndroidClient (app imbox Android).

Esta directiva guía todas las decisiones conflictivas: por defecto, preservar nuestro código. Solo adoptar upstream cuando (a) no hay equivalente funcional, (b) hay breaking change mandatorio (e.g. RN 0.77.2 requirements), o (c) se verifica que la customización propia ya no es necesaria.

---

## 4. Ejecución del merge y análisis de conflictos

`git merge mobile-sdk-11.5.1` produjo **25 ficheros en conflicto**. Se categorizan por dificultad.

### 4.1. Categoría A — Triviales (11 ficheros)

| # | Fichero | Tipo de conflicto | Resolución | Justificación |
|---|---|---|---|---|
| 1 | `ios/app/broadcast-extension/Info.plist` | Versión `24.5.0 → 25.5.1` | aceptar upstream | Version bump mecánico |
| 2 | `ios/app/src/Info.plist` | Versión | aceptar upstream | ídem |
| 3 | `ios/app/watchos/app/Info.plist` | Versión | aceptar upstream | ídem |
| 4 | `ios/app/watchos/extension/Info.plist` | Versión | aceptar upstream | ídem |
| 5 | `ios/sdk/src/Info.plist` | `10.2.1 → 11.5.1` | aceptar upstream | ídem |
| 6 | `ios/sdk/src/Lite-Info.plist` | `10.2.1 → 11.5.1` | aceptar upstream | ídem |
| 7 | `ios/sdk/sdk.xcodeproj/project.pbxproj` | Upstream eliminó `JavaScriptSandbox.m` + `Pods_JitsiMeetSDK.framework` | aceptar upstream | Es parte del cambio duktape → worklets-core por el que nos actualizamos |
| 8 | `.gitignore` | Ambos añadieron entradas diferentes | **unir ambos** (`tmp` nuestro + `tests/.env`, `test-results` upstream) | Combinación no-conflictiva |
| 9 | `PictureInPictureButton.ts` | Upstream añadió `override` + `icon = IconArrowDown`; nosotros `icon = IconPip` | **combinar**: adoptar `override` (requisito TS strict de RN 0.77.2), **mantener `IconPip`** | `IconPip` en nuestro fork está aliaseado a `collapsed.svg` (ver commit `10230d3c5` "botón para colapsar el picture in picture"). Preservar UX custom |
| 10 | `ios/app/app.xcodeproj/project.pbxproj` | Upstream añadió `hermes.xcframework`, `PrivacyInfo.xcprivacy`, Swift `AppDelegate` + `ViewController`; eliminó `main.m`, `FIRUtilities.m` | aceptar upstream | RN 0.77.2 mandatory migration (Swift AppDelegate). Nuestro único cambio propio (`libPods-JitsiMeet.a → Pods_JitsiMeet.framework`) era cosmético — CocoaPods regenera en `pod install` |
| 11 | `BroadcastIntentHelper.java` (resuelto en Cat C1) | Upstream borró `buildSetAudioDeviceIntent()` | mantener nuestro helper | ver sección 4.3.1 |

### 4.2. Categoría B — Moderados (6 ficheros)

#### 4.2.1. `android/build.gradle`

**Conflicto**: upstream reorganizó el bloque `ext { }` dentro de `buildscript { ext { } }` al top del fichero (antes era un bloque suelto). Upstream 11.5.1 trae:
- `kotlinVersion "1.7.0" → "2.0.21"`
- `buildToolsVersion "33.0.2" → "35.0.0"`
- `compileSdkVersion 34 → 35`
- `minSdkVersion 24 → 26` ⚠️
- `targetSdkVersion 34 → 35`
- `ndkVersion "23.1.7779620" → "27.1.12297006"`
- `rnVersion "0.73.8" → "0.77.2"`
- Nuevo: `javaVersion VERSION_17`, `jvmToolchainVersion 17`, `jvmTargetVersion '17'`, `gradlePluginVersion "8.6.0"`
- **`libreBuild` default cambió nuestro valor `"true"` al default upstream `"false"`**.

**Resolución**: aceptar la reestructura upstream al completo, pero **sobrescribir `libreBuild = "true"`** (nuestra customización histórica — ver historia: commits `6d1a66e` y similares donde intencionalmente pusimos `"true"` como default del fork).

**Justificación**: `libreBuild=true` evita build de componentes propietarios Google (Amplitude, Giphy, GoogleSignIn) que no necesitamos. Es una customización deliberada del fork.

⚠️ **Efecto colateral crítico**: `minSdkVersion 26` es un bump desde `24`. AndroidClient `spotbrosClient/build.gradle` tiene actualmente `minSdkVersion 25` — habrá que **bumpearla a 26** para poder instalar el nuevo SDK Jitsi (sino fallará dependency resolution).

#### 4.2.2. `android/gradle.properties`

**Conflicto**: dos bloques.
1. `-Xmx4096m` (nuestro) vs `-Xmx4048m` (upstream).
2. Upstream añadió `android.enableJetifier=true`, `newArchEnabled=false`, `hermesEnabled=true` + nuevas versiones `appVersion=25.5.1 sdkVersion=11.5.1`.

**Resolución**: mantener `-Xmx4096m` (nuestro, más RAM para builds grandes) + aceptar bloque upstream de nuevas props.

#### 4.2.3. `ios/app/app.xcodeproj/project.pbxproj`

Ya descrito en fila 10 de Cat A. Aceptar upstream; nuestros cambios eran renames cosméticos sin impacto funcional (CocoaPods los regenera).

#### 4.2.4. `ios/sdk/src/AudioMode.m`

**Conflicto**: upstream añadió guard `audioDisabled` early-return en `setMode`; nosotros habíamos añadido `RCTLogInfo(@"[AudioMode] Set mode: %d", mode);`.

**Resolución**: **combinar ambos** — primero el guard upstream, luego nuestro log:

```objc
RCT_EXPORT_METHOD(setMode:(int)mode ...) {
    if (audioDisabled) {
        resolve(nil);
        return;
    }
    RCTLogInfo(@"[AudioMode] Set mode: %d", mode);
    // ... resto del método upstream
}
```

#### 4.2.5. `react/features/mobile/audio-mode/middleware.ts`

**Conflictos**:
1. Imports: nuestro `{ AUDIO_FOCUS_DISABLED, AUDIO_DEFAULT_TO_SPEAKER }` vs upstream `{ AUDIO_FOCUS_DISABLED }` + nuevo `SET_CONFIG`.
2. Switch block: upstream outdentó el switch un nivel (estilo `case` alineado con `switch`).

**Resolución**:
1. **Mantener ambos imports**: `{ AUDIO_DEFAULT_TO_SPEAKER, AUDIO_FOCUS_DISABLED }` + nuevo `{ SET_CONFIG }`. Nuestro `AUDIO_DEFAULT_TO_SPEAKER` se usa en `_updateAudioMode` para decidir si por defecto el audio va a speaker o earpiece (feature flag custom de imbox).
2. Adoptar indentación upstream + mantener nuestro case `CONFERENCE_JOINED | SET_AUDIO_ONLY → _updateAudioMode`.

#### 4.2.6. `android/sdk/src/main/java/org/jitsi/meet/sdk/JitsiMeetActivity.java`

**Conflictos**: dos bloques.

1. **Imports**: upstream eliminó `FrameLayout`, añadió `View`, `ViewGroup`, `Window` (para el nuevo `addTopBottomInsets`).
2. **`onCreate`**: upstream cambió a `findViewById(R.id.jitsiView)` + `addTopBottomInsets(getWindow(), findViewById(android.R.id.content))`. Nosotros teníamos `createJitsiView()` subclaseable + `getRootView().addView(...)` programático.

**Análisis crítico**: AndroidClient `spotbrosClient/src/main/java/com/spotbros/ui/activities/NewCallActivity.java:113` declara `public class NewCallActivity extends JitsiMeetActivity` y override `createJitsiView()` en las líneas 235-244. **No podemos revertir al modelo upstream sin romper AndroidClient.**

Además, nuestro fork elimina el elemento `<JitsiMeetView>` del XML de layout (`android/sdk/src/main/res/layout/activity_jitsi_meet.xml` queda como un `<FrameLayout>` vacío), porque la view se crea programáticamente vía `createJitsiView()`.

**Resolución — modelo híbrido**:
- Mantener imports nuestros + upstream: `FrameLayout` (ours, necesario) + `View`, `ViewGroup`, `Window` (upstream, necesario para `addTopBottomInsets`).
- Mantener nuestro patrón `createJitsiView()` + `getRootView().addView(jitsiView)` + layout XML programático.
- **Añadir** la llamada `addTopBottomInsets(getWindow(), findViewById(android.R.id.content))` antes del `createJitsiView()`.
- Mantener nuestro `join()` con null-check de `options`.

```java
setContentView(R.layout.activity_jitsi_meet);

addTopBottomInsets(getWindow(), findViewById(android.R.id.content));

this.jitsiView = createJitsiView();
if (jitsiView != null) {
    jitsiView.setLayoutParams(new FrameLayout.LayoutParams(
        FrameLayout.LayoutParams.MATCH_PARENT,
        FrameLayout.LayoutParams.MATCH_PARENT));
    getRootView().addView(jitsiView);
}
```

### 4.3. Categoría C — Difíciles (5 ficheros)

#### 4.3.1. SET_AUDIO_DEVICE — resurrect (5 ficheros afectados)

**Hallazgo crítico**: upstream **eliminó completamente** la acción `SET_AUDIO_DEVICE` en algún punto entre 10.2.1 y 11.5.1. Afecta a 5 ficheros: `BroadcastAction.java`, `BroadcastIntentHelper.java`, `ExternalAPIModule.java`, `ios/sdk/src/ExternalAPI.m`, `react/features/mobile/external-api/middleware.ts`.

**Verificación**: `git show aca89c2e4:android/sdk/src/main/java/org/jitsi/meet/sdk/BroadcastAction.java | grep SET_AUDIO_DEVICE` confirma que existía en upstream 10.2.1 — no era una adición nuestra, era funcionalidad upstream heredada.

**Análisis de uso**:
- AndroidClient no lo invoca directamente vía broadcast (grep: sin matches).
- Pero `ios/sdk/src/JitsiMeetView.h:54` expone `- (void)setAudioDevice:(NSString *_Nonnull)device;` como API pública — la app iOS de imbox podría usarlo.
- `react/features/mobile/audio-mode/components/AudioRoutePickerDialog.tsx:231` llama `AudioMode.setAudioDevice(device.uid || device.type)` directamente desde UI Jitsi.

**Decisión**: **mantener** `SET_AUDIO_DEVICE` en el fork (directriz conservadora). No podemos garantizar que la app iOS de imbox no lo use y el impacto de eliminarlo sería silencioso (rompe routing de audio sin error de compilación visible).

**Resolución por fichero**:

##### `BroadcastAction.java`
Fusionar los enums: nuestro `SET_AUDIO_DEVICE` + todos los nuevos de upstream (`SHOW_NOTIFICATION`, `HIDE_NOTIFICATION`, `START_RECORDING`, `STOP_RECORDING`, `OVERWRITE_CONFIG`, `SEND_CAMERA_FACING_MODE_MESSAGE`). Resultado:

```java
enum Type {
    // ... anteriores
    SET_CLOSED_CAPTIONS_ENABLED("org.jitsi.meet.SET_CLOSED_CAPTIONS_ENABLED"),
    SET_AUDIO_DEVICE("org.jitsi.meet.SET_AUDIO_DEVICE"),        // ← mantenido
    TOGGLE_CAMERA("org.jitsi.meet.TOGGLE_CAMERA"),
    SHOW_NOTIFICATION("org.jitsi.meet.SHOW_NOTIFICATION"),       // ← upstream
    HIDE_NOTIFICATION("org.jitsi.meet.HIDE_NOTIFICATION"),       // ← upstream
    START_RECORDING("org.jitsi.meet.START_RECORDING"),           // ← upstream
    STOP_RECORDING("org.jitsi.meet.STOP_RECORDING"),             // ← upstream
    OVERWRITE_CONFIG("org.jitsi.meet.OVERWRITE_CONFIG"),         // ← upstream
    SEND_CAMERA_FACING_MODE_MESSAGE("org.jitsi.meet.SEND_CAMERA_FACING_MODE_MESSAGE"); // ← upstream
}
```

##### `BroadcastIntentHelper.java`
Mantener nuestro helper `buildSetAudioDeviceIntent(String device)`.

##### `ExternalAPIModule.java`
Auto-mergeado OK — git preservó nuestra entrada `constants.put("SET_AUDIO_DEVICE", BroadcastAction.Type.SET_AUDIO_DEVICE.getAction());` automáticamente.

##### `ios/sdk/src/ExternalAPI.m`
Fusionar dos bloques (`constantsToExport` y `supportedEvents`): mantener `setAudioDeviceAction` + añadir los nuevos de upstream.

##### `react/features/mobile/external-api/middleware.ts`
Ver sección 4.4.2 (se resolvió como parte del trabajo quirúrgico sobre el fichero).

#### 4.3.2. `android/sdk/src/main/java/org/jitsi/meet/sdk/JitsiMeetView.java`

**Conflicto**: 1 marker. Upstream eliminó el bloque que inicializa `ReactInstanceManagerHolder` desde el constructor de `JitsiMeetView`, porque ahora upstream lo hace en `JitsiInitializer` (nuevo, vía `androidx.startup`, con `<meta-data>` declarado en `AndroidManifest.xml`).

Nuestro bloque:

```java
if (context instanceof Activity) {
    ReactInstanceManagerHolder.initReactInstanceManager(
        (Activity) context, ((Activity) context).getApplication());
} else if (context instanceof Application) {
    ReactInstanceManagerHolder.initReactInstanceManager(
        createDummyFragmentActivity(context), (Application) context);
} else {
    throw new RuntimeException("Context must be of type Activity or Application");
}
```

**Resolución**: **mantener nuestro bloque** con un comentario añadido justificándolo como **fallback defensivo**. El razonamiento:

- `JitsiInitializer` (nuevo) se ejecuta al crear la `Application` vía `androidx.startup`, antes que cualquier Activity.
- Cuando `JitsiMeetView` se construye después, el guard `if (reactInstanceManager != null) return;` dentro de `initReactInstanceManager` convierte estas llamadas en no-ops.
- Sin embargo, si un embedder (p.ej. una integración alternativa imbox-específica futura) desactiva `JitsiInitializer` o construye la view desde un `Application` sin Activity previa, nuestro bloque actúa como fallback.

Comentario añadido al código:

```java
// Defensive fallback: JitsiInitializer normally initializes the ReactInstanceManager at
// application startup via androidx.startup. These calls are no-ops in that case because
// of the null-check guard inside initReactInstanceManager, but we keep them to support
// embedders that haven't wired JitsiInitializer or construct the view from an Application
// context.
```

#### 4.3.3. `android/sdk/src/main/java/org/jitsi/meet/sdk/ReactInstanceManagerHolder.java`

**Conflicto**: upstream cambió la firma de `initReactInstanceManager` de `(Activity, Application)` a solo `(Application)`. Nuestro `JitsiMeetView.java` (sección 4.3.2) depende de la firma antigua.

**Resolución**: **mantener las tres sobrecargas** para compatibilidad:

```java
static void initReactInstanceManager(Activity activity) {
    initReactInstanceManager(activity, activity.getApplication());
}

static void initReactInstanceManager(Application app) {
    initReactInstanceManager(null, app);  // nueva firma upstream, usada por JitsiInitializer
}

static void initReactInstanceManager(Activity activity, Application application) {
    if (reactInstanceManager != null) {
        return;
    }
    // ... resto del cuerpo (el que fusiona .setApplication(application).setCurrentActivity(activity))
}
```

Imports: mantener `Activity` (nuestro, necesario) + añadir `SuppressLint` (nuevo upstream) + eliminar `android.util.Log` (ya no se usa).

#### 4.3.4. `android/sdk/src/main/java/org/jitsi/meet/sdk/AudioModeModule.java`

**Conflicto 1**: campo nuevo vs nuestro singleton.
- Nuestro: `private static AudioModeModule instance;`
- Upstream: `private boolean audioDisabled;`

Resolución: **mantener ambos campos**.

**Conflicto 2**: validación del parámetro `mode` en `setMode`.
- Nuestro: `if (mode != DEFAULT && mode != AUDIO_CALL && mode != VIDEO_CALL && mode != EARPIECE_CALL)`
- Upstream: guard `audioDisabled` early-return + `if (mode < DEFAULT || mode > VIDEO_CALL)`

**Análisis crítico**: constantes definidas:

```java
public static final int DEFAULT    = 0;
public static final int AUDIO_CALL = 1;
public static final int VIDEO_CALL = 2;
public static final int EARPIECE_CALL = 3;   // ← añadido por nosotros
```

El rango `mode < DEFAULT || mode > VIDEO_CALL` de upstream equivale a `mode < 0 || mode > 2`. Nuestro `EARPIECE_CALL=3` **sería rechazado** por esta validación, rompiendo el audio routing a earpiece.

**Resolución**: ampliar el rango a `mode < DEFAULT || mode > EARPIECE_CALL` y combinar con guard upstream + log propio:

```java
public void setMode(final int mode, final Promise promise) {
    if (audioDisabled) {
        promise.resolve(null);
        return;
    }

    JitsiMeetLogger.i(TAG + " Set audio mode: " + mode);
    if (mode < DEFAULT || mode > EARPIECE_CALL) {
        promise.reject("setMode", "Invalid audio mode " + mode);
        return;
    }
    // ... resto upstream
}
```

#### 4.3.5. `react-native-sdk/package.json` + `package-lock.json`

**Conflicto**: 15 markers en `package.json`. Upstream 11.5.1 actualiza masivamente todas las dependencias. Cambios destacables:

| Dependencia | 10.2.1 | 11.5.1 |
|---|---|---|
| `react-native` | `0.73.8` | `~0.77.0` |
| `react-native-webrtc` | `124.0.4` | `124.0.4` (sin cambio) |
| `react-native-device-info` | `10.9.0` | `12.1.0` |
| `react-native-gesture-handler` | `2.18.1` | `2.24.0` |
| `react-native-screens` | `3.32.0` | `4.11.1` |
| `react-native-svg` | `13.13.0` | `15.11.2` |
| `react-native-video` | `6.0.0-alpha.11` | `6.13.0` |
| `react-native-webview` | `13.8.7` | `13.13.5` |
| `react-native-safe-area-context` | `4.10.8` | `5.5.2` |
| `react-native-performance` | `5.0.0` | `5.1.2` |

Reemplazos completos:
- `@amplitude/react-native` → `@amplitude/analytics-react-native`
- `react-native-keep-awake` → `@sayem314/react-native-keep-awake`
- `react-native-splash-screen` → `react-native-splash-view`

Nuevas:
- `react-native-worklets-core` (https://github.com/jitsi/react-native-worklets-core.git — el cambio clave del 16 KB)

Eliminadas:
- `@jitsi/rtcstats`, `moment`, `moment-duration-format`, `promise.allsettled`, `abab` (dup)
- Bloque `overrides: @xmldom/xmldom`

Muchas deps se reemplazan por forks de Jitsi (`react-native-background-timer`, `react-native-calendar-events`, `react-native-default-preference`, `react-native-immersive-mode`, `react-native-orientation-locker`, `react-native-sound` — todas con URL a `github.com/jitsi/...`).

**Resolución**: aceptar upstream al 100% con `git checkout --theirs`. No teníamos customizaciones propias en deps.

⚠️ **Pendiente manual**: ejecutar `cd react-native-sdk && npm install` para regenerar `package-lock.json` consistente con el nuevo `package.json`. El lockfile actual del merge es el de upstream pero puede necesitar reconciliación con el resto del fork.

### 4.4. Categoría D — Muy difíciles (2 ficheros)

#### 4.4.1. `react/features/toolbox/components/native/Toolbox.tsx`

**Contexto del refactor upstream**: Jitsi 11.5.1 reescribió el sistema de botones del toolbar a una arquitectura de **registro dinámico**:

- Hook `useNativeToolboxButtons(customToolbarButtons)` construye la lista.
- Función `getVisibleNativeButtons()` filtra según `clientWidth`, `iAmVisitor`, `mainToolbarButtonsThresholds`, etc.
- Renderizado genérico: `mainMenuButtons?.map(({ Content, key, ... }) => <Content ... />)`.
- **Se eliminaron** las props `_endConferenceEnabled`, `_endConferenceSupported`, `_shouldDisplayReactionsButtons`.
- **Se eliminó** el hardcoding de `AudioMuteButton`, `VideoMuteButton`, `ChatButton`, `ScreenSharingButton`, `ReactionsMenuButton`, `RaiseHandButton`, `TileViewButton`, `OverflowMenuButton`, `HangupMenuButton`, `HangupButton`.

**Customización propia perdida en el refactor**: en nuestro fork teníamos el feature flag `END_CONFERENCE_ENABLED` que gateaba `HangupMenuButton` (menú "End for all" / "Leave") vs `HangupButton` (solo "Leave"). Permitía a imbox desactivar la opción "End Conference for everyone" en ciertos deployments.

**Análisis del nuevo punto de decisión**: en 11.5.1, la decisión Hangup Menu vs Hangup simple se movió a `react/features/toolbox/components/native/HangupContainerButtons.tsx`:

```tsx
const HangupContainerButtons = (props: AbstractButtonProps) => {
    const { conference } = useSelector(...)['features/base/conference'];
    const endConferenceSupported = conference?.isEndConferenceSupported();
    return endConferenceSupported
        ? <HangupMenuButton {...props} />
        : <HangupButton {...props} />;
};
```

Y este componente se registra en `react/features/toolbox/hooks.native.ts` como `Content: HangupContainerButtons` dentro del botón `hangup`.

**Resolución — portar la lógica al nuevo sitio**:

1. **Aceptar** upstream completo para `Toolbox.tsx` (nueva arquitectura de registro).
2. **Editar `HangupContainerButtons.tsx`** para integrar nuestro feature flag:

```tsx
import { END_CONFERENCE_ENABLED } from '../../../base/flags/constants';
import { getFeatureFlag } from '../../../base/flags/functions';

const HangupContainerButtons = (props: AbstractButtonProps) => {
    const { conference } = useSelector((state: IReduxState) => state['features/base/conference']);
    const endConferenceSupported = conference?.isEndConferenceSupported();
    const endConferenceEnabled = useSelector((state: IReduxState) =>
        getFeatureFlag(state, END_CONFERENCE_ENABLED, true));

    return endConferenceSupported && endConferenceEnabled
        ? <HangupMenuButton {...props} />
        : <HangupButton {...props} />;
};
```

Así nuestra intención (feature flag para desactivar end-for-all) se preserva correctamente integrada en la nueva arquitectura upstream.

#### 4.4.2. `react/features/mobile/external-api/middleware.ts`

**Apariencia inicial**: 589 líneas de churn, parecía el fichero más complicado. Pero tras análisis:

**Realidad**: **la mayoría del churn es reindentación**. Upstream outdentó el switch gigante un nivel (estilo `case` alineado con `switch`). Nuestro fork tenía 4 espacios extra en todo el switch. Por eso el diff parece enorme (líneas marcadas ± aunque el contenido es idéntico modulo whitespace).

**Customizaciones substantivas** en nuestro fork (solo 3 items, el resto era ruido):

1. `const { AudioMode } = NativeModules;` al top del módulo (para llamar `AudioMode.setAudioDevice`).
2. Listener `SET_AUDIO_DEVICE` en `_registerForNativeEvents`:
   ```ts
   eventEmitter.addListener(ExternalAPI.SET_AUDIO_DEVICE, ({ device }: any) => {
       logger.log('SET_AUDIO_DEVICE ' + device);
       AudioMode.setAudioDevice(device);
   });
   ```
3. Cleanup en `_unregisterForNativeEvents`:
   ```ts
   eventEmitter.removeAllListeners(ExternalAPI.SET_AUDIO_DEVICE);
   ```

**Resolución — estrategia quirúrgica**:

1. `git checkout --theirs react/features/mobile/external-api/middleware.ts` — aceptar upstream al completo.
2. Re-introducir los 3 items substantivos con edits precisos:
   - `const { ExternalAPI } = NativeModules;` → `const { AudioMode, ExternalAPI } = NativeModules;`
   - Insertar el listener `SET_AUDIO_DEVICE` justo antes del listener `TOGGLE_CAMERA` existente.
   - Insertar el `removeAllListeners(ExternalAPI.SET_AUDIO_DEVICE)` junto al `removeAllListeners(ExternalAPI.TOGGLE_CAMERA)`.

Esto evita tener que navegar/resolver cientos de hunks de whitespace, preservando la integridad del refactor upstream (que trae muchos eventos nuevos: `RECORDING_SESSION_UPDATED`, `SET_ROOM`, `READY_TO_CLOSE`, etc.) y solo añade exactamente lo que es nuestro.

---

## 4.5. Fixes post-merge (bugs encontrados en upstream + ajustes en AndroidClient)

Tras completar el merge y probar en runtime, aparecieron varios errores. Se documentan aquí porque forman parte del trabajo necesario para que el upgrade sea usable.

### 4.5.1. Bug upstream: `Conference.tsx` lee el reducer con clave errónea (🚨 crítico)

**Síntoma**: al entrar a una sala Jitsi, pantalla completamente negra. El JS de Jitsi crashea con:

```
TypeError: Cannot read property 'appState' of undefined
    at useMemo (index.android.bundle)
    at Connect(Component)
```

**Causa**: `react/features/conference/components/native/Conference.tsx:576` hace destructuring de un reducer que no existe:

```ts
const { appState } = state['features/background'];  // ← typo, no existe
```

El reducer real está registrado como `features/mobile/background` (ver `react/features/mobile/background/reducer.ts:20`). Otros ficheros del propio Jitsi lo leen correctamente (`features/mobile/full-screen/middleware.ts:63`, `features/base/lastn/middleware.ts:36`). El typo deja `state['features/background']` como `undefined`, el destructuring lanza `TypeError`, y React renderiza el fallback (pantalla negra).

**Verificación**:
- `grep -rn "'features/background'" react/` → única ocurrencia es la línea 576 de `Conference.tsx`.
- `grep -rn "ReducerRegistry.register.*background" react/` → sólo `features/mobile/background`.
- Bug presente también en `mobile-sdk-12.0.0`.
- Historia en `git log` muestra que upstream ha ido y venido varias veces con esta línea (`features/background` ↔ `features/mobile/background`), el último commit la rompió.

**Fix aplicado en el fork**:

```ts
// Antes (upstream buggy):
const { appState } = state['features/background'];
// Después:
const { appState } = state['features/mobile/background'];
```

**Impacto en futuros merges**: el fix debe preservarse en el paso 2 (merge a `mobile-sdk-12.0.0`) porque 12.0.0 tiene el mismo bug. Añadir a la lista de customizaciones a auditar.

**Acción upstream**: reportar el issue a `jitsi/jitsi-meet` con un PR de una sola línea. Esto afecta a toda la comunidad Jitsi Meet SDK ≥ 11.5.1.

### 4.5.2. AndroidClient: `MainActivityV2.kt` firma de `requestPermissions`

Tras el bump a RN 0.77.2, `com.facebook.react.modules.core.PermissionAwareActivity` pasó de ser interfaz Java a Kotlin, con firma:

```kotlin
public fun requestPermissions(
    permissions: Array<String>,
    requestCode: Int,
    listener: PermissionListener?
)
```

La override anterior de `MainActivityV2.kt:1732` usaba tipos nullables en `permissions` y no nullable en `listener` (exactamente al revés de lo que pide ahora). Kotlin rechazaba el override → `Class 'MainActivityV2' is not abstract and does not implement abstract member 'requestPermissions'`.

**Fix aplicado**:

```kotlin
override fun requestPermissions(p0: Array<String>, p1: Int, p2: PermissionListener?) {}
```

### 4.5.3. AndroidClient: `SpotbrosApplication.java` — `ReactFeatureFlags.enableEagerRootViewAttachment`

En RN 0.77.2 `com.facebook.react.config.ReactFeatureFlags` quedó deprecated y vaciado (solo conserva `dispatchPointerEvents`). El flag `enableEagerRootViewAttachment` se movió a `com.facebook.react.internal.featureflags.ReactNativeFeatureFlags` como getter backed by Cxx (solo lectura desde Java/Kotlin — no se puede asignar directamente).

En bridgeless/Fabric (activados por defecto en RN 0.77.2 con Hermes) el comportamiento eager root view attachment es el default, así que la asignación manual es innecesaria.

**Fix aplicado**: eliminada la línea y su import en `SpotbrosApplication.java`.

### 4.5.4. AndroidClient: `minSdkVersion 25 → 26` en los 6 build.gradle

Transitive dep `com.facebook.react:react-native-community_clipboard:1.14.3` (traída por Jitsi 11.5.1) requiere `minSdk 26`. Manifest merger fallaba. Bumpeados todos los flavors (`imbox`, `imboxdefense`, `mzguild`, `spotbros`, `spotbrosClient`, `waveformSeekBarLib`) a API 26 (Android 8 Oreo, ago-2017). Sin impacto práctico — Oreo+ cubre >99% del parque actual.

### 4.5.5. AndroidClient: migración ExoPlayer v2 → Media3 (colisión con `react-native-video` 6.13.0)

**Síntoma**: al entrar en `ChatActivityV2`, crash en `onCreate`:

```
java.lang.ClassCastException: androidx.media3.ui.AspectRatioFrameLayout cannot be cast to com.google.android.exoplayer2.ui.AspectRatioFrameLayout
    at com.google.android.exoplayer2.ui.PlayerView.<init>(PlayerView.java:403)
```

**Causa**: el chat de AndroidClient usaba `com.google.android.exoplayer:exoplayer:2.19.1`. Jitsi 11.5.1 actualiza `react-native-video` `6.0.0-alpha.11 → 6.13.0-jitsi`, y esa versión de RN Video ya no depende de ExoPlayer v2 sino de `androidx.media3`. Con ambas libs en el classpath, `media3-ui:1.9.0` incluye un layout `exo_player_view.xml` con id `exo_content_frame` que **pisa** al layout homónimo de ExoPlayer v2. Cuando ExoPlayer v2's `PlayerView.<init>` hace `findViewById(R.id.exo_content_frame)` encuentra un `androidx.media3.ui.AspectRatioFrameLayout` y el cast a `com.google.android.exoplayer2.ui.AspectRatioFrameLayout` falla.

**Decisión estratégica**: migrar completamente a Media3 en vez de intentar excluir `media3-ui` de las transitives. Razones:
1. Google archivó ExoPlayer v2 en 2023 — no habrá más fixes, performance, ni 16 KB alignment updates.
2. Media3 es el sucesor directo con API casi idéntica (Google publicó un [mapping table](https://developer.android.com/media/media3/exoplayer/mappings) 1:1).
3. La migración es principalmente renames de paquete.

**Cambios en AndroidClient**:

`spotbrosClient/build.gradle`:
- Removed: `com.google.android.exoplayer:exoplayer:2.19.1`
- Added: `androidx.media3:media3-ui:1.9.0`, `androidx.media3:media3-common:1.9.0`.

**6 ficheros Kotlin** (imports):

| Antes | Después |
|---|---|
| `com.google.android.exoplayer2.ExoPlayer` | `androidx.media3.exoplayer.ExoPlayer` |
| `com.google.android.exoplayer2.MediaItem` | `androidx.media3.common.MediaItem` |
| `com.google.android.exoplayer2.{PlaybackException,Player}` | `androidx.media3.common.*` |
| `com.google.android.exoplayer2.{DefaultLoadControl,LoadControl}` | `androidx.media3.exoplayer.*` |
| `com.google.android.exoplayer2.source.ProgressiveMediaSource` | `androidx.media3.exoplayer.source.ProgressiveMediaSource` |
| `com.google.android.exoplayer2.upstream.{DataSource,DefaultHttpDataSource}` | `androidx.media3.datasource.*` |
| `com.google.android.exoplayer2.upstream.DefaultBandwidthMeter` | `androidx.media3.exoplayer.upstream.DefaultBandwidthMeter` |
| `com.google.android.exoplayer2.ui.PlayerView` | `androidx.media3.ui.PlayerView` |

Ficheros afectados: `ExoPlayerUtil.kt`, `MediaPagerActivity.kt`, `ShowImageOrVideoActivity.kt`, `CollectionDriveActivity.kt`, `SearchAnyThingActivity.kt`, `MediaPagerAdapter.kt`.

`ExoPlayerUtil.kt` además usa `DefaultLoadControl`, `DefaultBandwidthMeter`, `setMediaSourceFactory`, `setBandwidthMeter`, `setLoadControl`, `ProgressiveMediaSource.Factory` y `setCustomCacheKey`, todas marcadas `@UnstableApi` en Media3. Añadido `@file:OptIn(UnstableApi::class)` al principio del fichero en vez de anotar cada método.

**7 layouts XML** — renames FQCN:
- `com.google.android.exoplayer2.ui.PlayerView` → `androidx.media3.ui.PlayerView`
- `com.google.android.exoplayer2.ui.DefaultTimeBar` → `androidx.media3.ui.DefaultTimeBar`

Ficheros: `activity_chat_v2.xml`, `exo_playback_control_view_2.xml`, `item_media_pager_video.xml`, `activity_collection_drive.xml`, `activity_camera.xml`, `activity_show_image_or_video.xml`, `activity_search_anything.xml`.

Post-migración: `grep -rn "com.google.android.exoplayer2" spotbrosClient/src/` devuelve 0 resultados — no quedan referencias al paquete deprecated.

### 4.5.6. Nota: `amplituda 2.2.2` sigue sin soporte 16 KB

Durante el build apareció el aviso:
```
APK imboxdefense-debug.apk is not compatible with 16 KB devices. Some libraries have LOAD segments not aligned at 16 KB boundaries:
lib/arm64-v8a/libamplituda-native-lib.so
lib/arm64-v8a/libavcodec-amplituda.so
lib/arm64-v8a/libavformat-amplituda.so
lib/arm64-v8a/libavutil-amplituda.so
lib/arm64-v8a/libswresample-amplituda.so
```

`com.github.lincollincol:amplituda:2.2.2` es un fork custom del proyecto upstream [lincollincol/Amplituda](https://github.com/lincollincol/Amplituda), que AndroidClient usa para generar waveforms de audio. El upstream añadió soporte 16 KB en `2.2.3` (ene 2025) y pulió con `2.3.1` (sep 2025, también incluye upgrade a FFmpeg 7.1).

Hacer el straight bump a `2.3.1` no compila — el fork interno divergió del upstream público.

**Pendiente como trabajo independiente**: mergear los cambios de `Amplituda 2.2.3+` en el fork interno, con misma estrategia conservadora (preservar customizaciones). No bloquea este merge de Jitsi — el aviso de 16 KB para amplituda es una compliance separada que toca cerrar antes del 31-may-2026.

---

## 5. Auditoría final de preservación

Todas las customizaciones identificadas del fork fueron verificadas post-merge:

| Customización | Ubicación | Status |
|---|---|---|
| `SET_AUDIO_DEVICE` broadcast/listener | `BroadcastAction.java`, `BroadcastIntentHelper.java`, `ExternalAPIModule.java`, `ExternalAPI.m`, `external-api/middleware.ts` | ✅ |
| `createJitsiView()` + `getRootView()` hook (subclasseable) | `JitsiMeetActivity.java` | ✅ |
| Layout XML programmatic (empty `<FrameLayout>`) | `android/sdk/src/main/res/layout/activity_jitsi_meet.xml` | ✅ (auto-mergeado) |
| `TelecomAudioRouteHandler.java` (nuevo fichero nuestro) | preservado, referenciado desde `AudioModeModule` + `AudioDeviceHandlerGeneric` | ✅ |
| `EARPIECE_CALL=3` + soporte en `setMode` | `AudioModeModule.java` | ✅ |
| `END_CONFERENCE_ENABLED` feature flag | `flags/constants.ts` + **nuevo sitio** `HangupContainerButtons.tsx` | ✅ (ported) |
| `AUDIO_DEFAULT_TO_SPEAKER` feature flag | `flags/constants.ts` + `audio-mode/middleware.ts` | ✅ |
| `IconPip → collapsed.svg` alias | `constants.ts`, `index.ts`, `PictureInPictureButton.ts` | ✅ |
| `middleware.any.ts` bloque custom (+223 líneas) | `react/features/base/conference/middleware.any.ts` (fichero ahora 1018 líneas) | ✅ |
| `libreBuild="true"` default | `android/build.gradle` | ✅ |
| `-Xmx4096m` gradle JVM | `android/gradle.properties` | ✅ |
| Audio recovery WiFi↔celular (commit `faa9a45e3`) | `AudioDeviceHandlerGeneric.java` | ✅ |
| `join()` null-check de options | `JitsiMeetActivity.java` | ✅ |
| Activity-based RIManager init overloads | `ReactInstanceManagerHolder.java` | ✅ |
| Proximity functions (commit `0d828721d` "Other routes") | `react/features/mobile/proximity/functions.js` + `middleware.ts` | ✅ (auto-mergeado) |
| RN 0.73.8 patch eliminado (dead para 0.77.2) | `patches/react-native+0.73.8.patch` | ✅ (eliminado correctamente) |
| `react-native-webrtc+124.0.4.patch` | `patches/` | ✅ (misma versión webrtc, patch válido) |
| `@giphy+js-brand+2.2.2.patch` (upstream) | `patches/` (mismo blob que 10.2.1) | ✅ |
| `@giphy+js-analytics+4.2.0.patch` (upstream) | eliminado en 11.5.1 | ✅ (upstream lo retiró, correcto) |
| **Fix upstream bug** `Conference.tsx:576` (post-merge) | `features/background` → `features/mobile/background` | ✅ (nuevo fix del fork) |

---

## 6. Próximos pasos y tareas pendientes

### 6.1. Antes de commitear el merge

Revisión manual por parte del autor del fork del diff completo contra `imbox-mobile-24.5` (base previa) y contra `mobile-sdk-11.5.1` (upstream target). Comandos útiles:

```bash
# Cambios nuestros vs upstream 11.5.1 (lo que diverge ahora)
git diff mobile-sdk-11.5.1..HEAD

# Lo que aporta este merge respecto a la rama previa
git diff imbox-mobile-24.5..HEAD
```

### 6.2. Commit del merge

Una vez validada la resolución:

```bash
git commit
```

Usar el mensaje autogenerado por git (lista de conflictos) editado con contexto:
- Referencia al issue `imbox-technologies/AndroidClient#3902`.
- Resumen corto de por qué.
- Lista de customizaciones preservadas.

### 6.3. Regenerar lockfile

```bash
cd react-native-sdk
npm install
```

Verificar que el `package-lock.json` resultante es coherente y stagear.

### 6.4. Ajustes downstream en AndroidClient

#### 6.4.1. `spotbrosClient/build.gradle`

Bump mandatorio por el upgrade de Jitsi:

```diff
-        minSdkVersion 25
+        minSdkVersion 26
```

Sin este cambio, la resolución de dependencias de `jitsi-meet-sdk:11.5.1` fallará.

#### 6.4.2. Bump version del SDK

```diff
-    implementation ('org.jitsi.react:jitsi-meet-sdk:10.2.1') { transitive = true }
+    implementation ('org.jitsi.react:jitsi-meet-sdk:11.5.1') { transitive = true }
```

#### 6.4.3. Verificar compatibilidad del override `NewCallActivity.createJitsiView()`

Confirmar que la firma del método upstream no ha cambiado. Nuestra versión devuelve `JitsiMeetView` — mantener.

### 6.5. Build y test

#### 6.5.1. iOS

- `cd ios && pod install` para regenerar Pods con la nueva arquitectura (Hermes, Swift AppDelegate).
- Build en Xcode y verificar que compila sin errores.

#### 6.5.2. Android

- `./gradlew clean`
- Desde AndroidClient: build del flavor `spotbrosClient`.
- Verificar que el APK resultante cumple 16 KB alignment (check en Play Console al subir, o herramienta `alignment-checker`).

#### 6.5.3. Testing funcional exhaustivo

- [ ] Audio: mute/unmute local y remoto.
- [ ] Audio routing: speaker ↔ earpiece ↔ bluetooth ↔ wired.
- [ ] Audio recovery en cambio de red: WiFi → cellular, cellular → WiFi (commit `faa9a45e3`).
- [ ] Video: mute/unmute, facing mode toggle.
- [ ] Picture-in-Picture: entrar/salir, botón colapsar (UI con `IconPip → collapsed.svg`).
- [ ] Telecom integration (nuestro `TelecomAudioRouteHandler`).
- [ ] End Conference: con `END_CONFERENCE_ENABLED=true` (default) debe mostrar menú; con `false` debe mostrar botón simple.
- [ ] Proximity sensor (pantalla off al acercar al oído).
- [ ] Chat: apertura/cierre, envío de mensajes, recepción.
- [ ] Screen sharing.
- [ ] Conference flow completo: join → mute/unmute → chat → leave.
- [ ] Recovery de CONFERENCE_FAILED (password, reconexión).

### 6.6. Paso 2 — merge a `mobile-sdk-12.0.0`

Tras validar el paso 1 completo, crear rama `imbox-android-mobile-sdk-12.0.0` desde `imbox-android-mobile-sdk-11.5.1` y mergear `mobile-sdk-12.0.0`.

Expectativas:
- Merge ligero (mismo RN 0.77.2, solo bump webrtc `124.0.4 → 124.0.7`).
- Regenerar `patches/react-native-webrtc+124.0.4.patch` → `patches/react-native-webrtc+124.0.7.patch` (probablemente el contenido del patch sigue aplicando textualmente; bastará el rename).
- Fallback: `mobile-sdk-11.6.3` si 12.0.0 introduce regresiones (evitar `11.6.0` que tiene crash conocido [jitsi/jitsi-meet#16527](https://github.com/jitsi/jitsi-meet/issues/16527)).

### 6.7. Release

- Tag SDK release: `imbox-mobile-sdk-11.5.1-1` (o la convención interna que se use).
- Publicar al repo Maven privado.
- Bump en AndroidClient (`spotbrosClient/build.gradle`).
- Subir a Play Console antes del **2026-05-31** (deadline Google).

---

## 7. Apéndices

### 7.1. Comandos de preparación del merge (ejecutados)

```bash
cd /Users/alvaromarcos/repositories/jitsi/imbox/jitsi-meet

# Añadir remote upstream
git remote add upstream https://github.com/jitsi/jitsi-meet.git
git fetch upstream --tags

# Crear rama de trabajo
git checkout -b imbox-android-mobile-sdk-11.5.1 imbox-mobile-24.5

# Merge
git merge mobile-sdk-11.5.1
# → 25 conflicts
```

### 7.2. Ficheros en conflicto (listado completo)

```
.gitignore
android/build.gradle
android/gradle.properties
android/sdk/src/main/java/org/jitsi/meet/sdk/AudioModeModule.java
android/sdk/src/main/java/org/jitsi/meet/sdk/BroadcastAction.java
android/sdk/src/main/java/org/jitsi/meet/sdk/BroadcastIntentHelper.java
android/sdk/src/main/java/org/jitsi/meet/sdk/JitsiMeetActivity.java
android/sdk/src/main/java/org/jitsi/meet/sdk/JitsiMeetView.java
android/sdk/src/main/java/org/jitsi/meet/sdk/ReactInstanceManagerHolder.java
ios/app/app.xcodeproj/project.pbxproj
ios/app/broadcast-extension/Info.plist
ios/app/src/Info.plist
ios/app/watchos/app/Info.plist
ios/app/watchos/extension/Info.plist
ios/sdk/sdk.xcodeproj/project.pbxproj
ios/sdk/src/AudioMode.m
ios/sdk/src/ExternalAPI.m
ios/sdk/src/Info.plist
ios/sdk/src/Lite-Info.plist
react-native-sdk/package-lock.json
react-native-sdk/package.json
react/features/mobile/audio-mode/middleware.ts
react/features/mobile/external-api/middleware.ts
react/features/mobile/picture-in-picture/components/PictureInPictureButton.ts
react/features/toolbox/components/native/Toolbox.tsx
```

### 7.3. Comandos útiles para auditoría

```bash
# Verificar que todas las customizaciones sobreviven
git grep -l "SET_AUDIO_DEVICE"
git grep -l "createJitsiView\|getRootView" -- android
git grep -l "TelecomAudioRouteHandler" -- android
git grep -l "EARPIECE_CALL" -- android
git grep -l "END_CONFERENCE_ENABLED" -- react
git grep -l "IconPip\|collapsed.svg" -- react
grep -c "^" react/features/base/conference/middleware.any.ts  # debe ser >= 1018

# Ver el diff final del merge
git log -p --merges -n 1  # tras commit
git diff HEAD~1..HEAD     # tras commit

# Comparar divergencia actual vs upstream
git diff mobile-sdk-11.5.1..HEAD --stat
```

### 7.4. Referencias

- Issue interno: [imbox-technologies/AndroidClient#3902](https://github.com/imbox-technologies/AndroidClient/issues/3902)
- Jitsi tracking del 16 KB support: [jitsi/jitsi-meet#16190](https://github.com/jitsi/jitsi-meet/issues/16190)
- Crash en 11.6.0 (evitar): [jitsi/jitsi-meet#16527](https://github.com/jitsi/jitsi-meet/issues/16527)
- Changelog mobile SDK: [CHANGELOG-MOBILE-SDKS.md](https://github.com/jitsi/jitsi-meet-release-notes/blob/master/CHANGELOG-MOBILE-SDKS.md)
- Google Play 16 KB docs: [developer.android.com/guide/practices/page-sizes](https://developer.android.com/guide/practices/page-sizes)
