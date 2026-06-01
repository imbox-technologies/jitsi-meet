package org.jitsi.meet.sdk;

/*
 *  Copyright 2017 The WebRTC project authors. All Rights Reserved.
 *
 *  Use of this source code is governed by a BSD-style license
 *  that can be found in the LICENSE file in the root of the source
 *  tree. An additional intellectual property rights grant can be found
 *  in the file PATENTS.  All contributing project authors may
 *  be found in the AUTHORS file in the root of the source tree.
 */

import android.media.MediaCodecInfo;
import androidx.annotation.Nullable;

import com.oney.WebRTCModule.webrtcutils.SoftwareVideoDecoderFactoryProxy;

import org.webrtc.EglBase;
import org.webrtc.HardwareVideoDecoderFactory;
import org.webrtc.JitsiPlatformVideoDecoderFactory;
import org.webrtc.Predicate;
import org.webrtc.VideoCodecInfo;
import org.webrtc.VideoDecoder;
import org.webrtc.VideoDecoderFactory;
import org.webrtc.VideoDecoderFallback;

import java.util.Arrays;
import java.util.LinkedHashSet;

/**
 * Custom decoder factory which uses native SW decoders for VP8 / VP9 and HW decoders with SW fallback
 * for the rest.
 */
public class JitsiVideoDecoderFactory implements VideoDecoderFactory {
    private static final String VP8_CODEC = "VP8";
    private static final String VP9_CODEC = "VP9";

    private final VideoDecoderFactory hardwareVideoDecoderFactory;
    private final VideoDecoderFactory softwareVideoDecoderFactory = new SoftwareVideoDecoderFactoryProxy();
    private final VideoDecoderFactory platformSoftwareVideoDecoderFactory;

    /**
     * Predicate to filter out hardware decoders known to have surface attachment issues on
     * reconfiguration (rapid resolution / simulcast layer switches).
     *
     * - c2.google.av1: upstream filter, terrible framerates due to constant restarts (commit 8a79d200c).
     * - MediaTek HW decoders: observed on Xiaomi 2201116TG (Redmi/Mediatek). When the decoder is
     *   recreated by a simulcast layer change before the first frame is rendered, the
     *   SurfaceTextureHelper sink attachment is lost permanently and the EglRenderer receives 0
     *   frames for the rest of the track lifecycle. Falling back to software decoders
     *   (libvpx / openh264) avoids the issue. Both naming variants must be filtered:
     *     c2.mtk.*           - newer Codec2 API (e.g. c2.mtk.vpx.decoder, c2.mtk.avc.decoder)
     *     OMX.MTK.*          - legacy OMX API (e.g. OMX.MTK.VIDEO.DECODER.AVC, .VPX, .HEVC)
     *   Repro: Android Xiaomi <-> iOS with simulcast on; fails intermittently, more frequent on
     *   unstable network.
     */
    private static final String GOOGLE_AV1_DECODER = "c2.google.av1";
    private static final String MEDIATEK_C2_DECODER_PREFIX = "c2.mtk.";
    private static final String MEDIATEK_OMX_DECODER_PREFIX = "OMX.MTK.";
    private static final Predicate<MediaCodecInfo> hwCodecPredicate = arg -> {
        String name = arg.getName();
        return !name.startsWith(GOOGLE_AV1_DECODER)
            && !name.startsWith(MEDIATEK_C2_DECODER_PREFIX)
            && !name.startsWith(MEDIATEK_OMX_DECODER_PREFIX);
    };
    private static final Predicate<MediaCodecInfo> swCodecPredicate = arg -> {
        // Noop, just making sure we can customize it easily if needed.
        return true;
    };

    /**
     * Create decoder factory using default hardware decoder factory.
     */
    public JitsiVideoDecoderFactory(@Nullable EglBase.Context eglContext) {
        this.hardwareVideoDecoderFactory = new HardwareVideoDecoderFactory(eglContext, hwCodecPredicate);
        this.platformSoftwareVideoDecoderFactory = new JitsiPlatformVideoDecoderFactory(eglContext, swCodecPredicate);
    }

    @Override
    public @Nullable VideoDecoder createDecoder(VideoCodecInfo codecType) {
        VideoDecoder softwareDecoder = softwareVideoDecoderFactory.createDecoder(codecType);

        if (shouldUseNativeSoftwareDecoder(codecType) && softwareDecoder != null) {
            return softwareDecoder;
        }

        final VideoDecoder hardwareDecoder = hardwareVideoDecoderFactory.createDecoder(codecType);
        if (softwareDecoder == null) {
            softwareDecoder = platformSoftwareVideoDecoderFactory.createDecoder(codecType);
        }
        if (hardwareDecoder != null && softwareDecoder != null) {
            // Both hardware and software supported, wrap it in a software fallback
            return new VideoDecoderFallback(
                /* fallback= */ softwareDecoder, /* primary= */ hardwareDecoder);
        }
        return hardwareDecoder != null ? hardwareDecoder : softwareDecoder;
    }

    private static boolean shouldUseNativeSoftwareDecoder(VideoCodecInfo codecType) {
        return codecType.name.equalsIgnoreCase(VP8_CODEC)
            || codecType.name.equalsIgnoreCase(VP9_CODEC);
    }

    @Override
    public VideoCodecInfo[] getSupportedCodecs() {
        LinkedHashSet<VideoCodecInfo> supportedCodecInfos = new LinkedHashSet<>();

        supportedCodecInfos.addAll(Arrays.asList(softwareVideoDecoderFactory.getSupportedCodecs()));
        supportedCodecInfos.addAll(Arrays.asList(hardwareVideoDecoderFactory.getSupportedCodecs()));
        supportedCodecInfos.addAll(Arrays.asList(platformSoftwareVideoDecoderFactory.getSupportedCodecs()));

        return supportedCodecInfos.toArray(new VideoCodecInfo[supportedCodecInfos.size()]);
    }
}
