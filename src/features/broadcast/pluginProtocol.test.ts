import { describe, expect, it } from "vitest";
import {
  DAW_BRIDGE_DELIVERY,
  DAW_PLUGIN_DELIVERY,
  DEFAULT_DAW_PORT,
  DEFAULT_DAW_WS_URL,
  decodeLegacyPcm,
  decodePcmFrame,
  encodeControlMessage,
  encodePcmFrame,
  parseControlMessage,
  parseDawInfo,
} from "./pluginProtocol";
import { existsSync } from "node:fs";
import path from "node:path";

describe("pluginProtocol", () => {
  it("names honest delivery states", () => {
    expect(DAW_PLUGIN_DELIVERY).toBe("NATIVE-PLATFORM ONLY");
    expect(DAW_BRIDGE_DELIVERY).toBe("PARTIALLY IMPLEMENTED");
    expect(existsSync(path.resolve(__dirname, "../../../native/vlink/src/vlink_factory.cpp"))).toBe(true);
  });

  it("defines the loopback listen address", () => {
    expect(DEFAULT_DAW_PORT).toBe(48480);
    expect(DEFAULT_DAW_WS_URL).toBe("ws://127.0.0.1:48480/vybz-stream");
  });

  it("round-trips a hello control message", () => {
    const raw = encodeControlMessage({
      type: "hello",
      info: {
        dawName: "Ableton Live 12",
        pluginFormat: "vst3",
        sampleRate: 48000,
        channels: 2,
        bufferSize: 256,
        latencyMs: 5.33,
      },
    });
    expect(parseControlMessage(raw)).toEqual({
      type: "hello",
      info: {
        dawName: "Ableton Live 12",
        pluginFormat: "vst3",
        sampleRate: 48000,
        channels: 2,
        bufferSize: 256,
        latencyMs: 5.33,
      },
    });
  });

  it("rejects a hello with a fabricated or missing sample rate", () => {
    expect(parseDawInfo({ dawName: "X", pluginFormat: "vst3", channels: 2 })).toBeNull();
    expect(
      parseControlMessage(
        JSON.stringify({
          type: "hello",
          info: { dawName: "X", pluginFormat: "vst3", sampleRate: 0, channels: 2, bufferSize: 256, latencyMs: 1 },
        }),
      ),
    ).toBeNull();
  });

  it("rejects corrupt JSON and unknown types", () => {
    expect(parseControlMessage("{")).toBeNull();
    expect(parseControlMessage(JSON.stringify({ type: "explode" }))).toBeNull();
  });

  it("clamps meter peaks to 0–1 and keeps measured LUFS", () => {
    const msg = parseControlMessage(
      JSON.stringify({
        type: "meter",
        meter: { peakL: 1.4, peakR: -0.2, rmsL: 0.3, rmsR: 0.2, lufsIntegrated: -14.2, truePeak: -0.8 },
      }),
    );
    expect(msg).toEqual({
      type: "meter",
      meter: { peakL: 1, peakR: 0, rmsL: 0.3, rmsR: 0.2, lufsIntegrated: -14.2, truePeak: -0.8 },
    });
  });

  it("accepts the exact hello JSON VLink emits", () => {
    const raw =
      '{"type":"hello","info":{"dawName":"VLinkNode","pluginFormat":"vst3","pluginName":"VLink","pluginVersion":"0.1.0","sampleRate":48000,"channels":2,"bufferSize":256,"latencyMs":0}}';
    const msg = parseControlMessage(raw);
    expect(msg).toMatchObject({
      type: "hello",
      info: {
        dawName: "VLinkNode",
        pluginFormat: "vst3",
        pluginName: "VLink",
        sampleRate: 48000,
        channels: 2,
        bufferSize: 256,
        latencyMs: 0,
      },
    });
  });

  it("round-trips a framed stereo PCM block", () => {
    const samples = new Float32Array([0.1, -0.2, 0.3, -0.4]);
    const encoded = encodePcmFrame({ channels: 2, sampleRate: 48000, frameCount: 2, samples });
    const decoded = decodePcmFrame(encoded);
    expect(decoded?.sampleRate).toBe(48000);
    expect(decoded?.frameCount).toBe(2);
    const got = Array.from(decoded?.samples ?? []);
    expect(got).toHaveLength(4);
    [0.1, -0.2, 0.3, -0.4].forEach((n, i) => expect(got[i]).toBeCloseTo(n, 5));
    const bytes = new Uint8Array(encoded);
    expect([...bytes.slice(0, 8)]).toEqual([0x56, 0x59, 0x42, 0x5a, 1, 2, 0, 0]);
  });

  it("rejects a frame with the wrong magic or a truncated payload", () => {
    const samples = new Float32Array([0, 0]);
    const encoded = encodePcmFrame({ channels: 2, sampleRate: 48000, frameCount: 1, samples });
    const copy = new Uint8Array(encoded.slice(0));
    copy[0] = 0;
    expect(decodePcmFrame(copy.buffer)).toBeNull();
    expect(decodePcmFrame(encoded.slice(0, 12))).toBeNull();
  });

  it("accepts legacy headerless stereo PCM only when the byte length is even frames", () => {
    expect(decodeLegacyPcm(new Float32Array([0.1, 0.2]).buffer)).not.toBeNull();
    expect(decodeLegacyPcm(new Float32Array([0.1]).buffer)).toBeNull();
  });

  it("round-trips VLink hello extras and omits unmeasured transport fields", () => {
    const hello = parseControlMessage(
      JSON.stringify({
        type: "hello",
        info: {
          dawName: "Reaper",
          pluginFormat: "vst3",
          pluginName: "VLink",
          pluginVersion: "0.1.0",
          sampleRate: 48000,
          channels: 2,
          bufferSize: 256,
          latencyMs: 0,
        },
      }),
    );
    expect(hello).toMatchObject({ type: "hello", info: { pluginName: "VLink", dawName: "Reaper" } });
    const tr = parseControlMessage(
      JSON.stringify({
        type: "transport",
        transport: {
          playing: true,
          recording: false,
          cycling: false,
          sampleRate: 48000,
          tempoBpm: null,
          timeSigNum: null,
          timeSigDen: null,
          projectTimeSamples: 1024,
        },
      }),
    );
    expect(tr).toEqual({
      type: "transport",
      transport: {
        playing: true,
        recording: false,
        cycling: false,
        sampleRate: 48000,
        tempoBpm: null,
        timeSigNum: null,
        timeSigDen: null,
        projectTimeSamples: 1024,
      },
    });
  });

  it("allows null listener counts on telemetry so we never invent them", () => {
    expect(parseControlMessage(JSON.stringify({ type: "telemetry", listeners: null, sparksCount: null }))).toEqual({
      type: "telemetry",
      listeners: null,
      sparksCount: null,
    });
  });
});
