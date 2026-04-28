# Upgrade upstream iOS: `imbox-mobile-23.5` → `mobile-sdk-11.5.1`

**Estado**: completado y mergeado a `develop` en iOSClient (2026-04-21)
**Fecha de creación**: 2026-04-16
**Rama destino propuesta**: `imbox-ios-mobile-sdk-11.5.1` (desde `imbox-mobile-23.5`)
**Tag upstream a mergear**: `mobile-sdk-11.5.1` (2025-09-16)
**Issue relacionado**: `imbox-technologies/iOSClient#2800` (intento previo fallido, dic-2024)

---

## 1. Contexto y motivación

### 1.1. Por qué ahora

Completado el equivalente Android (`imbox-android-mobile-sdk-11.5.1`, mergeado el 2026-04-15, ver
`doc/imbox/2026-04-15-merge-mobile-sdk-11.5.1.md`), toca alinear la contraparte iOS.

Motivos:

- **Consistencia**: ambas plataformas deben consumir el mismo SDK de Jitsi para evitar
  divergencias de comportamiento.
- **Cadencia de seguridad**: el SDK iOS 8.5.0 (dic-2024) lleva ~16 meses sin parches — se
  acumulan fixes, CVEs potenciales, y parches de compat con iOS nuevos.
- **Deuda técnica**: el fork iOS ha quedado muy atrás; cuanto más esperemos, más doloroso.
- **Unificación de tags upstream**: Jitsi ya publica `mobile-sdk-*` unificado (iOS + Android
  + código RN común en el mismo tag) desde ~11.x. Los tags separados `ios-sdk-*` y
  `android-sdk-*` se abandonaron.

### 1.2. Intento previo (#2800, dic-2024)

En dic-2024 se intentó actualizar Jitsi iOS desde 8.5.0 hacia 24.5/24.6/24.7/25.0.
Bloqueado por:

