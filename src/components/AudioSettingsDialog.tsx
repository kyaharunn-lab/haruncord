"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Headphones,
  Mic,
  Radio,
  RefreshCcw,
  RotateCcw,
  SlidersHorizontal,
  Speaker,
  Volume2,
  Waves,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AudioSettings, AudioQualityMode } from "@/lib/webrtc";

type AudioSettingsWithOutput = AudioSettings & { outputDeviceId?: string };

interface AudioSettingsDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  settings: AudioSettingsWithOutput;
  onSettingsChange: (settings: AudioSettingsWithOutput) => void;
  onReconnectVoice?: () => void;
  isVoiceConnected?: boolean;
}

const STORAGE_KEY = "kanka_audio_settings";

const DEFAULT_SETTINGS: AudioSettingsWithOutput = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  micSensitivity: 0.3,
  gateLevel: 0.5,
  gateSmoothing: 0.5,
  micGain: 1.0,
  deviceId: "default",
  outputDeviceId: "default",
  qualityMode: "balanced",
};

function getDeviceLabel(device: MediaDeviceInfo, fallback: string, index: number) {
  return device.label || `${fallback} ${index + 1}`;
}

function isPermissionDenied(error: unknown) {
  return error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "PermissionDeniedError");
}

export function AudioSettingsDialog({
  isOpen,
  onOpenChange,
  settings,
  onSettingsChange,
  onReconnectVoice,
  isVoiceConnected,
}: AudioSettingsDialogProps) {
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);
  const [micLevel, setMicLevel] = useState(0);
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [isPermissionError, setIsPermissionError] = useState(false);
  const [activeSection, setActiveSection] = useState("voice");
  const previewStreamRef = useRef<MediaStream | null>(null);
  const previewAudioContextRef = useRef<AudioContext | null>(null);
  const previewFrameRef = useRef<number | null>(null);

  const selectedMicName = useMemo(() => {
    const device = microphones.find((mic) => mic.deviceId === settings.deviceId);
    return device?.label || "Varsayılan mikrofon";
  }, [microphones, settings.deviceId]);

  const stopMicPreview = useCallback(() => {
    if (previewFrameRef.current) {
      cancelAnimationFrame(previewFrameRef.current);
      previewFrameRef.current = null;
    }
    previewStreamRef.current?.getTracks().forEach((track) => track.stop());
    previewStreamRef.current = null;
    if (previewAudioContextRef.current?.state !== "closed") {
      void previewAudioContextRef.current?.close();
    }
    previewAudioContextRef.current = null;
    setMicLevel(0);
  }, []);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      setDeviceError("Bu tarayıcı medya cihazlarını listelemeyi desteklemiyor.");
      setIsPermissionError(false);
      return;
    }
    try {
      setDeviceError(null);
      setIsPermissionError(false);
      const devices = await navigator.mediaDevices.enumerateDevices();
      setMicrophones(devices.filter((device) => device.kind === "audioinput"));
      setSpeakers(devices.filter((device) => device.kind === "audiooutput"));
    } catch (error) {
      setDeviceError(error instanceof Error ? error.message : "Cihazlar listelenemedi.");
      setIsPermissionError(isPermissionDenied(error));
    }
  }, []);

  const startMicPreview = useCallback(async () => {
    stopMicPreview();
    if (!isOpen || !navigator.mediaDevices?.getUserMedia) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: settings.deviceId && settings.deviceId !== "default" ? { exact: settings.deviceId } : undefined,
          echoCancellation: settings.echoCancellation,
          noiseSuppression: settings.noiseSuppression,
          autoGainControl: settings.autoGainControl,
        },
      });
      previewStreamRef.current = stream;
      setDeviceError(null);
      setIsPermissionError(false);
      await refreshDevices();

      const AudioContextCtor =
        window.AudioContext ||
        (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;

      const audioContext = new AudioContextCtor({ latencyHint: "interactive" });
      previewAudioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.68;
      source.connect(analyser);
      const data = new Uint8Array(analyser.fftSize);

      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) {
          const centered = (data[i] - 128) / 128;
          sum += centered * centered;
        }
        setMicLevel(Math.min(100, Math.round(Math.sqrt(sum / data.length) * 260)));
        previewFrameRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (error) {
      if (isPermissionDenied(error)) {
        setDeviceError("Mikrofon izni reddedildi. Ses ayarlarını kullanmak için tarayıcı izinlerinden mikrofona erişime izin verip tekrar deneyin.");
        setIsPermissionError(true);
      } else {
        setDeviceError(error instanceof Error ? error.message : "Mikrofon testi başlatılamadı.");
        setIsPermissionError(false);
      }
    }
  }, [
    isOpen,
    refreshDevices,
    settings.autoGainControl,
    settings.deviceId,
    settings.echoCancellation,
    settings.noiseSuppression,
    stopMicPreview,
  ]);

  useEffect(() => {
    if (!isOpen) {
      stopMicPreview();
      return;
    }
    void refreshDevices();
    void startMicPreview();
    const handleDeviceChange = () => void refreshDevices();
    navigator.mediaDevices?.addEventListener?.("devicechange", handleDeviceChange);
    return () => {
      navigator.mediaDevices?.removeEventListener?.("devicechange", handleDeviceChange);
      stopMicPreview();
    };
  }, [isOpen, refreshDevices, startMicPreview, stopMicPreview]);

  const persistSettings = useCallback((nextSettings: AudioSettingsWithOutput) => {
    onSettingsChange(nextSettings);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextSettings));
  }, [onSettingsChange]);

  const updateSetting = useCallback(<K extends keyof AudioSettingsWithOutput>(key: K, value: AudioSettingsWithOutput[K]) => {
    persistSettings({ ...settings, [key]: value });
  }, [persistSettings, settings]);

  const handleReset = () => {
    persistSettings(DEFAULT_SETTINGS);
  };

  const handleTestSound = async () => {
    try {
      const AudioContextCtor =
        window.AudioContext ||
        (window as Window & typeof globalThis & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextCtor) return;
      const audioContext = new AudioContextCtor();
      const destination = audioContext.createMediaStreamDestination();
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(660, audioContext.currentTime);
      oscillator.frequency.exponentialRampToValueAtTime(880, audioContext.currentTime + 0.08);
      gain.gain.setValueAtTime(0, audioContext.currentTime);
      gain.gain.linearRampToValueAtTime(0.045, audioContext.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.28);
      oscillator.connect(gain);
      gain.connect(destination);

      const audio = new Audio();
      audio.srcObject = destination.stream;
      const sinkableAudio = audio as HTMLAudioElement & { setSinkId?: (sinkId: string) => Promise<void> };
      if (settings.outputDeviceId && settings.outputDeviceId !== "default" && sinkableAudio.setSinkId) {
        await sinkableAudio.setSinkId(settings.outputDeviceId);
      }
      oscillator.start();
      oscillator.stop(audioContext.currentTime + 0.3);
      await audio.play();
      oscillator.onended = () => {
        destination.stream.getTracks().forEach((track) => track.stop());
        void audioContext.close();
      };
    } catch (error) {
      setDeviceError(error instanceof Error ? error.message : "Test sesi çalınamadı.");
      setIsPermissionError(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] overflow-hidden border-white/10 bg-[#111019] p-0 text-white shadow-2xl sm:max-w-4xl">
        <div className="grid max-h-[92vh] grid-cols-1 overflow-hidden md:grid-cols-[210px_1fr]">
          <aside className="border-b border-white/10 bg-black/20 p-3 md:border-b-0 md:border-r">
            <DialogHeader className="mb-3 px-2 pt-2">
              <DialogTitle className="text-xl font-bold tracking-tight">Ses Ayarları</DialogTitle>
              <p className="text-xs text-white/42">Ses cihazları ve mikrofon iyileştirme</p>
            </DialogHeader>
            <div className="grid grid-cols-3 gap-2 md:grid-cols-1">
              {[
                { id: "voice", label: "Ses", icon: Mic },
                { id: "devices", label: "Cihazlar", icon: Headphones },
                { id: "advanced", label: "Gelişmiş", icon: SlidersHorizontal },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveSection(item.id)}
                    className={cn(
                      "flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-medium text-white/50 transition-all hover:bg-white/[0.06] hover:text-white md:justify-start",
                      activeSection === item.id && "bg-indigo-500/15 text-white ring-1 ring-indigo-300/20"
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="max-h-[92vh] overflow-y-auto p-4 sm:p-6">
            {deviceError && (
              <div className="mb-4 flex flex-col gap-3 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm text-red-100 sm:flex-row sm:items-center sm:justify-between">
                <span>{deviceError}</span>
                {isPermissionError && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="shrink-0 border-red-200/20 bg-red-200/10 text-red-50 hover:bg-red-200/20"
                    onClick={() => void startMicPreview()}
                  >
                    Tekrar dene
                  </Button>
                )}
              </div>
            )}

            {activeSection === "voice" && (
              <section className="space-y-5">
                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <Label className="text-sm font-semibold text-white">Mikrofon testi</Label>
                      <p className="mt-1 text-xs text-white/42">{selectedMicName}</p>
                    </div>
                    <Radio className="h-5 w-5 text-emerald-300" />
                  </div>
                  <div className="grid grid-cols-12 gap-1.5">
                    {Array.from({ length: 24 }).map((_, index) => {
                      const active = micLevel >= ((index + 1) / 24) * 100;
                      return (
                        <div
                          key={index}
                          className={cn(
                            "h-8 rounded-md border border-white/5 bg-white/[0.045] transition-colors",
                            active && index < 15 && "bg-emerald-400/70",
                            active && index >= 15 && index < 20 && "bg-amber-300/80",
                            active && index >= 20 && "bg-red-400/80"
                          )}
                        />
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="mb-3 flex justify-between">
                    <div>
                      <Label className="text-sm font-semibold text-white">Ses algılama hassasiyeti</Label>
                      <p className="mt-1 text-xs text-white/42">Daha yüksek değerler daha sessiz konuşmaları algılar.</p>
                    </div>
                    <span className="rounded-full bg-white/10 px-2 py-1 text-xs text-white/60">
                      {Math.round(settings.micSensitivity * 100)}%
                    </span>
                  </div>
                  <Slider
                    value={[settings.micSensitivity * 100]}
                    min={1}
                    max={100}
                    onValueChange={(value) => updateSetting("micSensitivity", value[0] / 100)}
                  />
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Button onClick={handleTestSound} className="h-11 gap-2 rounded-xl bg-indigo-500 hover:bg-indigo-400">
                    <Volume2 className="h-4 w-4" />
                    Test sesi çal
                  </Button>
                  <Button
                    variant="outline"
                    onClick={onReconnectVoice}
                    disabled={!isVoiceConnected}
                    className="h-11 gap-2 rounded-xl border-white/10 bg-white/[0.04] text-white hover:bg-white/[0.08]"
                  >
                    <RefreshCcw className="h-4 w-4" />
                    Sese yeniden bağlan
                  </Button>
                </div>
              </section>
            )}

            {activeSection === "devices" && (
              <section className="space-y-5">
                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-white">Giriş cihazı</Label>
                  <Select value={settings.deviceId || "default"} onValueChange={(value) => updateSetting("deviceId", value)}>
                    <SelectTrigger className="h-11 rounded-xl border-white/10 bg-white/[0.04] text-white">
                      <SelectValue placeholder="Mikrofon seç" />
                    </SelectTrigger>
                    <SelectContent className="border-white/10 bg-[#17151f] text-white">
                      <SelectItem value="default">Varsayılan mikrofon</SelectItem>
                      {microphones.filter((mic) => mic.deviceId).map((mic, index) => (
                        <SelectItem key={mic.deviceId} value={mic.deviceId}>
                          {getDeviceLabel(mic, "Mikrofon", index)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label className="text-sm font-semibold text-white">Çıkış cihazı</Label>
                  <Select value={settings.outputDeviceId || "default"} onValueChange={(value) => updateSetting("outputDeviceId", value)}>
                    <SelectTrigger className="h-11 rounded-xl border-white/10 bg-white/[0.04] text-white">
                      <SelectValue placeholder="Çıkış seç" />
                    </SelectTrigger>
                    <SelectContent className="border-white/10 bg-[#17151f] text-white">
                      <SelectItem value="default">Varsayılan çıkış</SelectItem>
                      {speakers.filter((speaker) => speaker.deviceId).map((speaker, index) => (
                        <SelectItem key={speaker.deviceId} value={speaker.deviceId}>
                          {getDeviceLabel(speaker, "Hoparlör", index)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-white/38">Çıkış değiştirme Chromium tarayıcılarda setSinkId ile desteklenir.</p>
                </div>
              </section>
            )}

            {activeSection === "advanced" && (
              <section className="space-y-5">
                <Tabs
                  value={settings.qualityMode || "balanced"}
                  onValueChange={(value) => updateSetting("qualityMode", value as AudioQualityMode)}
                >
                  <TabsList className="grid h-12 w-full grid-cols-3 rounded-xl bg-white/[0.05]">
                    <TabsTrigger value="low-latency" className="gap-2 rounded-lg text-xs">
                      <Zap className="h-3.5 w-3.5" />
                      Hızlı
                    </TabsTrigger>
                    <TabsTrigger value="balanced" className="gap-2 rounded-lg text-xs">
                      <Waves className="h-3.5 w-3.5" />
                      Dengeli
                    </TabsTrigger>
                    <TabsTrigger value="high-quality" className="gap-2 rounded-lg text-xs">
                      <Speaker className="h-3.5 w-3.5" />
                      Kalite
                    </TabsTrigger>
                  </TabsList>
                </Tabs>

                {[
                  ["noiseSuppression", "Gürültü azaltma", "Arka plan gürültüsünü daha güçlü bastırır."] as const,
                  ["echoCancellation", "Yankı engelleme", "Geri besleme ve yankıyı engeller."] as const,
                  ["autoGainControl", "Otomatik ses dengeleme", "Mikrofon ses yüksekliğini otomatik dengeler."] as const,
                ].map(([key, title, description]) => (
                  <div key={key} className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <div>
                      <Label className="text-sm font-semibold text-white">{title}</Label>
                      <p className="mt-1 text-xs text-white/42">{description}</p>
                    </div>
                    <Switch checked={settings[key]} onCheckedChange={(value) => updateSetting(key, value)} />
                  </div>
                ))}

                <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                  <div className="mb-3 flex justify-between">
                    <Label className="text-sm font-semibold text-white">Mikrofon kazancı</Label>
                    <span className="text-xs text-white/55">{Math.round((settings.micGain ?? 1) * 10) / 10}x</span>
                  </div>
                  <Slider
                    value={[(settings.micGain ?? 1) * 25]}
                    min={25}
                    max={100}
                    onValueChange={(value) => updateSetting("micGain", value[0] / 25)}
                  />
                </div>
              </section>
            )}

            <div className="mt-6 flex justify-between border-t border-white/10 pt-4">
              <Button variant="ghost" className="gap-2 text-white/55 hover:bg-white/[0.06] hover:text-white" onClick={handleReset}>
                <RotateCcw className="h-4 w-4" />
                Sıfırla
              </Button>
              <Button className="rounded-xl bg-white text-[#111019] hover:bg-white/90" onClick={() => onOpenChange(false)}>
                Tamam
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
