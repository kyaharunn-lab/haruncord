"use client";

import { useState, useEffect } from "react";
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
import { RotateCcw } from "lucide-react";
import { AudioSettings } from "@/lib/webrtc";

interface AudioSettingsDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  settings: AudioSettings & { outputDeviceId?: string };
  onSettingsChange: (settings: AudioSettings & { outputDeviceId?: string }) => void;
}

const DEFAULT_SETTINGS: AudioSettings & { outputDeviceId?: string } = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  micSensitivity: 0.03,
  gateLevel: 0.5,
  gateSmoothing: 0.5,
  micGain: 1.0,
  deviceId: "default",
  outputDeviceId: "default",
};

export function AudioSettingsDialog({
  isOpen,
  onOpenChange,
  settings,
  onSettingsChange,
}: AudioSettingsDialogProps) {
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    const fetchDevices = async () => {
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        
        setMicrophones(devices.filter((d) => d.kind === "audioinput"));
        setSpeakers(devices.filter((d) => d.kind === "audiooutput"));
      } catch (err) {
        console.error("Cihaz listesi alınamadı:", err);
      }
    };

    if (isOpen) {
      fetchDevices();
    }
  }, [isOpen]);

  const updateSetting = (key: keyof (AudioSettings & { outputDeviceId?: string }), value: any) => {
    const newSettings = { ...settings, [key]: value };
    onSettingsChange(newSettings);
    localStorage.setItem("kanka_audio_settings", JSON.stringify(newSettings));
  };

  const handleReset = () => {
    onSettingsChange(DEFAULT_SETTINGS);
    localStorage.setItem("kanka_audio_settings", JSON.stringify(DEFAULT_SETTINGS));
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[425px] bg-card border-border max-h-[90vh] overflow-y-auto">
        <DialogHeader className="flex flex-row items-center justify-between">
          <DialogTitle className="text-xl font-bold">Ses Ayarları</DialogTitle>
          <Button variant="ghost" size="sm" onClick={handleReset} className="h-8 gap-2 text-xs text-muted-foreground hover:text-foreground">
            <RotateCcw className="w-3 h-3" />
            Sıfırla
          </Button>
        </DialogHeader>
        
        <div className="space-y-6 py-4">
          {/* Cihaz Seçimi */}
          <div className="space-y-4">
            <div className="space-y-2">
              <Label className="text-sm font-semibold">Mikrofon</Label>
              <Select
                value={settings.deviceId || "default"}
                onValueChange={(val) => updateSetting("deviceId", val)}
              >
                <SelectTrigger className="w-full bg-background border-border">
                  <SelectValue placeholder="Mikrofon seçin" />
                </SelectTrigger>
                <SelectContent>
                  {microphones.map((mic) => (
                    <SelectItem key={mic.deviceId} value={mic.deviceId}>
                      {mic.label || "Bilinmeyen Mikrofon"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold">Hoparlör / Çıkış</Label>
              <Select
                value={settings.outputDeviceId || "default"}
                onValueChange={(val) => updateSetting("outputDeviceId", val)}
              >
                <SelectTrigger className="w-full bg-background border-border">
                  <SelectValue placeholder="Çıkış cihazı seçin" />
                </SelectTrigger>
                <SelectContent>
                  {speakers.map((spk) => (
                    <SelectItem key={spk.deviceId} value={spk.deviceId}>
                      {spk.label || "Bilinmeyen Hoparlör"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="h-px bg-border" />

          {/* Gelişmiş Filtreler */}
          <div className="space-y-5">
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <Label className="text-xs font-bold uppercase text-muted-foreground">Mikrofon Hassasiyeti</Label>
                <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded">%{Math.round(settings.micSensitivity * 100)}</span>
              </div>
              <Slider
                value={[settings.micSensitivity * 100]}
                max={100}
                onValueChange={(val) => updateSetting("micSensitivity", val[0] / 100)}
              />
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <Label className="text-xs font-bold uppercase text-muted-foreground">Gürültü Kapısı Seviyesi</Label>
                <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded">%{Math.round((settings.gateLevel ?? 0.5) * 100)}</span>
              </div>
              <Slider
                value={[(settings.gateLevel ?? 0.5) * 100]}
                max={100}
                onValueChange={(val) => updateSetting("gateLevel", val[0] / 100)}
              />
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <Label className="text-xs font-bold uppercase text-muted-foreground">Gate Yumuşatma</Label>
                <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded">%{Math.round((settings.gateSmoothing ?? 0.5) * 100)}</span>
              </div>
              <Slider
                value={[(settings.gateSmoothing ?? 0.5) * 100]}
                max={100}
                onValueChange={(val) => updateSetting("gateSmoothing", val[0] / 100)}
              />
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <Label className="text-xs font-bold uppercase text-muted-foreground">Mikrofon Kazancı (Boost)</Label>
                <span className="text-[10px] font-mono bg-muted px-1.5 py-0.5 rounded">{Math.round((settings.micGain ?? 1.0) * 10) / 10}x</span>
              </div>
              <Slider
                value={[(settings.micGain ?? 1.0) * 25]} // 1.0 - 4.0 scale
                min={25}
                max={100}
                onValueChange={(val) => updateSetting("micGain", val[0] / 25)}
              />
            </div>
          </div>

          <div className="h-px bg-border" />

          {/* Ses İşleme Donanımsal Ayarları */}
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-semibold">Yankı Önleme</Label>
                <p className="text-[11px] text-muted-foreground">Geri bildirimi engeller.</p>
              </div>
              <Switch
                checked={settings.echoCancellation}
                onCheckedChange={(val) => updateSetting("echoCancellation", val)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-semibold">Donanımsal Gürültü Azaltma</Label>
                <p className="text-[11px] text-muted-foreground">Arka plan seslerini temizler.</p>
              </div>
              <Switch
                checked={settings.noiseSuppression}
                onCheckedChange={(val) => updateSetting("noiseSuppression", val)}
              />
            </div>

            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label className="text-sm font-semibold">Otomatik Kazanç (AGC)</Label>
                <p className="text-[11px] text-muted-foreground">Seviyenizi otomatik dengeler.</p>
              </div>
              <Switch
                checked={settings.autoGainControl}
                onCheckedChange={(val) => updateSetting("autoGainControl", val)}
              />
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