- **Pantalla negra al aceptar llamada entrante** en 24.5, 24.6 y 25.0. Síntoma coincide
  con el bug identificado en Android: `Conference.tsx` leía `state['features/background']`
  (reducer inexistente). Upstream lo eliminó en **nov-2024** (commit `d45c10805`, PR #15308).
  Si mergeamos ahora `mobile-sdk-11.5.1` (sep-2025) **ese bug ya no está presente en
  upstream** — problema resuelto "gratis".
- **Hermes en el Podfile** a partir de 24.7: upstream empezó a habilitar Hermes en RN
  0.73+. El build script del fork no copiaba `hermes.xcframework` a la salida, y la
  iOSClient linkeaba sin Hermes → fallos. Resolución conocida ahora: añadir el copy de
  `hermes.xcframework` al build script.
- **Algunos warnings de dependencias** (Giphy iOS SDK, otros). A evaluar caso a caso tras
  el merge.

### 1.3. Convención de nombres de rama

Se adopta la convención ya usada para Android:

| Antes | Ahora |
|---|---|
| `imbox-mobile-23.5` (basada en versión app móvil Jitsi antigua) | `imbox-ios-mobile-sdk-11.5.1` (plataforma + SDK) |

Misma razón que en Android: upstream ya distingue tags por plataforma solo históricamente
(iOS SDK y Android SDK ahora comparten versionado `mobile-sdk-*`). Añadir `ios-` al nombre
de rama refleja que la rama **la consume específicamente la app iOS imbox** (`iOSClient`),
aunque el código toque código cross-platform.

---

## 2. Estado actual del fork iOS

### 2.1. Rama `imbox-mobile-23.5`

| Dato | Valor |
|---|---|
| Tip | `3680765c8` ("silent-reload-on-error.enabled flag", 2026-03-09) |
| Último merge upstream | `8435827e1` (2024-12-27), trajo `mobile-23.5` ≡ iOS SDK 8.5.0 |
| Commits propios post-merge | 5 |
| Ficheros divergentes | 11 (~134 líneas añadidas) |

### 2.2. Commits propios (post-merge upstream)

```
3680765c8 silent-reload-on-error.enabled flag
89838f090 Fix audio recovery on WiFi→cellular network change, #2832
c2abd8d79 Ajuste de tamaño del botón para colapsar el picture in picture
4fffaab41 botón para colapsar el picture in picture
1c41af921 pod
```

### 2.3. Ficheros modificados vs upstream 8.5.0

```
ios/Podfile.lock                                                      (iOS-específico)
patches/react-native-webrtc+111.0.3.patch                             (iOS-específico por la versión webrtc)
react/features/base/conference/middleware.any.ts                      (compartido c/ Android)
react/features/base/flags/constants.ts                                (compartido)
react/features/base/icons/svg/collapsed.svg                           (compartido)
react/features/base/icons/svg/constants.ts                            (compartido, IconPip alias)
react/features/base/icons/svg/index.ts                                (compartido)
react/features/conference/components/native/styles.ts                 (compartido)
react/features/mobile/picture-in-picture/components/PictureInPictureButton.ts  (compartido)
react/features/mobile/polyfills/browser.js                            (compartido)
react/features/overlay/middleware.ts                                  (compartido)
```

**Observación clave**: 9 de los 11 ficheros son **código JS/TS compartido con la rama
Android**. La mayoría de las decisiones de resolución de conflictos ya las tomamos para
Android (PiP collapse, `IconPip → collapsed.svg` alias, `middleware.any.ts` de conference,
flags custom imbox) y podemos aplicar las mismas en el merge iOS.

**No hay modificaciones propias en ObjC/Swift nativo**. Coherente con la arquitectura imbox
iOS: la integración CallKit se hace desde la app host (`iOSClient`), no desde el SDK.

---

## 3. Estado del consumidor (`iOSClient`)

### 3.1. Cómo se consume el SDK

- **Drop-in manual**: `SpotBros/Vendor/Jitsi/JitsiMeetSDK.xcframework` — resultado de buildear
  el fork con el script actual (ver §7).
- **CocoaPods**: pod `JitsiWebRTC` declarado en `Podfile` para los targets `IMBox`,
  `IMBoxDefense`, y uno más. Versión actual en lock: **`JitsiWebRTC 124.0.1`**.

### 3.2. Usos directos del SDK en código de la app

Solo **2 ficheros** importan `JitsiMeetSDK` directamente:

- `SpotBros/Views/Conference/ConferenceViewController.h` — declara `@import JitsiMeetSDK;`
- `SpotBros/Views/Calls/CallViewController.m` — consumidor principal

Adicionalmente, la **integración CallKit** usa el proxy `JMCallKitProxy` desde:

- `SpotBros/AppDelegate.m`
- `SpotBros/Backend/Comms/NotificationManager.m`

### 3.3. Hallazgo crítico — API `JMCallKitProxy` idéntica entre 8.5.0 y 11.5.1

Comparación byte-a-byte de los ficheros `ios/sdk/src/callkit/*` entre los tags
`mobile-23.5` (8.5.0) y `mobile-sdk-11.5.1`:

```
JMCallKitProxy.h   : blob 82cd72c1a…  IDÉNTICO en ambas versiones
JMCallKitProxy.m   : blob c18f9c8b1…  IDÉNTICO en ambas versiones
JMCallKitListener.h: blob fcc59163e…  IDÉNTICO
JMCallKitEmitter.h : blob fdd908ed2…  IDÉNTICO
JMCallKitEmitter.m : blob 12a4b227b…  IDÉNTICO
CallKit.m          : blob 9fa88f00b…  IDÉNTICO
```

Esto significa que **la integración CallKit de `iOSClient` seguirá funcionando sin tocarla
una sola línea**. Es un alivio gigantesco: en móvil iOS el acoplamiento CallKit-app suele ser
la zona de mayor fricción en upgrades de SDK, y aquí está completamente aislado.

### 3.4. iOS deployment target actual

- `Podfile`: `platform :ios, '12.0'`
- `SpotBros.xcodeproj/project.pbxproj`: mezcla de `IPHONEOS_DEPLOYMENT_TARGET = 10.0 / 13.0`
  en distintas configuraciones. Config antigua e inconsistente.

**Jitsi `mobile-sdk-11.5.1` requiere iOS 15.1+** (upstream subió el mínimo a 15.1 en
`mobile-24.5`, ver `feat(ios) bump minimum required iOS version to 15.1` en el log).

Habrá que subir deployment target a **iOS 15.1** como mínimo. Impacto: deja fuera iPhone 6
y 6 Plus (2014) y anteriores. Dispositivos residuales en la base de usuarios actual.

---

## 4. Matriz de versiones

|  | `react-native` | `react-native-webrtc` (JS) | JitsiWebRTC pod (iOS) | JS engine | iOS min |
|---|---|---|---|---|---|
| 8.5.0 (fork actual) | ~0.72.x (`"*"`) | `111.0.3` | `124.0.1` (ya lo tienes en iOSClient) | JSC | 12.0 (iOSClient) |
| 11.5.1 (target) | `0.77.2` | `124.0.4` | `124.0.4` esperado | Hermes | **15.1** |

**Salto muy grande en RN** (0.72.x → 0.77.2, 5 versiones mayores, arquitectura bridgeless +
Hermes). Mismo salto conceptual que hicimos en Android.

**`react-native-webrtc` subirá JS de 111 → 124**. En el lado pod (`JitsiWebRTC 124.0.1`)
ya estás a 124 — suerte. Actualizar el pod a la versión que publiquen para 11.5.1 (muy
probablemente `124.0.4` cuando salga).

---

## 5. Cambios anticipados del merge upstream (8.5.0 → 11.5.1)

Basado en el merge Android (mismos cambios upstream, solo difiere lo iOS-específico):

### 5.1. JS/TS compartido con Android

Las mismas cosas que ya resolvimos en la rama Android. Se pueden replicar las decisiones:

- **`Conference.tsx`**: upstream eliminó la lectura de `appState`. Nosotros queremos
  preservar el comportamiento imbox (reducedUI en background). Aplicar el mismo fix que
  en Android — leer desde `features/mobile/background`.
- **`Toolbox.tsx`**: refactor completo upstream a registro de botones dinámico. No
  afecta nuestro fork iOS porque no lo modificamos (nos limitamos a aceptar upstream).
- **`external-api/middleware.ts`**: indentación reorganizada upstream; ver qué
  modificaciones iOS aporta. Previsión: solo polyfills y overlay, sin cambios sobre
  este fichero.
- **`middleware.any.ts` conference**: nuestras +81 líneas de lógica propia imbox deben
  preservarse (vs +223 líneas en Android — menos lógica extra en iOS).

### 5.2. iOS nativo — los grandes

- **Swift `AppDelegate`**: upstream migró `AppDelegate.m` → `AppDelegate.swift` al
  alinear con RN 0.77.2. `ios/app/app.xcodeproj/project.pbxproj` sufrirá cambios
  considerables.
- **`hermes.xcframework`**: nuevo framework embebido, añadido a Frameworks + Embed
  Frameworks en el pbxproj.
- **`PrivacyInfo.xcprivacy`**: añadido por upstream (requisito de Apple para
  `Required Reason API`).
- **Podfile**: regenerado, nuevas deps, versiones actualizadas.
- **`ios/Podfile.lock`**: se regenera entero con `pod install`.
- **Minimum deployment target**: iOS 15.1.
- **Xcode mínimo**: 15+ (probablemente 16+ recomendado). Usuario tiene Xcode 26.4, OK.

### 5.3. Deps y patches

- `patches/react-native-webrtc+111.0.3.patch` (nuestro) → renombrar a
  `patches/react-native-webrtc+124.0.4.patch` y **verificar que el contenido sigue
  aplicando** sobre el nuevo webrtc. Si no aplica, regenerar.
- `patches/react-native+0.73.8.patch` (si hubiera) → evaluar qué hacemos con él en RN
  0.77.2 (probablemente ya no aplica; eliminar si upstream lo hizo obsoleto, igual que
  en Android).
- `@giphy/js-brand` patch (de upstream): se mantiene.

---

## 6. Cambios anticipados en `iOSClient`

### 6.1. Mandatorios

- **`Podfile`**: bump `platform :ios, '12.0'` → `'15.1'`.
- **`SpotBros.xcodeproj/project.pbxproj`**: bump `IPHONEOS_DEPLOYMENT_TARGET` a `15.1` en
  todas las configuraciones (unificar). Debug/Release/etc.
- **`SpotBros/Vendor/Jitsi/`**: reemplazar `JitsiMeetSDK.xcframework` por el nuevo build,
  y **añadir `hermes.xcframework`** al mismo directorio.
- **Xcode project**: añadir `hermes.xcframework` a los targets como `Embed & Sign`
  (análogo a cómo está `WebRTC.xcframework` hoy).
- **`pod deintegrate && pod install`**: al tocar `Podfile`, regenerar `Pods/`.
- **Pod `JitsiWebRTC`**: revisar si hay una versión más reciente publicada por Jitsi
  que corresponda a `react-native-webrtc 124.0.4`. Actualmente `124.0.1` en lock.

### 6.2. Posibles (a evaluar tras build + primer test)

- Warnings de Giphy iOS SDK (reportado en #2800).
- Deprecaciones varias por subida de iOS deployment target.
- Ajustes menores en los 2 ficheros que importan `JitsiMeetSDK` (`CallViewController.m`,
  `ConferenceViewController.h`) si alguna signature cambió.
- Ajuste en ficheros que usan `JMCallKitProxy` — **no esperado** (API idéntica
  verificada), pero mantener ojo.

### 6.3. No mandatorios pero recomendados

- Unificar `IPHONEOS_DEPLOYMENT_TARGET` en xcodeproj (mezcla actual de 10.0/13.0 es
  deuda que conviene limpiar de una).

---

## 7. Build script — cambios anticipados

**Cambios mandatorios** (sin ellos el build falla):

- **Nueva ruta de `WebRTC.xcframework`**: antes en `node_modules/react-native-webrtc/apple/`,
  ahora en `ios/Pods/JitsiWebRTC/`. Motivo: en webrtc 124 el XCFramework se
  distribuye vía pod `JitsiWebRTC`, no via npm package. La ruta antigua ya no
  existe.
- **Añadir copia de `hermes.xcframework`** desde `ios/Pods/hermes-engine/destroot/...`.
  Mandatorio en RN 0.77.2 con `hermes_enabled: true` (sin esto la app host
  cascará en runtime al no encontrar el framework Hermes).

**Cambios cosméticos** (opcionales; el script del fork los tenía y funcionaba, se
pueden mantener tal cual):

- `VALID_ARCHS='x86_64 arm64'` / `VALID_ARCHS=arm64` — Xcode 26 las autodetecta
  por SDK, pero ponerlas explícitas no causa problema.
- `ENABLE_BITCODE=NO` — bitcode está deprecated desde Xcode 14, el flag es
  inerte pero inofensivo.
- El script oficial de Jitsi (`ios/scripts/release-sdk.sh`) hace un
  `xcodebuild clean` antes de archivar, pero como ya limpiamos con
  `rm -rf ios/sdk/out` y `rm -rf ~/Library/Developer/Xcode/DerivedData/jitsi-meet-*`,
  es redundante.

Script del fork (antes del merge):

```bash
rm -rf ios/sdk/out
mkdir -p ios/sdk/out

xcodebuild archive \
    -workspace ios/jitsi-meet.xcworkspace \
    -scheme JitsiMeetSDK \
    -configuration Release \
    -sdk iphonesimulator \
    -destination='generic/platform=iOS Simulator' \
    -archivePath ios/sdk/out/ios-simulator \
    VALID_ARCHS='x86_64 arm64' \
    ENABLE_BITCODE=NO \
    SKIP_INSTALL=NO \
    BUILD_LIBRARY_FOR_DISTRIBUTION=YES

xcodebuild archive \
    -workspace ios/jitsi-meet.xcworkspace \
    -scheme JitsiMeetSDK \
    -configuration Release \
    -sdk iphoneos \
    -destination='generic/platform=iOS' \
    -archivePath ios/sdk/out/ios-device \
    VALID_ARCHS=arm64 \
    ENABLE_BITCODE=NO \
    SKIP_INSTALL=NO \
    BUILD_LIBRARY_FOR_DISTRIBUTION=YES

xcodebuild -create-xcframework \
    -framework ios/sdk/out/ios-device.xcarchive/Products/Library/Frameworks/JitsiMeetSDK.framework \
    -framework ios/sdk/out/ios-simulator.xcarchive/Products/Library/Frameworks/JitsiMeetSDK.framework \
    -output ios/sdk/out/JitsiMeetSDK.xcframework

cp -a node_modules/react-native-webrtc/apple/WebRTC.xcframework ios/sdk/out
```

Script recomendado (post-merge, alineado con `release-sdk.sh` oficial):

```bash
rm -rf ios/sdk/out
mkdir -p ios/sdk/out

xcodebuild clean \
    -workspace ios/jitsi-meet.xcworkspace \
    -scheme JitsiMeetSDK

xcodebuild archive \
    -workspace ios/jitsi-meet.xcworkspace \
    -scheme JitsiMeetSDK \
    -configuration Release \
    -sdk iphonesimulator \
    -destination='generic/platform=iOS Simulator' \
    -archivePath ios/sdk/out/ios-simulator \
    SKIP_INSTALL=NO \
    BUILD_LIBRARY_FOR_DISTRIBUTION=YES

xcodebuild archive \
    -workspace ios/jitsi-meet.xcworkspace \
    -scheme JitsiMeetSDK \
    -configuration Release \
    -sdk iphoneos \
    -destination='generic/platform=iOS' \
    -archivePath ios/sdk/out/ios-device \
    SKIP_INSTALL=NO \
    BUILD_LIBRARY_FOR_DISTRIBUTION=YES

xcodebuild -create-xcframework \
    -framework ios/sdk/out/ios-device.xcarchive/Products/Library/Frameworks/JitsiMeetSDK.framework \
    -framework ios/sdk/out/ios-simulator.xcarchive/Products/Library/Frameworks/JitsiMeetSDK.framework \
    -output ios/sdk/out/JitsiMeetSDK.xcframework

cp -a ios/Pods/JitsiWebRTC/WebRTC.xcframework ios/sdk/out
cp -a ios/Pods/hermes-engine/destroot/Library/Frameworks/universal/hermes.xcframework ios/sdk/out
```

### 7.1. Cambio requerido: añadir Hermes

Al final del script, tras copiar WebRTC, añadir una copia análoga para `hermes.xcframework`.

**Ruta confirmada tras `pod install`** (verificada con `find` sobre el repo):

```bash
cp -a ios/Pods/hermes-engine/destroot/Library/Frameworks/universal/hermes.xcframework ios/sdk/out
```

Hermes viene como pod (`hermes-engine`) porque `use_react_native!` lo inyecta con
`:hermes_enabled => true` en el Podfile. El script phase que anunció `pod install`
(*"hermes-engine has added 1 script phase"*) es el responsable de compilar el bundle
JS a bytecode `.hbc` durante la build del SDK.

### 7.2. Cambio requerido: WebRTC.xcframework ha cambiado de ubicación

En el fork iOS viejo (webrtc 111.0.3), el XCFramework estaba en
`node_modules/react-native-webrtc/apple/WebRTC.xcframework`. En 11.5.1 con webrtc
124.0.x ese directorio ya no existe — el framework llega ahora vía el pod
`JitsiWebRTC 124.0.2`, que CocoaPods instala en `ios/Pods/JitsiWebRTC/`.

**Cambio requerido en el build script**:

```diff
-cp -a node_modules/react-native-webrtc/apple/WebRTC.xcframework ios/sdk/out
+cp -a ios/Pods/JitsiWebRTC/WebRTC.xcframework ios/sdk/out
```

### 7.3. Cambio requerido: Podfile `post_install` para fmt + Xcode 26

Xcode 16 y 26.x traen un clang más estricto con `consteval` (C++20). El pod `fmt
11.0.2` que viene con Jitsi 11.5.1 usa `consteval` en `FMT_STRING` y dispara
`error: call to consteval` al compilar `format-inl.h` en el archive del SDK.

**Fix final aplicado**: bajar el estándar C++ a `c++17` solo en el target `fmt`.
fmt soporta tanto C++17 como C++20 — su uso de `consteval` es syntactic sugar
C++20 opcional. En C++17 la feature no existe y fmt usa `constexpr`/normal
functions equivalentes. No hay impacto en runtime.

```ruby
installer.pods_project.targets.each do |target|
  if target.name == 'fmt'
    target.build_configurations.each do |config|
      config.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17'
    end
  end
end
```

Es quirúrgico: el resto de pods siguen en C++20. Approach documentado en la
[guía de BleepingSwift para Xcode 26.4 + RN](https://bleepingswift.com/blog/fmt-consteval-error-xcode-26-4-react-native)
y tracked en [fmtlib/fmt#4740](https://github.com/fmtlib/fmt/issues/4740).

> **Historial de intentos** (dejado como referencia — útil para entender el bug
> y evitar volver a estos callejones sin salida):
> - **Intento 1**: `-DFMT_CONSTEVAL=constexpr`. Falló. `FMT_CONSTEVAL` es
>   condicional derivada, no configurable directamente.
> - **Intento 2**: `-DFMT_USE_CONSTEVAL=0` via `GCC_PREPROCESSOR_DEFINITIONS`.
>   Falló. El header redefine la macro internamente sin `#ifndef` guard.
> - **Intento 3**: patch in-place de `fmt/base.h` vía `post_install` Ruby.
>   Funcionó técnicamente pero invasivo — modifica source de un pod.
> - **Intento 4 (el final)**: `CLANG_CXX_LANGUAGE_STANDARD = 'c++17'` solo en
>   target `fmt`. La solución limpia que adopta la comunidad RN.

En el paso 2 (merge a `mobile-sdk-12.0.0`), revisar si upstream ya actualizó fmt a
una versión ≥11.1 que incluye este fix nativamente — en ese caso este override
puede eliminarse.

### 7.5. `HangupContainerButtons.tsx` — port del feature flag `END_CONFERENCE_ENABLED`

**Síntoma**: en la primera ejecución tras el merge, el botón de colgar mostraba
el comportamiento upstream (botón azul con menú "Leave / End for all") en vez
del botón rojo simple que usa `iOSClient`. En Android ya funcionaba porque se
había portado durante ese merge.

**Causa**: `HangupContainerButtons.tsx` es un fichero **nuevo** añadido por
upstream en 11.5.x. Al no existir en la base común 8.5.0, **no apareció como
conflicto** durante `git merge` y mi paso de copiar resoluciones Android con
`git checkout imbox-android-mobile-sdk-11.5.1 -- <files>` se basaba solo en
los ficheros con conflicto. Este fichero nuevo se quedó con la versión upstream,
que **ignora `END_CONFERENCE_ENABLED`**.

**Fix**: copiar desde la rama Android (ya ported allí):

```bash
git checkout imbox-android-mobile-sdk-11.5.1 -- \
  react/features/toolbox/components/native/HangupContainerButtons.tsx
```

Diferencia: upstream solo comprueba `conference?.isEndConferenceSupported()`;
nuestra versión además exige `END_CONFERENCE_ENABLED` feature flag == true.
Como `iOSClient` ya pasa `"end-conference.enabled" = NO` en las feature flags
de `ConferenceViewController.m:143` y `CallViewController.m:635`, con el fix
portado el comportamiento vuelve a ser botón rojo simple.

**Lecciones para futuros merges** — este bug reveló dos debilidades del proceso
que usamos y cómo corregirlas:

**1. Los ficheros NUEVOS upstream no salen en `git diff --diff-filter=U`**. Aunque
requieran los mismos ports que los modificados (p.ej. `HangupContainerButtons.tsx`
necesitaba respetar `END_CONFERENCE_ENABLED` igual que el viejo `Toolbox.tsx`).
**Fix**: tras cada merge, listar los ficheros **nuevos** que añadió upstream
(`git diff --name-status <base>..<upstream> | awk '$1=="A"{print $2}'`), revisar
si alguno hereda lógica que antes estaba en un fichero que sí se eliminó/refactorizó.

**2. Traer resoluciones de la rama análoga (Android ↔ iOS) es frágil**. Funcionó
aquí solo porque las customizaciones principales coincidían en ambas. Si hubiera
algo iOS-only (o Android-only) en un fichero JS compartido, se perdería
silenciosamente con el shortcut `git checkout <other-branch> -- <file>`.
**Fix**: auditar customizaciones propias **fichero por fichero** contra el HEAD
de la rama, no contra la análoga. Auditoría en 3 niveles:

- **Nivel 1**: comparar `git diff --stat <base>..<old-branch>` vs `git diff --stat <base>..HEAD`
  por fichero. Si el conteo `+N` baja, se perdió algo.
- **Nivel 2**: `grep` por flags/símbolos conocidos (lista en este doc) contra
  HEAD para confirmar que siguen referenciados en los sitios correctos.
- **Nivel 3**: para ficheros iOS-only / Android-only sin conflicto,
  `git diff <base>..HEAD -- <file>` para revisar el diff a ojo.

Esta auditoría debería ejecutarse **antes de commitear el merge**, no después
(como fue el caso aquí — descubierto en runtime durante el testing).

### 7.6. Colisión de categoría Objective-C: `UIColor(…)+colorWithHex:alpha:`

**Síntoma**: al entrar en videoconferencia, crash inmediato en `objc_retain` /
`objc_storeStrong`, stack trace apuntando a `JitsiMeetView.m:103` →
`[UIColor colorWithHex:alpha:]` → `SpotBros/Utils/Categories/UIColor+Utils.m`.

**Causa**: dos categorías sobre `UIColor` con el **mismo selector**
`colorWithHex:alpha:` pero **tipos de parámetro incompatibles**:

| Fuente | Firma |
|---|---|
| Jitsi SDK (`ios/sdk/src/JitsiMeetView.m`, upstream ≥ 11.5.0) | `+ (UIColor *)colorWithHex:(uint32_t)hex alpha:(CGFloat)alpha;` |
| iOSClient (`SpotBros/Utils/Categories/UIColor+Utils.m`) | `+ (UIColor*)colorWithHex:(NSString*)hex alpha:(CGFloat)alpha;` |

Objective-C **no distingue categorías por signature** — solo por selector. Al
linkar aparece *"duplicate category will be ignored"* (warning) y una pisa a la
otra **impredeciblemente**. El SDK llama con `0x040404` (uint32_t); si gana la
implementación de iOSClient (que espera `NSString*`), el valor `0x040404` se
interpreta como puntero a NSString inválido → `objc_retain` sobre basura →
crash.

Esta línea **no existía en upstream 8.5.0** (nuestra base previa) — fue
introducida por upstream en 11.5.x en el commit `18d8c3652`
*"fix(android,ios) set native view background matching JS"*. Por eso el crash
no había aparecido nunca antes.

**Fix** (localizado en el fork Jitsi, 3 líneas en `JitsiMeetView.m`): renombrar
los métodos del SDK con prefijo `jitsi_` para eliminar el choque de selectors.
Cambio quirúrgico — `iOSClient` no se toca:

```diff
-@interface UIColor (Hex)
-+ (UIColor *)colorWithHex:(uint32_t)hex;
-+ (UIColor *)colorWithHex:(uint32_t)hex alpha:(CGFloat)alpha;
+@interface UIColor (JitsiHex)
++ (UIColor *)jitsi_colorWithHex:(uint32_t)hex;
++ (UIColor *)jitsi_colorWithHex:(uint32_t)hex alpha:(CGFloat)alpha;

(idem en @implementation)

-    self.backgroundColor = [UIColor colorWithHex:0x040404 alpha:1];
+    self.backgroundColor = [UIColor jitsi_colorWithHex:0x040404 alpha:1];
```

**Custom a preservar en futuros merges**: upstream seguramente mantendrá la
categoría `UIColor (Hex)` sin prefijo. En cada merge tendremos que reaplicar
este renombre al selector.

### 7.7. Modular headers de forma granular (NO globalmente)

CocoaPods aborta el `pod install` con este error:

```
[!] The following Swift pods cannot yet be integrated as static libraries:
The Swift pod `giphy-react-native-sdk` depends upon `glog` and `DoubleConversion`,
which do not define modules...
The Swift pod `react-native-video` depends upon `glog` and `DoubleConversion`,
which do not define modules...
```

Sí es un error bloqueante, no warning (se confirmó empíricamente: sin fix,
`pod install` no llega a "installation complete").

**Solución trampa a evitar**: `use_modular_headers!` a nivel global. Hace que
CocoaPods auto-genere modulemaps para todos los pods, lo que entra en conflicto
con el modulemap manual que `ReactCommon` ya trae. Resultado: 114 ocurrencias
de `error: Redefinition of module 'ReactCommon'` durante el archive. Bug conocido
[facebook/react-native#45000](https://github.com/facebook/react-native/issues/45000).

**Solución correcta (granular)**: declarar `:modular_headers => true` solo para
los dos pods que los Swift pods realmente necesitan, y usar el path del podspec
de RN (third-party-podspecs):

```ruby
target 'JitsiMeetSDK' do
  project 'sdk/sdk.xcodeproj'

  # BEFORE use_react_native! so CocoaPods picks up these options when it
  # processes the transitive deps.
  pod 'glog', :podspec => '../node_modules/react-native/third-party-podspecs/glog.podspec', :modular_headers => true
  pod 'DoubleConversion', :podspec => '../node_modules/react-native/third-party-podspecs/DoubleConversion.podspec', :modular_headers => true

  config = use_native_modules!
  use_react_native!(...)
  ...
end
```

Mismo bloque en `target 'JitsiMeetSDKLite'`.

El orden importa: las declaraciones con `:modular_headers => true` deben ir
**antes** de `use_react_native!`, que es donde internamente se declaran los
pods transitivos; CocoaPods toma los options de la primera declaración.

### 7.2. Otras consideraciones

- `VALID_ARCHS='x86_64 arm64'` para simulator: OK. En Apple Silicon se necesita arm64
  simulator también.
- `ENABLE_BITCODE=NO`: OK (bitcode deprecated desde Xcode 14).
- Al terminar el build, `ios/sdk/out/` contendrá:
  - `JitsiMeetSDK.xcframework` (nuestro build)
  - `WebRTC.xcframework` (copiado)
  - `hermes.xcframework` (nuevo, a añadir)

---

## 8. Plan de ejecución propuesto

### Fase 1 — Preparación (sin código) ✅ COMPLETADA (2026-04-16)

1. ✅ Crear rama `imbox-ios-mobile-sdk-11.5.1` desde `imbox-mobile-23.5`.
2. ✅ Pre-análisis: `git diff ios-sdk-8.5.0..mobile-sdk-11.5.1` para ver alcance exacto
   de cambios upstream.
3. ✅ Catalogar conflictos esperados (la mayoría JS ya resueltos en Android — se
   replicaron decisiones).

### Fase 2 — Merge ✅ COMPLETADA (2026-04-16)

4. ✅ `git merge mobile-sdk-11.5.1`. **31 conflictos**, todos resueltos (ver §11 para
   detalle).
5. ✅ `npm ci` en la raíz del fork regenerado sin errores.

### Fase 3 — Build ✅ COMPLETADA (2026-04-16)

6. ✅ Podfile ajustado con los fixes (ver §7.3 y §7.4).
7. ✅ `pod install` exitoso tras los ajustes.
8. ✅ `xcodebuild archive` para simulator + device + `create-xcframework` completados.
9. ✅ `ios/sdk/out/` contiene los 3 XCFrameworks: `JitsiMeetSDK.xcframework`,
   `WebRTC.xcframework`, `hermes.xcframework`.

6. Actualizar el build script con la línea de copiar `hermes.xcframework`.
7. Ejecutar el script de build del SDK.
8. Verificar `ios/sdk/out/` tiene los 3 frameworks.

### Fase 4 — Integración en `iOSClient` ✅ COMPLETADA (2026-04-16)

9. ✅ `JitsiMeetSDK.xcframework` reemplazado en `SpotBros/Vendor/Jitsi/`.
10. ✅ `hermes.xcframework` añadido a `SpotBros/Vendor/Jitsi/` y embebido (Embed & Sign)
    en los targets vía `SpotBros.xcodeproj/project.pbxproj`.
11. ✅ `Podfile.lock` regenerado.
12. ✅ Build OK en Xcode 26.4.

Nota: el bump de `IPHONEOS_DEPLOYMENT_TARGET` a 15.1 anticipado en §6.1 finalmente
**no fue necesario** para que la app compilase y arrancase (los targets actuales
siguen con la mezcla 10.0/13.0). Limpieza pospuesta — no bloqueante.

### Fase 5 — Testing runtime ✅ COMPLETADA (2026-04-16)

13. ✅ Smoke test pasado: chat, conferencia, CallKit, PiP, transiciones background.
14. ✅ Caso crítico #2800 reproducido y verificado: llamada entrante desde móvil →
    pantalla de conferencia aparece correctamente (no negra). Bloqueador resuelto.
15. ✅ Crash `objc_retain` por colisión de selector `colorWithHex:alpha:` detectado
    en runtime y arreglado en el fork (ver §7.6, renombre a `jitsi_colorWithHex:`).

### Fase 6 — Release ✅ COMPLETADA (2026-04-21)

16. ✅ Fork Jitsi: rama `imbox-ios-mobile-sdk-11.5.1` con tip `23627b2bd`
    (incluye merge `543773ea8` + commit con este doc).
17. ✅ Commit en `iOSClient`: `5b9a7b863` *"upgrade Jitsi SDK to 11.5.1, #3060"*
    (2026-04-16). Cierra el bloqueador de #2800.
18. ✅ Mergeado a `develop` en iOSClient: `7f41286c9` *"Merge branch
    'jitsi-sdk-11.5.1' into develop"* (2026-04-21).

---

## 9. Preguntas abiertas / decisiones pendientes

- [x] Xcode disponible: 26.4 (confirmado).
- [x] Usuario OK con bump iOS deployment target a 15.1.
- [x] Paso intermedio a `mobile-sdk-11.5.1` confirmado (no salto directo a 12.0.0).
- [x] Ruta de `hermes.xcframework` confirmada: **opción B** (`ios/Pods/hermes-engine/destroot/…`).
- [ ] Verificar si el pod `JitsiWebRTC` tiene versión >= 124.0.4 publicada.
- [ ] Tras el build, verificar si el patch `react-native-webrtc+111.0.3.patch` sigue
      aplicando sobre el nuevo webrtc 124.x — si no, regenerar.

---

## 10. Apéndice — Referencias

- Issue iOSClient: [imbox-technologies/iOSClient#2800](https://github.com/imbox-technologies/iOSClient/issues/2800)
- Merge Android (antecedente): `doc/imbox/2026-04-15-merge-mobile-sdk-11.5.1.md`
- Tag upstream: [jitsi/jitsi-meet/releases/tag/mobile-sdk-11.5.1](https://github.com/jitsi/jitsi-meet/releases/tag/mobile-sdk-11.5.1)
- Hermes docs: [reactnative.dev/docs/hermes](https://reactnative.dev/docs/hermes)
- Jitsi iOS 15.1 bump commit: `feat(ios) bump minimum required iOS version to 15.1`
  (en `mobile-24.5` changelog).

---

## 11. Log de ejecución del merge (2026-04-16)

Esta sección se añade tras completar Fase 1 y Fase 2. Captura las decisiones concretas
tomadas durante la resolución de los 31 conflictos.

### 11.1. Fase 1 — Preparación

Ejecutado sin incidencias:

```
git checkout imbox-mobile-23.5
git checkout -b imbox-ios-mobile-sdk-11.5.1
```

**Pre-análisis**:

- Entre `ios-sdk-8.5.0` y `mobile-sdk-11.5.1`: 1604 ficheros cambiados upstream
  (+99.652 / −43.980). La mayoría en `react/features/` (1124 ficheros, código JS
  compartido con Android).
- Ficheros iOS-específicos tocados por upstream: 44. Destaca la migración Swift del
  AppDelegate/ViewController, PrivacyInfo, eliminación de `JavaScriptSandbox.m`, y
  eliminación de patches obsoletos.
- **Hallazgo importante**: `ios/sdk/src/callkit/JMCallKit*` idénticos byte-a-byte
  entre 8.5.0 y 11.5.1 (SHAs iguales en git). La integración CallKit de `iOSClient`
  sigue funcionando sin tocar nada.
- **Hallazgo importante #2**: `Conference.tsx` en nuestra rama iOS **no tiene** la
  línea problemática `state['features/background']` (mergeamos `mobile-23.5` en
  dic-2024 después del fix upstream `d45c10805` de nov-2024). El bug de pantalla
  negra que bloqueó el intento de #2800 no debería reaparecer.

### 11.2. Fase 2 — Merge

`git merge mobile-sdk-11.5.1` → 31 conflictos. Clasificados y resueltos así:

#### 🟢 Aceptar upstream directo (11 ficheros)

- Versiones en `Info.plist` × 6 (broadcast-extension, src, watchos app, watchos
  extension, sdk src, sdk Lite-Info).
- `ios/sdk/sdk.xcodeproj/project.pbxproj` — eliminación de `JavaScriptSandbox.m`
  (parte del switch duktape → worklets-core).
- `ios/app/app.xcodeproj/project.pbxproj` — migración Swift AppDelegate + Hermes +
  PrivacyInfo (RN 0.77.2 mandatorio).
- `ios/Podfile.lock` — se regenera con `pod install`, falso conflicto.
- `react-native-sdk/package.json` + `package-lock.json` — deps upstream.
- `resources/update-mobile-rnsdk-version.sh` — script util.
- `patches/react-native+0.69.11.patch` — upstream lo eliminó, estado UD → `git rm`.

#### 🟡 Traídos desde resolución Android (11 ficheros)

Se usó `git checkout imbox-android-mobile-sdk-11.5.1 -- <file>` para traer las
resoluciones ya testeadas y commiteadas en la rama Android:

- **Android legacy** (8 ficheros, vestigios del repo compartido iOS/Android):
  `android/build.gradle`, `android/gradle.properties`,
  `android/sdk/src/main/java/org/jitsi/meet/sdk/{AudioModeModule,BroadcastAction,BroadcastIntentHelper,JitsiMeetActivity,JitsiMeetView,ReactInstanceManagerHolder}.java`.
- **JS/TS cross-platform con decisiones idénticas** (5 ficheros):
  - `react/features/app/components/App.native.tsx`
  - `react/features/mobile/picture-in-picture/components/PictureInPictureButton.ts`
    (preserva `IconPip` alias a `collapsed.svg`).
  - `react/features/toolbox/components/native/Toolbox.tsx` (aceptar refactor upstream).
  - `react/features/mobile/audio-mode/middleware.ts` (imports combinados:
    `AUDIO_DEFAULT_TO_SPEAKER` + `SET_CONFIG`).
  - `react/features/mobile/external-api/middleware.ts` (listener `SET_AUDIO_DEVICE`
    quirúrgico preservado).

Verificación previa al checkout: ninguno de estos ficheros tenía lógica específica de
iOS (`Platform.OS === 'ios'` o similares) que se pudiera perder. Safe.

#### 🟠 Resueltos a mano (7 ficheros con decisiones iOS-específicas)

1. **`ios/sdk/src/AudioMode.m`**: combinar guard `audioDisabled` (upstream) + nuestro
   `RCTLogInfo` justo después. Mismo patrón que Android.
2. **`ios/sdk/src/ExternalAPI.m`**: fusionar dos listas (`constantsToExport` y
   `supportedEvents`). Preservar `SET_AUDIO_DEVICE` + añadir los nuevos de upstream
   (`SHOW_NOTIFICATION`, `HIDE_NOTIFICATION`, `START/STOP_RECORDING`, `OVERWRITE_CONFIG`,
   `SEND_CAMERA_FACING_MODE_MESSAGE`). Mismo patrón que Android.
3. **`react/features/overlay/middleware.ts`** (iOS-only, nuestro flag
   `silent-reload-on-error.enabled`): **combinar tres piezas**:
   - Imports: preservar `SILENT_RELOAD_ON_ERROR` + `getFeatureFlag` nuestros; adoptar
     `JitsiConnectionErrors` nuevo de upstream.
   - Añadir el `leaving` check nuevo de upstream (evita reload si ya estamos saliendo).
   - Añadir el logger upstream.
   - Mantener nuestro gating: si `silentReload` flag activo → `reloadNow()`, sino →
     `openPageReloadDialog(conferenceError, configError, connectionError)` con los 3
     argumentos nuevos de upstream.
4. **`react/features/mobile/navigation/components/RootNavigationContainer.tsx`**:
   aceptar upstream. Añade una nueva `<RootStack.Screen>` para `VisitorsQueue` antes
   del `ConferenceNavigationContainer`. Nuestro código no tocaba esta zona.
5. **`react/features/base/conference/middleware.any.ts`**: únicamente un conflicto en
   imports. **Union de imports**:
   - Preservar nuestros `SET_NETWORK_INFO` (de `net-info/actionTypes`) y `NET_INFO_STORE`
     (de `net-info/constants`) — forman parte del fix iOS #2832 (audio recovery
     WiFi↔celular).
   - Adoptar `JitsiConferenceEvents` nuevo + `MEDIA_TYPE` nuevo de upstream.
   - Resto del fichero: auto-merge de git funcionó.

### 11.3. Auditoría post-merge

Ejecutadas verificaciones `grep` para confirmar preservación:

| Customización | Confirmado |
|---|---|
| `SET_AUDIO_DEVICE` / `setAudioDeviceAction` en `ExternalAPI.m` | ✅ 4 ocurrencias |
| `SILENT_RELOAD_ON_ERROR` + `silentReload` gating | ✅ 3 ocurrencias |
| `IconPip` alias en `svg/constants.ts` | ✅ 2 ocurrencias |
| Imports `SET_NETWORK_INFO` / `NET_INFO_STORE` (#2832) | ✅ 4 ocurrencias |
| `audioDisabled` upstream + `Set mode: %d` log en `AudioMode.m` | ✅ 7 ocurrencias |
| `collapsed.svg` fichero presente | ✅ |
| `VisitorsQueue` screen (nuevo upstream integrado) | ✅ 2 ocurrencias |

### 11.4. `npm ci`

Ejecutado en la raíz del fork. Sin errores. `node_modules` regenerado con las deps
de upstream 11.5.1 (RN 0.77.2, etc.). Patches aplicados via `patch-package` durante
el `postinstall`:

- `@giphy+js-brand+2.2.2.patch` — upstream, sigue en 11.5.1.
- `react-native-webrtc+111.0.3.patch` — nuestro, **a verificar** si sigue aplicando
  sobre el webrtc nuevo (124.x). Si falla, regenerar para el nuevo pathname.

### 11.5. Cierre

- Fork Jitsi: merge commiteado en `543773ea8`, doc añadido en `23627b2bd`.
- Build SDK + Hermes: OK con los fixes de §7.
- Integración iOSClient: commit `5b9a7b863` (#3060, 2026-04-16).
- Merge a `develop` en iOSClient: `7f41286c9` (2026-04-21).
- Testing runtime: pasado, incluido el caso crítico #2800.
